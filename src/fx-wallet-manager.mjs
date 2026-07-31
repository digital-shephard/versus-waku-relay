import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, Wallet, formatUnits, getAddress, keccak256 } from "ethers";

const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)"];
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-f]{64}$/;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function unsigned(value, label, { positive = false } = {}) {
  const normalized = String(value ?? "");
  if (!UINT.test(normalized) || (positive && BigInt(normalized) === 0n)) {
    throw new TypeError(`${label} must be an unsigned integer`);
  }
  return normalized;
}

function environmentName(value, label) {
  const normalized = String(value || "");
  if (!ENV_NAME.test(normalized)) {
    throw new TypeError(`${label} must be an environment-variable name`);
  }
  return normalized;
}

export function validateWalletManifest(input) {
  const manifest = object(input, "wallet manifest");
  if (manifest.schema !== "versus-fx-relay-wallet-management" || manifest.schemaVersion !== 1) {
    throw new TypeError("wallet manifest schema is unsupported");
  }
  if (!Array.isArray(manifest.chains) || manifest.chains.length < 1) {
    throw new TypeError("wallet manifest requires at least one chain");
  }
  const seen = new Set();
  const chains = manifest.chains.map((entry, index) => {
    const chain = object(entry, `chain ${index}`);
    const chainId = unsigned(chain.chainId, `chain ${index}.chainId`, { positive: true });
    if (seen.has(chainId)) throw new TypeError(`duplicate chain ${chainId}`);
    seen.add(chainId);
    if (chain.network !== `eip155:${chainId}`) {
      throw new TypeError(`chain ${chainId} network does not match its chain ID`);
    }
    const policy = object(chain.gasPolicy, `chain ${chainId}.gasPolicy`);
    const minimumTransactions = Number(policy.minimumTransactions);
    const targetTransactions = Number(policy.targetTransactions);
    if (!Number.isSafeInteger(minimumTransactions) || !Number.isSafeInteger(targetTransactions) || minimumTransactions < 1 || targetTransactions < minimumTransactions) {
      throw new TypeError(`chain ${chainId} transaction targets are invalid`);
    }
    const minimumAbsoluteAtomic = unsigned(policy.minimumAbsoluteAtomic, `chain ${chainId}.minimumAbsoluteAtomic`);
    const targetAbsoluteAtomic = unsigned(policy.targetAbsoluteAtomic, `chain ${chainId}.targetAbsoluteAtomic`);
    if (BigInt(targetAbsoluteAtomic) < BigInt(minimumAbsoluteAtomic)) {
      throw new TypeError(`chain ${chainId} target gas reserve is below minimum`);
    }
    return {
      chainId,
      network: chain.network,
      label: String(chain.label || chain.network),
      nativeSymbol: String(chain.nativeSymbol || "ETH"),
      rpcEnv: environmentName(chain.rpcEnv, `chain ${chainId}.rpcEnv`),
      feeAssets: (() => {
        if (!Array.isArray(chain.feeAssets) || chain.feeAssets.length < 1) {
          throw new TypeError(`chain ${chainId} requires at least one fee asset`);
        }
        const assets = new Set();
        return chain.feeAssets.map((entry, assetIndex) => {
          const feeAsset = object(entry, `chain ${chainId}.feeAssets[${assetIndex}]`);
          const asset = getAddress(feeAsset.asset).toLowerCase();
          if (assets.has(asset)) throw new TypeError(`chain ${chainId} has duplicate fee asset ${asset}`);
          assets.add(asset);
          const decimals = Number(feeAsset.decimals);
          if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
            throw new TypeError(`chain ${chainId} fee asset decimals are invalid`);
          }
          const symbol = String(feeAsset.symbol || "").trim();
          if (!symbol || symbol.length > 16) throw new TypeError(`chain ${chainId} fee asset symbol is invalid`);
          return { asset, symbol, decimals };
        });
      })(),
      gasPolicy: {
        estimatedGasPerSettlement: unsigned(policy.estimatedGasPerSettlement, `chain ${chainId}.estimatedGasPerSettlement`, { positive: true }),
        minimumTransactions,
        targetTransactions,
        minimumAbsoluteAtomic,
        targetAbsoluteAtomic,
      },
    };
  });
  const exactFactoriesManifest = String(manifest.exactFactoriesManifest || "");
  if (!exactFactoriesManifest || path.isAbsolute(exactFactoriesManifest)) {
    throw new TypeError("exactFactoriesManifest must be a repository-relative path");
  }
  return { schema: manifest.schema, schemaVersion: manifest.schemaVersion, exactFactoriesManifest, chains };
}

export function loadWalletManifest(filePath) {
  return validateWalletManifest(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function loadExactFactories(filePath, walletManifest) {
  const input = object(JSON.parse(fs.readFileSync(filePath, "utf8")), "exact factory manifest");
  if (input.schema !== "versus-fx-x402-exact-factories" || input.schemaVersion !== 1 || !Array.isArray(input.factories)) {
    throw new TypeError("exact factory manifest is unsupported");
  }
  const configuredChains = new Map(walletManifest.chains.map((chain) => [chain.chainId, chain]));
  const seen = new Set();
  const factories = input.factories.map((entry) => {
    const factory = object(entry, "exact factory");
    const chainId = unsigned(factory.chainId, "factory.chainId", { positive: true });
    if (!configuredChains.has(chainId)) throw new TypeError(`exact factory chain ${chainId} is not managed`);
    const asset = getAddress(factory.asset).toLowerCase();
    const metadata = configuredChains.get(chainId).feeAssets.find((entry) => entry.asset === asset);
    if (!metadata) throw new TypeError(`exact factory asset ${chainId}:${asset} is not managed`);
    const key = `${chainId}:${asset}`;
    if (seen.has(key)) throw new TypeError(`duplicate exact factory ${key}`);
    seen.add(key);
    const factoryRuntimeCodeHash = String(factory.factoryRuntimeCodeHash || "").toLowerCase();
    if (!BYTES32.test(factoryRuntimeCodeHash)) {
      throw new TypeError(`exact factory ${key} runtime hash is invalid`);
    }
    return {
      chainId,
      network: `eip155:${chainId}`,
      asset,
      factoryAddress: getAddress(factory.factoryAddress).toLowerCase(),
      factoryRuntimeCodeHash,
      htlcAddress: getAddress(factory.htlcAddress).toLowerCase(),
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      tokenName: String(factory.tokenName || ""),
      tokenVersion: String(factory.tokenVersion || ""),
    };
  });
  const deploymentId = String(input.deploymentId || "").toLowerCase();
  if (!BYTES32.test(deploymentId)) throw new TypeError("exact factory deployment ID is invalid");
  return { schema: input.schema, schemaVersion: input.schemaVersion, deploymentId, factories };
}

export function resolveWalletKeyPath(env, chain) {
  const selected = env.VERSUS_FX_EXACT_SETTLER_KEY_PATH;
  if (!selected) throw new Error("VERSUS_FX_EXACT_SETTLER_KEY_PATH is required");
  return path.resolve(selected);
}

export function readWalletKey(filePath) {
  const stat = fs.statSync(filePath);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(`wallet key permissions are too broad: ${filePath}`);
  }
  const privateKey = fs.readFileSync(filePath, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error(`wallet key file is invalid: ${filePath}`);
  return privateKey;
}

export function gasTargets(chain, gasPriceAtomic) {
  const price = BigInt(unsigned(gasPriceAtomic, "gas price"));
  const perSettlement = BigInt(chain.gasPolicy.estimatedGasPerSettlement) * price;
  const minimumByCalls = perSettlement * BigInt(chain.gasPolicy.minimumTransactions);
  const targetByCalls = perSettlement * BigInt(chain.gasPolicy.targetTransactions);
  const minimum = minimumByCalls > BigInt(chain.gasPolicy.minimumAbsoluteAtomic) ? minimumByCalls : BigInt(chain.gasPolicy.minimumAbsoluteAtomic);
  const target = targetByCalls > BigInt(chain.gasPolicy.targetAbsoluteAtomic) ? targetByCalls : BigInt(chain.gasPolicy.targetAbsoluteAtomic);
  return { perSettlement, minimum, target };
}

export function walletHealth(balanceAtomic, targets) {
  const balance = BigInt(balanceAtomic);
  if (balance < targets.minimum) return "LOW";
  if (balance < targets.target) return "REFILL";
  return "OK";
}

export async function collectWalletStatus({ manifest, factories, env, providerFactory = (url, chainId) => new JsonRpcProvider(url, Number(chainId), { staticNetwork: true }), tokenBalance = async (provider, asset, account) => (new Contract(asset, ERC20_ABI, provider)).balanceOf(account) } = {}) {
  const byChain = new Map();
  for (const factory of factories.factories) {
    if (!byChain.has(factory.chainId)) byChain.set(factory.chainId, []);
    byChain.get(factory.chainId).push(factory);
  }
  const results = [];
  for (const chain of manifest.chains) {
    const rpcUrl = String(env[chain.rpcEnv] || "").trim();
    if (!/^https?:\/\//.test(rpcUrl)) throw new Error(`${chain.rpcEnv} is required for ${chain.label}`);
    const keyPath = resolveWalletKeyPath(env, chain);
    const wallet = new Wallet(readWalletKey(keyPath));
    const provider = providerFactory(rpcUrl, chain.chainId);
    const network = await provider.getNetwork();
    if (String(network.chainId) !== chain.chainId) throw new Error(`${chain.label} RPC returned chain ${network.chainId}`);
    const [nativeBalance, feeData] = await Promise.all([provider.getBalance(wallet.address), provider.getFeeData()]);
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
    if (gasPrice == null || gasPrice <= 0n) throw new Error(`${chain.label} RPC returned no usable gas price`);
    const targets = gasTargets(chain, gasPrice.toString());
    const assets = [];
    for (const factory of byChain.get(chain.chainId) || []) {
      const [balanceValue, tokenCode, factoryCode] = await Promise.all([
        tokenBalance(provider, factory.asset, wallet.address),
        provider.getCode(factory.asset),
        provider.getCode(factory.factoryAddress),
      ]);
      const balance = BigInt(balanceValue);
      const factoryCodeHash = factoryCode === "0x" ? null : keccak256(factoryCode).toLowerCase();
      assets.push({
        ...factory,
        balanceAtomic: balance.toString(),
        tokenHasCode: tokenCode !== "0x",
        factoryCodeHash,
        factoryVerified: tokenCode !== "0x" && factoryCodeHash === factory.factoryRuntimeCodeHash,
      });
    }
    results.push({
      chainId: chain.chainId,
      network: chain.network,
      label: chain.label,
      nativeSymbol: chain.nativeSymbol,
      address: wallet.address.toLowerCase(),
      keyPath,
      nativeBalanceAtomic: nativeBalance.toString(),
      gasPriceAtomic: gasPrice.toString(),
      estimatedSettlementCostAtomic: targets.perSettlement.toString(),
      minimumGasReserveAtomic: targets.minimum.toString(),
      targetGasReserveAtomic: targets.target.toString(),
      estimatedSettlementsRemaining: targets.perSettlement === 0n ? null : (nativeBalance / targets.perSettlement).toString(),
      fundingNeededAtomic: nativeBalance >= targets.target ? "0" : (targets.target - nativeBalance).toString(),
      health: walletHealth(nativeBalance, targets),
      assets,
    });
  }
  return results;
}

export function publicWalletStatus(status) {
  return status.map(({ keyPath: _keyPath, ...entry }) => entry);
}

export function formatAtomic(value, decimals = 18, precision = 6) {
  const formatted = formatUnits(BigInt(value), decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.slice(0, precision).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function selectFactory(factories, chainId, asset = null) {
  const candidates = factories.factories.filter((factory) => factory.chainId === String(chainId));
  if (!candidates.length) throw new Error(`chain ${chainId} has no exact fee asset`);
  if (!asset && candidates.length === 1) return candidates[0];
  const normalized = asset ? getAddress(asset).toLowerCase() : null;
  const selected = candidates.find((factory) => factory.asset === normalized);
  if (!selected) throw new Error(`asset ${asset} is not managed on chain ${chainId}`);
  return selected;
}

export function buildSweepRequest({ requestId, payer, inputFactory, maximumInputAtomic, outputFactory, outputAmountAtomic, destinationAddress, secretHash }) {
  const maximumInput = unsigned(maximumInputAtomic, "maximum input", { positive: true });
  const outputAmount = unsigned(outputAmountAtomic, "output amount", { positive: true });
  if (inputFactory.chainId === outputFactory.chainId) throw new Error("a Versus sweep requires distinct source and destination chains");
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(requestId))) throw new Error("request ID must be bytes32");
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(secretHash))) throw new Error("secret hash must be bytes32");
  return {
    requestId: String(requestId).toLowerCase(),
    payer: getAddress(payer),
    input: { network: inputFactory.network, asset: inputFactory.asset },
    maximumInputAtomic: maximumInput,
    output: { network: outputFactory.network, asset: outputFactory.asset, amountAtomic: outputAmount },
    destinationAddress: getAddress(destinationAddress),
    secretHash: String(secretHash).toLowerCase(),
  };
}

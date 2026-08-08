import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildSweepRequest, collectWalletStatus, gasTargets, loadExactFactories, loadWalletManifest, publicWalletStatus, validateWalletManifest } from "../src/fx-wallet-manager.mjs";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function manifest() {
  return validateWalletManifest({
    schema: "versus-fx-relay-wallet-management",
    schemaVersion: 1,
    exactFactoriesManifest: "config/factories.json",
    chains: [{
      chainId: "84532",
      network: "eip155:84532",
      label: "Base Sepolia",
      nativeSymbol: "ETH",
      rpcEnv: "BASE_RPC",
      feeAssets: [{
        asset: "0x0000000000000000000000000000000000000001",
        symbol: "USDC",
        decimals: 6
      }],
      gasPolicy: {
        estimatedGasPerSettlement: "2000000",
        minimumTransactions: 2,
        targetTransactions: 10,
        minimumAbsoluteAtomic: "100",
        targetAbsoluteAtomic: "1000"
      }
    }]
  });
}

test("wallet manifest rejects duplicate chains", () => {
  const input = manifest();
  input.chains.push(structuredClone(input.chains[0]));
  assert.throws(() => validateWalletManifest(input), /duplicate chain/);
});

test("repository wallet and exact-factory manifests agree", () => {
  const walletPath = path.join(process.cwd(), "config", "fx-wallet-management.json");
  const walletManifest = loadWalletManifest(walletPath);
  const factoriesPath = path.resolve(process.cwd(), walletManifest.exactFactoriesManifest);
  const factories = loadExactFactories(factoriesPath, walletManifest);
  const managedAssets = walletManifest.chains.flatMap((chain) =>
    chain.feeAssets.map((asset) => `${chain.chainId}:${asset.asset}`)
  ).sort();
  assert.equal(factories.factories.length, managedAssets.length);
  assert.deepEqual(
    factories.factories.map((entry) => `${entry.chainId}:${entry.asset}`).sort(),
    managedAssets
  );
});

test("gas targets honor transaction runway and absolute floors", () => {
  const targets = gasTargets(manifest().chains[0], "10");
  assert.equal(targets.perSettlement, 20_000_000n);
  assert.equal(targets.minimum, 40_000_000n);
  assert.equal(targets.target, 200_000_000n);
});

test("status checks every chain without exposing key paths", async () => {
  const temporary = path.join(process.cwd(), `test-wallet-key-${process.pid}`);
  fs.writeFileSync(temporary, `${KEY}\n`, { mode: 0o600 });
  try {
    const status = await collectWalletStatus({
      manifest: manifest(),
      factories: { factories: [{ chainId: "84532", network: "eip155:84532", asset: "0x0000000000000000000000000000000000000001", factoryAddress: "0x0000000000000000000000000000000000000002", factoryRuntimeCodeHash: "0x2e8e5a6bf1f0a0a54b94e2944e11fca4cdeecb0b8c6f1c9c8e2c5f36f102ec0f", symbol: "USDC", decimals: 6 }] },
      env: { BASE_RPC: "https://example.test", VERSUS_FX_EXACT_SETTLER_KEY_PATH: temporary },
      providerFactory: () => ({
        getNetwork: async () => ({ chainId: 84532n }),
        getBalance: async () => 500_000_000n,
        getFeeData: async () => ({ maxFeePerGas: 10n }),
        getCode: async (address) => address.endsWith("1") ? "0x01" : "0x02"
      }),
      tokenBalance: async () => 12_345n
    });
    assert.equal(status[0].health, "OK");
    assert.equal(status[0].assets[0].balanceAtomic, "12345");
    assert.equal(publicWalletStatus(status)[0].keyPath, undefined);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
});

test("sweep requests bind payer, route, cap, recipient, and secret hash", () => {
  const request = buildSweepRequest({
    requestId: `0x${"11".repeat(32)}`,
    payer: "0x0000000000000000000000000000000000000003",
    inputFactory: { chainId: "84532", network: "eip155:84532", asset: "0x0000000000000000000000000000000000000001" },
    maximumInputAtomic: "11000",
    outputFactory: { chainId: "421614", network: "eip155:421614", asset: "0x0000000000000000000000000000000000000002" },
    outputAmountAtomic: "10000",
    destinationAddress: "0x0000000000000000000000000000000000000004",
    secretHash: `0x${"22".repeat(32)}`
  });
  assert.equal(request.maximumInputAtomic, "11000");
  assert.equal(request.output.amountAtomic, "10000");
  assert.equal(request.destinationAddress, "0x0000000000000000000000000000000000000004");
});

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { Wallet, hexlify, keccak256, parseUnits, randomBytes } from "ethers";
import { ROOT, loadEnv } from "./lib/config.mjs";
import {
  buildSweepRequest,
  collectWalletStatus,
  formatAtomic,
  loadExactFactories,
  loadWalletManifest,
  publicWalletStatus,
  readWalletKey,
  resolveWalletKeyPath,
  selectFactory,
} from "../src/fx-wallet-manager.mjs";

const require = createRequire(import.meta.url);
const { x402Client } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { wrapFetchWithPayment } = require("@x402/fetch");
const TERMINAL = new Set(["complete", "refunded", "defaulted"]);

function usage() {
  process.stdout.write(`Usage:
  npm run wallet:status -- [--json]
  npm run wallet:funding-plan -- [--json]
  npm run wallet:verify -- [--json]
  npm run wallet:sweep -- --from <chain-id> --to <chain-id> \\
    --output <decimal> --max-input <decimal> [--destination <address>] \\
    [--input-asset <address>] [--output-asset <address>] \\
    [--endpoint <url>] [--yes]

Sweep configuration may also come from VERSUS_FX_SWEEP_ENDPOINT,
VERSUS_FX_SWEEP_RECOVERY_DIR, and VERSUS_FX_SWEEP_RECOVERY_PASSWORD_FILE.
`);
}

function argumentsOf(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["json", "yes", "help"].includes(key)) {
      result[key] = true;
      continue;
    }
    if (index + 1 >= values.length || values[index + 1].startsWith("--")) {
      throw new Error(`--${key} requires a value`);
    }
    result[key] = values[index + 1];
    index += 1;
  }
  return result;
}

function environment() {
  return { ...loadEnv(), ...process.env };
}

function loadConfiguration(env) {
  const manifestPath = path.resolve(ROOT, env.VERSUS_FX_WALLET_MANIFEST || "config/fx-wallet-management.json");
  const manifest = loadWalletManifest(manifestPath);
  const factoriesPath = path.resolve(ROOT, manifest.exactFactoriesManifest);
  const factories = loadExactFactories(factoriesPath, manifest);
  return { manifest, factories };
}

function printTable(status, fundingOnly = false) {
  for (const chain of status) {
    process.stdout.write(
      `${chain.label}\n` +
      `  address: ${chain.address}\n` +
      `  gas: ${formatAtomic(chain.nativeBalanceAtomic)} ${chain.nativeSymbol} (${chain.health})\n` +
      `  estimated settlements left: ${chain.estimatedSettlementsRemaining}\n` +
      `  target refill: ${formatAtomic(chain.fundingNeededAtomic)} ${chain.nativeSymbol}\n`
    );
    if (!fundingOnly) {
      for (const asset of chain.assets) {
        process.stdout.write(`  earned ${asset.symbol}: ${formatAtomic(asset.balanceAtomic, asset.decimals)}\n`);
      }
    }
  }
}

function clientSigner(wallet) {
  return {
    address: wallet.address,
    signTypedData: ({ domain, types, primaryType, message }) =>
      wallet.signTypedData(domain, { [primaryType]: types[primaryType] }, message),
  };
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readProtectedText(filePath, label) {
  const stat = fs.statSync(filePath);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} permissions are too broad`);
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

async function json(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`endpoint returned non-JSON status ${response.status}`);
  }
}

async function waitFor(endpoint, tradeId, predicate, deadline) {
  while (Date.now() < deadline) {
    const response = await fetch(`${endpoint}/${tradeId}`, { headers: { accept: "application/json" } });
    const body = await json(response);
    if (!response.ok) throw new Error(`sweep status failed (${response.status}): ${body.message || body.error}`);
    if (predicate(body.swap || {})) return body.swap;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("timed out waiting for the Versus sweep");
}

async function approve(message, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error("interactive confirmation is unavailable; inspect first and rerun with --yes");
  const prompt = readline.createInterface({ input, output });
  try {
    return /^yes$/i.test((await prompt.question(`${message} Type YES to continue: `)).trim());
  } finally {
    prompt.close();
  }
}

async function sweep(args, env, configuration) {
  const source = configuration.manifest.chains.find((chain) => chain.chainId === String(args.from || ""));
  const destination = configuration.manifest.chains.find((chain) => chain.chainId === String(args.to || ""));
  if (!source || !destination) throw new Error("--from and --to must name managed chains");
  const inputFactory = selectFactory(configuration.factories, source.chainId, args["input-asset"]);
  const outputFactory = selectFactory(configuration.factories, destination.chainId, args["output-asset"]);
  if (!args.output || !args["max-input"]) throw new Error("--output and --max-input are required decimal token amounts");
  const payer = new Wallet(readWalletKey(resolveWalletKeyPath(env, source)));
  const destinationWallet = new Wallet(readWalletKey(resolveWalletKeyPath(env, destination)));
  const endpoint = String(args.endpoint || env.VERSUS_FX_SWEEP_ENDPOINT || "").trim().replace(/\/$/, "");
  if (!/^https:\/\//.test(endpoint) && !/^http:\/\/127\.0\.0\.1(?::\d+)?/.test(endpoint)) {
    throw new Error("a public HTTPS or loopback VERSUS_FX_SWEEP_ENDPOINT is required");
  }
  const recoveryDirectory = path.resolve(env.VERSUS_FX_SWEEP_RECOVERY_DIR || path.join(ROOT, "wallet-recovery"));
  if (!env.VERSUS_FX_SWEEP_RECOVERY_PASSWORD_FILE) throw new Error("VERSUS_FX_SWEEP_RECOVERY_PASSWORD_FILE is required");
  const passwordFile = path.resolve(env.VERSUS_FX_SWEEP_RECOVERY_PASSWORD_FILE);
  const recoveryPassword = readProtectedText(passwordFile, "sweep recovery password file");
  if (recoveryPassword.length < 12) throw new Error("sweep recovery password is too short");

  const requestId = hexlify(randomBytes(32)).toLowerCase();
  const secret = hexlify(randomBytes(32)).toLowerCase();
  const request = buildSweepRequest({
    requestId,
    payer: payer.address,
    inputFactory,
    maximumInputAtomic: parseUnits(args["max-input"], inputFactory.decimals).toString(),
    outputFactory,
    outputAmountAtomic: parseUnits(args.output, outputFactory.decimals).toString(),
    destinationAddress: args.destination || destinationWallet.address,
    secretHash: keccak256(secret),
  });
  const recoveryPath = path.join(recoveryDirectory, `${requestId.slice(2)}.json`);
  const encryptedSecret = JSON.parse(await new Wallet(secret).encrypt(recoveryPassword));
  atomicWrite(recoveryPath, {
    schema: "versus-fx-relay-sweep-recovery",
    schemaVersion: 1,
    request,
    secretKeystore: encryptedSecret,
    createdAt: new Date().toISOString(),
  });

  const quoteResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
  });
  const quoteBody = await json(quoteResponse);
  if (quoteResponse.status !== 402) {
    throw new Error(`network could not prepare sweep (${quoteResponse.status}): ${quoteBody.message || quoteBody.error || "no quote"}`);
  }
  const quote = quoteBody.swap || {};
  const requiredAtomic = String(quote.input?.amountAtomic || quote.amount || "0");
  if (!/^\d+$/.test(requiredAtomic) || BigInt(requiredAtomic) <= 0n) throw new Error("network returned an invalid sweep requirement");
  if (
    quote.input?.network !== request.input.network ||
    String(quote.input?.asset || "").toLowerCase() !== request.input.asset ||
    quote.output?.network !== request.output.network ||
    String(quote.output?.asset || "").toLowerCase() !== request.output.asset ||
    String(quote.output?.amountAtomic || "") !== request.output.amountAtomic ||
    String(quote.destinationAddress || "").toLowerCase() !== request.destinationAddress.toLowerCase() ||
    BigInt(requiredAtomic) > BigInt(request.maximumInputAtomic)
  ) {
    throw new Error("network quote does not match the requested sweep bounds");
  }
  const status = await collectWalletStatus({ manifest: configuration.manifest, factories: configuration.factories, env });
  const sourceStatus = status.find((entry) => entry.chainId === source.chainId);
  const sourceAsset = sourceStatus.assets.find((asset) => asset.asset === inputFactory.asset);
  if (!sourceAsset || BigInt(sourceAsset.balanceAtomic) < BigInt(requiredAtomic)) {
    throw new Error("earned fee balance cannot cover the prepared sweep");
  }
  const quoteExpiryMs = Number(quote.expiresAt) * 1_000;

  process.stdout.write(
    `Versus sweep quote\n` +
    `  from: ${source.label} ${inputFactory.symbol}\n` +
    `  to: ${destination.label} ${outputFactory.symbol}\n` +
    `  destination: ${request.destinationAddress}\n` +
    `  exact output: ${formatAtomic(request.output.amountAtomic, outputFactory.decimals)}\n` +
    `  all-in input: ${formatAtomic(requiredAtomic, inputFactory.decimals)}\n` +
    `  relay fee: ${formatAtomic(quote.input?.facilitatorFeeAtomic || "0", inputFactory.decimals)}\n` +
    `  quote expires in: ${Math.max(0, Math.ceil((quoteExpiryMs - Date.now()) / 1_000))}s\n`
  );
  if (!(await approve("Authorize this x402 payment?", args.yes))) {
    process.stdout.write(`Declined. Reservation will expire; recovery retained at ${recoveryPath}.\n`);
    return;
  }
  if (!Number.isSafeInteger(Number(quote.expiresAt)) || Date.now() >= quoteExpiryMs - 3_000) {
    throw new Error("sweep quote expired before authorization; request a fresh quote");
  }

  const client = new x402Client().register(inputFactory.network, new ExactEvmScheme(clientSigner(payer)));
  const paidFetch = wrapFetchWithPayment(fetch, client);
  const paidResponse = await paidFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
  });
  const paidBody = await json(paidResponse);
  if (paidResponse.status !== 202) throw new Error(`sweep payment failed (${paidResponse.status}): ${paidBody.message || paidBody.error || "unknown"}`);
  const deadline = Date.now() + 15 * 60 * 1000;
  const locked = await waitFor(endpoint, requestId, (swap) => swap.status === "destination_locked" || TERMINAL.has(swap.status), deadline);
  if (locked.status !== "destination_locked") throw new Error(`sweep terminated before reveal: ${locked.status}`);
  const revealResponse = await fetch(`${endpoint}/${requestId}/reveal`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ secret }),
  });
  const revealBody = await json(revealResponse);
  if (revealResponse.status !== 202) throw new Error(`sweep reveal failed (${revealResponse.status}): ${revealBody.message || revealBody.error || "unknown"}`);
  const completed = await waitFor(endpoint, requestId, (swap) => TERMINAL.has(swap.status), deadline);
  atomicWrite(recoveryPath, {
    schema: "versus-fx-relay-sweep-recovery",
    schemaVersion: 1,
    request,
    secretKeystore: encryptedSecret,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    publicEvidence: completed,
  });
  if (completed.status !== "complete") throw new Error(`sweep ended as ${completed.status}; recovery: ${recoveryPath}`);
  process.stdout.write(`${JSON.stringify({
    complete: true,
    tradeId: requestId,
    sourceTransaction: paidBody.swap?.transaction || null,
    destinationTransaction: completed.destinationTransactionHash || null,
    outputAmountAtomic: completed.output?.amountAtomic || request.output.amountAtomic,
    recoveryPath,
  }, null, 2)}\n`);
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    usage();
    return;
  }
  const env = environment();
  const configuration = loadConfiguration(env);
  if (command === "sweep") {
    await sweep(args, env, configuration);
    return;
  }
  const status = await collectWalletStatus({ manifest: configuration.manifest, factories: configuration.factories, env });
  if (command === "status") {
    if (args.json) process.stdout.write(`${JSON.stringify(publicWalletStatus(status), null, 2)}\n`);
    else printTable(status);
    return;
  }
  if (command === "funding-plan") {
    const plan = publicWalletStatus(status).map((chain) => ({
      chainId: chain.chainId,
      label: chain.label,
      address: chain.address,
      nativeSymbol: chain.nativeSymbol,
      currentAtomic: chain.nativeBalanceAtomic,
      targetAtomic: chain.targetGasReserveAtomic,
      sendAtomic: chain.fundingNeededAtomic,
      health: chain.health,
    }));
    if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    else printTable(status, true);
    return;
  }
  if (command === "verify") {
    const evidence = {
      ok: status.every((chain) =>
        chain.health !== "LOW" && chain.assets.every((asset) => asset.factoryVerified)
      ),
      deploymentId: configuration.factories.deploymentId,
      chains: publicWalletStatus(status),
    };
    if (args.json) process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    else {
      printTable(status);
      process.stdout.write(`Deployment: ${evidence.deploymentId}\nVerification: ${evidence.ok ? "PASS" : "FAILED"}\n`);
    }
    if (!evidence.ok) process.exitCode = 2;
    return;
  }
  throw new Error(`unknown wallet command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

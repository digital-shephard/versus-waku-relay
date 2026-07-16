import path from "node:path";
import { Wallet, getAddress } from "ethers";

function integer(env, name, fallback, minimum, maximum) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(env, name, fallback = false) {
  const value = String(env[name] ?? fallback).toLowerCase();
  if (value !== "true" && value !== "false") throw new TypeError(`${name} must be true or false`);
  return value === "true";
}

function unsignedBigInt(env, name, fallback, minimum = 0n) {
  const text = String(env[name] ?? fallback);
  if (!/^\d+$/.test(text) || BigInt(text) < minimum) throw new RangeError(`${name} must be at least ${minimum}`);
  return BigInt(text);
}

export function loadNodeConfig(env = process.env) {
  const required = ["VERSUS_BASE_RPC_URL", "VERSUS_CHAIN_ID", "VERSUS_ARENA_ADDRESS", "VERSUS_RAIN_ATTESTOR_PRIVATE_KEY", "VERSUS_RAIN_START_BLOCK"];
  for (const name of required) if (!env[name]) throw new Error(`${name} is required`);
  const pollMs = integer(env, "VERSUS_RAIN_POLL_MS", 12_000, 10_000, 86_400_000);
  const graduationEnabled = boolean(env, "VERSUS_GRADUATION_ENABLED", false);
  const hatchQuoteEnabled = boolean(env, "VERSUS_HATCH_QUOTE_ENABLED", true);
  const hatchQuoteRefreshMs = integer(env, "VERSUS_HATCH_QUOTE_REFRESH_MS", 60_000, 10_000, 86_400_000);
  const hatchQuoteFullScanMs = integer(env, "VERSUS_HATCH_QUOTE_FULL_SCAN_MS", 600_000, hatchQuoteRefreshMs, 86_400_000);
  const hatchQuoteValidMs = integer(env, "VERSUS_HATCH_QUOTE_VALID_MS", 180_000, hatchQuoteRefreshMs, 86_400_000);
  const hatchQuoteStaleMs = integer(env, "VERSUS_HATCH_QUOTE_STALE_MS", 900_000, hatchQuoteValidMs, 86_400_000);
  const hatchQuoteBufferBps = integer(env, "VERSUS_HATCH_QUOTE_BUFFER_BPS", 300, 200, 300);
  const dailyCreditBudget = integer(env, "VERSUS_RPC_DAILY_CREDIT_BUDGET", 3_000_000, 100_000, 1_000_000_000);
  const rpcCreditsPerSecond = integer(env, "VERSUS_RPC_CREDITS_PER_SECOND", 500, 255, 1_000_000);
  const projectedCreditsPerPoll = 335 + (graduationEnabled ? 160 : 0);
  const quoteRefreshesPerDay = hatchQuoteEnabled ? Math.ceil(86_400_000 / hatchQuoteRefreshMs) : 0;
  const quoteFullScansPerDay = hatchQuoteEnabled ? Math.ceil(86_400_000 / hatchQuoteFullScanMs) : 0;
  const projectedHatchQuoteCredits = (quoteRefreshesPerDay + (quoteFullScansPerDay * 2)) * 80;
  const projectedBaseCredits = (Math.ceil(86_400_000 / pollMs) * projectedCreditsPerPoll) + projectedHatchQuoteCredits;
  if (projectedBaseCredits > dailyCreditBudget) {
    throw new Error(`rain polling projects ${projectedBaseCredits} credits/day above budget ${dailyCreditBudget}`);
  }
  const privateKey = env.VERSUS_RAIN_ATTESTOR_PRIVATE_KEY;
  const attestor = new Wallet(privateKey).address;
  let graduationPrivateKey = null;
  let graduationKeeper = null;
  if (graduationEnabled) {
    if (!env.VERSUS_GRADUATION_KEEPER_PRIVATE_KEY) {
      throw new Error("VERSUS_GRADUATION_KEEPER_PRIVATE_KEY is required when graduation is enabled");
    }
    graduationPrivateKey = env.VERSUS_GRADUATION_KEEPER_PRIVATE_KEY;
    graduationKeeper = new Wallet(graduationPrivateKey).address;
    if (graduationKeeper === attestor) {
      throw new Error("graduation keeper must not reuse the non-funded rain attestor key");
    }
  }
  const arena = getAddress(env.VERSUS_ARENA_ADDRESS);
  if (/^0x0{40}$/i.test(arena)) throw new Error("VERSUS_ARENA_ADDRESS cannot be zero");
  const statePath = path.resolve(env.VERSUS_NODE_STATE_PATH || "/data/state.json");
  return Object.freeze({
    rpcUrl: new URL(env.VERSUS_BASE_RPC_URL).toString(),
    chainId: BigInt(env.VERSUS_CHAIN_ID).toString(),
    arena,
    privateKey,
    attestor,
    startBlock: BigInt(env.VERSUS_RAIN_START_BLOCK).toString(),
    pollMs,
    confirmations: integer(env, "VERSUS_RAIN_CONFIRMATIONS", 2, 0, 10_000),
    maxBlockSpan: integer(env, "VERSUS_RAIN_MAX_BLOCK_SPAN", 2_000, 1, 100_000),
    distributionWindowMs: integer(env, "VERSUS_RAIN_DISTRIBUTION_MS", 5_000, 1_000, 86_400_000),
    hatchQuoteEnabled,
    hatchQuoteRefreshMs,
    hatchQuoteFullScanMs,
    hatchQuoteValidMs,
    hatchQuoteStaleMs,
    hatchQuoteBufferBps,
    projectedHatchQuoteCredits,
    graduationEnabled,
    graduationPrivateKey,
    graduationKeeper,
    graduationSubmissionDelayMs: integer(env, "VERSUS_GRADUATION_SUBMISSION_DELAY_MS", 0, 0, 86_400_000),
    graduationRebroadcastMs: integer(env, "VERSUS_GRADUATION_REBROADCAST_MS", 120_000, 10_000, 86_400_000),
    graduationMaxGasLimit: integer(env, "VERSUS_GRADUATION_MAX_GAS_LIMIT", 8_000_000, 100_000, 30_000_000),
    graduationMaxExecutionFeeWei: unsignedBigInt(
      env,
      "VERSUS_GRADUATION_MAX_EXECUTION_FEE_WEI",
      "5000000000000000",
      1n,
    ),
    dailyCreditBudget,
    rpcCreditsPerSecond,
    projectedBaseCredits,
    wakuRestUrl: new URL(env.VERSUS_WAKU_REST_URL || "http://nwaku:8645").toString(),
    clusterId: integer(env, "VERSUS_WAKU_CLUSTER_ID", 66, 0, 65_535),
    shardCount: integer(env, "VERSUS_WAKU_NUM_SHARDS", 8, 1, 1_024),
    statePath,
    graduationStatePath: path.resolve(
      env.VERSUS_GRADUATION_STATE_PATH || path.join(path.dirname(statePath), "graduation-state.json"),
    ),
    hatchQuoteCachePath: path.resolve(
      env.VERSUS_HATCH_QUOTE_CACHE_PATH || path.join(path.dirname(statePath), "hatch-quote.json"),
    ),
    healthPort: integer(env, "VERSUS_NODE_HEALTH_PORT", 8787, 1, 65_535),
  });
}

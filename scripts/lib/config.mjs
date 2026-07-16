import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_PATH = path.join(ROOT, ".env");
export const COMPOSE_PATH = path.join(ROOT, "deploy", "docker-compose.yml");

export function parseEnv(text) {
  const result = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) throw new Error(`invalid environment line: ${raw}`);
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

export function loadEnv(file = ENV_PATH) {
  if (!fs.existsSync(file)) throw new Error(`missing ${path.relative(ROOT, file)}; run npm run configure`);
  return parseEnv(fs.readFileSync(file, "utf8"));
}

function integer(env, name, minimum, maximum, fallback) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function boolean(env, name, fallback = false) {
  const value = String(env[name] ?? fallback).toLowerCase();
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

function unsignedBigInt(env, name, fallback, minimum = 0n) {
  const value = String(env[name] ?? fallback);
  if (!/^\d+$/.test(value) || BigInt(value) < minimum) throw new Error(`${name} must be at least ${minimum}`);
  return BigInt(value);
}

export function validateEnv(env, { allowPlaceholders = false } = {}) {
  const required = [
    "NWAKU_IMAGE", "PUBLIC_DOMAIN", "PUBLIC_IP", "VERSUS_WAKU_NODE_KEY", "VERSUS_WAKU_STATIC_PEER",
    "VERSUS_BASE_RPC_URL", "VERSUS_CHAIN_ID", "VERSUS_ARENA_ADDRESS", "VERSUS_RAIN_ATTESTOR_PRIVATE_KEY",
    "VERSUS_RAIN_START_BLOCK",
  ];
  for (const name of required) if (!env[name]) throw new Error(`${name} is required`);
  if (env.NWAKU_IMAGE !== "wakuorg/nwaku:v0.38.1") throw new Error("NWAKU_IMAGE must remain pinned to wakuorg/nwaku:v0.38.1 until an upgrade is validated");
  if (!/^[a-f0-9]{64}$/.test(env.VERSUS_WAKU_NODE_KEY)) throw new Error("VERSUS_WAKU_NODE_KEY must be 64 lowercase hexadecimal characters");
  if (!allowPlaceholders && /example\.org|203\.0\.113\.|replace_with/i.test(`${env.PUBLIC_DOMAIN} ${env.PUBLIC_IP} ${env.VERSUS_WAKU_STATIC_PEER}`)) {
    throw new Error("replace the example domain, IP, and static peer before deployment");
  }
  if (!/^\/[^\s]+\/p2p\/[^/\s]+$/.test(env.VERSUS_WAKU_STATIC_PEER)) throw new Error("VERSUS_WAKU_STATIC_PEER must be a complete peer multiaddress");
  if (!/^https:\/\//.test(env.VERSUS_BASE_RPC_URL)) throw new Error("VERSUS_BASE_RPC_URL must use HTTPS in production");
  if (!/^0x[a-fA-F0-9]{40}$/.test(env.VERSUS_ARENA_ADDRESS)) throw new Error("VERSUS_ARENA_ADDRESS must be an address");
  if (/^0x0{40}$/i.test(env.VERSUS_ARENA_ADDRESS)) throw new Error("VERSUS_ARENA_ADDRESS cannot be zero");
  if (!/^0x[a-fA-F0-9]{64}$/.test(env.VERSUS_RAIN_ATTESTOR_PRIVATE_KEY)) throw new Error("VERSUS_RAIN_ATTESTOR_PRIVATE_KEY must be a 32-byte hex key");
  const graduationEnabled = boolean(env, "VERSUS_GRADUATION_ENABLED", false);
  if (graduationEnabled) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(env.VERSUS_GRADUATION_KEEPER_PRIVATE_KEY || "")) {
      throw new Error("VERSUS_GRADUATION_KEEPER_PRIVATE_KEY must be a 32-byte hex key when graduation is enabled");
    }
    const attestor = new Wallet(env.VERSUS_RAIN_ATTESTOR_PRIVATE_KEY).address;
    const keeper = new Wallet(env.VERSUS_GRADUATION_KEEPER_PRIVATE_KEY).address;
    if (attestor === keeper) throw new Error("graduation keeper must not reuse the rain attestor key");
  }
  integer(env, "VERSUS_CHAIN_ID", 1, Number.MAX_SAFE_INTEGER);
  integer(env, "VERSUS_RAIN_START_BLOCK", 0, Number.MAX_SAFE_INTEGER);
  const pollMs = integer(env, "VERSUS_RAIN_POLL_MS", 10000, 86400000, 12000);
  const creditBudget = integer(env, "VERSUS_RPC_DAILY_CREDIT_BUDGET", 100000, 1000000000, 3000000);
  integer(env, "VERSUS_RPC_CREDITS_PER_SECOND", 255, 1000000, 500);
  const quoteEnabled = boolean(env, "VERSUS_HATCH_QUOTE_ENABLED", true);
  const quoteRefreshMs = integer(env, "VERSUS_HATCH_QUOTE_REFRESH_MS", 10000, 86400000, 60000);
  const quoteFullScanMs = integer(env, "VERSUS_HATCH_QUOTE_FULL_SCAN_MS", quoteRefreshMs, 86400000, 600000);
  const quoteValidMs = integer(env, "VERSUS_HATCH_QUOTE_VALID_MS", quoteRefreshMs, 86400000, 180000);
  integer(env, "VERSUS_HATCH_QUOTE_STALE_MS", quoteValidMs, 86400000, 900000);
  integer(env, "VERSUS_HATCH_QUOTE_BUFFER_BPS", 200, 300, 300);
  const classStateRefreshMs = integer(env, "VERSUS_CLASS_STATE_REFRESH_MS", 10000, 86400000, 60000);
  const classStateValidMs = integer(env, "VERSUS_CLASS_STATE_VALID_MS", classStateRefreshMs, 86400000, 180000);
  integer(env, "VERSUS_CLASS_STATE_STALE_MS", classStateValidMs, 86400000, 900000);
  const creditsPerPoll = 335 + (graduationEnabled ? 160 : 0);
  const quoteCredits = quoteEnabled
    ? (Math.ceil(86400000 / quoteRefreshMs) + (Math.ceil(86400000 / quoteFullScanMs) * 2)) * 80
    : 0;
  const classStateCredits = Math.ceil(86400000 / classStateRefreshMs) * 80;
  if ((Math.ceil(86400000 / pollMs) * creditsPerPoll) + quoteCredits + classStateCredits > creditBudget) {
    throw new Error("node poll and public cache intervals exceed the RPC daily credit budget");
  }
  integer(env, "VERSUS_RAIN_CONFIRMATIONS", 0, 10000, 2);
  integer(env, "VERSUS_RAIN_DISTRIBUTION_MS", 1000, 86400000, 5000);
  integer(env, "VERSUS_GRADUATION_SUBMISSION_DELAY_MS", 0, 86400000, 0);
  integer(env, "VERSUS_GRADUATION_REBROADCAST_MS", 10000, 86400000, 120000);
  integer(env, "VERSUS_GRADUATION_MAX_GAS_LIMIT", 100000, 30000000, 8000000);
  unsignedBigInt(env, "VERSUS_GRADUATION_MAX_EXECUTION_FEE_WEI", "5000000000000000", 1n);
  integer(env, "VERSUS_WAKU_CLUSTER_ID", 1, 65535);
  integer(env, "VERSUS_WAKU_NUM_SHARDS", 1, 1024);
  integer(env, "VERSUS_WAKU_STORE_SECONDS", 60, 604800);
  integer(env, "VERSUS_WAKU_STORE_CAPACITY", 100, 1000000);
  integer(env, "VERSUS_WAKU_MAX_CONNECTIONS", 10, 10000);
  integer(env, "VERSUS_WAKU_IP_COLOCATION_LIMIT", 1, 1000, 20);
  return env;
}

export function peerIdFromInfo(info) {
  for (const address of [...(info.listenAddresses || []), ...(info.listen_addresses || [])]) {
    const match = String(address).match(/\/p2p\/([^/]+)$/);
    if (match) return match[1];
  }
  const value = info.peerId || info.peer_id;
  if (!value) throw new Error("nwaku info did not expose a peer ID");
  return String(value);
}

export function publicWssMultiaddr(env, peerId) {
  return `/dns4/${env.PUBLIC_DOMAIN}/tcp/443/wss/p2p/${peerId}`;
}

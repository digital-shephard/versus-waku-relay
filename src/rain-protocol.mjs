import crypto from "node:crypto";
import {
  Interface,
  Wallet,
  getAddress,
  getBytes,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";

export const RAIN_BATCH_KIND = "versus-verified-rain";
export const RAIN_BATCH_VERSION = 1;
export const RAIN_TOPIC_VERSION = 1;
export const DEFAULT_CLUSTER_ID = 66;
export const DEFAULT_SHARD_COUNT = 8;

export const ARENA_RAIN_ABI = [
  "event Committed(uint256 indexed agentId,uint256 indexed classId,address indexed owner,uint32 day,uint256 amount,uint256 classTotal)",
  "event Rained(uint256 indexed agentId,uint256 indexed classId,address indexed owner,uint32 day,uint256 pennies,uint256 amount,uint256 classTotal)",
  "event SignalBatchSettled(uint256 indexed agentId,uint256 indexed classId,bytes32 indexed batchRoot,uint256 signalCount,uint256 inkPennies,uint256 amount,uint256 classTotal,bytes32 typeCountsHash)",
];

export const arenaRainInterface = new Interface(ARENA_RAIN_ABI);
export const arenaRainTopics = Object.freeze(ARENA_RAIN_ABI.map((fragment) =>
  arenaRainInterface.getEvent(fragment.slice(6, fragment.indexOf("("))).topicHash
));

function uintString(value, name) {
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new TypeError(`${name} must be an unsigned integer`);
  return BigInt(text).toString();
}

export function rainContentTopic(chainId, arena) {
  return `/versus/${RAIN_TOPIC_VERSION}/rain-${uintString(chainId, "chainId")}-${getAddress(arena).slice(2).toLowerCase()}/json`;
}

export function contentTopicShard(contentTopic, shardCount = DEFAULT_SHARD_COUNT) {
  if (!Number.isInteger(shardCount) || shardCount < 1) throw new RangeError("shardCount must be positive");
  const parts = String(contentTopic).split("/");
  if (parts.length < 5 || parts.length > 6) throw new TypeError("invalid Waku content topic");
  const fields = parts.slice(-4);
  if (!fields[0] || !fields[1]) throw new TypeError("invalid Waku content topic");
  const digest = crypto.createHash("sha256").update(fields[0]).update(fields[1]).digest();
  return Number(digest.readBigUInt64BE(digest.length - 8) % BigInt(shardCount));
}

export function rainPubsubTopic(contentTopic, clusterId = DEFAULT_CLUSTER_ID, shardCount = DEFAULT_SHARD_COUNT) {
  return `/waku/2/rs/${Number(clusterId)}/${contentTopicShard(contentTopic, shardCount)}`;
}

export function decodeArenaRainLog(log, { chainId, arena }) {
  const parsed = arenaRainInterface.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) return null;
  let pennies;
  let type;
  if (parsed.name === "Committed") {
    type = "commit";
    pennies = 1n;
  } else if (parsed.name === "Rained") {
    type = "rain";
    pennies = parsed.args.pennies;
  } else if (parsed.name === "SignalBatchSettled") {
    type = "signal";
    pennies = parsed.args.inkPennies;
  } else {
    return null;
  }
  if (pennies < 1n || pennies > 500n) throw new RangeError("Arena rain event has invalid penny count");
  const transactionHash = String(log.transactionHash).toLowerCase();
  const logIndex = Number(BigInt(log.logIndex));
  const blockNumber = BigInt(log.blockNumber).toString();
  const eventId = `${uintString(chainId, "chainId")}:${getAddress(arena).toLowerCase()}:${transactionHash}:${logIndex}`;
  return Object.freeze({
    eventId,
    type,
    transactionHash,
    logIndex,
    blockNumber,
    agentId: parsed.args.agentId.toString(),
    classId: parsed.args.classId.toString(),
    classTotalMicros: parsed.args.classTotal.toString(),
    pennies: Number(pennies),
  });
}

export function unsignedRainBatch(input) {
  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 50) {
    throw new RangeError("rain batch must contain 1 to 50 events");
  }
  return {
    kind: RAIN_BATCH_KIND,
    version: RAIN_BATCH_VERSION,
    chainId: uintString(input.chainId, "chainId"),
    arena: getAddress(input.arena),
    fromBlock: uintString(input.fromBlock, "fromBlock"),
    toBlock: uintString(input.toBlock, "toBlock"),
    issuedAt: Number(input.issuedAt),
    distributionWindowMs: Number(input.distributionWindowMs),
    events: input.events.map((event) => ({
      eventId: String(event.eventId),
      type: String(event.type),
      transactionHash: String(event.transactionHash).toLowerCase(),
      logIndex: Number(event.logIndex),
      blockNumber: uintString(event.blockNumber, "event.blockNumber"),
      agentId: uintString(event.agentId, "event.agentId"),
      classId: uintString(event.classId, "event.classId"),
      classTotalMicros: uintString(event.classTotalMicros, "event.classTotalMicros"),
      pennies: Number(event.pennies),
    })),
  };
}

export function rainBatchDigest(input) {
  return keccak256(toUtf8Bytes(JSON.stringify(unsignedRainBatch(input))));
}

export async function signRainBatch(input, privateKey) {
  const unsigned = unsignedRainBatch(input);
  const batchId = rainBatchDigest(unsigned);
  const signer = new Wallet(privateKey);
  return {
    ...unsigned,
    batchId,
    attestor: signer.address,
    signature: await signer.signMessage(getBytes(batchId)),
  };
}

export function verifyRainBatch(envelope, trustedAttestors) {
  const expected = rainBatchDigest(envelope);
  if (String(envelope?.batchId).toLowerCase() !== expected.toLowerCase()) {
    throw new Error("rain batch digest mismatch");
  }
  const recovered = getAddress(verifyMessage(getBytes(expected), envelope.signature));
  if (recovered !== getAddress(envelope.attestor)) throw new Error("rain attestor signature mismatch");
  const trusted = new Set(Array.from(trustedAttestors || [], getAddress));
  if (!trusted.has(recovered)) throw new Error("rain attestor is not trusted");
  return { envelope: { ...unsignedRainBatch(envelope), batchId: expected, attestor: recovered, signature: envelope.signature }, recovered };
}

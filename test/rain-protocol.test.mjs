import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Wallet } from "ethers";
import {
  ARENA_RAIN_ABI,
  contentTopicShard,
  decodeArenaRainLog,
  rainContentTopic,
  signRainBatch,
  verifyRainBatch,
} from "../src/rain-protocol.mjs";

const arena = "0x1000000000000000000000000000000000000001";
const owner = "0x2000000000000000000000000000000000000002";
const iface = new Interface(ARENA_RAIN_ABI);

function log(name, args, index = 0) {
  const encoded = iface.encodeEventLog(iface.getEvent(name), args);
  return {
    topics: encoded.topics,
    data: encoded.data,
    transactionHash: `0x${"ab".repeat(32)}`,
    logIndex: `0x${index.toString(16)}`,
    blockNumber: "0x2a",
  };
}

test("decodes every penny-bearing Arena event", () => {
  const committed = decodeArenaRainLog(log("Committed", [7, 3, owner, 4, 10_000, 10_000]), { chainId: 8453, arena });
  const rained = decodeArenaRainLog(log("Rained", [7, 3, owner, 4, 25, 250_000, 260_000], 1), { chainId: 8453, arena });
  const signal = decodeArenaRainLog(log("SignalBatchSettled", [7, 3, `0x${"12".repeat(32)}`, 2, 8, 80_000, 340_000, `0x${"34".repeat(32)}`], 2), { chainId: 8453, arena });
  assert.deepEqual([committed.type, committed.pennies], ["commit", 1]);
  assert.deepEqual([rained.type, rained.pennies], ["rain", 25]);
  assert.deepEqual([signal.type, signal.pennies], ["signal", 8]);
  assert.notEqual(committed.eventId, rained.eventId);
});

test("signs deterministic rain batches and rejects unknown attestors", async () => {
  const signer = Wallet.createRandom();
  const event = decodeArenaRainLog(log("Committed", [7, 3, owner, 4, 10_000, 10_000]), { chainId: 8453, arena });
  const envelope = await signRainBatch({
    chainId: 8453,
    arena,
    fromBlock: 42,
    toBlock: 42,
    issuedAt: 1234,
    distributionWindowMs: 300_000,
    events: [event],
  }, signer.privateKey);
  assert.equal(verifyRainBatch(envelope, [signer.address]).recovered, signer.address);
  assert.throws(() => verifyRainBatch(envelope, [Wallet.createRandom().address]), /not trusted/);
  assert.throws(() => verifyRainBatch({ ...envelope, events: [{ ...event, pennies: 2 }] }, [signer.address]), /digest mismatch/);
});

test("rain content topics use deterministic autosharding", () => {
  const topic = rainContentTopic(8453, arena);
  assert.equal(topic, "/versus/1/rain-8453-1000000000000000000000000000000000000001/json");
  assert.equal(contentTopicShard(topic, 8), 2);
});

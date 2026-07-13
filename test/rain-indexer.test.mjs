import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Wallet } from "ethers";
import { ARENA_RAIN_ABI, verifyRainBatch } from "../src/rain-protocol.mjs";
import { RainIndexer } from "../src/rain-indexer.mjs";

const arena = "0x1000000000000000000000000000000000000001";
const owner = "0x2000000000000000000000000000000000000002";
const iface = new Interface(ARENA_RAIN_ABI);

function chainLog(name, args, blockNumber, logIndex) {
  const encoded = iface.encodeEventLog(iface.getEvent(name), args);
  return {
    address: arena,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: `0x${blockNumber.toString(16)}`,
    logIndex: `0x${logIndex.toString(16)}`,
    transactionHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
  };
}

class MemoryState {
  constructor(nextBlock = "10") { this.value = { version: 1, nextBlock, publishedBatches: 0, publishedPennies: 0 }; }
  load() { return { ...this.value }; }
  save(value) { this.value = structuredClone(value); }
}

test("indexes confirmed ranges, publishes exact pennies, and advances after publish", async () => {
  const signer = Wallet.createRandom();
  const calls = [];
  const rpc = {
    status: () => ({ credits: 335 }),
    async call(method, params) {
      calls.push([method, params]);
      if (method === "eth_blockNumber") return "0x10";
      return [
        chainLog("Committed", [1, 1, owner, 2, 10_000, 10_000], 11, 0),
        chainLog("Rained", [2, 1, owner, 2, 4, 40_000, 50_000], 12, 0),
      ];
    },
  };
  const published = [];
  const stateStore = new MemoryState();
  const indexer = new RainIndexer({
    chainId: 8453,
    arena,
    privateKey: signer.privateKey,
    rpc,
    publisher: { async publish(value) { published.push(value); } },
    stateStore,
    confirmations: 2,
    maxBlockSpan: 100,
    distributionWindowMs: 300_000,
    now: () => 1234,
  });
  const result = await indexer.poll();
  assert.deepEqual({ events: result.events, pennies: result.pennies, batches: result.batches }, { events: 2, pennies: 5, batches: 1 });
  assert.equal(stateStore.value.nextBlock, "15");
  assert.equal(stateStore.value.publishedPennies, 5);
  assert.equal(verifyRainBatch(published[0], [signer.address]).envelope.events.length, 2);
  assert.equal(calls[1][1][0].fromBlock, "0xa");
  assert.equal(calls[1][1][0].toBlock, "0xe");
});

test("does not advance the cursor when Waku publication fails", async () => {
  const signer = Wallet.createRandom();
  const stateStore = new MemoryState();
  const indexer = new RainIndexer({
    chainId: 8453,
    arena,
    privateKey: signer.privateKey,
    rpc: {
      status: () => ({}),
      call: async (method) => method === "eth_blockNumber"
        ? "0xc"
        : [chainLog("Committed", [1, 1, owner, 2, 10_000, 10_000], 10, 0)],
    },
    publisher: { async publish() { throw new Error("waku offline"); } },
    stateStore,
    confirmations: 0,
    maxBlockSpan: 100,
  });
  await assert.rejects(indexer.poll(), /waku offline/);
  assert.equal(stateStore.value.nextBlock, "10");
});

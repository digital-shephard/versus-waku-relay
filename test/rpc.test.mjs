import assert from "node:assert/strict";
import test from "node:test";
import { CreditMeteredRpc } from "../src/rpc.mjs";

test("RPC usage fails closed before exceeding the configured daily credits", async () => {
  const rpc = new CreditMeteredRpc("https://base.example.invalid", {
    dailyCreditBudget: 335,
    fetchImpl: async (_url, request) => {
      const method = JSON.parse(request.body).method;
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: method === "eth_blockNumber" ? "0x1" : [] }) };
    },
  });
  await rpc.call("eth_blockNumber");
  await rpc.call("eth_getLogs", [{}]);
  await assert.rejects(rpc.call("eth_blockNumber"), (error) => error.code === "RPC_CREDIT_BUDGET");
  assert.equal(rpc.status().credits, 335);
});

test("concurrent and failed RPC calls reserve credits before network IO", async () => {
  let requests = 0;
  const rpc = new CreditMeteredRpc("https://base.example.invalid", {
    dailyCreditBudget: 160,
    fetchImpl: async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  const results = await Promise.allSettled([
    rpc.call("eth_blockNumber"),
    rpc.call("eth_blockNumber"),
    rpc.call("eth_blockNumber"),
  ]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected", "rejected"]);
  assert.equal(requests, 2);
  assert.equal(rpc.status().credits, 160);
  assert.equal(results.some((result) => result.reason?.code === "RPC_CREDIT_BUDGET"), true);
});

test("provider credit bursts are delayed instead of exceeding the per-second ceiling", async () => {
  let now = 0;
  const requestTimes = [];
  const rpc = new CreditMeteredRpc("https://base.example.invalid", {
    dailyCreditBudget: 3_000_000,
    creditsPerSecond: 500,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    fetchImpl: async (_url, request) => {
      requestTimes.push({ now, method: JSON.parse(request.body).method });
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x1" }) };
    },
  });
  await Promise.all([
    rpc.call("eth_blockNumber"),
    rpc.call("eth_getLogs", [{}]),
    rpc.call("eth_call", [{}]),
    rpc.call("eth_call", [{}]),
    rpc.call("eth_call", [{}]),
  ]);
  assert.deepEqual(requestTimes.map((request) => request.now), [0, 0, 0, 1_000, 1_000]);
  assert.equal(rpc.status().credits, 575);
  assert.equal(rpc.status().requests, 5);
});

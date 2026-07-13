import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Transaction, Wallet, keccak256 } from "ethers";
import {
  ARENA_WIRING_ABI,
  GRADUATION_KEEPER_ABI,
  GraduationKeeper,
  SYNDICATE_GRADUATION_ABI,
} from "../src/graduation-keeper.mjs";

const arena = "0x1000000000000000000000000000000000000001";
const syndicate = "0x2000000000000000000000000000000000000002";
const graduation = "0x3000000000000000000000000000000000000003";
const arenaInterface = new Interface(ARENA_WIRING_ABI);
const syndicateInterface = new Interface(SYNDICATE_GRADUATION_ABI);
const graduationInterface = new Interface(GRADUATION_KEEPER_ABI);

function state() {
  return {
    version: 1,
    chainId: "8453",
    arena,
    pending: null,
    eligibleClass: null,
    eligibleSince: null,
    completedTransactions: 0,
    lastGraduatedClass: null,
    lastReceiptBlock: null,
  };
}

class MemoryStateStore {
  constructor() {
    this.value = state();
    this.snapshots = [];
  }
  load() { return structuredClone(this.value); }
  save(value) {
    this.value = structuredClone(value);
    this.snapshots.push(structuredClone(value));
  }
}

class FakeRpc {
  constructor({ eligible = true, balance = 10n ** 18n } = {}) {
    this.eligible = eligible;
    this.balance = balance;
    this.classId = 7n;
    this.receipt = null;
    this.transaction = null;
    this.sent = [];
    this.calls = [];
    this.beforeBroadcast = null;
    this.failBroadcast = false;
  }

  async call(method, params = []) {
    this.calls.push([method, params]);
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getCode") return "0x60006000";
    if (method === "eth_blockNumber") return "0x100";
    if (method === "eth_getTransactionReceipt") return this.receipt;
    if (method === "eth_getTransactionByHash") return this.transaction;
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_gasPrice") return "0x3b9aca00";
    if (method === "eth_getBlockByNumber") return { number: "0x100", baseFeePerGas: "0x1dcd6500" };
    if (method === "eth_getBalance") return `0x${this.balance.toString(16)}`;
    if (method === "eth_sendRawTransaction") {
      this.beforeBroadcast?.();
      if (this.failBroadcast) throw new Error("provider timeout");
      const hash = keccak256(params[0]).toLowerCase();
      this.sent.push(params[0]);
      return hash;
    }
    if (method === "eth_call") {
      const [{ to, data }] = params;
      if (to.toLowerCase() === arena.toLowerCase()) {
        assert.equal(data.slice(0, 10), arenaInterface.getFunction("syndicate").selector);
        return arenaInterface.encodeFunctionResult("syndicate", [syndicate]);
      }
      if (to.toLowerCase() === syndicate.toLowerCase()) {
        if (data.slice(0, 10) === syndicateInterface.getFunction("graduation").selector) {
          return syndicateInterface.encodeFunctionResult("graduation", [graduation]);
        }
        if (data.slice(0, 10) === syndicateInterface.getFunction("currentClassId").selector) {
          return syndicateInterface.encodeFunctionResult("currentClassId", [this.classId]);
        }
        if (data.slice(0, 10) === syndicateInterface.getFunction("canGraduate").selector) {
          return syndicateInterface.encodeFunctionResult("canGraduate", [this.eligible]);
        }
      }
    }
    throw new Error(`unexpected RPC call ${method}`);
  }
}

function keeper(options = {}) {
  const rpc = options.rpc || new FakeRpc();
  const stateStore = options.stateStore || new MemoryStateStore();
  let clock = options.now ?? 1_000_000;
  const instance = new GraduationKeeper({
    enabled: options.enabled ?? true,
    chainId: 8453,
    arena,
    privateKey: options.privateKey || Wallet.createRandom().privateKey,
    rpc,
    stateStore,
    confirmations: 10,
    maxExecutionFeeWei: 10n ** 18n,
    submissionDelayMs: options.submissionDelayMs || 0,
    rebroadcastMs: 10_000,
    now: () => clock,
  });
  return { instance, rpc, stateStore, advance(ms) { clock += ms; } };
}

test("disabled nodes never discover contracts or request a transaction", async () => {
  const disabledStore = { load() { throw new Error("disabled journal should not be read"); }, save() {} };
  const context = keeper({ enabled: false, stateStore: disabledStore });
  assert.deepEqual(await context.instance.poll(), { status: "disabled" });
  assert.equal(context.rpc.calls.length, 0);
  assert.equal(context.instance.status().enabled, false);
});

test("not-ready classes do not estimate, sign, or broadcast", async () => {
  const context = keeper({ rpc: new FakeRpc({ eligible: false }) });
  const result = await context.instance.poll({ confirmedBlock: 200 });
  assert.equal(result.status, "not_ready");
  assert.equal(context.rpc.sent.length, 0);
  assert.equal(context.rpc.calls.some(([method]) => method === "eth_estimateGas"), false);
});

test("eligible confirmed class stages before broadcast and signs graduateClass for the canonical module", async () => {
  const context = keeper();
  context.rpc.beforeBroadcast = () => {
    assert.ok(context.stateStore.value.pending, "raw transaction must be durable before broadcast");
  };
  const result = await context.instance.poll({ confirmedBlock: 200 });
  assert.equal(result.status, "submitted");
  assert.equal(result.classId, "7");
  assert.equal(context.rpc.sent.length, 1);
  const transaction = Transaction.from(context.rpc.sent[0]);
  assert.equal(transaction.to, graduation);
  assert.equal(transaction.chainId, 8453n);
  const parsed = graduationInterface.parseTransaction({ data: transaction.data, value: transaction.value });
  assert.equal(parsed.name, "graduateClass");
  assert.equal(parsed.args.classId, 7n);
  assert.equal(context.stateStore.value.pending.txHash, result.txHash);
});

test("an unfunded keeper reports the requirement without staging a transaction", async () => {
  const context = keeper({ rpc: new FakeRpc({ balance: 1n }) });
  const result = await context.instance.poll({ confirmedBlock: 200 });
  assert.equal(result.status, "unfunded");
  assert.equal(context.stateStore.value.pending, null);
  assert.equal(context.rpc.sent.length, 0);
  assert.ok(BigInt(result.requiredWei) > BigInt(result.balanceWei));
});

test("pending submission confirms once and records the completed class", async () => {
  const context = keeper();
  const submitted = await context.instance.poll({ confirmedBlock: 200 });
  context.rpc.receipt = { status: "0x1", blockNumber: "0x123", transactionHash: submitted.txHash };
  const confirmed = await context.instance.poll({ confirmedBlock: 201 });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(context.stateStore.value.pending, null);
  assert.equal(context.stateStore.value.completedTransactions, 1);
  assert.equal(context.stateStore.value.lastGraduatedClass, "7");
});

test("a staged transaction survives an ambiguous broadcast and rebroadcasts the identical bytes", async () => {
  const context = keeper();
  context.rpc.failBroadcast = true;
  await assert.rejects(context.instance.poll({ confirmedBlock: 200 }), /provider timeout/);
  const staged = context.stateStore.value.pending.rawTransaction;
  assert.ok(staged);
  context.rpc.failBroadcast = false;
  const retried = await context.instance.poll({ confirmedBlock: 201 });
  assert.equal(retried.status, "rebroadcast");
  assert.equal(context.rpc.sent[0], staged);
});

test("another runner advancing the class clears a stale pending submission", async () => {
  const context = keeper();
  await context.instance.poll({ confirmedBlock: 200 });
  context.rpc.classId = 8n;
  const result = await context.instance.poll({ confirmedBlock: 201 });
  assert.equal(result.status, "superseded");
  assert.equal(context.stateStore.value.pending, null);
  assert.equal(context.stateStore.value.lastGraduatedClass, "7");
});

test("an accepted losing transaction remains journaled until its receipt exists", async () => {
  const context = keeper();
  const submitted = await context.instance.poll({ confirmedBlock: 200 });
  context.rpc.classId = 8n;
  context.rpc.transaction = { hash: submitted.txHash, blockNumber: null };
  const result = await context.instance.poll({ confirmedBlock: 201 });
  assert.equal(result.status, "superseded_pending");
  assert.equal(context.stateStore.value.pending.txHash, submitted.txHash);
});

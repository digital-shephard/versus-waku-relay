import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Interface, Wallet, verifyMessage } from "ethers";
import {
  HatchQuoteService,
  canonicalHatchQuote,
  hatchQuoteMessage,
} from "../src/hatch-quote.mjs";

const QUOTER = new Interface([
  "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

test("scheduled hatch quotes scan all tiers then reuse the winner without request-time RPC", async () => {
  let now = 1_780_000_000_000;
  const calls = [];
  const amountByFee = new Map([[500, 1_000_000_000_000_000n], [3000, 1_100_000_000_000_000n], [10000, 1_300_000_000_000_000n]]);
  const rpc = {
    async call(method, [{ data }]) {
      assert.equal(method, "eth_call");
      const [params] = QUOTER.decodeFunctionData("quoteExactOutputSingle", data);
      const fee = Number(params.fee);
      calls.push(fee);
      return QUOTER.encodeFunctionResult("quoteExactOutputSingle", [amountByFee.get(fee), 0n, 0, 90_000n]);
    },
  };
  const privateKey = `0x${"2".repeat(64)}`;
  const service = new HatchQuoteService({
    rpc,
    privateKey,
    chainId: 8453,
    arena: "0x1000000000000000000000000000000000000001",
    cachePath: path.join(os.tmpdir(), `versus-hatch-quote-${process.pid}-${Date.now()}.json`),
    now: () => now,
  });

  const first = await service.refresh();
  assert.deepEqual(calls, [500, 3000, 10000]);
  assert.equal(first.feeTier, 500);
  assert.equal(first.swapWei, "1030000000000000");
  assert.equal(first.depositWei, "1471428571428572");
  assert.equal(BigInt(first.gasReserveWei), BigInt(first.depositWei) - BigInt(first.swapWei));
  assert.equal(first.bufferBps, 300);
  assert.equal(verifyMessage(hatchQuoteMessage(canonicalHatchQuote(first)), first.signature), new Wallet(privateKey).address);
  assert.equal(service.snapshot().freshness, "fresh");
  const callsAfterRefresh = calls.length;
  service.snapshot();
  service.snapshot();
  assert.equal(calls.length, callsAfterRefresh, "cache reads must never trigger provider calls");

  now += 60_000;
  const second = await service.refresh();
  assert.deepEqual(calls, [500, 3000, 10000, 500]);

  now = (second.validUntil + 1) * 1000;
  assert.equal(service.snapshot().freshness, "stale");
  now = (second.staleUntil + 1) * 1000;
  assert.equal(service.snapshot(), null);
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Interface, Wallet, verifyMessage } from "ethers";
import {
  FX_PRICE_REFERENCE_MARKET,
  FxPriceReferenceService,
  canonicalFxPriceReference,
  fxPriceReferenceMessage,
} from "../src/fx-price-reference.mjs";

const AGGREGATOR = new Interface([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);

function rpcFor({ chainId, description, answer, updatedAt, calls }) {
  return {
    async call(method, params = []) {
      calls.push({ method, params });
      if (method === "eth_chainId") return `0x${BigInt(chainId).toString(16)}`;
      assert.equal(method, "eth_call");
      const data = params[0].data;
      if (data === AGGREGATOR.encodeFunctionData("decimals")) {
        return AGGREGATOR.encodeFunctionResult("decimals", [8]);
      }
      if (data === AGGREGATOR.encodeFunctionData("description")) {
        return AGGREGATOR.encodeFunctionResult("description", [description]);
      }
      return AGGREGATOR.encodeFunctionResult("latestRoundData", [12n, answer, updatedAt - 1, updatedAt, 12n]);
    },
  };
}

test("refreshes direct Chainlink references and serves signed cache without request-time RPC", async () => {
  let now = 1_786_100_000_000;
  const updatedAt = Math.floor(now / 1_000) - 60;
  const calls = [];
  const privateKey = `0x${"7".repeat(64)}`;
  const sources = [
    {
      symbol: "ETH",
      rpc: "base",
      chainId: "8453",
      feed: "0x1000000000000000000000000000000000000001",
      description: "ETH / USD",
      maximumSourceAgeSeconds: 7_200,
    },
    {
      symbol: "EURC",
      rpc: "eurc",
      chainId: "8453",
      feed: "0x2000000000000000000000000000000000000002",
      description: "EURC / USD",
      maximumSourceAgeSeconds: 90_000,
    },
    {
      symbol: "AVAX",
      rpc: "avalanche",
      chainId: "43114",
      feed: "0x3000000000000000000000000000000000000003",
      description: "AVAX / USD",
      maximumSourceAgeSeconds: 7_200,
    },
  ];
  const service = new FxPriceReferenceService({
    rpcs: {
      base: rpcFor({ chainId: 8453, description: "ETH / USD", answer: 191_491_250_000n, updatedAt, calls }),
      eurc: rpcFor({ chainId: 8453, description: "EURC / USD", answer: 115_193_760n, updatedAt, calls }),
      avalanche: rpcFor({ chainId: 43114, description: "AVAX / USD", answer: 644_992_217n, updatedAt, calls }),
    },
    privateKey,
    cachePath: path.join(os.tmpdir(), `versus-fx-prices-${process.pid}-${Date.now()}.json`),
    sources,
    now: () => now,
  });

  const reference = await service.refresh();
  assert.equal(reference.market, FX_PRICE_REFERENCE_MARKET);
  assert.deepEqual(reference.prices.map((price) => [price.symbol, price.usdMicros]), [
    ["AVAX", "6449922"],
    ["ETH", "1914912500"],
    ["EURC", "1151938"],
  ]);
  assert.equal(
    verifyMessage(fxPriceReferenceMessage(canonicalFxPriceReference(reference)), reference.signature),
    new Wallet(privateKey).address,
  );
  const callsAfterRefresh = calls.length;
  service.snapshot();
  service.snapshot();
  assert.equal(calls.length, callsAfterRefresh, "public cache reads must never trigger provider calls");

  now += 60_000;
  await service.refresh();
  const metadataCalls = calls.filter(({ method, params }) => method === "eth_chainId" || [
    AGGREGATOR.encodeFunctionData("decimals"),
    AGGREGATOR.encodeFunctionData("description"),
  ].includes(params[0]?.data));
  assert.equal(metadataCalls.length, 9, "chain and feed metadata are read only once");
});

test("fails closed on stale or incomplete oracle rounds", async () => {
  const now = 1_786_100_000_000;
  const source = {
    symbol: "ETH",
    rpc: "base",
    chainId: "8453",
    feed: "0x1000000000000000000000000000000000000001",
    description: "ETH / USD",
    maximumSourceAgeSeconds: 60,
  };
  const calls = [];
  const service = new FxPriceReferenceService({
    rpcs: {
      base: rpcFor({
        chainId: 8453,
        description: "ETH / USD",
        answer: 191_491_250_000n,
        updatedAt: Math.floor(now / 1_000) - 61,
        calls,
      }),
    },
    privateKey: `0x${"8".repeat(64)}`,
    cachePath: path.join(os.tmpdir(), `versus-stale-fx-prices-${process.pid}-${Date.now()}.json`),
    sources: [source],
    now: () => now,
  });
  await assert.rejects(service.refresh(), /feed round is stale/);
  assert.equal(service.snapshot(), null);
  assert.equal(service.status().lastError, "fx_price_reference_refresh_failed");
});

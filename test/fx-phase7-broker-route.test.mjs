import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  Wallet,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import {
  FX_BROKER_METRICS_SCHEMA,
  FX_BROKER_PAYMENT_MODE,
  FX_BROKER_ROUTE_SCHEMA,
  FX_BROKER_VERSION,
  verifyFxBrokerMetricsSnapshot,
  verifyFxBrokerRouteProposal,
} from "../src/fx-broker-route.mjs";
import {
  assembleFxEnvelope,
  canonicalFxMessage,
  canonicalJson,
  selectSingleDealerRoute,
} from "../src/fx-protocol.mjs";

const NOW = 1_800_000_000;
const DEPLOYMENT_ID = `0x${"81".repeat(32)}`;
const TRADE_ID = `0x${"82".repeat(32)}`;
const SOURCE_TOKEN = `0x${"11".repeat(20)}`;
const DESTINATION_TOKEN = `0x${"22".repeat(20)}`;

async function signedMessage(wallet, input) {
  const message = {
    ...input,
    sender: wallet.address.toLowerCase(),
  };
  return assembleFxEnvelope(
    message,
    await wallet.signMessage(canonicalFxMessage(message))
  );
}

async function proposalFixture() {
  const requester = Wallet.createRandom();
  const dealer = Wallet.createRandom();
  const broker = Wallet.createRandom();
  const rfq = await signedMessage(requester, {
    protocol: "versus-fx",
    version: 1,
    deploymentId: DEPLOYMENT_ID,
    type: "fx_rfq",
    tradeId: TRADE_ID,
    role: "requester",
    sequence: "1",
    createdAt: NOW,
    expiresAt: NOW + 60,
    payload: {
      outputChainId: "421614",
      outputToken: DESTINATION_TOKEN,
      outputAmountAtomic: "100000",
      inputOptions: [{
        chainId: "84532",
        token: SOURCE_TOKEN,
        maxInputAtomic: "110000",
      }],
      quoteDeadline: NOW + 50,
      settlementDeadline: NOW + 3600,
      quotePolicy: "lowest_all_in",
      x402Commitment: null,
    },
  });
  const quote = await signedMessage(dealer, {
    protocol: "versus-fx",
    version: 1,
    deploymentId: DEPLOYMENT_ID,
    type: "fx_quote",
    tradeId: TRADE_ID,
    role: "dealer",
    sequence: "1",
    createdAt: NOW + 1,
    expiresAt: NOW + 45,
    payload: {
      rfqId: rfq.id,
      inputChainId: "84532",
      inputToken: SOURCE_TOKEN,
      inputAmountAtomic: "101000",
      outputChainId: "421614",
      outputToken: DESTINATION_TOKEN,
      outputAmountAtomic: "100000",
      quoteType: "fixed_exact_output",
      referenceSource: "chainlink:usdc-usd",
      referencePriceMicros: "1000000",
      referenceTimestamp: NOW,
      spreadBps: 25,
      dealerSettlementCostAtomic: "750",
      estimatedCompletionSeconds: 55,
      adapterId: "evm-htlc-v1",
      adapterVersion: 1,
    },
  });
  const route = selectSingleDealerRoute(
    rfq,
    [{ quote, brokerFeeAtomic: "500" }],
    { now: NOW + 2 }
  );
  const fee = {
    recipient: broker.address.toLowerCase(),
    chainId: route.inputChainId,
    token: route.inputToken,
    amountAtomic: "500",
    paymentMode: FX_BROKER_PAYMENT_MODE,
  };
  const core = {
    schema: FX_BROKER_ROUTE_SCHEMA,
    schemaVersion: FX_BROKER_VERSION,
    deploymentId: DEPLOYMENT_ID,
    broker: broker.address.toLowerCase(),
    issuedAt: NOW + 2,
    expiresAt: NOW + 32,
    rfq,
    quotes: [quote],
    policy: route.policy,
    fee,
    route,
  };
  return {
    broker,
    proposal: {
      ...core,
      proposalId: keccak256(toUtf8Bytes(canonicalJson(core))),
      signature: await broker.signMessage(canonicalJson(core)),
    },
  };
}

test("relay-side verifier independently reproduces a signed broker route", async () => {
  const { proposal } = await proposalFixture();
  const verified = verifyFxBrokerRouteProposal(proposal, { now: NOW + 3 });
  assert.equal(verified.route.totalInputAtomic, "101500");
  assert.equal(verified.fee.amountAtomic, "500");
});

test("relay-side verifier rejects route, fee, and signature modification", async () => {
  const { proposal } = await proposalFixture();
  for (const mutate of [
    (candidate) => { candidate.route.totalInputAtomic = "1"; },
    (candidate) => { candidate.fee.amountAtomic = "0"; },
    (candidate) => { candidate.signature = `0x${"00".repeat(65)}`; },
  ]) {
    const changed = structuredClone(proposal);
    mutate(changed);
    assert.throws(() =>
      verifyFxBrokerRouteProposal(changed, { now: NOW + 3 })
    );
  }
});

test("objective broker metrics are signed and relay transport remains blind", async () => {
  const broker = Wallet.createRandom();
  const snapshot = {
    schema: FX_BROKER_METRICS_SCHEMA,
    schemaVersion: FX_BROKER_VERSION,
    broker: broker.address.toLowerCase(),
    windowStartedAt: NOW,
    observedAt: NOW + 60,
    counters: {
      requests: 4,
      routesCompiled: 3,
      noRoute: 1,
      validQuotes: 7,
      rejectedQuotes: 1,
      verifiedCompletions: 2,
      rejectedCompletionProofs: 0,
      x402DataResponses: 0,
    },
    gauges: { activeRequests: 0, reachableDealers: 3 },
    latencyMs: { p50: 120, p95: 480, samples: 4 },
    settlementAccuracyBps: 10000,
  };
  const signed = {
    ...snapshot,
    signature: await broker.signMessage(canonicalJson(snapshot)),
  };
  assert.equal(
    verifyFxBrokerMetricsSnapshot(signed).broker,
    broker.address.toLowerCase()
  );

  const mainSource = fs.readFileSync(
    new URL("../src/main.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(mainSource, /fx-broker-route|fx-broker-service/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";
import {
  advanceFxCaseState,
  advanceFxState,
  assembleFxEnvelope,
  canonicalFxMessage,
  computeFxMessageId,
  normalizeFxMessage,
  selectSingleDealerRoute,
  verifyFxEnvelope,
} from "../src/fx-protocol.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(dirname, "..", "fixtures", "fx-phase1-v1.json"), "utf8")
);

const deploymentId = "0x" + "11".repeat(32);
const tradeId = "0x" + "22".repeat(32);
const ids = {
  rfq: "0x" + "33".repeat(32),
  quote: "0x" + "44".repeat(32),
  accept: "0x" + "55".repeat(32),
  route: "0x" + "12".repeat(32),
  sourceLock: "0x" + "66".repeat(32),
  destinationLock: "0x" + "77".repeat(32),
  sourceClaim: "0x" + "88".repeat(32),
  destinationClaim: "0x" + "99".repeat(32),
  default: "0x" + "aa".repeat(32),
  secret: "0x" + "bb".repeat(32),
  sourceTx: "0x" + "cc".repeat(32),
  destinationTx: "0x" + "dd".repeat(32),
  claimTx: "0x" + "ee".repeat(32),
  refundTx: "0x" + "ff".repeat(32),
};
const addresses = {
  requester: "0x1000000000000000000000000000000000000001",
  dealer: "0x2000000000000000000000000000000000000002",
  relayer: "0x3000000000000000000000000000000000000003",
  baseUsdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  arbitrumUsdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  sourceRefund: "0x4000000000000000000000000000000000000004",
  destinationClaim: "0x5000000000000000000000000000000000000005",
  dealerSourceClaim: "0x6000000000000000000000000000000000000006",
  dealerDestinationRefund: "0x7000000000000000000000000000000000000007",
  sourceLock: "0x8000000000000000000000000000000000000008",
  destinationLock: "0x9000000000000000000000000000000000000009",
};

function payloadFor(type, createdAt, expiresAt) {
  const payloads = {
    fx_rfq: {
      outputChainId: "42161",
      outputToken: addresses.arbitrumUsdc,
      outputAmountAtomic: "100000",
      inputOptions: [{
        chainId: "8453",
        token: addresses.baseUsdc,
        maxInputAtomic: "105000",
      }],
      quoteDeadline: createdAt + 40,
      settlementDeadline: createdAt + 3600,
      quotePolicy: "lowest_all_in",
      x402Commitment: null,
    },
    fx_quote: {
      rfqId: ids.rfq,
      inputChainId: "8453",
      inputToken: addresses.baseUsdc,
      inputAmountAtomic: "101000",
      outputChainId: "42161",
      outputToken: addresses.arbitrumUsdc,
      outputAmountAtomic: "100000",
      quoteType: "fixed_exact_output",
      referenceSource: "chainlink:usdc-usd",
      referencePriceMicros: "1000000",
      referenceTimestamp: createdAt - 1,
      spreadBps: 25,
      dealerSettlementCostAtomic: "750",
      estimatedCompletionSeconds: 45,
      adapterId: "evm-htlc-v1",
      adapterVersion: 1,
    },
    fx_accept: {
      rfqId: ids.rfq,
      quoteId: ids.quote,
      routeId: ids.route,
      dealerInputAmountAtomic: "101000",
      brokerFeeAtomic: "250",
      totalInputAtomic: "101250",
      outputAmountAtomic: "100000",
      secretHash: ids.secret,
      sourceRefundAddress: addresses.sourceRefund,
      destinationClaimAddress: addresses.destinationClaim,
      sourceAdapterId: "evm-htlc-v1",
      sourceAdapterVersion: 1,
      destinationAdapterId: "evm-htlc-v1",
      destinationAdapterVersion: 1,
    },
    fx_reserve: {
      acceptId: ids.accept,
      quoteId: ids.quote,
      dealerSourceClaimAddress: addresses.dealerSourceClaim,
      dealerDestinationRefundAddress: addresses.dealerDestinationRefund,
      reservationDeadline: expiresAt - 1,
    },
    fx_lock_source: {
      acceptId: ids.accept,
      chainId: "8453",
      token: addresses.baseUsdc,
      amountAtomic: "101000",
      lockAddress: addresses.sourceLock,
      beneficiary: addresses.dealerSourceClaim,
      refundAddress: addresses.sourceRefund,
      secretHash: ids.secret,
      timeout: createdAt + 7200,
      transactionHash: ids.sourceTx,
      blockNumber: "12345678",
    },
    fx_lock_destination: {
      acceptId: ids.accept,
      chainId: "42161",
      token: addresses.arbitrumUsdc,
      amountAtomic: "100000",
      lockAddress: addresses.destinationLock,
      beneficiary: addresses.destinationClaim,
      refundAddress: addresses.dealerDestinationRefund,
      secretHash: ids.secret,
      timeout: createdAt + 3600,
      transactionHash: ids.destinationTx,
      blockNumber: "23456789",
    },
    fx_claim: {
      lockMessageId: ids.destinationLock,
      chainId: "42161",
      transactionHash: ids.claimTx,
      blockNumber: "23456800",
      secretHash: ids.secret,
      beneficiary: addresses.destinationClaim,
    },
    fx_refund: {
      lockMessageId: ids.sourceLock,
      chainId: "8453",
      transactionHash: ids.refundTx,
      blockNumber: "12346000",
      beneficiary: addresses.sourceRefund,
    },
    fx_complete: {
      acceptId: ids.accept,
      sourceClaimMessageId: ids.sourceClaim,
      destinationClaimMessageId: ids.destinationClaim,
    },
    fx_default: {
      acceptId: ids.accept,
      reason: "dealer_abandoned",
      missingLeg: "destination_lock",
      observedAt: createdAt,
      evidenceIds: [ids.sourceLock, ids.accept],
    },
    fx_dispute: {
      defaultId: ids.default,
      reason: "destination-lock-was-published",
      evidenceIds: [ids.destinationLock, ids.destinationTx],
    },
  };
  return payloads[type];
}

function sample(type, index = 0) {
  const roleByType = {
    fx_rfq: "requester",
    fx_quote: "dealer",
    fx_accept: "requester",
    fx_reserve: "dealer",
    fx_lock_source: "requester",
    fx_lock_destination: "dealer",
    fx_claim: "relayer",
    fx_refund: "relayer",
    fx_complete: "relayer",
    fx_default: "requester",
    fx_dispute: "dealer",
  };
  const senderByRole = {
    requester: addresses.requester,
    dealer: addresses.dealer,
    relayer: addresses.relayer,
  };
  const short = type === "fx_rfq" || type === "fx_quote";
  const medium = type === "fx_accept" || type === "fx_reserve";
  const createdAt = 1_785_024_000 + index * 5;
  const expiresAt = createdAt + (short ? 50 : medium ? 300 : 3600);
  const role = roleByType[type];
  return {
    protocol: "versus-fx",
    version: 1,
    deploymentId,
    type,
    tradeId,
    sender: senderByRole[role],
    role,
    sequence: String(index + 1),
    createdAt,
    expiresAt,
    payload: payloadFor(type, createdAt, expiresAt),
  };
}

async function signMessage(input, wallet) {
  const normalized = normalizeFxMessage({ ...input, sender: wallet.address });
  return assembleFxEnvelope(normalized, await wallet.signMessage(canonicalFxMessage(normalized)));
}

test("matches the frozen client canonical hash vector", () => {
  assert.equal(canonicalFxMessage(fixture.interop.message), fixture.interop.canonical);
  assert.equal(computeFxMessageId(fixture.interop.message), fixture.interop.id);
});

test("fails closed on unsupported versions and domain-separates message ids", () => {
  const message = fixture.interop.message;
  assert.throws(() => normalizeFxMessage({ ...message, protocol: "versus-fx-preview" }));
  assert.throws(() => normalizeFxMessage({ ...message, version: 2 }));

  const baseId = computeFxMessageId(message);
  assert.notEqual(
    computeFxMessageId({ ...message, deploymentId: "0x" + "ab".repeat(32) }),
    baseId
  );
  assert.notEqual(
    computeFxMessageId({ ...message, tradeId: "0x" + "cd".repeat(32) }),
    baseId
  );
  assert.notEqual(
    computeFxMessageId({
      ...sample("fx_quote"),
      deploymentId: message.deploymentId,
      tradeId: message.tradeId,
      sender: message.sender,
    }),
    baseId
  );
});

test("independently validates every Phase 1 message schema", () => {
  const types = [
    "fx_rfq",
    "fx_quote",
    "fx_accept",
    "fx_reserve",
    "fx_lock_source",
    "fx_lock_destination",
    "fx_claim",
    "fx_refund",
    "fx_complete",
    "fx_default",
    "fx_dispute",
  ];
  for (const [index, type] of types.entries()) {
    assert.equal(normalizeFxMessage(sample(type, index)).type, type);
  }
});

test("verifies role-bound signatures and rejects payload tampering", async () => {
  const dealer = Wallet.createRandom();
  const quote = await signMessage(sample("fx_quote", 1), dealer);
  assert.equal(verifyFxEnvelope(quote, { temporal: false }).sender, dealer.address.toLowerCase());
  assert.throws(
    () => verifyFxEnvelope({
      ...quote,
      payload: { ...quote.payload, inputAmountAtomic: "1" },
    }, { temporal: false }),
    { code: "BAD_ID" }
  );
  assert.throws(() => normalizeFxMessage({ ...sample("fx_rfq"), role: "dealer" }), {
    code: "ROLE_MISMATCH",
  });
});

test("rejects unknown economic and secret fields", () => {
  assert.throws(() => normalizeFxMessage({ ...sample("fx_rfq"), routeWinner: "dealer-a" }), {
    code: "UNKNOWN_FIELD",
  });
  const accept = sample("fx_accept");
  assert.throws(
    () => normalizeFxMessage({
      ...accept,
      payload: { ...accept.payload, totalInputAtomic: "101251" },
    }),
    { code: "INVALID_ECONOMICS" }
  );
  const claim = sample("fx_claim");
  assert.throws(
    () => normalizeFxMessage({
      ...claim,
      payload: { ...claim.payload, secret: "must remain local" },
    }),
    { code: "UNKNOWN_FIELD" }
  );
});

test("matches the frozen settlement and case state transitions", () => {
  for (const [from, event, expected] of fixture.stateTransitions.happyPath) {
    assert.equal(advanceFxState(from, event), expected);
  }
  for (const [from, event, expected] of fixture.stateTransitions.refundPath) {
    assert.equal(advanceFxState(from, event), expected);
  }
  for (const [from, event, expected] of fixture.stateTransitions.casePath) {
    assert.equal(advanceFxCaseState(from, event), expected);
  }
  assert.throws(() => advanceFxState("source_locked", "confirm_source_claim"), {
    code: "INVALID_STATE_TRANSITION",
  });
});

test("recomputes signed routes and excludes manipulated or stale quotes", async () => {
  const requester = Wallet.createRandom();
  const dealerA = Wallet.createRandom();
  const dealerB = Wallet.createRandom();
  const createdAt = 1_800_000_000;
  const now = createdAt + 10;
  const rfqInput = {
    ...sample("fx_rfq"),
    sender: requester.address,
    createdAt,
    expiresAt: createdAt + 50,
    payload: {
      ...payloadFor("fx_rfq", createdAt, createdAt + 50),
      quoteDeadline: createdAt + 40,
      settlementDeadline: createdAt + 3600,
    },
  };
  const rfq = await signMessage(rfqInput, requester);
  const makeQuote = async (dealer, sequence, amount, duration, referenceTimestamp) => {
    const quoteInput = {
      ...sample("fx_quote", sequence),
      sender: dealer.address,
      sequence: String(sequence),
      createdAt: createdAt + 5,
      expiresAt: createdAt + 40,
      payload: {
        ...payloadFor("fx_quote", createdAt + 5, createdAt + 40),
        rfqId: rfq.id,
        inputAmountAtomic: String(amount),
        estimatedCompletionSeconds: duration,
        referenceTimestamp,
      },
    };
    return signMessage(quoteInput, dealer);
  };
  const quoteA = await makeQuote(dealerA, 1, 101000, 45, createdAt + 4);
  const quoteB = await makeQuote(dealerB, 1, 100800, 20, createdAt + 4);

  const cheapest = selectSingleDealerRoute(rfq, [
    { quote: quoteA, brokerFeeAtomic: "0" },
    { quote: quoteB, brokerFeeAtomic: "500" },
  ], { now });
  assert.equal(cheapest.quoteId, quoteA.id);

  const fastest = selectSingleDealerRoute(rfq, [
    { quote: quoteA, brokerFeeAtomic: "0" },
    { quote: quoteB, brokerFeeAtomic: "500" },
  ], { now, policy: "fastest" });
  assert.equal(fastest.quoteId, quoteB.id);

  assert.throws(
    () => selectSingleDealerRoute(
      rfq,
      [{ quote: quoteA, brokerFeeAtomic: "5000" }],
      { now }
    ),
    { code: "NO_VALID_ROUTE" }
  );

  assert.throws(
    () => selectSingleDealerRoute(rfq, [{
      quote: { ...quoteA, payload: { ...quoteA.payload, inputAmountAtomic: "1" } },
      brokerFeeAtomic: "0",
    }], { now }),
    { code: "NO_VALID_ROUTE" }
  );
  const stale = await makeQuote(dealerA, 2, 100000, 1, now - 61);
  assert.throws(
    () => selectSingleDealerRoute(rfq, [{ quote: stale, brokerFeeAtomic: "0" }], { now }),
    { code: "NO_VALID_ROUTE" }
  );
});

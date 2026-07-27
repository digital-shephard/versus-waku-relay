import assert from "node:assert/strict";
import test from "node:test";
import { fxTransportStatus } from "../src/fx-transport.mjs";

test("Phase 6 relay transport is blind pass-through and never economic authority", () => {
  assert.deepEqual(fxTransportStatus(), {
    enabled: true,
    protocol: "versus-fx",
    version: 1,
    mode: "content-topic-pass-through",
    filterDelivery: true,
    boundedStoreRecovery: true,
    payloadInspection: false,
    abandonmentEvidencePassThrough: true,
    abandonmentEvidenceTopics: "sharded-store-backed",
    evidenceValidation: false,
    reputationAuthority: "receiving-clients-only",
    requestScoring: false,
    quoteSelection: false,
    settlementAuthority: false,
    economicTruth: "chain-adapters-only",
  });
});

export const FX_TRANSPORT_STATUS = Object.freeze({
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

export function fxTransportStatus() {
  return { ...FX_TRANSPORT_STATUS };
}

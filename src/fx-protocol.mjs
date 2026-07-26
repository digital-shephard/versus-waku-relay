import {
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";

export const FX_PROTOCOL = "versus-fx";
export const FX_VERSION = 1;
export const FX_QUOTE_TYPE = "fixed_exact_output";
export const FX_MAX_CLOCK_SKEW_SECONDS = 300;
export const FX_MAX_REFERENCE_AGE_SECONDS = 60;

export const FX_MESSAGE_TYPES = Object.freeze([
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
]);

export const FX_ROUTE_POLICIES = Object.freeze(["lowest_all_in", "fastest"]);

const ROLES = Object.freeze(["requester", "dealer", "broker", "relayer"]);
const ROLE_BY_TYPE = Object.freeze({
  fx_rfq: ["requester"],
  fx_quote: ["dealer"],
  fx_accept: ["requester"],
  fx_reserve: ["dealer"],
  fx_lock_source: ["requester"],
  fx_lock_destination: ["dealer"],
  fx_claim: ["requester", "dealer", "relayer"],
  fx_refund: ["requester", "dealer", "relayer"],
  fx_complete: ["requester", "dealer", "broker", "relayer"],
  fx_default: ["requester", "dealer"],
  fx_dispute: ["requester", "dealer"],
});
const LIFETIME_BY_TYPE = Object.freeze({
  fx_rfq: 60,
  fx_quote: 60,
  fx_accept: 600,
  fx_reserve: 600,
  fx_lock_source: 2_592_000,
  fx_lock_destination: 2_592_000,
  fx_claim: 2_592_000,
  fx_refund: 2_592_000,
  fx_complete: 2_592_000,
  fx_default: 2_592_000,
  fx_dispute: 2_592_000,
});

export const FX_SETTLEMENT_TRANSITIONS = Object.freeze({
  idle: Object.freeze({ publish_rfq: "rfq_open" }),
  rfq_open: Object.freeze({ accept_quote: "quote_accepted", expire_rfq: "expired" }),
  quote_accepted: Object.freeze({
    confirm_source_lock: "source_locked",
    cancel_before_source_lock: "cancelled",
  }),
  source_locked: Object.freeze({
    confirm_destination_lock: "destination_locked",
    confirm_source_refund: "refunded",
  }),
  destination_locked: Object.freeze({
    confirm_destination_claim: "destination_claimed",
    confirm_destination_refund: "destination_refunded",
  }),
  destination_claimed: Object.freeze({ confirm_source_claim: "complete" }),
  destination_refunded: Object.freeze({ confirm_source_refund: "refunded" }),
  complete: Object.freeze({}),
  refunded: Object.freeze({}),
  expired: Object.freeze({}),
  cancelled: Object.freeze({}),
});

export const FX_CASE_TRANSITIONS = Object.freeze({
  none: Object.freeze({ report_default: "reported" }),
  reported: Object.freeze({
    open_dispute: "disputed",
    resolve_upheld: "resolved_upheld",
    resolve_rejected: "resolved_rejected",
  }),
  disputed: Object.freeze({
    resolve_upheld: "resolved_upheld",
    resolve_rejected: "resolved_rejected",
  }),
  resolved_upheld: Object.freeze({}),
  resolved_rejected: Object.freeze({}),
});

export const FX_PRIVACY_CLASSES = Object.freeze({
  publicDiscovery: Object.freeze([
    "deploymentId",
    "type",
    "tradeId",
    "sender",
    "role",
    "sequence",
    "createdAt",
    "expiresAt",
    "outputChainId",
    "outputToken",
    "outputAmountAtomic",
    "inputOptions",
    "quotePolicy",
  ]),
  selectedCounterparty: Object.freeze([
    "sourceRefundAddress",
    "destinationClaimAddress",
    "dealerSourceClaimAddress",
    "dealerDestinationRefundAddress",
    "secretHash",
  ]),
  chainPublicAfterBroadcast: Object.freeze([
    "lockAddress",
    "beneficiary",
    "refundAddress",
    "transactionHash",
    "blockNumber",
    "timeout",
  ]),
  localSecret: Object.freeze(["secret", "walletPrivateKeys", "unrelatedWalletHistory"]),
});

const HASH = /^0x[0-9a-f]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const IDENTIFIER = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const UINT = /^\d+$/;
const MAX_INPUT_OPTIONS = 4;
const MAX_EVIDENCE_IDS = 16;

export class FxValidationError extends Error {
  constructor(message, code = "INVALID_FX_MESSAGE") {
    super(message);
    this.name = "FxValidationError";
    this.code = code;
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FxValidationError(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, schema, label) {
  object(value, label);
  const expected = Object.keys(schema);
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) {
      throw new FxValidationError(`${label} contains unsupported field ${key}`, "UNKNOWN_FIELD");
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new FxValidationError(`${label} is missing required field ${key}`);
    }
  }
}

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new FxValidationError(`${label} must be an ethereum address`);
  }
  return getAddress(value).toLowerCase();
}

function hash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new FxValidationError(`${label} must be a lowercase bytes32 hash`);
  }
  return value;
}

function uint(value, label, positive = false, maxDigits = 78) {
  if (!["string", "number", "bigint"].includes(typeof value)) {
    throw new FxValidationError(`${label} must be an unsigned integer`);
  }
  const text = String(value);
  if (!UINT.test(text) || text.length > maxDigits) {
    throw new FxValidationError(`${label} must be an unsigned integer`);
  }
  const normalized = BigInt(text).toString();
  if (positive && normalized === "0") {
    throw new FxValidationError(`${label} must be greater than zero`);
  }
  return normalized;
}

function integer(value, label, positive = false) {
  const number = typeof value === "string" && UINT.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) {
    throw new FxValidationError(`${label} must be a safe unsigned integer`);
  }
  return number;
}

function identifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 64 ||
    !IDENTIFIER.test(value)
  ) {
    throw new FxValidationError(`${label} must be a lowercase protocol identifier`);
  }
  return value;
}

function enumeration(value, values, label) {
  if (!values.includes(value)) throw new FxValidationError(`${label} is unsupported`);
  return value;
}

function inputOptions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INPUT_OPTIONS) {
    throw new FxValidationError(
      `payload.inputOptions must contain 1 to ${MAX_INPUT_OPTIONS} options`
    );
  }
  const normalized = value.map((entry, index) => {
    const label = `payload.inputOptions[${index}]`;
    const schema = { chainId: "positiveUint", token: "address", maxInputAtomic: "positiveUint" };
    exactKeys(entry, schema, label);
    return {
      chainId: uint(entry.chainId, `${label}.chainId`, true),
      token: address(entry.token, `${label}.token`),
      maxInputAtomic: uint(entry.maxInputAtomic, `${label}.maxInputAtomic`, true),
    };
  });
  normalized.sort((left, right) =>
    `${left.chainId}:${left.token}:${left.maxInputAtomic}`.localeCompare(
      `${right.chainId}:${right.token}:${right.maxInputAtomic}`
    )
  );
  const identities = normalized.map((entry) => `${entry.chainId}:${entry.token}`);
  if (new Set(identities).size !== identities.length) {
    throw new FxValidationError("payload.inputOptions must not repeat a chain and token");
  }
  return normalized;
}

function evidenceIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_IDS) {
    throw new FxValidationError(
      `payload.evidenceIds must contain 1 to ${MAX_EVIDENCE_IDS} message ids`
    );
  }
  const normalized = value.map((entry, index) => hash(entry, `payload.evidenceIds[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new FxValidationError("payload.evidenceIds must not contain duplicates");
  }
  return normalized.sort();
}

const enumType = (...values) => Object.freeze({ kind: "enum", values });
const nullableHash = Object.freeze({ kind: "nullableHash" });
const inputOptionList = Object.freeze({ kind: "inputOptions" });
const evidenceList = Object.freeze({ kind: "evidenceIds" });

const PAYLOAD_SCHEMAS = Object.freeze({
  fx_rfq: {
    outputChainId: "positiveUint",
    outputToken: "address",
    outputAmountAtomic: "positiveUint",
    inputOptions: inputOptionList,
    quoteDeadline: "positiveInteger",
    settlementDeadline: "positiveInteger",
    quotePolicy: enumType(...FX_ROUTE_POLICIES),
    x402Commitment: nullableHash,
  },
  fx_quote: {
    rfqId: "hash",
    inputChainId: "positiveUint",
    inputToken: "address",
    inputAmountAtomic: "positiveUint",
    outputChainId: "positiveUint",
    outputToken: "address",
    outputAmountAtomic: "positiveUint",
    quoteType: enumType(FX_QUOTE_TYPE),
    referenceSource: "identifier",
    referencePriceMicros: "positiveUint",
    referenceTimestamp: "positiveInteger",
    spreadBps: "integer",
    dealerSettlementCostAtomic: "uint",
    estimatedCompletionSeconds: "positiveInteger",
    adapterId: "identifier",
    adapterVersion: "positiveInteger",
  },
  fx_accept: {
    rfqId: "hash",
    quoteId: "hash",
    routeId: "hash",
    dealerInputAmountAtomic: "positiveUint",
    brokerFeeAtomic: "uint",
    totalInputAtomic: "positiveUint",
    outputAmountAtomic: "positiveUint",
    secretHash: "hash",
    sourceRefundAddress: "address",
    destinationClaimAddress: "address",
    sourceAdapterId: "identifier",
    sourceAdapterVersion: "positiveInteger",
    destinationAdapterId: "identifier",
    destinationAdapterVersion: "positiveInteger",
  },
  fx_reserve: {
    acceptId: "hash",
    quoteId: "hash",
    dealerSourceClaimAddress: "address",
    dealerDestinationRefundAddress: "address",
    reservationDeadline: "positiveInteger",
  },
  fx_lock_source: {
    acceptId: "hash",
    chainId: "positiveUint",
    token: "address",
    amountAtomic: "positiveUint",
    lockAddress: "address",
    beneficiary: "address",
    refundAddress: "address",
    secretHash: "hash",
    timeout: "positiveInteger",
    transactionHash: "hash",
    blockNumber: "uint",
  },
  fx_lock_destination: {
    acceptId: "hash",
    chainId: "positiveUint",
    token: "address",
    amountAtomic: "positiveUint",
    lockAddress: "address",
    beneficiary: "address",
    refundAddress: "address",
    secretHash: "hash",
    timeout: "positiveInteger",
    transactionHash: "hash",
    blockNumber: "uint",
  },
  fx_claim: {
    lockMessageId: "hash",
    chainId: "positiveUint",
    transactionHash: "hash",
    blockNumber: "uint",
    secretHash: "hash",
    beneficiary: "address",
  },
  fx_refund: {
    lockMessageId: "hash",
    chainId: "positiveUint",
    transactionHash: "hash",
    blockNumber: "uint",
    beneficiary: "address",
  },
  fx_complete: {
    acceptId: "hash",
    sourceClaimMessageId: "hash",
    destinationClaimMessageId: "hash",
  },
  fx_default: {
    acceptId: "hash",
    reason: enumType(
      "requester_abandoned",
      "dealer_abandoned",
      "invalid_lock",
      "timeout",
      "chain_unavailable",
      "endpoint_failure"
    ),
    missingLeg: enumType(
      "source_lock",
      "destination_lock",
      "destination_claim",
      "source_claim",
      "endpoint_delivery"
    ),
    observedAt: "positiveInteger",
    evidenceIds: evidenceList,
  },
  fx_dispute: {
    defaultId: "hash",
    reason: "identifier",
    evidenceIds: evidenceList,
  },
});

function normalizeField(value, rule, label) {
  if (typeof rule === "object") {
    if (rule.kind === "enum") return enumeration(value, rule.values, label);
    if (rule.kind === "nullableHash") return value === null ? null : hash(value, label);
    if (rule.kind === "inputOptions") return inputOptions(value);
    if (rule.kind === "evidenceIds") return evidenceIds(value);
  }
  if (rule === "hash") return hash(value, label);
  if (rule === "address") return address(value, label);
  if (rule === "uint") return uint(value, label);
  if (rule === "positiveUint") return uint(value, label, true);
  if (rule === "integer") return integer(value, label);
  if (rule === "positiveInteger") return integer(value, label, true);
  if (rule === "identifier") return identifier(value, label);
  throw new FxValidationError(`unsupported schema rule for ${label}`);
}

function normalizePayload(type, value, envelope) {
  const schema = PAYLOAD_SCHEMAS[type];
  exactKeys(value, schema, "payload");
  const normalized = {};
  for (const [key, rule] of Object.entries(schema)) {
    normalized[key] = normalizeField(value[key], rule, `payload.${key}`);
  }

  if (type === "fx_rfq") {
    if (
      normalized.quoteDeadline < envelope.createdAt ||
      normalized.quoteDeadline > envelope.expiresAt
    ) {
      throw new FxValidationError("payload.quoteDeadline must be within the RFQ lifetime");
    }
    if (normalized.settlementDeadline <= normalized.quoteDeadline) {
      throw new FxValidationError("payload.settlementDeadline must follow the quote deadline");
    }
  }
  if (type === "fx_quote" && normalized.spreadBps > 10_000) {
    throw new FxValidationError("payload.spreadBps must not exceed 10000");
  }
  if (
    type === "fx_reserve" &&
    (normalized.reservationDeadline < envelope.createdAt ||
      normalized.reservationDeadline > envelope.expiresAt)
  ) {
    throw new FxValidationError("payload.reservationDeadline must be within the message lifetime");
  }
  if (
    (type === "fx_lock_source" || type === "fx_lock_destination") &&
    normalized.timeout <= envelope.createdAt
  ) {
    throw new FxValidationError("payload.timeout must follow the message timestamp");
  }
  return normalized;
}

export function normalizeFxMessage(input) {
  const envelopeSchema = {
    protocol: true,
    version: true,
    deploymentId: true,
    type: true,
    tradeId: true,
    sender: true,
    role: true,
    sequence: true,
    createdAt: true,
    expiresAt: true,
    payload: true,
    signature: false,
    id: false,
  };
  object(input, "message");
  for (const key of Object.keys(input)) {
    if (!(key in envelopeSchema)) {
      throw new FxValidationError(`message contains unsupported field ${key}`, "UNKNOWN_FIELD");
    }
  }
  for (const [key, required] of Object.entries(envelopeSchema)) {
    if (required && !(key in input)) {
      throw new FxValidationError(`message is missing required field ${key}`);
    }
  }
  if (input.protocol !== FX_PROTOCOL) throw new FxValidationError("protocol is unsupported");
  if (input.version !== FX_VERSION) throw new FxValidationError("version is unsupported");

  const type = enumeration(input.type, FX_MESSAGE_TYPES, "type");
  const role = enumeration(input.role, ROLES, "role");
  if (!ROLE_BY_TYPE[type].includes(role)) {
    throw new FxValidationError(`${role} cannot send ${type}`, "ROLE_MISMATCH");
  }
  const createdAt = integer(input.createdAt, "createdAt", true);
  const expiresAt = integer(input.expiresAt, "expiresAt", true);
  if (expiresAt <= createdAt || expiresAt - createdAt > LIFETIME_BY_TYPE[type]) {
    throw new FxValidationError(`${type} has an invalid lifetime`);
  }
  const normalized = {
    protocol: FX_PROTOCOL,
    version: FX_VERSION,
    deploymentId: hash(input.deploymentId, "deploymentId"),
    type,
    tradeId: hash(input.tradeId, "tradeId"),
    sender: address(input.sender, "sender"),
    role,
    sequence: uint(input.sequence, "sequence"),
    createdAt,
    expiresAt,
  };
  const payload = normalizePayload(type, input.payload, normalized);
  if (
    type === "fx_accept" &&
    BigInt(payload.dealerInputAmountAtomic) + BigInt(payload.brokerFeeAtomic) !==
      BigInt(payload.totalInputAtomic)
  ) {
    throw new FxValidationError(
      "payload.totalInputAtomic must equal dealer input plus broker fee",
      "INVALID_ECONOMICS"
    );
  }
  return {
    ...normalized,
    payload,
  };
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new FxValidationError("canonical JSON only supports safe integer numbers");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  object(value, "canonical value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function canonicalFxMessage(input) {
  return canonicalJson(normalizeFxMessage(input));
}

export function computeFxMessageId(input) {
  return keccak256(toUtf8Bytes(canonicalFxMessage(input)));
}

export function assembleFxEnvelope(input, signature) {
  const normalized = normalizeFxMessage(input);
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
    throw new FxValidationError("signature must be a 65 byte hex value");
  }
  return { ...normalized, signature, id: computeFxMessageId(normalized) };
}

export function verifyFxEnvelope(envelope, options = {}) {
  const normalized = normalizeFxMessage(envelope);
  const expectedId = computeFxMessageId(normalized);
  if (envelope.id !== expectedId) {
    throw new FxValidationError("message id does not match its payload", "BAD_ID");
  }
  if (typeof envelope.signature !== "string" || !SIGNATURE.test(envelope.signature)) {
    throw new FxValidationError("signature must be a 65 byte hex value", "BAD_SIGNATURE");
  }
  let recovered;
  try {
    recovered = verifyMessage(canonicalFxMessage(normalized), envelope.signature).toLowerCase();
  } catch {
    throw new FxValidationError("message signature is invalid", "BAD_SIGNATURE");
  }
  if (recovered !== normalized.sender) {
    throw new FxValidationError("message signature does not match sender", "BAD_SIGNATURE");
  }
  if (options.temporal !== false) {
    const now = options.now ?? Math.floor(Date.now() / 1000);
    const skew = options.clockSkewSeconds ?? FX_MAX_CLOCK_SKEW_SECONDS;
    if (normalized.createdAt > now + skew) {
      throw new FxValidationError("message is too far in the future", "FUTURE_MESSAGE");
    }
    if (normalized.expiresAt < now - skew) {
      throw new FxValidationError("message has expired", "EXPIRED_MESSAGE");
    }
  }
  return { ...normalized, signature: envelope.signature, id: expectedId };
}

function advance(table, state, event, code, label) {
  if (!(state in table)) throw new FxValidationError(`unknown ${label} state ${state}`);
  const next = table[state][event];
  if (!next) {
    throw new FxValidationError(
      `event ${event} is invalid from ${label} state ${state}`,
      code
    );
  }
  return next;
}

export function advanceFxState(state, event) {
  return advance(
    FX_SETTLEMENT_TRANSITIONS,
    state,
    event,
    "INVALID_STATE_TRANSITION",
    "settlement"
  );
}

export function advanceFxCaseState(state, event) {
  return advance(
    FX_CASE_TRANSITIONS,
    state,
    event,
    "INVALID_CASE_TRANSITION",
    "case"
  );
}

export function selectSingleDealerRoute(rfqEnvelope, candidates, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxReferenceAgeSeconds ?? FX_MAX_REFERENCE_AGE_SECONDS;
  const rfq = verifyFxEnvelope(rfqEnvelope, { now, clockSkewSeconds: 0 });
  if (rfq.type !== "fx_rfq") throw new FxValidationError("route selection requires an fx_rfq");
  if (!Array.isArray(candidates) || candidates.length < 1) {
    throw new FxValidationError("route selection requires at least one quote");
  }

  const valid = candidates.flatMap((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      Object.keys(candidate).some((key) => !["quote", "brokerFeeAtomic"].includes(key))
    ) {
      throw new FxValidationError("route candidate contains unsupported fields", "UNKNOWN_FIELD");
    }
    let quote;
    try {
      quote = verifyFxEnvelope(candidate.quote, { now, clockSkewSeconds: 0 });
    } catch {
      return [];
    }
    if (
      quote.type !== "fx_quote" ||
      quote.deploymentId !== rfq.deploymentId ||
      quote.tradeId !== rfq.tradeId ||
      quote.payload.rfqId !== rfq.id ||
      quote.createdAt > rfq.payload.quoteDeadline ||
      quote.expiresAt < now ||
      quote.payload.referenceTimestamp > now ||
      now - quote.payload.referenceTimestamp > maxAge ||
      quote.payload.outputChainId !== rfq.payload.outputChainId ||
      quote.payload.outputToken !== rfq.payload.outputToken ||
      quote.payload.outputAmountAtomic !== rfq.payload.outputAmountAtomic
    ) {
      return [];
    }
    const option = rfq.payload.inputOptions.find(
      (entry) =>
        entry.chainId === quote.payload.inputChainId &&
        entry.token === quote.payload.inputToken
    );
    if (!option) {
      return [];
    }
    const brokerFeeAtomic = uint(
      candidate.brokerFeeAtomic,
      "route candidate brokerFeeAtomic"
    );
    const totalInputAtomic = (
      BigInt(quote.payload.inputAmountAtomic) + BigInt(brokerFeeAtomic)
    ).toString();
    if (BigInt(totalInputAtomic) > BigInt(option.maxInputAtomic)) {
      return [];
    }
    return [{
      quote,
      brokerFeeAtomic,
      totalInputAtomic,
      estimatedCompletionSeconds: quote.payload.estimatedCompletionSeconds,
    }];
  });
  if (valid.length < 1) {
    throw new FxValidationError("no valid route candidates", "NO_VALID_ROUTE");
  }

  const policy = options.policy ?? rfq.payload.quotePolicy;
  enumeration(policy, FX_ROUTE_POLICIES, "route policy");
  valid.sort((left, right) => {
    if (policy === "fastest") {
      const duration = left.estimatedCompletionSeconds - right.estimatedCompletionSeconds;
      if (duration !== 0) return duration;
    }
    const leftTotal = BigInt(left.totalInputAtomic);
    const rightTotal = BigInt(right.totalInputAtomic);
    if (leftTotal !== rightTotal) return leftTotal < rightTotal ? -1 : 1;
    if (policy !== "fastest") {
      const duration = left.estimatedCompletionSeconds - right.estimatedCompletionSeconds;
      if (duration !== 0) return duration;
    }
    return left.quote.id.localeCompare(right.quote.id);
  });

  const selected = valid[0];
  const route = {
    policy,
    rfqId: rfq.id,
    quoteId: selected.quote.id,
    dealer: selected.quote.sender,
    inputChainId: selected.quote.payload.inputChainId,
    inputToken: selected.quote.payload.inputToken,
    totalInputAtomic: selected.totalInputAtomic,
    brokerFeeAtomic: selected.brokerFeeAtomic,
    outputChainId: selected.quote.payload.outputChainId,
    outputToken: selected.quote.payload.outputToken,
    outputAmountAtomic: selected.quote.payload.outputAmountAtomic,
    estimatedCompletionSeconds: selected.estimatedCompletionSeconds,
  };
  return { ...route, routeId: keccak256(toUtf8Bytes(canonicalJson(route))) };
}

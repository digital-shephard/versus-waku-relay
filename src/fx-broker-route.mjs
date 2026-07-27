import {
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";
import {
  canonicalJson,
  selectSingleDealerRoute,
  verifyFxEnvelope,
} from "./fx-protocol.mjs";

export const FX_BROKER_ROUTE_SCHEMA = "versus-fx-broker-route";
export const FX_BROKER_METRICS_SCHEMA = "versus-fx-broker-metrics";
export const FX_BROKER_VERSION = 1;
export const FX_BROKER_PAYMENT_MODE = "verified-completion-v1";

const HASH = /^0x[0-9a-f]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

export class FxBrokerRouteError extends Error {
  constructor(message, code = "FX_BROKER_ROUTE_ERROR") {
    super(message);
    this.name = "FxBrokerRouteError";
    this.code = code;
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FxBrokerRouteError(`${label} must be an object`);
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new FxBrokerRouteError(
        `${label} contains unsupported field ${key}`,
        "UNKNOWN_FIELD"
      );
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new FxBrokerRouteError(`${label} is missing ${key}`, "MISSING_FIELD");
    }
  }
}

function address(value, label, { allowZero = false } = {}) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new FxBrokerRouteError(`${label} must be an EVM address`);
  }
  const normalized = getAddress(value).toLowerCase();
  if (
    !allowZero &&
    normalized === "0x0000000000000000000000000000000000000000"
  ) {
    throw new FxBrokerRouteError(`${label} must not be zero`);
  }
  return normalized;
}

function hash(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!HASH.test(normalized)) {
    throw new FxBrokerRouteError(`${label} must be bytes32`);
  }
  return normalized;
}

function uint(value, label) {
  const text = String(value);
  if (!/^\d+$/.test(text) || text.length > 78) {
    throw new FxBrokerRouteError(`${label} must be an unsigned integer`);
  }
  return BigInt(text).toString();
}

function integer(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new FxBrokerRouteError(`${label} must be a positive integer`);
  }
  return normalized;
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function proposalCore({
  deploymentId,
  broker,
  issuedAt,
  expiresAt,
  rfq,
  quotes,
  policy,
  fee,
  route,
}) {
  return {
    schema: FX_BROKER_ROUTE_SCHEMA,
    schemaVersion: FX_BROKER_VERSION,
    deploymentId,
    broker,
    issuedAt,
    expiresAt,
    rfq,
    quotes,
    policy,
    fee,
    route,
  };
}

export function verifyFxBrokerRouteProposal(input, {
  now = Math.floor(Date.now() / 1000),
  deploymentId,
  rfqId,
  temporal = true,
} = {}) {
  exactKeys(input, [
    "schema",
    "schemaVersion",
    "deploymentId",
    "broker",
    "issuedAt",
    "expiresAt",
    "rfq",
    "quotes",
    "policy",
    "fee",
    "route",
    "proposalId",
    "signature",
  ], "broker proposal");
  if (
    input.schema !== FX_BROKER_ROUTE_SCHEMA ||
    input.schemaVersion !== FX_BROKER_VERSION
  ) {
    throw new FxBrokerRouteError("broker proposal schema is unsupported");
  }
  const broker = address(input.broker, "broker");
  const issuedAt = integer(input.issuedAt, "issuedAt");
  const expiresAt = integer(input.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt || (temporal && (issuedAt > now || expiresAt < now))) {
    throw new FxBrokerRouteError("broker proposal lifetime is invalid");
  }
  const validationNow = temporal ? now : issuedAt;
  const rfq = verifyFxEnvelope(input.rfq, {
    now: validationNow,
    temporal,
    clockSkewSeconds: 0,
  });
  const normalizedDeployment = hash(input.deploymentId, "deploymentId");
  if (
    rfq.type !== "fx_rfq" ||
    rfq.deploymentId !== normalizedDeployment ||
    (deploymentId && normalizedDeployment !== hash(deploymentId, "expected deployment")) ||
    (rfqId && rfq.id !== hash(rfqId, "expected RFQ"))
  ) {
    throw new FxBrokerRouteError("broker proposal RFQ scope is invalid");
  }
  if (
    !Array.isArray(input.quotes) ||
    input.quotes.length < 1 ||
    input.quotes.length > 128
  ) {
    throw new FxBrokerRouteError("broker proposal quote set is invalid");
  }
  const quotes = input.quotes.map((candidate) => {
    const quote = verifyFxEnvelope(candidate, {
      now: validationNow,
      temporal,
      clockSkewSeconds: 0,
    });
    if (
      quote.type !== "fx_quote" ||
      quote.deploymentId !== rfq.deploymentId ||
      quote.tradeId !== rfq.tradeId ||
      quote.payload.rfqId !== rfq.id
    ) {
      throw new FxBrokerRouteError("broker proposal contains an unrelated quote");
    }
    return quote;
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(quotes.map((quote) => quote.id)).size !== quotes.length) {
    throw new FxBrokerRouteError("broker proposal contains duplicate quotes");
  }
  exactKeys(
    input.fee,
    ["recipient", "chainId", "token", "amountAtomic", "paymentMode"],
    "fee"
  );
  const fee = {
    recipient: address(input.fee.recipient, "fee.recipient"),
    chainId: uint(input.fee.chainId, "fee.chainId"),
    token: address(input.fee.token, "fee.token", { allowZero: true }),
    amountAtomic: uint(input.fee.amountAtomic, "fee.amountAtomic"),
    paymentMode: input.fee.paymentMode,
  };
  const route = selectSingleDealerRoute(
    rfq,
    quotes.map((quote) => ({
      quote,
      brokerFeeAtomic: fee.amountAtomic,
    })),
    {
      now: validationNow,
      policy: input.policy,
    }
  );
  if (
    fee.recipient !== broker ||
    fee.chainId !== route.inputChainId ||
    fee.token !== route.inputToken ||
    fee.amountAtomic !== route.brokerFeeAtomic ||
    fee.paymentMode !== FX_BROKER_PAYMENT_MODE
  ) {
    throw new FxBrokerRouteError("broker fee disclosure is invalid", "FEE_MISMATCH");
  }
  if (!same(route, input.route)) {
    throw new FxBrokerRouteError(
      "broker route does not match local recomputation",
      "ROUTE_MISMATCH"
    );
  }
  const selected = quotes.find((quote) => quote.id === route.quoteId);
  if (
    expiresAt > rfq.expiresAt ||
    expiresAt > rfq.payload.quoteDeadline ||
    !selected ||
    expiresAt > selected.expiresAt
  ) {
    throw new FxBrokerRouteError("broker proposal outlives signed inputs");
  }
  const core = proposalCore({
    deploymentId: normalizedDeployment,
    broker,
    issuedAt,
    expiresAt,
    rfq,
    quotes,
    policy: route.policy,
    fee,
    route,
  });
  const proposalId = keccak256(toUtf8Bytes(canonicalJson(core)));
  if (hash(input.proposalId, "proposalId") !== proposalId) {
    throw new FxBrokerRouteError("broker proposal id is invalid", "BAD_PROPOSAL_ID");
  }
  if (typeof input.signature !== "string" || !SIGNATURE.test(input.signature)) {
    throw new FxBrokerRouteError("broker signature is invalid", "BAD_SIGNATURE");
  }
  let recovered;
  try {
    recovered = verifyMessage(canonicalJson(core), input.signature).toLowerCase();
  } catch {
    throw new FxBrokerRouteError("broker signature is invalid", "BAD_SIGNATURE");
  }
  if (recovered !== broker) {
    throw new FxBrokerRouteError("broker signature does not match broker", "BAD_SIGNATURE");
  }
  return { ...core, proposalId, signature: input.signature };
}

export function verifyFxBrokerMetricsSnapshot(input) {
  if (!input || input.schema !== FX_BROKER_METRICS_SCHEMA) {
    throw new FxBrokerRouteError("broker metrics schema is unsupported");
  }
  const metricKeys = [
    "schema",
    "schemaVersion",
    "broker",
    "windowStartedAt",
    "observedAt",
    "counters",
    "gauges",
    "latencyMs",
    "settlementAccuracyBps",
    "signature",
  ];
  if (
    Object.keys(input).length !== metricKeys.length ||
    metricKeys.some((key) => !(key in input))
  ) {
    throw new FxBrokerRouteError("broker metrics shape is invalid");
  }
  const { signature, ...snapshot } = input;
  const broker = address(snapshot.broker, "metrics broker");
  if (
    snapshot.schemaVersion !== FX_BROKER_VERSION ||
    !Number.isSafeInteger(snapshot.windowStartedAt) ||
    !Number.isSafeInteger(snapshot.observedAt) ||
    snapshot.observedAt < snapshot.windowStartedAt
  ) {
    throw new FxBrokerRouteError("broker metrics fields are invalid");
  }
  const numericGroups = [
    [snapshot.counters, [
      "requests",
      "routesCompiled",
      "noRoute",
      "validQuotes",
      "rejectedQuotes",
      "verifiedCompletions",
      "rejectedCompletionProofs",
      "x402DataResponses",
    ]],
    [snapshot.gauges, ["activeRequests", "reachableDealers"]],
    [snapshot.latencyMs, ["p50", "p95", "samples"]],
  ];
  for (const [group, keys] of numericGroups) {
    if (
      !group ||
      Object.keys(group).length !== keys.length ||
      keys.some((key) => !Number.isSafeInteger(group[key]) || group[key] < 0)
    ) {
      throw new FxBrokerRouteError("broker metrics counters are invalid");
    }
  }
  if (
    !Number.isSafeInteger(snapshot.settlementAccuracyBps) ||
    snapshot.settlementAccuracyBps < 0 ||
    snapshot.settlementAccuracyBps > 10_000
  ) {
    throw new FxBrokerRouteError("broker settlement accuracy is invalid");
  }
  let recovered;
  try {
    recovered = verifyMessage(canonicalJson(snapshot), signature).toLowerCase();
  } catch {
    throw new FxBrokerRouteError("broker metrics signature is invalid", "BAD_SIGNATURE");
  }
  if (recovered !== broker) {
    throw new FxBrokerRouteError("broker metrics signature does not match broker", "BAD_SIGNATURE");
  }
  return { ...snapshot, broker, signature };
}

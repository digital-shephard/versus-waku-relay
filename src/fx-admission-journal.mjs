import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { keccak256, toUtf8Bytes } from "ethers";
import {
  advanceFxCaseState,
  advanceFxState,
  canonicalJson,
  selectSingleDealerRoute,
  verifyFxEnvelope,
} from "./fx-protocol.mjs";

const VERSION = 1;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

export class FxAdmissionError extends Error {
  constructor(message, code = "FX_ADMISSION_ERROR") {
    super(message);
    this.name = "FxAdmissionError";
    this.code = code;
  }
}

function hash(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new FxAdmissionError(`${label} must be a 32-byte hash`, "INVALID_SCOPE");
  }
  return normalized;
}

export function fxActionSlot(message) {
  switch (message.type) {
    case "fx_rfq": return "trade:open";
    case "fx_accept": return "trade:accept";
    case "fx_reserve": return "trade:reserve";
    case "fx_lock_source": return "lock:source";
    case "fx_lock_destination": return "lock:destination";
    case "fx_claim":
    case "fx_refund":
      return `settle-lock:${message.payload.lockMessageId}`;
    case "fx_complete": return "trade:complete";
    case "fx_default": return `case:default:${message.sender}`;
    case "fx_dispute": return `case:dispute:${message.sender}`;
    default: return null;
  }
}

export function fxActionNullifier(message, slot = fxActionSlot(message)) {
  if (!slot) return null;
  return keccak256(toUtf8Bytes(canonicalJson({
    protocol: message.protocol,
    version: message.version,
    deploymentId: message.deploymentId,
    tradeId: message.tradeId,
    slot,
  })));
}

function initialState(deploymentId) {
  return { version: VERSION, deploymentId, trades: {} };
}

function atomicSave(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, filePath);
}

function validateLoadedState(value, deploymentId) {
  if (
    !value ||
    value.version !== VERSION ||
    !value.trades ||
    typeof value.trades !== "object" ||
    Array.isArray(value.trades)
  ) {
    throw new FxAdmissionError(
      "FX admission journal is invalid or belongs to another deployment",
      "BAD_JOURNAL"
    );
  }
  if (value.deploymentId !== deploymentId) {
    throw new FxAdmissionError(
      "FX admission journal belongs to another deployment",
      "DEPLOYMENT_MISMATCH"
    );
  }
  for (const [tradeId, trade] of Object.entries(value.trades)) {
    hash(tradeId, "tradeId");
    if (
      !trade ||
      typeof trade.settlementState !== "string" ||
      typeof trade.caseState !== "string" ||
      !trade.messages ||
      !Array.isArray(trade.messageOrder) ||
      !trade.sequences ||
      !trade.actions
    ) {
      throw new FxAdmissionError("FX trade journal entry is invalid", "BAD_JOURNAL");
    }
  }
  return value;
}

export class FxAdmissionJournal {
  constructor({
    filePath,
    deploymentId,
    now = () => Math.floor(Date.now() / 1000),
    minimumTimeoutDeltaSeconds = 60,
  } = {}) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new TypeError("FX admission journal requires a file path");
    }
    this.filePath = path.resolve(filePath);
    this.deploymentId = hash(deploymentId, "deploymentId");
    this.now = now;
    this.minimumTimeoutDeltaSeconds = Number(minimumTimeoutDeltaSeconds);
    if (
      !Number.isSafeInteger(this.minimumTimeoutDeltaSeconds) ||
      this.minimumTimeoutDeltaSeconds < 1
    ) {
      throw new TypeError("minimumTimeoutDeltaSeconds must be a positive integer");
    }
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return initialState(this.deploymentId);
    try {
      return validateLoadedState(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
        this.deploymentId
      );
    } catch (error) {
      if (error instanceof FxAdmissionError) throw error;
      throw new FxAdmissionError(
        `FX admission journal cannot be read: ${error.message}`,
        "BAD_JOURNAL"
      );
    }
  }

  save() {
    atomicSave(this.filePath, this.state);
  }

  trade(tradeId) {
    return this.state.trades[tradeId] || null;
  }

  message(tradeId, id) {
    return this.trade(tradeId)?.messages[id]?.message || null;
  }

  requireMessage(tradeId, id, type) {
    const message = this.message(tradeId, id);
    if (!message || message.type !== type || message.tradeId !== tradeId) {
      throw new FxAdmissionError(
        `${type} reference is missing or belongs to another trade`,
        "MISSING_REFERENCE"
      );
    }
    return message;
  }

  findType(tradeId, type) {
    const trade = this.trade(tradeId);
    if (!trade) return null;
    for (let index = trade.messageOrder.length - 1; index >= 0; index -= 1) {
      const message = trade.messages[trade.messageOrder[index]]?.message;
      if (message?.type === type) return message;
    }
    return null;
  }

  validateLineage(message, trade) {
    let settlementState = trade.settlementState;
    let caseState = trade.caseState;
    switch (message.type) {
      case "fx_rfq":
        settlementState = advanceFxState(settlementState, "publish_rfq");
        break;
      case "fx_quote":
        if (settlementState !== "rfq_open") {
          throw new FxAdmissionError("quote arrived outside the RFQ window", "INVALID_STATE");
        }
        this.requireMessage(message.tradeId, message.payload.rfqId, "fx_rfq");
        break;
      case "fx_accept": {
        const rfq = this.requireMessage(message.tradeId, message.payload.rfqId, "fx_rfq");
        const quote = this.requireMessage(
          message.tradeId,
          message.payload.quoteId,
          "fx_quote"
        );
        const route = selectSingleDealerRoute(
          rfq,
          [{ quote, brokerFeeAtomic: message.payload.brokerFeeAtomic }],
          { now: message.createdAt, policy: rfq.payload.quotePolicy }
        );
        if (
          route.routeId !== message.payload.routeId ||
          route.totalInputAtomic !== message.payload.totalInputAtomic ||
          quote.payload.inputAmountAtomic !== message.payload.dealerInputAmountAtomic ||
          quote.payload.outputAmountAtomic !== message.payload.outputAmountAtomic
        ) {
          throw new FxAdmissionError(
            "acceptance does not match the locally recomputed route",
            "ROUTE_MISMATCH"
          );
        }
        settlementState = advanceFxState(settlementState, "accept_quote");
        break;
      }
      case "fx_reserve":
        this.requireMessage(message.tradeId, message.payload.acceptId, "fx_accept");
        this.requireMessage(message.tradeId, message.payload.quoteId, "fx_quote");
        if (settlementState !== "quote_accepted") {
          throw new FxAdmissionError("reservation arrived outside acceptance", "INVALID_STATE");
        }
        break;
      case "fx_lock_source": {
        const accept = this.requireMessage(
          message.tradeId,
          message.payload.acceptId,
          "fx_accept"
        );
        const quote = this.requireMessage(
          message.tradeId,
          accept.payload.quoteId,
          "fx_quote"
        );
        const reserve = this.findType(message.tradeId, "fx_reserve");
        if (
          !reserve ||
          message.payload.chainId !== quote.payload.inputChainId ||
          message.payload.token !== quote.payload.inputToken ||
          message.payload.amountAtomic !== accept.payload.totalInputAtomic ||
          message.payload.secretHash !== accept.payload.secretHash ||
          message.payload.refundAddress !== accept.payload.sourceRefundAddress ||
          message.payload.beneficiary !== reserve.payload.dealerSourceClaimAddress
        ) {
          throw new FxAdmissionError(
            "source lock does not match accepted route",
            "MALFORMED_LOCK"
          );
        }
        settlementState = advanceFxState(settlementState, "confirm_source_lock");
        break;
      }
      case "fx_lock_destination": {
        const accept = this.requireMessage(
          message.tradeId,
          message.payload.acceptId,
          "fx_accept"
        );
        const quote = this.requireMessage(
          message.tradeId,
          accept.payload.quoteId,
          "fx_quote"
        );
        const reserve = this.findType(message.tradeId, "fx_reserve");
        const sourceLock = this.findType(message.tradeId, "fx_lock_source");
        if (
          !reserve ||
          !sourceLock ||
          message.payload.chainId !== quote.payload.outputChainId ||
          message.payload.token !== quote.payload.outputToken ||
          message.payload.amountAtomic !== accept.payload.outputAmountAtomic ||
          message.payload.secretHash !== accept.payload.secretHash ||
          message.payload.beneficiary !== accept.payload.destinationClaimAddress ||
          message.payload.refundAddress !== reserve.payload.dealerDestinationRefundAddress ||
          sourceLock.payload.timeout <
            message.payload.timeout + this.minimumTimeoutDeltaSeconds
        ) {
          throw new FxAdmissionError(
            "destination lock does not match route or safe timeout order",
            "MALFORMED_LOCK"
          );
        }
        settlementState = advanceFxState(
          settlementState,
          "confirm_destination_lock"
        );
        break;
      }
      case "fx_claim": {
        const lock = this.message(message.tradeId, message.payload.lockMessageId);
        if (
          !lock ||
          !["fx_lock_source", "fx_lock_destination"].includes(lock.type) ||
          lock.payload.chainId !== message.payload.chainId ||
          lock.payload.secretHash !== message.payload.secretHash ||
          lock.payload.beneficiary !== message.payload.beneficiary
        ) {
          throw new FxAdmissionError("claim does not match a verified lock", "BAD_EVIDENCE");
        }
        settlementState = advanceFxState(
          settlementState,
          lock.type === "fx_lock_destination"
            ? "confirm_destination_claim"
            : "confirm_source_claim"
        );
        break;
      }
      case "fx_refund": {
        const lock = this.message(message.tradeId, message.payload.lockMessageId);
        if (
          !lock ||
          !["fx_lock_source", "fx_lock_destination"].includes(lock.type) ||
          lock.payload.chainId !== message.payload.chainId ||
          lock.payload.refundAddress !== message.payload.beneficiary ||
          message.createdAt < lock.payload.timeout
        ) {
          throw new FxAdmissionError(
            "refund does not match an expired verified lock",
            "BAD_EVIDENCE"
          );
        }
        settlementState = advanceFxState(
          settlementState,
          lock.type === "fx_lock_destination"
            ? "confirm_destination_refund"
            : "confirm_source_refund"
        );
        break;
      }
      case "fx_complete":
        if (settlementState !== "complete") {
          throw new FxAdmissionError(
            "completion cannot precede both verified claims",
            "BAD_EVIDENCE"
          );
        }
        this.requireMessage(message.tradeId, message.payload.acceptId, "fx_accept");
        this.requireMessage(
          message.tradeId,
          message.payload.sourceClaimMessageId,
          "fx_claim"
        );
        this.requireMessage(
          message.tradeId,
          message.payload.destinationClaimMessageId,
          "fx_claim"
        );
        break;
      case "fx_default":
        this.requireMessage(message.tradeId, message.payload.acceptId, "fx_accept");
        caseState = advanceFxCaseState(caseState, "report_default");
        break;
      case "fx_dispute":
        this.requireMessage(message.tradeId, message.payload.defaultId, "fx_default");
        caseState = advanceFxCaseState(caseState, "open_dispute");
        break;
      default:
        throw new FxAdmissionError("unsupported FX message type", "UNSUPPORTED_MESSAGE");
    }
    return { settlementState, caseState };
  }

  apply(envelope, { now = this.now(), temporal = false } = {}) {
    const message = verifyFxEnvelope(envelope, { now, temporal });
    if (message.deploymentId !== this.deploymentId) {
      throw new FxAdmissionError(
        "message belongs to another deployment",
        "DEPLOYMENT_MISMATCH"
      );
    }
    let trade = this.trade(message.tradeId);
    if (trade?.messages[message.id]) {
      return { status: "duplicate", snapshot: this.snapshot(message.tradeId) };
    }
    if (!trade) {
      if (message.type !== "fx_rfq") {
        throw new FxAdmissionError("trade must begin with an RFQ", "UNKNOWN_TRADE");
      }
      trade = {
        settlementState: "idle",
        caseState: "none",
        createdAt: message.createdAt,
        updatedAt: now,
        messages: {},
        messageOrder: [],
        sequences: {},
        actions: {},
      };
      this.state.trades[message.tradeId] = trade;
    }

    const senderSequence = trade.sequences[message.sender];
    const sameSequence = Object.values(trade.messages).find(
      (entry) =>
        entry.message.sender === message.sender &&
        entry.message.sequence === message.sequence
    );
    if (sameSequence) {
      throw new FxAdmissionError(
        "sender equivocated at one trade sequence",
        "SEQUENCE_EQUIVOCATION"
      );
    }
    if (
      senderSequence &&
      BigInt(message.sequence) <= BigInt(senderSequence.lastSequence)
    ) {
      throw new FxAdmissionError("message sequence was already surpassed", "STALE_SEQUENCE");
    }

    const slot = fxActionSlot(message);
    const nullifier = fxActionNullifier(message, slot);
    if (slot && trade.actions[slot]) {
      throw new FxAdmissionError(
        `economic action ${slot} was already reserved`,
        "ACTION_REPLAY"
      );
    }

    const next = this.validateLineage(message, trade);
    trade.messages[message.id] = { message, receivedAt: now };
    trade.messageOrder.push(message.id);
    trade.sequences[message.sender] = {
      lastSequence: message.sequence,
      lastMessageId: message.id,
    };
    if (slot) {
      trade.actions[slot] = { nullifier, messageId: message.id, createdAt: now };
    }
    trade.settlementState = next.settlementState;
    trade.caseState = next.caseState;
    trade.updatedAt = now;
    this.save();
    return {
      status: "accepted",
      messageId: message.id,
      actionNullifier: nullifier,
      snapshot: this.snapshot(message.tradeId),
    };
  }

  snapshot(tradeId) {
    tradeId = hash(tradeId, "tradeId");
    const trade = this.trade(tradeId);
    if (!trade) return null;
    const messages = trade.messageOrder
      .map((id) => trade.messages[id])
      .sort((left, right) =>
        left.receivedAt - right.receivedAt ||
        left.message.id.localeCompare(right.message.id)
      )
      .map(({ message }) => ({
        id: message.id,
        type: message.type,
        sender: message.sender,
        sequence: message.sequence,
      }));
    const actions = Object.entries(trade.actions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([slot, action]) => ({
        nullifier: action.nullifier,
        slot,
        messageId: action.messageId,
      }));
    const sequences = Object.entries(trade.sequences)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sender, sequence]) => ({
        sender,
        lastSequence: sequence.lastSequence,
        lastMessageId: sequence.lastMessageId,
      }));
    const stable = {
      version: VERSION,
      deploymentId: this.deploymentId,
      tradeId,
      settlementState: trade.settlementState,
      caseState: trade.caseState,
      messages,
      actions,
      sequences,
    };
    return {
      ...stable,
      stateHash: keccak256(toUtf8Bytes(canonicalJson(stable))),
    };
  }
}

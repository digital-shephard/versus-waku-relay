import fs from "node:fs";
import path from "node:path";
import { Interface, Wallet, getAddress, verifyMessage } from "ethers";

export const CLASS_STATE_DOMAIN = "VERSUS_CLASS_STATE_V1";
export const BASE_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const ARENA = new Interface([
  "function syndicate() view returns (address)",
  "function currentDay() view returns (uint32)",
]);
const SYNDICATE = new Interface([
  "function currentClassId() view returns (uint256)",
  "function graduationFloor() view returns (uint256)",
  "function getClass(uint256 classId) view returns (uint256 totalCommitted,uint32 participantCount,uint32 openedDay,bool graduated)",
]);
const MULTICALL = new Interface([
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[] returnData)",
]);

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

export function canonicalClassState(value) {
  return {
    version: 1,
    chainId: String(value.chainId),
    arena: getAddress(value.arena),
    syndicate: getAddress(value.syndicate),
    classId: String(value.classId),
    totalCommittedMicros: String(value.totalCommittedMicros),
    participantCount: Number(value.participantCount),
    openedDay: Number(value.openedDay),
    chainDay: Number(value.chainDay),
    graduated: Boolean(value.graduated),
    graduationFloorMicros: String(value.graduationFloorMicros),
    blockNumber: String(value.blockNumber),
    observedAt: Number(value.observedAt),
    validUntil: Number(value.validUntil),
    staleUntil: Number(value.staleUntil),
  };
}

export function classStateMessage(value) {
  return `${CLASS_STATE_DOMAIN}\n${JSON.stringify(canonicalClassState(value))}`;
}

export class ClassStateService {
  constructor({
    rpc,
    privateKey,
    chainId,
    arena,
    cachePath,
    now = () => Date.now(),
    validMs = 180_000,
    staleMs = 900_000,
  }) {
    this.rpc = rpc;
    this.wallet = new Wallet(privateKey);
    this.chainId = String(chainId);
    this.arena = getAddress(arena);
    this.cachePath = cachePath;
    this.now = now;
    this.validMs = validMs;
    this.staleMs = staleMs;
    this.state = null;
    this.syndicate = null;
    this.lastError = null;
    this.running = null;
    this.load();
  }

  load() {
    if (!this.cachePath || !fs.existsSync(this.cachePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
      const payload = canonicalClassState(saved);
      const signer = verifyMessage(classStateMessage(payload), saved.signature);
      if (
        signer !== this.wallet.address ||
        payload.chainId !== this.chainId ||
        payload.arena !== this.arena ||
        payload.staleUntil * 1000 <= this.now()
      ) return;
      this.syndicate = payload.syndicate;
      this.state = { ...payload, signer, signature: saved.signature };
    } catch {
      this.state = null;
    }
  }

  persist() {
    if (!this.cachePath || !this.state) return;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    const temporary = `${this.cachePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.cachePath);
  }

  async ensureWiring(blockTag = "latest") {
    if (this.syndicate) return this.syndicate;
    const encoded = await this.rpc.call("eth_call", [{
      to: this.arena,
      data: ARENA.encodeFunctionData("syndicate"),
    }, blockTag]);
    const syndicate = getAddress(ARENA.decodeFunctionResult("syndicate", encoded)[0]);
    if (/^0x0{40}$/i.test(syndicate)) throw new Error("Arena returned a zero Syndicate address");
    this.syndicate = syndicate;
    return syndicate;
  }

  async aggregate(classId, blockTag) {
    const syndicate = await this.ensureWiring(blockTag);
    const calls = [
      { target: syndicate, allowFailure: false, callData: SYNDICATE.encodeFunctionData("currentClassId") },
      { target: this.arena, allowFailure: false, callData: ARENA.encodeFunctionData("currentDay") },
      { target: syndicate, allowFailure: false, callData: SYNDICATE.encodeFunctionData("graduationFloor") },
      { target: syndicate, allowFailure: false, callData: SYNDICATE.encodeFunctionData("getClass", [classId]) },
    ];
    const encoded = await this.rpc.call("eth_call", [{
      to: BASE_MULTICALL3,
      data: MULTICALL.encodeFunctionData("aggregate3", [calls]),
    }, blockTag]);
    const [results] = MULTICALL.decodeFunctionResult("aggregate3", encoded);
    const currentClassId = SYNDICATE.decodeFunctionResult("currentClassId", results[0].returnData)[0];
    const chainDay = ARENA.decodeFunctionResult("currentDay", results[1].returnData)[0];
    const graduationFloor = SYNDICATE.decodeFunctionResult("graduationFloor", results[2].returnData)[0];
    const currentClass = SYNDICATE.decodeFunctionResult("getClass", results[3].returnData);
    return { currentClassId, chainDay, graduationFloor, currentClass };
  }

  async refresh({ confirmedBlock }) {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const blockNumber = BigInt(confirmedBlock);
        const blockTag = hex(blockNumber);
        let classId = this.state ? BigInt(this.state.classId) : null;
        if (classId === null) {
          const syndicate = await this.ensureWiring(blockTag);
          const encoded = await this.rpc.call("eth_call", [{
            to: syndicate,
            data: SYNDICATE.encodeFunctionData("currentClassId"),
          }, blockTag]);
          classId = SYNDICATE.decodeFunctionResult("currentClassId", encoded)[0];
        }
        let result = await this.aggregate(classId, blockTag);
        if (result.currentClassId !== classId) {
          classId = result.currentClassId;
          result = await this.aggregate(classId, blockTag);
        }
        const observedAt = Math.floor(this.now() / 1000);
        const payload = canonicalClassState({
          chainId: this.chainId,
          arena: this.arena,
          syndicate: this.syndicate,
          classId,
          totalCommittedMicros: result.currentClass.totalCommitted ?? result.currentClass[0],
          participantCount: result.currentClass.participantCount ?? result.currentClass[1],
          openedDay: result.currentClass.openedDay ?? result.currentClass[2],
          chainDay: result.chainDay,
          graduated: result.currentClass.graduated ?? result.currentClass[3],
          graduationFloorMicros: result.graduationFloor,
          blockNumber,
          observedAt,
          validUntil: observedAt + Math.floor(this.validMs / 1000),
          staleUntil: observedAt + Math.floor(this.staleMs / 1000),
        });
        const signature = await this.wallet.signMessage(classStateMessage(payload));
        this.state = { ...payload, signer: this.wallet.address, signature };
        this.lastError = null;
        this.persist();
        return this.state;
      } catch (error) {
        this.lastError = error;
        throw error;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  snapshot() {
    if (!this.state) return null;
    const now = Math.floor(this.now() / 1000);
    if (now > this.state.staleUntil) return null;
    return { ...this.state, freshness: now <= this.state.validUntil ? "fresh" : "stale" };
  }

  status() {
    const state = this.snapshot();
    return {
      available: Boolean(state),
      freshness: state?.freshness || "expired",
      classId: state?.classId || null,
      blockNumber: state?.blockNumber || null,
      observedAt: state?.observedAt || null,
      lastError: this.lastError ? "class_state_refresh_failed" : null,
    };
  }
}

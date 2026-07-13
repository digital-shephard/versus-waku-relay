import fs from "node:fs";
import path from "node:path";
import { getAddress } from "ethers";

function initialState(chainId, arena) {
  return {
    version: 1,
    chainId: BigInt(chainId).toString(),
    arena: getAddress(arena),
    pending: null,
    eligibleClass: null,
    eligibleSince: null,
    completedTransactions: 0,
    lastGraduatedClass: null,
    lastReceiptBlock: null,
  };
}

function unsignedInteger(value) {
  return value === null || /^\d+$/.test(String(value));
}

export class GraduationStateStore {
  constructor(filePath, { chainId, arena }) {
    this.filePath = path.resolve(filePath);
    this.chainId = BigInt(chainId).toString();
    this.arena = getAddress(arena);
  }

  load() {
    if (!fs.existsSync(this.filePath)) return initialState(this.chainId, this.arena);
    const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (
      value.version !== 1 ||
      String(value.chainId) !== this.chainId ||
      getAddress(value.arena) !== this.arena ||
      !unsignedInteger(value.eligibleClass) ||
      !unsignedInteger(value.eligibleSince) ||
      !unsignedInteger(value.lastGraduatedClass) ||
      !unsignedInteger(value.lastReceiptBlock) ||
      !Number.isSafeInteger(Number(value.completedTransactions || 0)) ||
      Number(value.completedTransactions || 0) < 0
    ) {
      throw new Error("Versus graduation state is invalid or belongs to another deployment");
    }
    if (value.pending) {
      const pending = value.pending;
      if (
        !unsignedInteger(pending.classId) ||
        !unsignedInteger(pending.nonce) ||
        !/^0x[a-fA-F0-9]{64}$/.test(String(pending.txHash)) ||
        !/^0x[a-fA-F0-9]+$/.test(String(pending.rawTransaction)) ||
        !unsignedInteger(pending.stagedAt) ||
        !unsignedInteger(pending.lastBroadcastAt) ||
        !Number.isSafeInteger(Number(pending.broadcasts || 0)) ||
        Number(pending.broadcasts || 0) < 0
      ) {
        throw new Error("Versus graduation pending transaction state is invalid");
      }
    }
    return { ...initialState(this.chainId, this.arena), ...value };
  }

  save(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}

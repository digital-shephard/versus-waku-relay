import fs from "node:fs";
import path from "node:path";

export class StateStore {
  constructor(filePath, startBlock) {
    this.filePath = path.resolve(filePath);
    this.startBlock = BigInt(startBlock);
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return { version: 1, nextBlock: this.startBlock.toString(), publishedBatches: 0, publishedPennies: 0 };
    }
    const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    if (value.version !== 1 || !/^\d+$/.test(String(value.nextBlock))) {
      throw new Error("Versus node state is invalid");
    }
    return value;
  }

  save(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GraduationStateStore } from "../src/graduation-state-store.mjs";

const arena = "0x1000000000000000000000000000000000000001";

test("graduation journal is deployment-scoped and survives restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "versus-graduation-state-"));
  const file = path.join(directory, "state.json");
  try {
    const first = new GraduationStateStore(file, { chainId: 8453, arena });
    const value = first.load();
    value.lastGraduatedClass = "12";
    value.completedTransactions = 3;
    first.save(value);
    assert.deepEqual(new GraduationStateStore(file, { chainId: 8453, arena }).load(), value);
    assert.throws(
      () => new GraduationStateStore(file, { chainId: 84532, arena }).load(),
      /another deployment/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

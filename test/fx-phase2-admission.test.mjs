import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import {
  assembleFxEnvelope,
  canonicalFxMessage,
} from "../src/fx-protocol.mjs";
import {
  FxAdmissionJournal,
} from "../src/fx-admission-journal.mjs";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/fx-phase2-transcript.json", import.meta.url),
    "utf8"
  )
);

function temporaryJournal() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "versus-fx-relay-"));
  const filePath = path.join(directory, "admission.json");
  return {
    directory,
    filePath,
    journal: new FxAdmissionJournal({
      filePath,
      deploymentId: fixture.deploymentId,
    }),
  };
}

test("relay independently reaches the exact client snapshot across restarts", () => {
  const run = temporaryJournal();
  try {
    for (const message of fixture.messages) {
      const result = run.journal.apply(message, {
        now: message.createdAt,
        temporal: false,
      });
      assert.equal(result.status, "accepted");
      run.journal = new FxAdmissionJournal({
        filePath: run.filePath,
        deploymentId: fixture.deploymentId,
      });
    }
    assert.deepEqual(
      run.journal.snapshot(fixture.tradeId),
      fixture.expectedSnapshot
    );
    assert.equal(
      run.journal.apply(fixture.messages[0], { temporal: false }).status,
      "duplicate"
    );
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test("relay action nullifier rejects a newly signed duplicate acceptance", async () => {
  const run = temporaryJournal();
  try {
    for (const message of fixture.messages) {
      run.journal.apply(message, { temporal: false });
    }
    const original = fixture.messages.find((message) => message.type === "fx_accept");
    const wallet = new Wallet(
      keccak256(
        toUtf8Bytes(
          ["versus-fx-simulator", fixture.seed, "requester"].join(":")
        )
      )
    );
    const input = {
      protocol: original.protocol,
      version: original.version,
      deploymentId: original.deploymentId,
      type: original.type,
      tradeId: original.tradeId,
      sender: wallet.address,
      role: original.role,
      sequence: "4",
      createdAt: original.createdAt + 1,
      expiresAt: original.expiresAt + 1,
      payload: original.payload,
    };
    const replay = assembleFxEnvelope(
      input,
      await wallet.signMessage(canonicalFxMessage(input))
    );
    assert.throws(
      () => run.journal.apply(replay, { temporal: false }),
      (error) => error.code === "ACTION_REPLAY"
    );
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

test("relay journal fails closed on corruption or deployment mismatch", () => {
  const run = temporaryJournal();
  try {
    run.journal.apply(fixture.messages[0], { temporal: false });
    assert.throws(
      () =>
        new FxAdmissionJournal({
          filePath: run.filePath,
          deploymentId: keccak256(toUtf8Bytes("other-deployment")),
        }),
      (error) => error.code === "DEPLOYMENT_MISMATCH"
    );
    fs.writeFileSync(run.filePath, "{broken");
    assert.throws(
      () =>
        new FxAdmissionJournal({
          filePath: run.filePath,
          deploymentId: fixture.deploymentId,
        }),
      (error) => error.code === "BAD_JOURNAL"
    );
  } finally {
    fs.rmSync(run.directory, { recursive: true, force: true });
  }
});

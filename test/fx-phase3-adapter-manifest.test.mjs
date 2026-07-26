import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FxAdapterAdmissionError,
  admitFxMessageAgainstManifest,
  findFxCapability,
  validateFxAdapterManifest,
} from "../src/fx-adapter-manifest.mjs";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/fx-phase3-adapter-manifest.json", import.meta.url),
    "utf8"
  )
);
const capability = validateFxAdapterManifest(manifest).capabilities[0];

test("relay Phase 3 independently validates the frozen capability manifest", () => {
  assert.equal(
    findFxCapability(manifest, capability.chainId, capability.asset.address)
      .adapterAddress,
    capability.adapterAddress
  );
  const duplicate = structuredClone(manifest);
  duplicate.capabilities.push(structuredClone(duplicate.capabilities[0]));
  assert.throws(
    () => validateFxAdapterManifest(duplicate),
    FxAdapterAdmissionError
  );
});

test("relay Phase 3 rejects every unsupported token behavior", () => {
  for (const feature of ["feeOnTransfer", "rebasing", "callbacks"]) {
    const candidate = structuredClone(manifest);
    candidate.capabilities[0].asset.features[feature] = true;
    assert.throws(
      () => validateFxAdapterManifest(candidate),
      (error) =>
        error instanceof FxAdapterAdmissionError &&
        error.code === "UNSUPPORTED_TOKEN"
    );
  }
});

test("relay Phase 3 admits only quotes whose input and output are manifested", () => {
  const quote = {
    type: "fx_quote",
    payload: {
      adapterId: "evm-htlc",
      adapterVersion: 1,
      inputChainId: capability.chainId,
      inputToken: capability.asset.address,
      outputChainId: capability.chainId,
      outputToken: capability.asset.address,
    },
  };
  assert.equal(admitFxMessageAgainstManifest(quote, manifest), true);
  assert.throws(
    () =>
      admitFxMessageAgainstManifest(
        {
          ...quote,
          payload: {
            ...quote.payload,
            outputToken: "0x3000000000000000000000000000000000000003",
          },
        },
        manifest
      ),
    (error) =>
      error instanceof FxAdapterAdmissionError &&
      error.code === "UNSUPPORTED_ASSET"
  );
});

test("relay Phase 3 binds observed locks to the exact manifested adapter", () => {
  const lock = {
    type: "fx_lock_source",
    payload: {
      chainId: capability.chainId,
      token: capability.asset.address,
      lockAddress: capability.adapterAddress,
    },
  };
  assert.equal(admitFxMessageAgainstManifest(lock, manifest), true);
  assert.throws(
    () =>
      admitFxMessageAgainstManifest(
        {
          ...lock,
          payload: {
            ...lock.payload,
            lockAddress: "0x3000000000000000000000000000000000000003",
          },
        },
        manifest
      ),
    (error) =>
      error instanceof FxAdapterAdmissionError &&
      error.code === "WRONG_ADAPTER"
  );
});

test("relay Phase 3 module remains disconnected from production node startup", () => {
  const productionSource = fs.readFileSync(
    new URL("../src/main.mjs", import.meta.url),
    "utf8"
  );
  assert.equal(productionSource.includes("fx-adapter-manifest"), false);
});

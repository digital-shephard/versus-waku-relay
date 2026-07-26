import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  FxPhase4RouteError,
  validateFxPhase4Route,
} from "../src/fx-phase4-route.mjs";

const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/fx-phase4-base-route.json", import.meta.url),
    "utf8"
  )
);

test("relay independently validates the frozen Phase 4 route", () => {
  const route = validateFxPhase4Route(manifest);
  assert.equal(route.pair.input.symbol, "EURC");
  assert.equal(route.pair.output.symbol, "USDC");
  assert.equal(route.settlement.deploymentAddress, null);
});

test("relay rejects altered assets, caps, bytecode, or production connectivity", () => {
  for (const mutate of [
    (candidate) => { candidate.pair.input.address = candidate.pair.output.address; },
    (candidate) => { candidate.settlement.maximumOutputAtomic = "1000001"; },
    (candidate) => { candidate.settlement.creationCodeHash = `0x${"00".repeat(32)}`; },
    (candidate) => { candidate.connectivity.productionWaku = true; },
    (candidate) => { candidate.settlement.deploymentAddress = "0x1000000000000000000000000000000000000001"; },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assert.throws(() => validateFxPhase4Route(candidate), FxPhase4RouteError);
  }
});

test("Phase 4 route remains disconnected from production relay startup", () => {
  const productionSource = fs.readFileSync(
    new URL("../src/main.mjs", import.meta.url),
    "utf8"
  );
  assert.equal(productionSource.includes("fx-phase4-route"), false);
  assert.equal(productionSource.includes("SameChainSettlementV1"), false);
  assert.equal(productionSource.includes("versus-atomic-exact"), false);
});

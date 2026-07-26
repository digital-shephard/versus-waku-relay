import { getAddress, isAddress } from "ethers";

const INPUT = "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42";
const OUTPUT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CREATION =
  "0xca6673e77d32b193161c3e916ad7c37031fe0fd96cbad9e13fc0c237b2b671f3";
const RUNTIME =
  "0x4cf0ab959c8010225c3bd4ff3a2ca42f5ce04a8f8666424b68c9dbd7fdedd574";

export class FxPhase4RouteError extends Error {
  constructor(message) {
    super(message);
    this.name = "FxPhase4RouteError";
  }
}

function address(value, label) {
  if (!isAddress(value)) throw new FxPhase4RouteError(`${label} is not an address`);
  return getAddress(value).toLowerCase();
}

function exact(value, expected, label) {
  if (value !== expected) {
    throw new FxPhase4RouteError(`${label} does not match the frozen Phase 4 route`);
  }
  return value;
}

export function validateFxPhase4Route(input) {
  if (!input || typeof input !== "object") {
    throw new FxPhase4RouteError("route manifest is required");
  }
  exact(input.schema, "versus-fx-phase4-route", "schema");
  exact(input.schemaVersion, 1, "schemaVersion");
  exact(input.status, "development-only", "status");
  exact(input.network?.caip2, "eip155:8453", "network");
  exact(input.network?.chainId, "8453", "chainId");
  exact(address(input.pair?.input?.address, "input token"), INPUT, "input token");
  exact(address(input.pair?.output?.address, "output token"), OUTPUT, "output token");
  exact(input.pair?.input?.decimals, 6, "input decimals");
  exact(input.pair?.output?.decimals, 6, "output decimals");
  exact(input.settlement?.contract, "SameChainSettlementV1", "contract");
  exact(input.settlement?.deploymentAddress, null, "deployment address");
  exact(input.settlement?.creationCodeHash, CREATION, "creation hash");
  exact(input.settlement?.runtimeTemplateHash, RUNTIME, "runtime hash");
  exact(input.settlement?.minimumOutputAtomic, "100000", "minimum output");
  exact(input.settlement?.maximumOutputAtomic, "1000000", "maximum output");
  exact(input.settlement?.maximumInputAtomic, "2000000", "maximum input");
  exact(input.settlement?.maximumQuoteLifetimeSeconds, 20, "quote lifetime");
  exact(input.x402?.version, 2, "x402 version");
  exact(input.x402?.scheme, "versus-atomic-exact", "x402 scheme");
  exact(
    input.x402?.compatibility,
    "controlled-fixture-extension",
    "x402 compatibility"
  );
  for (const [key, value] of Object.entries(input.connectivity || {})) {
    if (value !== false) {
      throw new FxPhase4RouteError(`${key} must remain false in Phase 4`);
    }
  }
  exact(Object.keys(input.connectivity || {}).length, 3, "connectivity policy");
  return structuredClone(input);
}

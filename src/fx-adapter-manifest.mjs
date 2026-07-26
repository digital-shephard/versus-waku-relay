import { getAddress, isAddress } from "ethers";

export const FX_ADAPTER_SCHEMA = "versus-fx-adapter-capabilities";
export const FX_ADAPTER_SCHEMA_VERSION = 1;
export const FX_EVM_ADAPTER_ID = "evm-htlc";
export const FX_EVM_ADAPTER_VERSION = 1;
export const FX_EVM_ADAPTER_SOURCE_TAG = "agentic-fx-phase3-v1";

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const UNSUPPORTED_FEATURES = [
  "feeOnTransfer",
  "rebasing",
  "callbacks",
];

export class FxAdapterAdmissionError extends Error {
  constructor(message, code = "FX_ADAPTER_ADMISSION_ERROR") {
    super(message);
    this.name = "FxAdapterAdmissionError";
    this.code = code;
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FxAdapterAdmissionError(`${label} must be an object`);
  }
}

function address(value, label) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new FxAdapterAdmissionError(`${label} must be an EVM address`);
  }
  return getAddress(value).toLowerCase();
}

function hash(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new FxAdapterAdmissionError(`${label} must be a bytes32 hash`);
  }
  return normalized;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FxAdapterAdmissionError(`${label} must be a non-empty string`);
  }
  return value;
}

function uint(value, label, minimum = 0) {
  const normalized = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    throw new FxAdapterAdmissionError(`${label} must be an unsigned integer`);
  }
  return normalized;
}

export function validateFxAdapterManifest(input) {
  object(input, "manifest");
  object(input.adapter, "manifest.adapter");
  object(input.build, "manifest.build");
  if (
    input.schema !== FX_ADAPTER_SCHEMA ||
    input.schemaVersion !== FX_ADAPTER_SCHEMA_VERSION ||
    input.adapter.id !== FX_EVM_ADAPTER_ID ||
    input.adapter.version !== FX_EVM_ADAPTER_VERSION ||
    input.adapter.contract !== "EvmHtlcV1"
  ) {
    throw new FxAdapterAdmissionError("adapter manifest identity is unsupported");
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    throw new FxAdapterAdmissionError("manifest has no capabilities");
  }
  const capabilities = input.capabilities.map((candidate, index) => {
    const label = `capabilities[${index}]`;
    object(candidate, label);
    object(candidate.asset, `${label}.asset`);
    object(candidate.asset.features, `${label}.asset.features`);
    object(candidate.confirmationPolicy, `${label}.confirmationPolicy`);
    object(candidate.timeoutPolicy, `${label}.timeoutPolicy`);
    for (const feature of UNSUPPORTED_FEATURES) {
      if (candidate.asset.features[feature] !== false) {
        throw new FxAdapterAdmissionError(
          `${label} enables unsupported token behavior ${feature}`,
          "UNSUPPORTED_TOKEN"
        );
      }
    }
    if (!["none", "documented"].includes(candidate.asset.features.issuerControls)) {
      throw new FxAdapterAdmissionError(
        `${label} has an invalid issuer-control policy`
      );
    }
    const requiredConfirmations = uint(
      candidate.confirmationPolicy.requiredConfirmations,
      `${label}.confirmationPolicy.requiredConfirmations`,
      1
    );
    const reorgSafetyBlocks = uint(
      candidate.confirmationPolicy.reorgSafetyBlocks,
      `${label}.confirmationPolicy.reorgSafetyBlocks`,
      requiredConfirmations
    );
    const minimumSeconds = uint(
      candidate.timeoutPolicy.minimumSeconds,
      `${label}.timeoutPolicy.minimumSeconds`,
      1
    );
    const maximumSeconds = uint(
      candidate.timeoutPolicy.maximumSeconds,
      `${label}.timeoutPolicy.maximumSeconds`,
      minimumSeconds + 1
    );
    const minimumCrossChainDeltaSeconds = uint(
      candidate.timeoutPolicy.minimumCrossChainDeltaSeconds,
      `${label}.timeoutPolicy.minimumCrossChainDeltaSeconds`,
      1
    );
    if (minimumCrossChainDeltaSeconds >= maximumSeconds) {
      throw new FxAdapterAdmissionError(`${label} has an impossible timeout policy`);
    }
    return {
      chainId: String(BigInt(candidate.chainId)),
      adapterAddress: address(candidate.adapterAddress, `${label}.adapterAddress`),
      runtimeCodeHash: hash(candidate.runtimeCodeHash, `${label}.runtimeCodeHash`),
      asset: {
        address: address(candidate.asset.address, `${label}.asset.address`),
        runtimeCodeHash: hash(
          candidate.asset.runtimeCodeHash,
          `${label}.asset.runtimeCodeHash`
        ),
        symbol: string(candidate.asset.symbol, `${label}.asset.symbol`),
        decimals: (() => {
          const decimals = uint(candidate.asset.decimals, `${label}.asset.decimals`);
          if (decimals > 255) {
            throw new FxAdapterAdmissionError(`${label}.asset.decimals exceeds uint8`);
          }
          return decimals;
        })(),
        standard: (() => {
          if (candidate.asset.standard !== "ERC20") {
            throw new FxAdapterAdmissionError(`${label}.asset.standard must be ERC20`);
          }
          return "ERC20";
        })(),
        features: Object.fromEntries(
          [
            ...UNSUPPORTED_FEATURES.map((feature) => [feature, false]),
            ["issuerControls", candidate.asset.features.issuerControls],
          ]
        ),
      },
      confirmationPolicy: { requiredConfirmations, reorgSafetyBlocks },
      timeoutPolicy: {
        minimumSeconds,
        maximumSeconds,
        minimumCrossChainDeltaSeconds,
      },
    };
  });
  const keys = capabilities.map(
    (capability) => `${capability.chainId}:${capability.asset.address}`
  );
  if (new Set(keys).size !== keys.length) {
    throw new FxAdapterAdmissionError("manifest repeats a chain and asset");
  }
  return {
    schema: FX_ADAPTER_SCHEMA,
    schemaVersion: FX_ADAPTER_SCHEMA_VERSION,
    adapter: {
      id: FX_EVM_ADAPTER_ID,
      version: FX_EVM_ADAPTER_VERSION,
      contract: "EvmHtlcV1",
      sourcePath: string(input.adapter.sourcePath, "manifest.adapter.sourcePath"),
    },
    build: {
      compiler: string(input.build.compiler, "manifest.build.compiler"),
      evmVersion: string(input.build.evmVersion, "manifest.build.evmVersion"),
      sourceTag: (() => {
        if (input.build.sourceTag !== FX_EVM_ADAPTER_SOURCE_TAG) {
          throw new FxAdapterAdmissionError("manifest.build.sourceTag is unsupported");
        }
        return FX_EVM_ADAPTER_SOURCE_TAG;
      })(),
      optimizerRuns: uint(input.build.optimizerRuns, "manifest.build.optimizerRuns"),
      viaIR: (() => {
        if (input.build.viaIR !== true) {
          throw new FxAdapterAdmissionError("manifest.build.viaIR must be true");
        }
        return true;
      })(),
      sourceSha256: hash(input.build.sourceSha256, "manifest.build.sourceSha256"),
      creationCodeHash: hash(
        input.build.creationCodeHash,
        "manifest.build.creationCodeHash"
      ),
    },
    capabilities,
  };
}

export function findFxCapability(manifestInput, chainId, token) {
  const manifest = validateFxAdapterManifest(manifestInput);
  const chain = String(BigInt(chainId));
  const asset = address(token, "token");
  const capability = manifest.capabilities.find(
    (candidate) => candidate.chainId === chain && candidate.asset.address === asset
  );
  if (!capability) {
    throw new FxAdapterAdmissionError(
      "message references an unsupported chain and asset",
      "UNSUPPORTED_ASSET"
    );
  }
  return capability;
}

export function admitFxMessageAgainstManifest(message, manifestInput) {
  object(message, "message");
  object(message.payload, "message.payload");
  const manifest = validateFxAdapterManifest(manifestInput);

  if (message.type === "fx_quote") {
    if (
      message.payload.adapterId !== FX_EVM_ADAPTER_ID ||
      message.payload.adapterVersion !== FX_EVM_ADAPTER_VERSION
    ) {
      throw new FxAdapterAdmissionError("quote adapter version is unsupported");
    }
    findFxCapability(
      manifest,
      message.payload.inputChainId,
      message.payload.inputToken
    );
    findFxCapability(
      manifest,
      message.payload.outputChainId,
      message.payload.outputToken
    );
    return true;
  }

  if (message.type === "fx_lock_source" || message.type === "fx_lock_destination") {
    const capability = findFxCapability(
      manifest,
      message.payload.chainId,
      message.payload.token
    );
    if (
      address(message.payload.lockAddress, "message.payload.lockAddress") !==
      capability.adapterAddress
    ) {
      throw new FxAdapterAdmissionError(
        "lock address is not the manifested adapter",
        "WRONG_ADAPTER"
      );
    }
    return true;
  }

  if (message.type === "fx_accept") {
    for (const [idField, versionField] of [
      ["sourceAdapterId", "sourceAdapterVersion"],
      ["destinationAdapterId", "destinationAdapterVersion"],
    ]) {
      if (
        message.payload[idField] !== FX_EVM_ADAPTER_ID ||
        message.payload[versionField] !== FX_EVM_ADAPTER_VERSION
      ) {
        throw new FxAdapterAdmissionError("acceptance names an unsupported adapter");
      }
    }
    return true;
  }

  return false;
}

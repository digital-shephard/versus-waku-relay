import fs from "node:fs";
import path from "node:path";
import { Interface, Wallet, getAddress, verifyMessage } from "ethers";

export const FX_PRICE_REFERENCE_DOMAIN = "VERSUS_FX_PRICE_REFERENCE_V1";
export const FX_PRICE_REFERENCE_MARKET = "versus-fx-mainnet-v1";
export const FX_PRICE_SOURCES = Object.freeze([
  Object.freeze({
    symbol: "AVAX",
    rpc: "avalanche",
    chainId: "43114",
    feed: "0x0A77230d17318075983913bC2145DB16C7366156",
    description: "AVAX / USD",
    maximumSourceAgeSeconds: 7_200,
  }),
  Object.freeze({
    symbol: "ETH",
    rpc: "base",
    chainId: "8453",
    feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    description: "ETH / USD",
    maximumSourceAgeSeconds: 7_200,
  }),
  Object.freeze({
    symbol: "EURC",
    rpc: "base",
    chainId: "8453",
    feed: "0xDAe398520e2B67cd3f27aeF9Cf14D93D927f8250",
    description: "EURC / USD",
    maximumSourceAgeSeconds: 90_000,
  }),
]);

const AGGREGATOR = new Interface([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
]);

function unixSeconds(now) {
  return Math.floor(now() / 1_000);
}

function usdMicros(answer, decimals) {
  answer = BigInt(answer);
  decimals = Number(decimals);
  if (answer <= 0n) throw new Error("price answer must be positive");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("price feed decimals are invalid");
  }
  if (decimals === 6) return answer;
  if (decimals < 6) return answer * (10n ** BigInt(6 - decimals));
  const divisor = 10n ** BigInt(decimals - 6);
  return (answer + (divisor / 2n)) / divisor;
}

export function canonicalFxPriceReference(value) {
  const prices = [...(value.prices || [])]
    .map((price) => ({
      symbol: String(price.symbol),
      usdMicros: String(price.usdMicros),
      sourceChainId: String(price.sourceChainId),
      feed: getAddress(price.feed),
      sourceDescription: String(price.sourceDescription),
      sourceDecimals: Number(price.sourceDecimals),
      roundId: String(price.roundId),
      sourceUpdatedAt: Number(price.sourceUpdatedAt),
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  return {
    version: 1,
    market: String(value.market),
    prices,
    observedAt: Number(value.observedAt),
    validUntil: Number(value.validUntil),
    staleUntil: Number(value.staleUntil),
  };
}

export function fxPriceReferenceMessage(value) {
  return `${FX_PRICE_REFERENCE_DOMAIN}\n${JSON.stringify(canonicalFxPriceReference(value))}`;
}

function assertConfiguredSources(prices, sources) {
  if (prices.length !== sources.length) throw new Error("price reference source count is invalid");
  const expected = new Map(sources.map((source) => [source.symbol, source]));
  for (const price of prices) {
    const source = expected.get(price.symbol);
    if (
      !source ||
      price.sourceChainId !== source.chainId ||
      price.feed !== getAddress(source.feed) ||
      price.sourceDescription !== source.description
    ) {
      throw new Error(`price reference source for ${price.symbol} is invalid`);
    }
  }
}

export class FxPriceReferenceService {
  constructor({
    rpcs,
    privateKey,
    cachePath,
    now = () => Date.now(),
    validMs = 180_000,
    staleMs = 900_000,
    sources = FX_PRICE_SOURCES,
  }) {
    this.rpcs = rpcs;
    this.wallet = new Wallet(privateKey);
    this.cachePath = cachePath;
    this.now = now;
    this.validMs = validMs;
    this.staleMs = staleMs;
    this.sources = sources.map((source) => ({ ...source, feed: getAddress(source.feed) }));
    this.metadata = new Map();
    this.checkedChains = new Set();
    this.reference = null;
    this.lastError = null;
    this.running = null;
    this.load();
  }

  load() {
    if (!this.cachePath || !fs.existsSync(this.cachePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
      const payload = canonicalFxPriceReference(saved);
      const signer = getAddress(verifyMessage(fxPriceReferenceMessage(payload), saved.signature));
      assertConfiguredSources(payload.prices, this.sources);
      if (
        signer !== this.wallet.address ||
        payload.market !== FX_PRICE_REFERENCE_MARKET ||
        payload.staleUntil * 1_000 <= this.now()
      ) return;
      this.reference = { ...payload, signer, signature: saved.signature };
    } catch {
      this.reference = null;
    }
  }

  persist() {
    if (!this.cachePath || !this.reference) return;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    const temporary = `${this.cachePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.reference)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.cachePath);
  }

  async ensureChain(source) {
    if (this.checkedChains.has(source.rpc)) return;
    const rpc = this.rpcs[source.rpc];
    if (!rpc) throw new Error(`price RPC ${source.rpc} is unavailable`);
    const chainId = BigInt(await rpc.call("eth_chainId"));
    if (chainId.toString() !== source.chainId) {
      throw new Error(`price RPC ${source.rpc} returned chain ${chainId}`);
    }
    this.checkedChains.add(source.rpc);
  }

  async ensureMetadata(source) {
    const key = `${source.chainId}:${source.feed}`;
    if (this.metadata.has(key)) return this.metadata.get(key);
    await this.ensureChain(source);
    const rpc = this.rpcs[source.rpc];
    const request = (data) => rpc.call("eth_call", [{ to: source.feed, data }, "latest"]);
    const [encodedDecimals, encodedDescription] = await Promise.all([
      request(AGGREGATOR.encodeFunctionData("decimals")),
      request(AGGREGATOR.encodeFunctionData("description")),
    ]);
    const decimals = Number(AGGREGATOR.decodeFunctionResult("decimals", encodedDecimals)[0]);
    const description = String(AGGREGATOR.decodeFunctionResult("description", encodedDescription)[0]);
    if (description !== source.description) {
      throw new Error(`${source.symbol} feed description is ${description}`);
    }
    if (!Number.isInteger(decimals) || decimals < 6 || decimals > 18) {
      throw new Error(`${source.symbol} feed decimals are invalid`);
    }
    const metadata = { decimals, description };
    this.metadata.set(key, metadata);
    return metadata;
  }

  async readSource(source, observedAt) {
    const metadata = await this.ensureMetadata(source);
    const encoded = await this.rpcs[source.rpc].call("eth_call", [{
      to: source.feed,
      data: AGGREGATOR.encodeFunctionData("latestRoundData"),
    }, "latest"]);
    const round = AGGREGATOR.decodeFunctionResult("latestRoundData", encoded);
    const roundId = BigInt(round.roundId ?? round[0]);
    const answer = BigInt(round.answer ?? round[1]);
    const updatedAt = Number(round.updatedAt ?? round[3]);
    const answeredInRound = BigInt(round.answeredInRound ?? round[4]);
    if (roundId <= 0n || answeredInRound < roundId || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) {
      throw new Error(`${source.symbol} feed round is incomplete`);
    }
    if (updatedAt > observedAt + 30 || observedAt - updatedAt > source.maximumSourceAgeSeconds) {
      throw new Error(`${source.symbol} feed round is stale`);
    }
    return {
      symbol: source.symbol,
      usdMicros: usdMicros(answer, metadata.decimals),
      sourceChainId: source.chainId,
      feed: source.feed,
      sourceDescription: metadata.description,
      sourceDecimals: metadata.decimals,
      roundId,
      sourceUpdatedAt: updatedAt,
    };
  }

  async refresh() {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const observedAt = unixSeconds(this.now);
        const prices = await Promise.all(this.sources.map((source) => this.readSource(source, observedAt)));
        const payload = canonicalFxPriceReference({
          market: FX_PRICE_REFERENCE_MARKET,
          prices,
          observedAt,
          validUntil: observedAt + Math.floor(this.validMs / 1_000),
          staleUntil: observedAt + Math.floor(this.staleMs / 1_000),
        });
        const signature = await this.wallet.signMessage(fxPriceReferenceMessage(payload));
        this.reference = { ...payload, signer: this.wallet.address, signature };
        this.lastError = null;
        this.persist();
        return this.reference;
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
    if (!this.reference) return null;
    const now = unixSeconds(this.now);
    if (now > this.reference.staleUntil) return null;
    return { ...this.reference, freshness: now <= this.reference.validUntil ? "fresh" : "stale" };
  }

  status() {
    const reference = this.snapshot();
    return {
      available: Boolean(reference),
      freshness: reference?.freshness || "expired",
      observedAt: reference?.observedAt || null,
      symbols: reference?.prices.map((price) => price.symbol) || [],
      lastError: this.lastError ? "fx_price_reference_refresh_failed" : null,
    };
  }
}

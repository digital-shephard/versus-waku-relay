import fs from "node:fs";
import path from "node:path";
import { Interface, Wallet, getAddress, verifyMessage } from "ethers";

export const BASE_WETH = "0x4200000000000000000000000000000000000006";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
export const HATCH_QUOTE_FEE_TIERS = Object.freeze([500, 3000, 10000]);
export const HATCH_QUOTE_DOMAIN = "VERSUS_HATCH_QUOTE_V1";

const BPS = 10_000n;
const QUOTER = new Interface([
  "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

function divideRoundUp(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

export function canonicalHatchQuote(value) {
  return {
    version: 1,
    chainId: String(value.chainId),
    arena: getAddress(value.arena),
    targetUsdMicros: String(value.targetUsdMicros),
    requiredRunwayMicros: String(value.requiredRunwayMicros),
    runwayBps: Number(value.runwayBps),
    bufferBps: Number(value.bufferBps),
    feeTier: Number(value.feeTier),
    depositWei: String(value.depositWei),
    swapWei: String(value.swapWei),
    gasReserveWei: String(value.gasReserveWei),
    quotedAt: Number(value.quotedAt),
    validUntil: Number(value.validUntil),
    staleUntil: Number(value.staleUntil),
  };
}

export function hatchQuoteMessage(value) {
  return `${HATCH_QUOTE_DOMAIN}\n${JSON.stringify(canonicalHatchQuote(value))}`;
}

export class HatchQuoteService {
  constructor({
    rpc,
    privateKey,
    chainId,
    arena,
    cachePath,
    now = () => Date.now(),
    refreshMs = 60_000,
    fullScanMs = 600_000,
    validMs = 180_000,
    staleMs = 900_000,
    bufferBps = 300,
    runwayBps = 7_000,
    targetUsdMicros = 10_000_000n,
    requiredRunwayMicros = 7_000_000n,
  }) {
    this.rpc = rpc;
    this.wallet = new Wallet(privateKey);
    this.chainId = String(chainId);
    this.arena = getAddress(arena);
    this.cachePath = cachePath;
    this.now = now;
    this.refreshMs = refreshMs;
    this.fullScanMs = fullScanMs;
    this.validMs = validMs;
    this.staleMs = staleMs;
    this.bufferBps = bufferBps;
    this.runwayBps = runwayBps;
    this.targetUsdMicros = BigInt(targetUsdMicros);
    this.requiredRunwayMicros = BigInt(requiredRunwayMicros);
    this.quote = null;
    this.winningFeeTier = null;
    this.lastFullScanAt = 0;
    this.lastError = null;
    this.running = null;
    this.load();
  }

  load() {
    if (!this.cachePath || !fs.existsSync(this.cachePath)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.cachePath, "utf8"));
      const payload = canonicalHatchQuote(saved);
      const signer = verifyMessage(hatchQuoteMessage(payload), saved.signature);
      if (
        signer !== this.wallet.address ||
        payload.chainId !== this.chainId ||
        payload.arena !== this.arena ||
        payload.staleUntil * 1000 <= this.now()
      ) return;
      this.quote = { ...payload, signer, signature: saved.signature };
      this.winningFeeTier = payload.feeTier;
    } catch {
      this.quote = null;
    }
  }

  persist() {
    if (!this.cachePath || !this.quote) return;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    const temporary = `${this.cachePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.quote)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.cachePath);
  }

  async quoteFee(feeTier) {
    const data = QUOTER.encodeFunctionData("quoteExactOutputSingle", [{
      tokenIn: BASE_WETH,
      tokenOut: BASE_USDC,
      amount: this.requiredRunwayMicros,
      fee: feeTier,
      sqrtPriceLimitX96: 0,
    }]);
    const encoded = await this.rpc.call("eth_call", [{ to: BASE_QUOTER_V2, data }, "latest"]);
    const decoded = QUOTER.decodeFunctionResult("quoteExactOutputSingle", encoded);
    return { feeTier, amountIn: BigInt(decoded.amountIn ?? decoded[0]) };
  }

  async scanFeeTiers() {
    const results = await Promise.allSettled(HATCH_QUOTE_FEE_TIERS.map((fee) => this.quoteFee(fee)));
    const viable = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (!viable.length) throw new Error("no live WETH to USDC exact-output quote was available");
    viable.sort((left, right) => left.amountIn < right.amountIn ? -1 : left.amountIn > right.amountIn ? 1 : 0);
    this.lastFullScanAt = this.now();
    this.winningFeeTier = viable[0].feeTier;
    return viable[0];
  }

  async calculate() {
    const fullScanDue = !this.winningFeeTier || this.now() - this.lastFullScanAt >= this.fullScanMs;
    if (fullScanDue) return this.scanFeeTiers();
    try {
      return await this.quoteFee(this.winningFeeTier);
    } catch {
      this.winningFeeTier = null;
      return this.scanFeeTiers();
    }
  }

  async refresh() {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const route = await this.calculate();
        const bufferedSwapWei = divideRoundUp(route.amountIn * (BPS + BigInt(this.bufferBps)), BPS);
        let depositWei = divideRoundUp(bufferedSwapWei * BPS, BigInt(this.runwayBps));
        let swapWei = (depositWei * BigInt(this.runwayBps)) / BPS;
        while (swapWei < bufferedSwapWei) {
          depositWei += 1n;
          swapWei = (depositWei * BigInt(this.runwayBps)) / BPS;
        }
        const quotedAt = Math.floor(this.now() / 1000);
        const payload = canonicalHatchQuote({
          chainId: this.chainId,
          arena: this.arena,
          targetUsdMicros: this.targetUsdMicros,
          requiredRunwayMicros: this.requiredRunwayMicros,
          runwayBps: this.runwayBps,
          bufferBps: this.bufferBps,
          feeTier: route.feeTier,
          depositWei,
          swapWei,
          gasReserveWei: depositWei - swapWei,
          quotedAt,
          validUntil: quotedAt + Math.floor(this.validMs / 1000),
          staleUntil: quotedAt + Math.floor(this.staleMs / 1000),
        });
        const signature = await this.wallet.signMessage(hatchQuoteMessage(payload));
        this.quote = { ...payload, signer: this.wallet.address, signature };
        this.lastError = null;
        this.persist();
        return this.quote;
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
    if (!this.quote) return null;
    const now = Math.floor(this.now() / 1000);
    if (now > this.quote.staleUntil) return null;
    return { ...this.quote, freshness: now <= this.quote.validUntil ? "fresh" : "stale" };
  }

  status() {
    const quote = this.snapshot();
    return {
      available: Boolean(quote),
      freshness: quote?.freshness || "expired",
      feeTier: quote?.feeTier || null,
      quotedAt: quote?.quotedAt || null,
      validUntil: quote?.validUntil || null,
      staleUntil: quote?.staleUntil || null,
      lastError: this.lastError ? "quote_refresh_failed" : null,
    };
  }
}

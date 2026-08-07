import { Wallet, getAddress, verifyMessage } from "ethers";
import { canonicalHatchQuote, hatchQuoteMessage } from "../src/hatch-quote.mjs";
import {
  canonicalFxPriceReference,
  fxPriceReferenceMessage,
} from "../src/fx-price-reference.mjs";
import { loadEnv, validateEnv } from "./lib/config.mjs";

const env = validateEnv(loadEnv());
const response = await fetch(`https://${env.PUBLIC_DOMAIN}/healthz`, { signal: AbortSignal.timeout(10000) });
const body = await response.text();
if (!response.ok) throw new Error(`public relay health failed: HTTP ${response.status} ${body.slice(0, 100)}`);
let info;
try { info = JSON.parse(body); } catch { throw new Error("public relay health did not return nwaku node info"); }
const addresses = info.listenAddresses || info.listen_addresses;
if (!Array.isArray(addresses) || !addresses.some((address) => String(address).includes("/p2p/"))) {
  throw new Error("public relay health did not expose a live nwaku peer identity");
}

let hatchQuote = { enabled: false };
if (String(env.VERSUS_HATCH_QUOTE_ENABLED ?? "true").toLowerCase() !== "false") {
  const quoteResponse = await fetch(`https://${env.PUBLIC_DOMAIN}/v1/hatch-quote`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!quoteResponse.ok) throw new Error(`public hatch quote failed: HTTP ${quoteResponse.status}`);
  const quote = await quoteResponse.json();
  const signer = getAddress(verifyMessage(hatchQuoteMessage(canonicalHatchQuote(quote)), quote.signature));
  const expectedSigner = new Wallet(env.VERSUS_RAIN_ATTESTOR_PRIVATE_KEY).address;
  if (signer !== expectedSigner) throw new Error("public hatch quote signer does not match this host's attestor");
  if (String(quote.chainId) !== String(env.VERSUS_CHAIN_ID) || getAddress(quote.arena) !== getAddress(env.VERSUS_ARENA_ADDRESS)) {
    throw new Error("public hatch quote does not match this deployment");
  }
  if (Number(quote.staleUntil) < Math.floor(Date.now() / 1000)) throw new Error("public hatch quote is expired");
  hatchQuote = { enabled: true, signer, freshness: quote.freshness, feeTier: quote.feeTier };
}

let fxBroker = { enabled: false };
let fxPriceReference = { enabled: false };
if (String(env.VERSUS_FX_PRICE_REFERENCE_ENABLED ?? "true").toLowerCase() !== "false") {
  const priceResponse = await fetch(`https://${env.PUBLIC_DOMAIN}/v1/fx/prices`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!priceResponse.ok) throw new Error(`public FX price reference failed: HTTP ${priceResponse.status}`);
  const reference = await priceResponse.json();
  const signer = getAddress(verifyMessage(
    fxPriceReferenceMessage(canonicalFxPriceReference(reference)),
    reference.signature,
  ));
  const expectedSigner = new Wallet(env.VERSUS_RAIN_ATTESTOR_PRIVATE_KEY).address;
  if (signer !== expectedSigner) throw new Error("public FX price signer does not match this host's attestor");
  if (reference.freshness !== "fresh") throw new Error("public FX price reference is not fresh");
  fxPriceReference = {
    enabled: true,
    signer,
    symbols: reference.prices.map((price) => price.symbol),
  };
}

if (String(env.VERSUS_FX_ENABLED || "false").toLowerCase() === "true") {
  const endpoints = {};
  for (const [name, path] of [
    ["custom", "/v1/fx/swaps"],
    ["exact", "/v1/fx/exact"],
  ]) {
    const endpoint = `https://${env.PUBLIC_DOMAIN}${path}`;
    const fxResponse = await fetch(endpoint, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(10_000),
    });
    if (fxResponse.status !== 204) {
      throw new Error(`public ${name} FX endpoint preflight failed: HTTP ${fxResponse.status}`);
    }
    endpoints[name] = endpoint;
  }
  fxBroker = {
    enabled: true,
    endpoints,
  };
}

console.log(JSON.stringify({
  healthy: true,
  publicRelay: `https://${env.PUBLIC_DOMAIN}/healthz`,
  hatchQuote,
  fxPriceReference,
  fxBroker,
}, null, 2));

const defaults = [
  "relay-a.versuscypher.com",
  "relay-b.versuscypher.com",
];

const domains = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : defaults;

if (domains.length !== 2 || new Set(domains).size !== 2) {
  throw new Error("provide exactly two distinct relay domains");
}

const timeoutMs = Number(process.env.VERSUS_FX_ACCEPTANCE_TIMEOUT_MS || 15_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
  throw new Error("VERSUS_FX_ACCEPTANCE_TIMEOUT_MS must be 1000 to 60000");
}

async function inspectRelay(domain) {
  if (!/^[a-z0-9.-]+$/i.test(domain)) {
    throw new Error(`invalid relay domain: ${domain}`);
  }

  const healthUrl = `https://${domain}/healthz`;
  const healthResponse = await fetch(healthUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!healthResponse.ok) {
    throw new Error(`${domain} relay health returned HTTP ${healthResponse.status}`);
  }
  const health = await healthResponse.json();
  const addresses = health.listenAddresses || health.listen_addresses || [];
  const peerAddress = addresses.find((value) => String(value).includes("/p2p/"));
  const peerId = String(peerAddress || "").split("/p2p/")[1] || "";
  if (!peerId) {
    throw new Error(`${domain} did not report a public Waku peer identity`);
  }

  const fxUrl = `https://${domain}/v1/fx/swaps`;
  const fxResponse = await fetch(fxUrl, {
    method: "OPTIONS",
    headers: {
      origin: "https://versuscypher.com",
      "access-control-request-method": "POST",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (fxResponse.status !== 204) {
    throw new Error(`${domain} FX endpoint returned HTTP ${fxResponse.status}`);
  }
  const methods = fxResponse.headers.get("access-control-allow-methods") || "";
  if (!methods.split(",").map((value) => value.trim()).includes("POST")) {
    throw new Error(`${domain} FX endpoint did not allow POST`);
  }

  return {
    domain,
    peerId,
    relayHealth: healthUrl,
    fxEndpoint: fxUrl,
    fxStatus: fxResponse.status,
  };
}

const relays = await Promise.all(domains.map(inspectRelay));
if (new Set(relays.map((relay) => relay.peerId)).size !== relays.length) {
  throw new Error("the two public domains expose the same Waku peer identity");
}

console.log(JSON.stringify({
  healthy: true,
  checkedAt: new Date().toISOString(),
  relays,
}, null, 2));

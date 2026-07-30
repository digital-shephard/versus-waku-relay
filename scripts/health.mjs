import { loadEnv, peerIdFromInfo, publicWssMultiaddr, validateEnv } from "./lib/config.mjs";

const env = validateEnv(loadEnv());
const port = Number(env.VERSUS_WAKU_REST_PORT || 18645);
const response = await fetch(`http://127.0.0.1:${port}/debug/v1/info`, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`local nwaku health returned HTTP ${response.status}`);
const info = await response.json();
const peerId = peerIdFromInfo(info);
const nodePort = Number(env.VERSUS_NODE_HEALTH_PORT || 18787);
const nodeResponse = await fetch(`http://127.0.0.1:${nodePort}/health`, { signal: AbortSignal.timeout(5000) });
const versusNode = await nodeResponse.json();
if (!nodeResponse.ok || !versusNode.ok) throw new Error("local Versus node verifier is unhealthy");
let fxBroker = { enabled: false };
if (String(env.VERSUS_FX_ENABLED || "false").toLowerCase() === "true") {
  const fxPort = Number(env.VERSUS_FX_BROKER_HEALTH_PORT || 18788);
  const fxResponse = await fetch(`http://127.0.0.1:${fxPort}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  const status = await fxResponse.json();
  if (!fxResponse.ok || !status.ok || status.active !== true) {
    throw new Error("local Versus FX broker is unhealthy");
  }
  fxBroker = {
    enabled: true,
    broker: status.broker,
    active: status.active,
    transport: status.transport,
  };
}
console.log(JSON.stringify({
  healthy: true,
  peerId,
  bootstrapMultiaddr: publicWssMultiaddr(env, peerId),
  listenAddresses: info.listenAddresses || info.listen_addresses || [],
  versusNode,
  fxBroker,
}, null, 2));

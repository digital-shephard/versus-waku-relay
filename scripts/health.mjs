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
console.log(JSON.stringify({
  healthy: true,
  peerId,
  bootstrapMultiaddr: publicWssMultiaddr(env, peerId),
  listenAddresses: info.listenAddresses || info.listen_addresses || [],
  versusNode,
}, null, 2));

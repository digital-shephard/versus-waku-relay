import crypto from "node:crypto";
import { docker } from "./lib/docker.mjs";
import { loadEnv, peerIdFromInfo, publicWssMultiaddr, validateEnv } from "./lib/config.mjs";

const env = validateEnv(loadEnv(), { allowPlaceholders: true });
const name = `versus-waku-identity-${crypto.randomBytes(4).toString("hex")}`;
try {
  docker(["run", "--detach", "--rm", "--name", name, "--publish", "127.0.0.1::8645", env.NWAKU_IMAGE,
    `--nodekey=${env.VERSUS_WAKU_NODE_KEY}`, "--relay=false", "--rest=true", "--rest-address=0.0.0.0", "--rest-port=8645"]);
  let port = "";
  for (let attempt = 0; attempt < 30 && !port; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    port = docker(["port", name, "8645/tcp"], { quiet: true, allowFailure: true }).match(/:(\d+)$/)?.[1] || "";
  }
  if (!port) throw new Error("temporary identity node did not publish its REST port");
  let info;
  for (let attempt = 0; attempt < 60 && !info; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/debug/v1/info`);
      if (response.ok) info = await response.json();
    } catch {}
    if (!info) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!info) throw new Error("temporary identity node did not become healthy");
  const peerId = peerIdFromInfo(info);
  console.log(JSON.stringify({ peerId, publicWssMultiaddr: publicWssMultiaddr(env, peerId), publicTcpMultiaddr: `/dns4/${env.PUBLIC_DOMAIN}/tcp/60000/p2p/${peerId}` }, null, 2));
} finally {
  docker(["rm", "--force", name], { quiet: true, allowFailure: true });
}

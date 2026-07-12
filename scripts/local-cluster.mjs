import path from "node:path";
import { ROOT, peerIdFromInfo } from "./lib/config.mjs";
import { docker } from "./lib/docker.mjs";

const composeFile = path.join(ROOT, "deploy", "local-compose.yml");
const base = ["compose", "--project-name", "versus-waku-relay-local", "--file", composeFile];
const compose = (args, options = {}) => docker([...base, ...args], options);
const command = process.argv[2] || "status";
const node1Placeholder = "/ip4/127.0.0.1/tcp/1/p2p/16Uiu2HAmPlaceholder";

async function info(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/debug/v1/info`);
      if (response.ok) return response.json();
      last = `HTTP ${response.status}`;
    } catch (error) { last = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`nwaku on ${port} did not become healthy: ${last}`);
}

function internalAddress(value) {
  const addresses = [...(value.listenAddresses || []), ...(value.listen_addresses || [])];
  const result = addresses.find((address) => /\/tcp\/60000\/p2p\//.test(String(address)));
  if (!result) throw new Error("node1 did not expose its internal TCP multiaddress");
  return String(result);
}

async function connectedPeers(port) {
  const response = await fetch(`http://127.0.0.1:${port}/admin/v1/peers`);
  if (!response.ok) throw new Error(`peer graph on ${port} returned HTTP ${response.status}`);
  const value = await response.json();
  return (Array.isArray(value) ? value : value ? [value] : [])
    .filter((peer) => String(peer.connected) === "Connected")
    .map((peer) => String(peer.multiaddr || "").match(/\/p2p\/([^/]+)$/)?.[1])
    .filter(Boolean)
    .sort();
}

async function waitForGraph(firstPeerId, secondPeerId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let graph = {};
  while (Date.now() < deadline) {
    try {
      graph = { node1: await connectedPeers(18645), node2: await connectedPeers(18646) };
      if (graph.node1.includes(secondPeerId) && graph.node2.includes(firstPeerId)) return graph;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`local relay graph did not converge: ${JSON.stringify(graph)}`);
}

async function up() {
  compose(["up", "--detach", "node1"], { env: { ...process.env, VERSUS_LOCAL_NODE1: node1Placeholder } });
  const first = await info(18645);
  const staticPeer = internalAddress(first);
  compose(["up", "--detach", "node2"], { env: { ...process.env, VERSUS_LOCAL_NODE1: staticPeer } });
  const second = await info(18646);
  const firstPeerId = peerIdFromInfo(first);
  const secondPeerId = peerIdFromInfo(second);
  const connected = await waitForGraph(firstPeerId, secondPeerId);
  console.log(JSON.stringify({
    healthy: true,
    clusterId: 66,
    shards: "0-7",
    nodes: [
      { peerId: firstPeerId, websocketMultiaddr: `/ip4/127.0.0.1/tcp/18000/ws/p2p/${firstPeerId}` },
      { peerId: secondPeerId, websocketMultiaddr: `/ip4/127.0.0.1/tcp/18001/ws/p2p/${secondPeerId}` },
    ],
    connected,
  }, null, 2));
}

async function status() {
  const records = [];
  for (const [name, port] of [["node1", 18645], ["node2", 18646]]) {
    try { records.push({ name, healthy: true, peerId: peerIdFromInfo(await info(port, 2000)), connectedPeers: await connectedPeers(port) }); }
    catch (error) { records.push({ name, healthy: false, error: error.message }); }
  }
  console.log(JSON.stringify(records, null, 2));
  if (records.some((record) => !record.healthy)) process.exitCode = 1;
}

if (command === "up") await up();
else if (command === "status") await status();
else if (command === "down") compose(["down", "--volumes"], { env: { ...process.env, VERSUS_LOCAL_NODE1: node1Placeholder } });
else throw new Error("usage: local-cluster.mjs up|status|down");

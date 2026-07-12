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
console.log(JSON.stringify({ healthy: true, publicRelay: `https://${env.PUBLIC_DOMAIN}/healthz` }, null, 2));

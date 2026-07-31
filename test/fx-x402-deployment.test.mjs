import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT, validateEnv } from "../scripts/lib/config.mjs";

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const DEPLOYMENT_ID =
  "0x5f6e0d22253c91a77b25e50add622e1e172c8a7f30a4b1cbfb652e8d680dbf45";
const COORDINATION_DOMAIN =
  "0x6e5a6b5ed65eac32898129a87fbcb68b870469b348c52645fe2170f03e04df9a";

test("frozen public-testnet manifest and broker package match their provenance", () => {
  const manifestText = read("config", "fx-v3-public-testnet.json");
  const manifest = JSON.parse(manifestText);
  const provenance = JSON.parse(read("broker", "PROVENANCE.json"));
  const exactFactoriesText = read("config", "fx-x402-exact-factories.json");
  const exactFactories = JSON.parse(exactFactoriesText);
  const tarball = fs.readFileSync(
    path.join(ROOT, "broker", "vendor", "versus-network-0.1.0.tgz")
  );

  assert.equal(manifest.schema, "versus-fx-evm-v3-capabilities");
  assert.equal(manifest.deploymentId, DEPLOYMENT_ID);
  assert.equal(manifest.coordinationDomain, COORDINATION_DOMAIN);
  assert.deepEqual(
    manifest.capabilities.map((chain) => String(chain.chainId)).sort(),
    ["421614", "84532"]
  );
  assert.equal(provenance.deploymentId, DEPLOYMENT_ID);
  assert.equal(provenance.coordinationDomain, COORDINATION_DOMAIN);
  assert.equal(exactFactories.deploymentId, DEPLOYMENT_ID);
  assert.equal(sha256(manifestText), provenance.manifestSha256);
  assert.equal(sha256(exactFactoriesText), provenance.exactFactoriesSha256);
  assert.equal(sha256(tarball), provenance.tarballSha256);
  assert.equal(tarball.length, provenance.tarballBytes);
  assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/);
});

test("FX broker stays isolated while generic exact charges a disclosed fee", () => {
  const compose = read("deploy", "docker-compose.yml");
  const caddy = read("deploy", "Caddyfile");
  const nodeEntry = read("src", "main.mjs");

  const brokerStart = compose.indexOf("  fx-broker:");
  const nodeStart = compose.indexOf("  versus-node:");
  const broker = compose.slice(brokerStart, nodeStart);

  assert.ok(brokerStart > 0);
  assert.match(broker, /profiles:\s*\n\s*- fx-testnet/);
  assert.match(broker, /FX_PHASE7_BROKER_FEE_ATOMIC: "0"/);
  assert.match(broker, /FX_PHASE7_BROKER_PRIVATE_KEY_FILE: \/run\/secrets\/fx-broker-key/);
  assert.match(broker, /FX_X402_SWAP_ENABLED: "1"/);
  assert.match(broker, /FX_X402_EXACT_ENABLED: "1"/);
  assert.match(broker, /FX_X402_EXACT_SETTLER_KEY_FILE: \/run\/secrets\/fx-exact-settler-key/);
  assert.match(broker, /FX_X402_EXACT_FACILITATOR_FEE_ATOMIC:/);
  assert.match(broker, /FX_PHASE7_HTTP_TRUST_PROXY: "1"/);
  assert.match(broker, /127\.0\.0\.1:\$\{VERSUS_FX_BROKER_HEALTH_PORT/);
  assert.match(broker, /read_only: true/);
  assert.match(broker, /no-new-privileges:true/);
  assert.match(broker, /cap_drop:\s*\n\s*- ALL/);
  assert.doesNotMatch(broker, /FX_PHASE7_BROKER_PRIVATE_KEY:/);
  assert.match(caddy, /handle \/v1\/fx\/swaps\*/);
  assert.match(caddy, /handle \/v1\/fx\/exact\*/);
  assert.match(caddy, /max_size 256KB/);
  assert.match(caddy, /reverse_proxy fx-broker:8788/);
  assert.doesNotMatch(nodeEntry, /fx-(?:broker|x402)/i);
});

test("FX production configuration fails closed unless every boundary is explicit", () => {
  const base = {
    NWAKU_IMAGE: "wakuorg/nwaku:v0.38.1",
    PUBLIC_DOMAIN: "relay-a.versuscypher.com",
    PUBLIC_IP: "198.51.100.4",
    VERSUS_WAKU_NODE_KEY: "1".repeat(64),
    VERSUS_WAKU_STATIC_PEER:
      "/dns4/relay-b.versuscypher.com/tcp/60000/p2p/16Uiu2HAmPeer",
    VERSUS_BASE_RPC_URL: "https://base.example.invalid/v3/key",
    VERSUS_CHAIN_ID: "8453",
    VERSUS_ARENA_ADDRESS: "0x1000000000000000000000000000000000000001",
    VERSUS_RAIN_ATTESTOR_PRIVATE_KEY: `0x${"2".repeat(64)}`,
    VERSUS_RAIN_START_BLOCK: "123",
    VERSUS_RAIN_POLL_MS: "300000",
    VERSUS_RPC_DAILY_CREDIT_BUDGET: "3000000",
    VERSUS_GRADUATION_ENABLED: "false",
    VERSUS_WAKU_CLUSTER_ID: "66",
    VERSUS_WAKU_NUM_SHARDS: "8",
    VERSUS_WAKU_STORE_SECONDS: "21600",
    VERSUS_WAKU_STORE_CAPACITY: "25000",
    VERSUS_WAKU_MAX_CONNECTIONS: "200",
    VERSUS_FX_ENABLED: "true",
    VERSUS_FX_DEPLOYMENT_ID: DEPLOYMENT_ID,
    VERSUS_FX_BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example.invalid",
    VERSUS_FX_ARBITRUM_SEPOLIA_RPC_URL: "https://arb-sepolia.example.invalid",
    VERSUS_FX_BROKER_KEY_PATH: "/var/lib/versus-fx-secrets/broker-key",
    VERSUS_FX_EXACT_SETTLER_KEY_PATH:
      "/var/lib/versus-fx-secrets/exact-settler-key",
    VERSUS_FX_EXACT_FACILITATOR_FEE_ATOMIC: "1000",
    VERSUS_FX_WAKU_PEERS:
      "/dns4/relay-a.versuscypher.com/tcp/443/wss/p2p/a,/dns4/relay-b.versuscypher.com/tcp/443/wss/p2p/b",
  };

  assert.doesNotThrow(() => validateEnv(base));
  assert.throws(
    () => validateEnv({ ...base, VERSUS_FX_DEPLOYMENT_ID: "0x01" }),
    /bytes32/
  );
  assert.throws(
    () => validateEnv({ ...base, VERSUS_FX_WAKU_PEERS: base.VERSUS_WAKU_STATIC_PEER }),
    /at least two/
  );
  assert.throws(
    () => validateEnv({ ...base, VERSUS_FX_HTTP_MAX_CONCURRENT_REQUESTS: "0" }),
    /1 to 64/
  );
});

test("AWS rollout reads scoped SSM secrets without placing the broker key in env", () => {
  const moduleMain = read("infra", "aws", "modules", "relay-host", "main.tf");
  const userData = read(
    "infra",
    "aws",
    "modules",
    "relay-host",
    "user-data.sh.tftpl"
  );
  const enable = read("deploy", "enable-fx-testnet.sh");
  const disable = read("deploy", "disable-fx-testnet.sh");
  const verify = read("deploy", "verify-fx-testnet.sh");

  assert.match(moduleMain, /var\.fx_broker_key_parameter_name/);
  assert.match(moduleMain, /var\.fx_exact_settler_key_parameter_name/);
  assert.match(moduleMain, /var\.fx_base_sepolia_rpc_parameter_name/);
  assert.match(moduleMain, /var\.fx_arbitrum_sepolia_rpc_parameter_name/);
  assert.match(userData, /aws ssm get-parameter[\s\S]*--with-decryption/);
  assert.match(userData, /\/var\/lib\/versus-fx-secrets\/broker-key/);
  assert.match(userData, /\/var\/lib\/versus-fx-secrets\/exact-settler-key/);
  assert.doesNotMatch(userData, /VERSUS_FX_BROKER_PRIVATE_KEY=/);
  assert.match(userData, /\$\{fx_compose_profile\}/);
  assert.match(moduleMain, /--profile fx-testnet/);
  assert.match(enable, /grep -vE '\^VERSUS_FX_'/);
  assert.match(enable, /\.deployment-id/);
  assert.match(enable, /x402-exact-swaps/);
  assert.match(enable, /archive_directory/);
  assert.doesNotMatch(enable, /rm -rf/);
  assert.match(enable, /FX_PHASE7_BROKER_FEE_ATOMIC|VERSUS_FX_DEPLOYMENT_ID/);
  assert.doesNotMatch(enable, /echo "\$broker_key"|set -x/);
  assert.match(disable, /stop fx-broker/);
  assert.doesNotMatch(disable, /rm -rf|docker compose[\s\S]*down/);
  assert.match(verify, /VERSUS_EXPECTED_REPOSITORY_REF/);
  assert.match(verify, /provenance\.manifestSha256/);
  assert.match(verify, /provenance\.exactFactoriesSha256/);
  assert.match(verify, /provenance\.tarballSha256/);
  assert.match(verify, /ps --status running --services/);
  assert.match(verify, /request OPTIONS/);
  assert.doesNotMatch(verify, /set -x|with-decryption|private.key/i);
});

test("public acceptance checks two distinct Waku identities and bounded FX preflight", () => {
  const acceptance = read("scripts", "fx-public-acceptance.mjs");

  assert.match(acceptance, /domains\.length !== 2/);
  assert.match(acceptance, /new Set\(domains\)\.size !== 2/);
  assert.match(acceptance, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(acceptance, /method: "OPTIONS"/);
  assert.match(acceptance, /access-control-request-method": "POST"/);
  assert.match(acceptance, /\/v1\/fx\/swaps/);
  assert.match(acceptance, /\/v1\/fx\/exact/);
  assert.match(acceptance, /same Waku peer identity/);
  assert.doesNotMatch(acceptance, /privateKey|sourceLock|secret/i);
});

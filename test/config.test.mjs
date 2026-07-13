import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadNodeConfig } from "../src/config.mjs";
import { ROOT, parseEnv, publicWssMultiaddr, validateEnv } from "../scripts/lib/config.mjs";

const valid = {
  NWAKU_IMAGE: "wakuorg/nwaku:v0.38.1",
  PUBLIC_DOMAIN: "relay-a.versus.example",
  PUBLIC_IP: "198.51.100.4",
  VERSUS_WAKU_NODE_KEY: "1".repeat(64),
  VERSUS_WAKU_STATIC_PEER: "/dns4/relay-b.versus.example/tcp/60000/p2p/16Uiu2HAmPeer",
  VERSUS_WAKU_CLUSTER_ID: "66",
  VERSUS_WAKU_NUM_SHARDS: "8",
  VERSUS_WAKU_STORE_SECONDS: "21600",
  VERSUS_WAKU_STORE_CAPACITY: "25000",
  VERSUS_WAKU_MAX_CONNECTIONS: "200",
  VERSUS_WAKU_IP_COLOCATION_LIMIT: "20",
  VERSUS_BASE_RPC_URL: "https://base.example.invalid/v3/key",
  VERSUS_CHAIN_ID: "8453",
  VERSUS_ARENA_ADDRESS: "0x1000000000000000000000000000000000000001",
  VERSUS_RAIN_ATTESTOR_PRIVATE_KEY: `0x${"2".repeat(64)}`,
  VERSUS_RAIN_START_BLOCK: "123",
  VERSUS_RAIN_POLL_MS: "300000",
  VERSUS_RPC_DAILY_CREDIT_BUDGET: "3000000",
  VERSUS_GRADUATION_ENABLED: "false",
};

test("environment parsing ignores comments without evaluating shell", () => {
  assert.deepEqual(parseEnv("# note\nA=one\nB=two=three\n"), { A: "one", B: "two=three" });
});

test("production environment is pinned and bounded", () => {
  assert.equal(validateEnv({ ...valid }).VERSUS_WAKU_CLUSTER_ID, "66");
  assert.throws(() => validateEnv({ ...valid, NWAKU_IMAGE: "wakuorg/nwaku:latest" }), /pinned/);
  assert.throws(() => validateEnv({ ...valid, VERSUS_WAKU_NODE_KEY: "secret" }), /64 lowercase/);
  assert.throws(() => validateEnv({ ...valid, VERSUS_WAKU_MAX_CONNECTIONS: "100000" }), /10 to 10000/);
  assert.throws(() => validateEnv({ ...valid, VERSUS_RAIN_POLL_MS: "10000", VERSUS_RPC_DAILY_CREDIT_BUDGET: "100000" }), /credit budget/);
  assert.throws(() => validateEnv({ ...valid, VERSUS_RAIN_CONFIRMATIONS: "-1" }), /0 to 10000/);
  assert.throws(() => validateEnv({ ...valid, VERSUS_RAIN_DISTRIBUTION_MS: "999" }), /1000 to 86400000/);
});

test("rain-only production defaults deliver quickly inside the provider budget", () => {
  const configured = loadNodeConfig({
    ...valid,
    VERSUS_RAIN_POLL_MS: undefined,
  });
  assert.equal(configured.pollMs, 10_000);
  assert.equal(configured.confirmations, 2);
  assert.equal(configured.distributionWindowMs, 5_000);
  assert.equal(configured.projectedBaseCredits, 2_894_400);
  assert.doesNotThrow(() => validateEnv({ ...valid, VERSUS_RAIN_POLL_MS: undefined }));
});

test("graduation keeper is opt-in and cannot reuse the rain attestor", () => {
  assert.doesNotThrow(() => validateEnv({ ...valid }));
  assert.throws(
    () => validateEnv({ ...valid, VERSUS_GRADUATION_ENABLED: "true" }),
    /KEEPER_PRIVATE_KEY/,
  );
  assert.throws(
    () => validateEnv({
      ...valid,
      VERSUS_GRADUATION_ENABLED: "true",
      VERSUS_GRADUATION_KEEPER_PRIVATE_KEY: valid.VERSUS_RAIN_ATTESTOR_PRIVATE_KEY,
    }),
    /must not reuse/,
  );
  const configured = loadNodeConfig({
    ...valid,
    VERSUS_GRADUATION_ENABLED: "true",
    VERSUS_GRADUATION_KEEPER_PRIVATE_KEY: `0x${"3".repeat(64)}`,
  });
  assert.equal(configured.graduationEnabled, true);
  assert.notEqual(configured.graduationKeeper, configured.attestor);
  assert.equal(configured.projectedBaseCredits, Math.ceil(86_400_000 / 300_000) * 495);
});

test("bootstrap address is deterministic from domain and peer ID", () => {
  assert.equal(publicWssMultiaddr(valid, "peer"), "/dns4/relay-a.versus.example/tcp/443/wss/p2p/peer");
});

test("deployment keeps stock nwaku and all operator APIs host-only", () => {
  const compose = fs.readFileSync(path.join(ROOT, "deploy", "docker-compose.yml"), "utf8");
  assert.match(compose, /wakuorg\/nwaku:v0\.38\.1/);
  const nwaku = compose.slice(compose.indexOf("  nwaku:"), compose.indexOf("  caddy:"));
  assert.doesNotMatch(nwaku, /^\s*build:/m);
  assert.match(compose, /127\.0\.0\.1:\$\{VERSUS_WAKU_REST_PORT/);
  assert.match(compose, /127\.0\.0\.1:\$\{VERSUS_NODE_HEALTH_PORT/);
  assert.match(compose, /--rest-admin=false/);
  assert.match(compose, /--store-message-retention-policy=time:/);
  assert.match(compose, /--max-msg-size=32KiB/);
  assert.match(compose, /--staticnode=/);
  assert.match(compose, /VERSUS_RPC_DAILY_CREDIT_BUDGET/);
  assert.match(compose, /VERSUS_GRADUATION_ENABLED/);
  assert.match(compose, /VERSUS_GRADUATION_KEEPER_PRIVATE_KEY/);
});

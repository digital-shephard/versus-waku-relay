import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
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
};

test("environment parsing ignores comments without evaluating shell", () => {
  assert.deepEqual(parseEnv("# note\nA=one\nB=two=three\n"), { A: "one", B: "two=three" });
});

test("production environment is pinned and bounded", () => {
  assert.equal(validateEnv({ ...valid }).VERSUS_WAKU_CLUSTER_ID, "66");
  assert.throws(() => validateEnv({ ...valid, NWAKU_IMAGE: "wakuorg/nwaku:latest" }), /pinned/);
  assert.throws(() => validateEnv({ ...valid, VERSUS_WAKU_NODE_KEY: "secret" }), /64 lowercase/);
  assert.throws(() => validateEnv({ ...valid, VERSUS_WAKU_MAX_CONNECTIONS: "100000" }), /10 to 10000/);
});

test("bootstrap address is deterministic from domain and peer ID", () => {
  assert.equal(publicWssMultiaddr(valid, "peer"), "/dns4/relay-a.versus.example/tcp/443/wss/p2p/peer");
});

test("deployment uses stock nwaku and keeps operator APIs host-only", () => {
  const compose = fs.readFileSync(path.join(ROOT, "deploy", "docker-compose.yml"), "utf8");
  assert.match(compose, /wakuorg\/nwaku:v0\.38\.1/);
  assert.doesNotMatch(compose, /^\s*build:/m);
  assert.match(compose, /127\.0\.0\.1:\$\{VERSUS_WAKU_REST_PORT/);
  assert.match(compose, /--rest-admin=false/);
  assert.match(compose, /--store-message-retention-policy=time:/);
  assert.match(compose, /--max-msg-size=32KiB/);
  assert.match(compose, /--staticnode=/);
});

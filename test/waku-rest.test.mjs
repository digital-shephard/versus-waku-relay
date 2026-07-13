import assert from "node:assert/strict";
import test from "node:test";
import { WakuRestPublisher } from "../src/waku-rest.mjs";

test("lets nwaku assign a nanosecond timestamp so Store retains published rain", async () => {
  let request;
  const publisher = new WakuRestPublisher({
    restUrl: "http://nwaku:8645",
    chainId: 8453,
    arena: "0x1000000000000000000000000000000000000001",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    },
  });

  await publisher.publish({ batchId: "test-batch" });
  const body = JSON.parse(request.options.body);
  assert.equal(request.options.method, "POST");
  assert.equal(body.ephemeral, false);
  assert.equal(Object.hasOwn(body, "timestamp"), false);
  assert.match(request.url, /\/relay\/v1\/messages\//);
});

import { rainContentTopic, rainPubsubTopic } from "./rain-protocol.mjs";

export class WakuRestPublisher {
  constructor({ restUrl, chainId, arena, clusterId = 66, shardCount = 8, fetchImpl = fetch }) {
    this.restUrl = String(restUrl).replace(/\/$/, "");
    this.contentTopic = rainContentTopic(chainId, arena);
    this.pubsubTopic = rainPubsubTopic(this.contentTopic, clusterId, shardCount);
    this.fetchImpl = fetchImpl;
  }

  async publish(value) {
    const payload = Buffer.from(JSON.stringify(value), "utf8");
    if (payload.byteLength > 30 * 1024) throw new RangeError("verified rain envelope exceeds Waku payload limit");
    const endpoint = `${this.restUrl}/relay/v1/messages/${encodeURIComponent(this.pubsubTopic)}`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: payload.toString("base64"),
        contentTopic: this.contentTopic,
        ephemeral: false,
      }),
    });
    if (!response.ok) throw new Error(`nwaku publish returned HTTP ${response.status}`);
    return { bytes: payload.byteLength, contentTopic: this.contentTopic, pubsubTopic: this.pubsubTopic };
  }
}

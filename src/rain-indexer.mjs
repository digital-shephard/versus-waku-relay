import { arenaRainTopics, decodeArenaRainLog, signRainBatch } from "./rain-protocol.mjs";

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

export class RainIndexer {
  constructor({
    chainId,
    arena,
    privateKey,
    rpc,
    publisher,
    stateStore,
    confirmations = 2,
    maxBlockSpan = 2_000,
    distributionWindowMs = 5_000,
    now = () => Date.now(),
  }) {
    this.chainId = String(chainId);
    this.arena = arena;
    this.privateKey = privateKey;
    this.rpc = rpc;
    this.publisher = publisher;
    this.stateStore = stateStore;
    this.confirmations = BigInt(confirmations);
    this.maxBlockSpan = BigInt(maxBlockSpan);
    this.distributionWindowMs = distributionWindowMs;
    this.now = now;
    this.state = stateStore.load();
    this.running = null;
    this.lastError = null;
    this.lastPollAt = null;
    this.lastSuccessAt = null;
  }

  async publishEvents(events, fromBlock, toBlock) {
    let batches = 0;
    let pennies = 0;
    for (let offset = 0; offset < events.length; offset += 50) {
      const selected = events.slice(offset, offset + 50);
      const envelope = await signRainBatch({
        chainId: this.chainId,
        arena: this.arena,
        fromBlock,
        toBlock,
        issuedAt: this.now(),
        distributionWindowMs: this.distributionWindowMs,
        events: selected,
      }, this.privateKey);
      await this.publisher.publish(envelope);
      batches += 1;
      pennies += selected.reduce((sum, event) => sum + event.pennies, 0);
    }
    return { batches, pennies };
  }

  async execute() {
    this.lastPollAt = this.now();
    const latest = BigInt(await this.rpc.call("eth_blockNumber"));
    const confirmed = latest > this.confirmations ? latest - this.confirmations : 0n;
    let next = BigInt(this.state.nextBlock);
    if (next > confirmed) {
      this.lastSuccessAt = this.now();
      return { status: "caught_up", latest: latest.toString(), confirmed: confirmed.toString(), nextBlock: next.toString() };
    }

    let totalEvents = 0;
    let totalPennies = 0;
    let totalBatches = 0;
    while (next <= confirmed) {
      const toBlock = next + this.maxBlockSpan - 1n < confirmed ? next + this.maxBlockSpan - 1n : confirmed;
      const logs = await this.rpc.call("eth_getLogs", [{
        address: this.arena,
        fromBlock: hex(next),
        toBlock: hex(toBlock),
        topics: [arenaRainTopics],
      }]);
      const events = logs
        .map((log) => decodeArenaRainLog(log, { chainId: this.chainId, arena: this.arena }))
        .filter(Boolean)
        .sort((left, right) => BigInt(left.blockNumber) < BigInt(right.blockNumber)
          ? -1
          : BigInt(left.blockNumber) > BigInt(right.blockNumber) ? 1 : left.logIndex - right.logIndex);
      const published = events.length ? await this.publishEvents(events, next, toBlock) : { batches: 0, pennies: 0 };
      totalEvents += events.length;
      totalPennies += published.pennies;
      totalBatches += published.batches;
      next = toBlock + 1n;
      this.state = {
        ...this.state,
        nextBlock: next.toString(),
        publishedBatches: Number(this.state.publishedBatches || 0) + published.batches,
        publishedPennies: Number(this.state.publishedPennies || 0) + published.pennies,
        lastPublishedAt: events.length ? this.now() : this.state.lastPublishedAt || null,
      };
      this.stateStore.save(this.state);
    }
    this.lastSuccessAt = this.now();
    this.lastError = null;
    return {
      status: "indexed",
      events: totalEvents,
      pennies: totalPennies,
      batches: totalBatches,
      latest: latest.toString(),
      confirmed: confirmed.toString(),
      nextBlock: next.toString(),
    };
  }

  poll() {
    if (this.running) return this.running;
    this.running = this.execute().catch((error) => {
      this.lastError = { message: error.message, at: this.now() };
      throw error;
    }).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  status() {
    return {
      nextBlock: this.state.nextBlock,
      publishedBatches: this.state.publishedBatches || 0,
      publishedPennies: this.state.publishedPennies || 0,
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      rpc: this.rpc.status(),
    };
  }
}

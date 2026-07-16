import http from "node:http";
import { loadNodeConfig } from "./config.mjs";
import { GraduationKeeper } from "./graduation-keeper.mjs";
import { GraduationStateStore } from "./graduation-state-store.mjs";
import { HatchQuoteService } from "./hatch-quote.mjs";
import { RainIndexer } from "./rain-indexer.mjs";
import { CreditMeteredRpc } from "./rpc.mjs";
import { StateStore } from "./state-store.mjs";
import { WakuRestPublisher } from "./waku-rest.mjs";

const config = loadNodeConfig();
const rpc = new CreditMeteredRpc(config.rpcUrl, {
  dailyCreditBudget: config.dailyCreditBudget,
  creditsPerSecond: config.rpcCreditsPerSecond,
});
const publisher = new WakuRestPublisher({
  restUrl: config.wakuRestUrl,
  chainId: config.chainId,
  arena: config.arena,
  clusterId: config.clusterId,
  shardCount: config.shardCount,
});
const indexer = new RainIndexer({
  chainId: config.chainId,
  arena: config.arena,
  privateKey: config.privateKey,
  rpc,
  publisher,
  stateStore: new StateStore(config.statePath, config.startBlock),
  confirmations: config.confirmations,
  maxBlockSpan: config.maxBlockSpan,
  distributionWindowMs: config.distributionWindowMs,
});
const graduationKeeper = new GraduationKeeper({
  enabled: config.graduationEnabled,
  chainId: config.chainId,
  arena: config.arena,
  privateKey: config.graduationPrivateKey,
  rpc,
  stateStore: new GraduationStateStore(config.graduationStatePath, {
    chainId: config.chainId,
    arena: config.arena,
  }),
  confirmations: config.confirmations,
  maxExecutionFeeWei: config.graduationMaxExecutionFeeWei,
  maxGasLimit: config.graduationMaxGasLimit,
  submissionDelayMs: config.graduationSubmissionDelayMs,
  rebroadcastMs: config.graduationRebroadcastMs,
});
const hatchQuote = config.hatchQuoteEnabled ? new HatchQuoteService({
  rpc,
  privateKey: config.privateKey,
  chainId: config.chainId,
  arena: config.arena,
  cachePath: config.hatchQuoteCachePath,
  refreshMs: config.hatchQuoteRefreshMs,
  fullScanMs: config.hatchQuoteFullScanMs,
  validMs: config.hatchQuoteValidMs,
  staleMs: config.hatchQuoteStaleMs,
  bufferBps: config.hatchQuoteBufferBps,
}) : null;

const server = http.createServer((request, response) => {
  if (request.url === "/v1/hatch-quote") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const quote = hatchQuote?.snapshot();
    if (!quote) {
      response.writeHead(503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : JSON.stringify({ ok: false, error: "quote_unavailable" }));
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "public, max-age=15, stale-while-revalidate=120",
      "access-control-allow-origin": "*",
      etag: `"${quote.signature.slice(2, 18)}"`,
    });
    response.end(request.method === "HEAD" ? undefined : JSON.stringify(quote));
    return;
  }
  if (request.url !== "/health" && request.url !== "/metrics") {
    response.writeHead(404).end();
    return;
  }
  const body = {
    ok: !indexer.lastError,
    service: "versus-node",
    attestor: config.attestor,
    pollMs: config.pollMs,
    projectedBaseCredits: config.projectedBaseCredits,
    dailyCreditBudget: config.dailyCreditBudget,
    rpcCreditsPerSecond: config.rpcCreditsPerSecond,
    rain: indexer.status(),
    graduation: graduationKeeper.status(),
    hatchQuote: hatchQuote?.status() || { available: false, freshness: "disabled" },
    ...(request.url === "/metrics" ? {
      chainId: config.chainId,
      arena: config.arena,
      contentTopic: publisher.contentTopic,
      pubsubTopic: publisher.pubsubTopic,
    } : {}),
  };
  response.writeHead(body.ok ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
});
server.listen(config.healthPort, "0.0.0.0");

async function poll() {
  let rainResult = null;
  try {
    rainResult = await indexer.poll();
    process.stdout.write(`${JSON.stringify({ level: "info", event: "rain_poll", ...rainResult })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ level: "error", event: "rain_poll", message: error.message })}\n`);
  }
  try {
    const result = await graduationKeeper.poll({ confirmedBlock: rainResult?.confirmed });
    process.stdout.write(`${JSON.stringify({ level: "info", event: "graduation_poll", ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ level: "error", event: "graduation_poll", message: error.message })}\n`);
  }
}

await poll();
const timer = setInterval(poll, config.pollMs);
timer.unref?.();
if (hatchQuote) {
  hatchQuote.refresh().catch((error) => {
    process.stderr.write(`${JSON.stringify({ level: "error", event: "hatch_quote_refresh", message: error.message })}\n`);
  });
}
const hatchQuoteTimer = hatchQuote ? setInterval(() => {
  hatchQuote.refresh().catch((error) => {
    process.stderr.write(`${JSON.stringify({ level: "error", event: "hatch_quote_refresh", message: error.message })}\n`);
  });
}, config.hatchQuoteRefreshMs) : null;
hatchQuoteTimer?.unref?.();

async function shutdown() {
  clearInterval(timer);
  if (hatchQuoteTimer) clearInterval(hatchQuoteTimer);
  await indexer.running?.catch(() => {});
  await graduationKeeper.running?.catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

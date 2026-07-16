# Architecture

```text
Base Arena             Base Arena
    | eth_getLogs          | eth_getLogs
versus-node-a          versus-node-b
    | signed rain windows  | signed rain windows
stock nwaku <---------> stock nwaku
    | WSS Filter/Store     | WSS Filter/Store
    +------ Versus Cypher light clients ------+

scheduled Uniswap quote -> signed cached /v1/hatch-quote

optional keeper -- graduateClass(classId) --> canonical GraduationModule
```

Each public host is an identical failure domain with a unique Secp256k1 node key and persistent SQLite Store. Caddy terminates TLS and forwards WebSocket upgrades to nwaku. REST and metrics bind only to host loopback. The two nodes connect through explicit static TCP multiaddresses and advertise stable domain-based WSS multiaddresses to light clients.

The service uses Versus cluster `66` and initially serves all eight autoshards. Those values isolate the first Versus graph from public cluster 1 and match the current content-topic client, whose launch topics may map onto any shard. They are coordinated network boundaries, not per-host tuning controls. Future neighborhood or interest sharding may assign subsets only alongside an explicit client routing migration.

## Verified rain

Each node persists the next unprocessed Base block. At the configured interval it reads the latest block and one bounded Arena log range ending behind the confirmation depth. `Committed` contributes one penny, `Rained` contributes its `pennies`, and `SignalBatchSettled` contributes `inkPennies`. Every Arena event also carries the canonical post-event class total. That absolute value lets a client reconcile counters immediately while still presenting each confirmed penny once, without double-raising the ocean after Store replay. At most 50 events enter one signed Waku envelope.

The cursor advances only after every envelope for that range is accepted by local nwaku. A crash after publication but before cursor persistence can replay an envelope; client event-ID deduplication makes that harmless. A failed publication cannot skip a range. The default 12-second poll performs 7,200 cycles daily. At 335 credits per `eth_blockNumber` plus `eth_getLogs` cycle, rain indexing projects 2,412,000 provider credits daily. Confirmed events are distributed over a five-second presentation window.

## Cached hatch quote

Unhatched clients need a fast Base ETH funding target before they own a Cypher identity. Each Versus node therefore performs one scheduled Uniswap V3 Quoter V2 exact-output request per minute for the currently winning WETH/USDC fee tier. Every 10 minutes it probes the 0.05%, 0.3%, and 1% tiers and reuses the cheapest viable tier between scans. The requested swap output is the immutable $7 USDC runway minimum; a 3% ETH input buffer is applied before deriving the 70/30 runway/gas deposit split.

The node signs the deployment-scoped payload with its existing rain-attestor identity and caches it atomically on disk and in memory. Desktop clients verify the signature, chain, Arena, timestamps, split, target, buffer, and fee tier before use. A quote is fresh for 3 minutes and remains an explicit stale fallback until 15 minutes. After that it is unavailable and the desktop may use its direct-provider fallback.

`GET /v1/hatch-quote` and `HEAD /v1/hatch-quote` only return the cached payload. HTTP request volume cannot cause provider calls, fee-tier scans, signing, or disk writes. Scheduled quote work adds 138,240 projected credits daily, bringing the default rain-plus-quote total to 2,550,240 credits per node per day. A serialized 500-credit-per-second scheduler delays coincident rain and fee-scan calls instead of bursting above the provider's Core-plan ceiling. The configured daily budget fails closed if intervals or optional keeper calls exceed it.

## Optional graduation keeper

Graduation is permissionless and does not require the service fleet. An operator can enable a keeper that derives `SyndicateEngine` from the configured Arena and derives `GraduationModule` from that Syndicate, checks `currentClassId()` and `canGraduate(classId)` against confirmed state, rechecks latest state, then signs `graduateClass(classId)`. Pinning the class prevents a delayed transaction from acting on an unintended later class.

The keeper key is distinct from the non-funded rain attestor and all Cypher or deployment identities. It receives only a deliberately small Base ETH gas balance. Signed transaction bytes are atomically journaled before broadcast; restart rebroadcasts those exact bytes, and a receipt closes the journal once. If another runner advances the class, an accepted transaction remains journaled until its inevitable receipt while a transaction absent from the RPC is cleared as superseded. A local gas limit and maximum execution-fee ceiling fail closed before signing. Base's fixed-size L1 data fee remains additional, so the keeper wallet's deliberately small balance is the absolute spend bound. Enabling the keeper adds provider calls to every poll and therefore requires a compatible polling interval or a larger explicit credit budget; configuration fails closed when the projection exceeds that budget.

Multiple keepers may race because no operator is privileged. Losing transactions can revert and consume their sender's gas, so an operator may enable only one of its own nodes or configure different submission delays. A broken or unfunded keeper cannot block manual graduation or another keeper.

## Trust boundary

The fleet is an availability, temporary-history, and rain-presentation dependency. It is not authoritative for:

- Cypher registration or current NFT ownership;
- daily voice;
- postcard authorship or signatures;
- Base payment proof;
- deduplication or reply lineage;
- local blocks, affinity, trust, coalition views, or model context.

An attestor can lie about presentation but cannot alter Base accounting. Clients accept rain only from explicitly configured attestors, validate the deployment scope and signature, and deduplicate canonical event locations. Independent operators can run nodes with separate RPCs and keys; financial state always remains authoritative on Base. A graduation keeper has no special contract authorization: it can spend its own gas to invoke the same entrypoint available to every address.

Every receiving Cypher verifies those properties independently. A relay may carry invalid bytes, but invalid content must not enter accepted local history or inference context.

## Scaling boundary

The controlled three-node topology delivered exactly through 100 concurrent clients. The 500-client stage exhausted service connection headroom before all clients became ready. Initial production limits therefore target the proven tier. Add nodes or introduce neighborhood/interest sharding before making claims above it.

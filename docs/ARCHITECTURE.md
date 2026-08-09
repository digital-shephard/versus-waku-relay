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
scheduled Chainlink reads -> signed cached /v1/fx/prices

optional keeper -- graduateClass(classId) --> canonical GraduationModule

public requester -- HTTPS /v1/fx/swaps or /v1/fx/exact --> FX broker
                                                |
                                    signed RFQ / dealer quotes over Waku
                                                |
                              frozen Base Sepolia + Avalanche Fuji V3 observations
```

Each public host is an identical failure domain with a unique Secp256k1 node key and persistent SQLite Store. Caddy terminates TLS and forwards WebSocket upgrades to nwaku. REST and metrics bind only to host loopback. The two nodes connect through explicit static TCP multiaddresses and advertise stable dual-stack `/dns/` WSS multiaddresses backed by A and AAAA records, so IPv4-only, IPv6-only, and dual-stack light clients can reach the same identities.

The service uses Versus cluster `66` and initially serves all eight autoshards. Those values isolate the first Versus graph from public cluster 1 and match the current content-topic client, whose launch topics may map onto any shard. They are coordinated network boundaries, not per-host tuning controls. Future neighborhood or interest sharding may assign subsets only alongside an explicit client routing migration.

## Verified rain

Each node persists the next unprocessed Base block. At the configured interval it reads the latest block and one bounded Arena log range ending behind the confirmation depth. `Committed` contributes one penny, `Rained` contributes its `pennies`, and `SignalBatchSettled` contributes `inkPennies`. Every Arena event also carries the canonical post-event class total. That absolute value lets a client reconcile counters immediately while still presenting each confirmed penny once, without double-raising the ocean after Store replay. At most 50 events enter one signed Waku envelope.

The cursor advances only after every envelope for that range is accepted by local nwaku. A crash after publication but before cursor persistence can replay an envelope; client event-ID deduplication makes that harmless. A failed publication cannot skip a range. The default 12-second poll performs 7,200 cycles daily. At 335 credits per `eth_blockNumber` plus `eth_getLogs` cycle, rain indexing projects 2,412,000 provider credits daily. Confirmed events are distributed over a five-second presentation window.

## Cached hatch quote

Unhatched clients need a fast Base ETH funding target before they own a Cypher identity. Each Versus node therefore performs one scheduled Uniswap V3 Quoter V2 exact-output request per minute for the currently winning WETH/USDC fee tier. Every 10 minutes it probes the 0.05%, 0.3%, and 1% tiers and reuses the cheapest viable tier between scans. The requested swap output is the immutable $7 USDC runway minimum; a 3% ETH input buffer is applied before deriving the 70/30 runway/gas deposit split.

The node signs the deployment-scoped payload with its existing rain-attestor identity and caches it atomically on disk and in memory. Desktop clients verify the signature, chain, Arena, timestamps, split, target, buffer, and fee tier before use. A quote is fresh for 3 minutes and remains an explicit stale fallback until 15 minutes. After that it is unavailable and the desktop may use its direct-provider fallback.

`GET /v1/hatch-quote` and `HEAD /v1/hatch-quote` only return the cached payload. HTTP request volume cannot cause provider calls, fee-tier scans, signing, or disk writes. Scheduled quote work adds 138,240 projected credits daily, bringing the default rain-plus-quote total to 2,550,240 credits per node per day. A serialized 500-credit-per-second scheduler delays coincident rain and fee-scan calls instead of bursting above the provider's Core-plan ceiling. The configured daily budget fails closed if intervals or optional keeper calls exceed it.

## Cached FX price reference

Agentic FX uses independent USD references for native and non-dollar assets.
Every minute, each node reads Chainlink ETH/USD and EURC/USD on Base and
AVAX/USD on Avalanche. Feed address, chain ID, decimals, description, round
completion, answer sign, source timestamp, and maximum source age are checked
before one canonical snapshot is signed with that node's existing non-funded
attestor identity. ETH and AVAX may be at most two hours old; the direct EURC
feed may be at most 25 hours old to accommodate its daily heartbeat.

`GET /v1/fx/prices` and `HEAD /v1/fx/prices` only return this bounded cache.
They never perform RPC calls, oracle reads, signing, or disk writes. A snapshot
is fresh for three minutes and retained as an explicitly stale diagnostic for
15 minutes; trading accepts only fresh snapshots. Desktop clients require two
distinct configured attestors, verify both canonical signatures and feed
identities, and reject a symbol when the two prices differ by more than 100
basis points. The client uses their median only after those checks pass.

The two Base reads add 230,400 projected provider credits per node per day,
bringing the default Base projection to 2,895,840 credits. Avalanche reads use
a separate RPC and meter. A failed refresh preserves the last bounded cache
for diagnosis but cannot silently become a tradeable fresh price.

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

## Optional public FX ingress

The `fx-testnet` profile adds a fourth, isolated process. Caddy forwards only
`/v1/fx/swaps*` and `/v1/fx/exact*` to it and caps request bodies at 256 KiB.
The broker has its own SSM-managed signing identity, a separate low-balance
exact-settlement identity, encrypted journal, testnet RPC URLs, HTTP limits,
Waku limits, and loopback-only health port. It is built from the
vendored `@versus/network` tarball whose source commit and SHA-256 are frozen
in `broker/PROVENANCE.json`.

The broker never receives a dealer key, Cypher key, requester key, or dealer
inventory. It can publish the signed RFQ, collect and deterministically rank
signed quotes, and observe V3 receipts. For generic exact only, its dedicated
settler spends relay gas to submit the caller's EIP-3009 authorization to a
frozen CREATE2 factory. One atomic transaction pays the disclosed facilitator
fee and activates the exact signed HTLC; failure rolls both back. The settler
cannot rewrite the signed amount, recipient, fee, or lock terms. Dealers and
execution relayers act independently over the same public protocol.

## Scaling boundary

The controlled three-node topology delivered exactly through 100 concurrent clients. The 500-client stage exhausted service connection headroom before all clients became ready. Initial production limits therefore target the proven tier. Add nodes or introduce neighborhood/interest sharding before making claims above it.

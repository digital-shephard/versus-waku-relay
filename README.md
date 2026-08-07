# Versus Node

Public verification and Waku transport infrastructure for the Versus network.

This repository will own the initial Relay and Store service, deployment configuration, bounded retention, health checks, operator runbooks, and public-internet validation. Versus Cypher desktop applications remain light clients and do not open inbound ports or run public relay infrastructure.

The stock Waku service still transports postcards without interpreting them. A separate least-privileged Versus-node process economically polls the canonical Base Arena, decodes confirmed penny-bearing events, binds each event to its canonical post-event class total, signs bounded event windows, and publishes them over a dedicated Waku content topic. Desktop clients animate one rain drop per deduplicated penny and never poll Base for network weather.

The same process maintains a signed, read-only hatch-funding quote for unhatched clients. Scheduled provider calls refresh the best known WETH/USDC exact-output route every 60 seconds, rescan the three supported Uniswap fee tiers every 10 minutes, and add a 3% input buffer. Public `GET /v1/hatch-quote` requests only read the in-memory cache: they never trigger an RPC call. Quotes are fresh for 3 minutes and may be used as a visibly stale fallback for up to 15 minutes before the endpoint fails closed.

For Agentic FX, each node also reads the canonical Chainlink ETH/USD and
EURC/USD feeds on Base and AVAX/USD on Avalanche once per minute. It signs one
bounded three-asset snapshot and serves the cached result at
`GET /v1/fx/prices`. Request traffic cannot trigger chain reads or signing.
Desktop clients require fresh snapshots from two distinct configured
attestors and reject prices that disagree by more than 1%.

The first production unit runs pinned stock `wakuorg/nwaku:v0.38.1` behind Caddy plus the open-source verifier container in this repository. By default the verifier has no Cypher key, funds, contract authority, message moderation authority, or access to private thoughts. Its signature attests only that it observed a canonical Arena log.

An operator may separately enable the permissionless graduation keeper. It discovers the canonical `SyndicateEngine` and `GraduationModule` through Arena, waits for confirmed `canGraduate(classId)`, and submits `graduateClass(classId)` from a dedicated low-balance gas wallet. This capability is disabled by default, has no privileged contract role, pins the intended class, journals signed bytes before broadcast, and enforces local gas and fee ceilings. Any operator may run it; the protocol does not depend on a designated keeper.

## Local validation

Requirements: Node.js 22, Docker Engine, and Docker Compose.

```sh
npm test
npm run local
npm run local:status
# From the sibling versus-cypher repository:
node scripts/lab/run-full-rain-node-e2e.js
npm run local:down
```

The local cluster uses deterministic throwaway keys and private loopback ports. Never deploy `deploy/local-compose.yml` publicly.

## Configure one production host

```sh
npm run configure
# Edit .env: transport identity, Base RPC, canonical Arena, start block,
# and a distinct non-funded rain attestor key.
# Optionally enable graduation with a separate low-balance funded keeper key.
npm run identity
npm run attestor
npm run preflight
npm run up
npm run health
npm run smoke
```

When FX is enabled, inspect the settlement wallet fleet with:

```sh
npm run wallet:status
npm run wallet:funding-plan
npm run wallet:verify
```

These commands report native gas runway separately from earned facilitator
tokens and never print private keys. An operator may explicitly consolidate
earned EIP-3009 fees through Versus with `npm run wallet:sweep`; see
[`docs/FX_WALLET_OPERATIONS.md`](./docs/FX_WALLET_OPERATIONS.md). Sweeping is
never automatic and never uses dealer inventory or HTLC principal.

Run the same repository on a second independently hosted machine with different Waku and rain-attestor keys. Publish both attestor addresses in the Cypher deployment configuration. Multiple nodes may announce the same chain event; clients deduplicate by `chainId + Arena + transactionHash + logIndex`. Graduation submission can remain disabled everywhere, be enabled on one operator node, or be enabled independently by several operators who accept the possibility of a losing race and reverted gas.

Production deployment and recovery are documented in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) and [`docs/OPERATIONS.md`](./docs/OPERATIONS.md). The security boundary is documented in [`docs/SECURITY.md`](./docs/SECURITY.md).

Agentic FX broker services remain optional sidecars rather than relay
features. The `fx-testnet` Compose profile exposes the requester-secret V3
testnet endpoint at `POST https://<relay>/v1/fx/swaps` and the standard x402
`exact` endpoint at `POST https://<relay>/v1/fx/exact`. It republishes a
requester-signed RFQ, compiles signed dealer quotes, and observes the frozen
Base Sepolia and Arbitrum Sepolia contracts. It owns no inventory or executor
funds. The custom endpoint charges a zero broker fee. Generic exact payments
include a disclosed fixed facilitator fee and use a dedicated low-balance
settlement identity to atomically activate the source HTLC from the caller's
EIP-3009 authorization. Relay forwarding itself is never paid per hop.

Its trust, economics, deployment, and recovery boundary is documented in
[`docs/FX_PHASE_7_BROKER_BOUNDARY.md`](./docs/FX_PHASE_7_BROKER_BOUNDARY.md).

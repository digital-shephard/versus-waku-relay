# Versus Waku Relay

Public Waku transport infrastructure for the Versus network.

This repository will own the initial Relay and Store service, deployment configuration, bounded retention, health checks, operator runbooks, and public-internet validation. Versus Cypher desktop applications remain light clients and do not open inbound ports or run public relay infrastructure.

Protocol identity, ownership, daily voice, payment-proof, and local-trust rules remain independently verifiable application concerns. A relay transports data; it does not become a trusted Versus authority.

The first production unit runs the pinned stock `wakuorg/nwaku:v0.38.1` image behind Caddy. It enables Relay, LightPush, Filter, bounded Store, secure public WebSockets, private REST/metrics, persistent peer identity, static cross-host peering, and coarse request limits. There is no custom relay server.

## Local validation

Requirements: Node.js 22, Docker Engine, and Docker Compose.

```sh
npm test
npm run local
npm run local:status
npm run local:down
```

The local cluster uses deterministic throwaway keys and private loopback ports. Never deploy `deploy/local-compose.yml` publicly.

## Configure one production host

```sh
npm run configure
# Edit .env: domain, public IP, and the other host's static peer.
npm run identity
npm run preflight
npm run up
npm run health
npm run smoke
```

Run the same repository on a second independently hosted machine with a different node key, domain, IP, data directory, and peer ID. Each `.env` points `VERSUS_WAKU_STATIC_PEER` at the other host's public TCP multiaddress. The desktop client receives both WSS multiaddresses printed by `npm run health`.

Production deployment and recovery are documented in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) and [`docs/OPERATIONS.md`](./docs/OPERATIONS.md). The security boundary is documented in [`docs/SECURITY.md`](./docs/SECURITY.md).

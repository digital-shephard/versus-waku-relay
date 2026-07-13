# Deployment

## Host requirements

- A small Linux VM with Docker Engine and Compose.
- At least 2 GB RAM for a WSS service node.
- Persistent disk for Waku Store, the Versus-node block cursor, and Caddy state.
- Public TCP 80, 443, and 60000.
- DNS A/AAAA record pointing the relay domain at the host.
- Host firewall denying every other inbound port.

## Two-host ceremony

1. Clone this repository independently on Host A and Host B.
2. Run `npm run configure`, `npm run identity`, and `npm run attestor` on each host. Store each transport key, attestor key, and RPC URL as secrets; publish only peer IDs and attestor addresses.
3. Set each public domain and IP. Do not copy `.env` between hosts.
4. Run `npm run identity` on each host and exchange the printed public TCP multiaddresses.
5. Set `VERSUS_WAKU_STATIC_PEER` on A to B and on B to A.
6. Run `npm run preflight` on each host.
7. Start A, then B, with `npm run up`.
8. Confirm `npm run health` locally and `npm run smoke` through public TLS.
9. Put both printed WSS multiaddresses and both public rain-attestor addresses into a test desktop configuration.
10. Complete the separate-machine paid postcard, verified-rain, Store recovery, and failover acceptance tests before adding either node to a stable client release.

Graduation submission is not part of relay availability and remains disabled by default. To opt one host in, create a separate keeper with `npm run keeper`, store it as an encrypted host secret, fund only its public address with a bounded Base gas balance, set `VERSUS_GRADUATION_ENABLED=true`, and verify its canonical wiring through loopback `/metrics`. Never reuse either host's rain-attestor or any Cypher/deployment identity. Other operators can independently enable their own keeper; no allowlist or designated operator exists.

Never expose ports 8645 or 8008 publicly. Never use the deterministic keys from `deploy/local-compose.yml`. Never use `latest` image tags. Upgrades require reading every intermediate nwaku migration note and repeating the controlled tests.

## Cloud independence

The friend-ready gate requires two independently reachable hosts. Prefer separate providers or at least separate failure domains. One Compose project containing two containers on one VM is useful for validation but is not service redundancy.

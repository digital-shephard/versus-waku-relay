# Deployment

## Host requirements

- A small Linux VM with Docker Engine and Compose.
- At least 2 GB RAM for a WSS service node.
- Persistent disk for `/data` and Caddy state.
- Public TCP 80, 443, and 60000.
- DNS A/AAAA record pointing the relay domain at the host.
- Host firewall denying every other inbound port.

## Two-host ceremony

1. Clone this repository independently on Host A and Host B.
2. Run `npm run configure` on each host. This generates a different ignored node key.
3. Set each public domain and IP. Do not copy `.env` between hosts.
4. Run `npm run identity` on each host and exchange the printed public TCP multiaddresses.
5. Set `VERSUS_WAKU_STATIC_PEER` on A to B and on B to A.
6. Run `npm run preflight` on each host.
7. Start A, then B, with `npm run up`.
8. Confirm `npm run health` locally and `npm run smoke` through public TLS.
9. Put both printed WSS multiaddresses into a test desktop configuration.
10. Complete the separate-machine paid postcard, Store recovery, and failover acceptance test before adding either address to a stable client release.

Never expose ports 8645 or 8008 publicly. Never use the deterministic keys from `deploy/local-compose.yml`. Never use `latest` image tags. Upgrades require reading every intermediate nwaku migration note and repeating the controlled tests.

## Cloud independence

The friend-ready gate requires two independently reachable hosts. Prefer separate providers or at least separate failure domains. One Compose project containing two containers on one VM is useful for validation but is not service redundancy.

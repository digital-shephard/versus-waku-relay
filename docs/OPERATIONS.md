# Operations

## Daily checks

```sh
npm run health
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 nwaku
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 versus-node
```

Monitor process restarts, connected peers, LightPush/Filter/Store availability, the verifier block cursor, last successful poll, daily estimated RPC credits, signed penny count, hatch-quote freshness and selected fee tier, signed class-state freshness and block, optional keeper state, Store size, disk, memory, and TLS expiry. Do not collect postcard bodies into a secondary analytics database.

The verifier returns `/health` and `/metrics` on host loopback. Alert when the cursor stops advancing for two poll windows, RPC credit use approaches its configured daily or per-second budget, Waku publication fails, both nodes lack a fresh hatch quote or class snapshot for more than 3 minutes, two nodes disagree about a canonical event, or an enabled keeper remains `unfunded`, `error`, or `pending` beyond two poll windows. Public `/v1/hatch-quote` and `/v1/class-state` requests read signed local caches and must never trigger provider work. A stale cache may serve for at most 15 minutes; after that the public endpoint returns 503. Never reset the cursor forward to clear an alert; replay from an earlier block is safe.

## Graduation keeper

Keep `VERSUS_GRADUATION_ENABLED=false` unless this operator deliberately accepts gas spending. To enable it, generate a dedicated identity with `npm run keeper`, store the private key directly in encrypted SSM or another host secret manager, fund its public address with only a small Base ETH balance, set the execution-fee ceiling, and restart the node. Confirm `/metrics` reports the expected signer plus Arena-derived Syndicate and Graduation addresses. Never fund the rain attestor.

The journal at `/var/lib/versus-node/graduation-state.json` is restart-critical while a transaction is pending. Do not edit it to force retries. `submitted`, `rebroadcast`, and `pending` are normal transient states; `confirmed` means this keeper's transaction won; `superseded_pending` means another address advanced the class while this transaction is still accepted and awaiting its likely reverted receipt; `superseded` means no such transaction remains at the RPC; `reverted` spent gas but did not graduate. The app still observes the resulting canonical class increment through ordinary reconciliation, regardless of who called graduation.

## Store backup

`npm run backup` briefly stops nwaku, copies the complete bounded data directory, writes a manifest, and restarts the service. Stopping first avoids an inconsistent SQLite copy. Stagger backups so both public nodes are never intentionally offline together.

Restore only an explicitly selected local backup:

```sh
npm run restore -- backups/2026-01-01T00-00-00-000Z --yes
```

The displaced pre-restore directory is retained for manual rollback. Store is temporary recovery material, not canonical permanent history.

## Upgrade

1. Read every nwaku upgrade note between the current and target versions.
2. Change the pinned image in a branch.
3. Run unit, Compose, identity, local-cluster, Store, failover, and capacity tests.
4. Back up each node.
5. Upgrade one host and observe it while the other remains available.
6. Roll forward the second host only after client acceptance.
7. Roll back using the prior image and data backup if database migration is incompatible.

## Incident priorities

1. Preserve node and attestor identity; if a graduation keeper is enabled, immediately disable or rotate it and move any remaining keeper-only gas funds after host compromise.
2. Keep one healthy service address available if possible.
3. Do not erase Store data merely to hide malformed traffic.
4. Record times, versions, peer counts, resource pressure, and recovery actions without publishing message bodies.
5. Tell clients and operators when availability is degraded; do not describe a single surviving host as decentralized redundancy.

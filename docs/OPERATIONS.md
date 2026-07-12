# Operations

## Daily checks

```sh
npm run health
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=200 nwaku
```

Monitor process restarts, connected peers, LightPush/Filter/Store protocol availability, Store size, disk, memory, request rate, rejection rate, and TLS expiry. Do not collect message bodies into a secondary analytics database.

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

1. Preserve node keys and user funds remain irrelevant because the relay holds none.
2. Keep one healthy service address available if possible.
3. Do not erase Store data merely to hide malformed traffic.
4. Record times, versions, peer counts, resource pressure, and recovery actions without publishing message bodies.
5. Tell clients and operators when availability is degraded; do not describe a single surviving host as decentralized redundancy.

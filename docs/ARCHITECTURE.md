# Architecture

```text
Versus Cypher light clients
        |  wss, LightPush, Filter, Store
        v
relay-a                 relay-b
Caddy :443              Caddy :443
   |                       |
stock nwaku <----------> stock nwaku
   | TCP :60000            | TCP :60000
bounded SQLite Store       bounded SQLite Store
```

Each public host is an identical failure domain with a unique Secp256k1 node key and persistent SQLite Store. Caddy terminates TLS and forwards WebSocket upgrades to nwaku. REST and metrics bind only to host loopback. The two nodes connect through explicit static TCP multiaddresses and advertise stable domain-based WSS multiaddresses to light clients.

The service uses Versus cluster `66` and initially serves all eight autoshards. Those values isolate the first Versus graph from public cluster 1 and match the current content-topic client, whose launch topics may map onto any shard. They are coordinated network boundaries, not per-host tuning controls. Future neighborhood or interest sharding may assign subsets only alongside an explicit client routing migration.

## Trust boundary

The fleet is an availability and temporary-history dependency. It is not authoritative for:

- Cypher registration or current NFT ownership;
- daily voice;
- postcard authorship or signatures;
- Base payment proof;
- deduplication or reply lineage;
- local blocks, affinity, trust, coalition views, or model context.

Every receiving Cypher verifies those properties independently. A relay may carry invalid bytes, but invalid content must not enter accepted local history or inference context.

## Scaling boundary

The controlled three-node topology delivered exactly through 100 concurrent clients. The 500-client stage exhausted service connection headroom before all clients became ready. Initial production limits therefore target the proven tier. Add nodes or introduce neighborhood/interest sharding before making claims above it.

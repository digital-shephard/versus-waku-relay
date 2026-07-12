# Initial limits

The defaults in `.env.example` are conservative V1 operator limits, not protocol constants.

| Setting | Initial value | Reason |
|---|---:|---|
| Cluster | 66 | Isolates the Versus service graph from public cluster 1. |
| Shards | 8 | Matches the controlled Versus laboratory. |
| Active shards | 0-7 | Current content-topic autosharding may map a launch onto any of the eight shards. |
| Store time | 6 hours | Temporary restart recovery without permanent surveillance. |
| Store capacity | 25,000 | Bounded message count. |
| Store size | 512 MB | Bounded host disk exposure. |
| Connections | 200 | Initial service ceiling around the proven 100-client tier. |
| Same-IP peers | 20 | Coarse Sybil/connection pressure bound without excluding ordinary shared networks. |
| Relay payload | 32 KiB | Leaves protocol overhead above the client's stricter 16 KiB application payload. |
| LightPush | 30 requests/second | Coarse transport abuse resistance. |
| Store | 10 requests/second | Prevents unbounded history-query load. |
| Filter | 12 operations/minute per subscriber | Allows refresh while limiting subscription churn. |

Changing cluster, shard, or topic boundaries requires coordinated client configuration and a preserved migration test. The first nodes serve all eight shards; future neighborhood or interest sharding may assign subsets only after the client routing rule is explicit. Raising connection or retention limits requires capacity and disk evidence. Desktop clients still enforce registered-Cypher ownership, daily voice, signatures, payment proof, deduplication, and local trust.

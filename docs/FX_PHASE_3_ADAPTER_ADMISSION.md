# FX Phase 3 Adapter Admission

The relay repository now contains an independent parser for the Phase 3
`evm-htlc` capability manifest.

It checks:

- manifest, adapter, and schema version
- exact chain and token tuple
- exact adapter address for observed lock messages
- source and destination capability for quote messages
- accepted adapter family/version in acceptance messages
- runtime and build hash syntax
- confirmation and timeout policy structure
- rejection of fee-on-transfer, rebasing, and callback-heavy tokens
- explicit issuer-control classification

The frozen fixture is byte-for-byte shared with the desktop/network repository.

This module is intentionally not imported by `src/main.mjs`. It does not
subscribe to FX topics, advertise dealer inventory, inspect production traffic,
or move funds. It exists only as Phase 3 cross-implementation evidence.

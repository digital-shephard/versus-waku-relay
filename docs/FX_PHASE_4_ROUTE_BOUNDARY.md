# FX Phase 4 Route Boundary

The relay repository carries an independent copy and validator for the frozen
Phase 4 Base route:

- EURC input
- USDC exact output
- tiny fixed caps
- 20-second quote lifetime
- frozen `SameChainSettlementV1` bytecode
- controlled `versus-atomic-exact` x402 extension

This is compatibility evidence, not a production relay feature.

`src/main.mjs` does not import the validator, settlement contract, or x402
scheme. The deployed Waku fleet does not:

- discover Phase 4 dealers
- select quotes
- collect broker fees
- submit settlements
- hold inventory
- inspect payment contents
- expose a Phase 4 HTTP route

Direct dealer discovery remains between requester and dealer. Production Waku
continues to provide the existing Cypher transport only. Phase 6, not Phase 4,
is where typed FX discovery is deliberately introduced and tested against
partitions, duplicates, and suppression.

The relay tests reject any manifest that changes an asset, cap, bytecode hash,
deployment state, or production-connectivity flag.

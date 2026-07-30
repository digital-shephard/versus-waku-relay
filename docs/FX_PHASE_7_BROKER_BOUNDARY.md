# Phase 7 Broker Boundary

The reference Agentic FX broker is an optional sidecar implemented in
`@versus/network`. It is deliberately not imported by `src/main.mjs` and is
not part of relay startup, rain indexing, hatch quoting, class snapshots, or
graduation keeping.

## Separate Roles

The deployed Waku service remains blind transport:

- it forwards signed FX envelopes
- it provides bounded Store recovery
- it does not select quotes
- it does not charge a broker fee
- it does not attest settlement
- it does not become a required gateway

The optional broker:

- republishes a requester-signed RFQ without changing it
- collects independently signed dealer quotes
- applies the public deterministic route compiler
- signs a proposal containing all considered quotes
- discloses one explicit completion-coupled fee
- exposes bounded health and signed aggregate metrics

A requester verifies the proposal locally. Relay health never upgrades a
broker proposal into economic truth.

## Independent Compatibility Verifier

`src/fx-broker-route.mjs` independently verifies the Phase 7 proposal and
metric formats. It is compatibility and audit tooling, not a production
broker feature. Tests assert that the deployed node entry point does not
import it.

## Operator Economics

Generic Waku hops earn nothing because forwarding receipts are Sybilable.
Operators may charge for the objectively attributable route-compilation
service. A requester can instead:

- query another broker
- query several brokers concurrently
- self-host the broker
- discover dealers directly and compile a zero-fee route

No broker payment is valid from a route response alone. The Phase 7 reference
fee claim requires the requester voucher, accepted route, both claim
observations, and independent chain confirmation.

## Public-Testnet Status

The `fx-testnet` profile packages the reference broker as a separate,
least-privileged container and exposes `/v1/fx/swaps*` through the existing
relay TLS domains. The current deployment is fixed to requester-secret V3 on
Base Sepolia and Arbitrum Sepolia. It charges no broker fee.

The sidecar has its own SSM-managed non-funded identity, read-only testnet
RPCs, journal, resource limits, health endpoint, and rollback path. It does
not add FX semantics to `src/main.mjs`, does not alter nwaku, and does not
hold inventory or execution funds. Mainnet remains disabled.

Run the independent checks with:

```bash
node --test test/fx-phase7-broker-route.test.mjs
npm test
```

Validation checkpoint, 2026-07-26:

- independent Phase 7 relay tests: 3/3 passed
- complete relay regression suite: 48/48 passed

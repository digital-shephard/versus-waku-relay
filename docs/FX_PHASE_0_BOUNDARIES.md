# Agentic FX Phase 0 Relay Boundaries

Status: frozen for protocol specification

Decision ID: `FX0-2026-07-25`

This document applies the shared Agentic FX Phase 0 research contract to the
Versus Waku relay repository. It defines future role boundaries only. The
current production relay does not provide FX routing or settlement.

The canonical client-side Phase 0 contract lives in:

`versus-cypher/docs/fx/PHASE_0_RESEARCH_CONTRACT.md`

## First Route

The first target is canonical native USDC between:

| Network | Chain ID | Token |
|---|---:|---|
| Base | `8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum One | `42161` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

Address source:

- https://developers.circle.com/stablecoins/usdc-contract-addresses

The first real-value toy range is `0.10-1.00 USDC`. Mainnet execution follows
simulation, local chains, test environments, and closed review.

## Relay Role

A relay may:

- transport versioned signed FX envelopes
- enforce structural message and size limits
- deduplicate messages
- provide bounded short-lived Store recovery
- expose transport health
- propagate dealer discovery and quote commitments
- observe public chain references for availability hints

A relay must not:

- take custody of trade principal
- sign for a requester or dealer
- set or modify dealer prices
- select the accepted route
- declare chain settlement final
- generate secrets
- construct arbitrary lock transactions
- become the mandatory Versus gateway
- earn a fee for each forwarded packet or claimed hop
- create a global dealer reputation score

## Broker Role

A broker may run beside a relay but remains a separate service boundary.

A broker:

1. collects independently signed dealer quotes
2. assembles a deterministic route proposal
3. returns the signed inputs, route policy, and explicit broker fee
4. allows the requester to recompute the route locally
5. earns only through an objectively completed accepted route

The broker needs its own:

- service identity
- configuration
- API boundary
- fee disclosure
- metrics
- abuse policy
- legal and sanctions analysis

Relay availability must not imply broker trust.

## No Per-Hop Rewards

Generic relay forwarding is not economically attributable. A node can create
fake peers and relay to itself. Therefore:

- no forwarding receipt earns money
- no peer count increases compensation
- no hop count increases compensation
- no relay vote establishes economic truth

Node operators may later earn from useful optional services:

- selected route compilation
- execution relaying
- direct x402 data APIs

Self-hosters may use transport and direct dealer discovery without a broker
fee.

## Initial FX Network Data

Phase 1 may define schemas for:

- RFQ announcements
- signed dealer quotes
- signed acceptance references
- reservations
- chain transaction references
- completion and refund evidence

The relay treats every economic field as signed opaque application data after
structural validation. Desktop clients and requester SDKs verify ownership,
quotes, adapters, and chain evidence.

## Privacy Requirements

The first RFQ protocol should:

- use ephemeral requester identities
- omit source and destination wallet addresses from broad discovery
- omit total dealer balances
- advertise maximum quote size rather than exact inventory
- use short expiries
- avoid indefinite Store retention
- progressively disclose settlement details only to selected participants

Sealed RFQs are later research. Phase 1 must leave room for encryption and
selective disclosure without claiming it is already solved.

## Abuse Requirements

Before public FX traffic, the service needs:

- per-source RFQ rate limits
- per-topic byte and message limits
- short quote and RFQ expiry
- replay nullifiers
- bounded Store retention
- quote-response limits
- duplicate and burst metrics
- explicit overload behavior
- no isolated claim that one relay saw every competing request

Economic bonds and RFQ fees belong to requester and dealer policy. The relay
does not custody them.

## Regulatory Boundary

The transport design aims to preserve the relay as a delivery,
communication, and network-access service. That posture is a legal question,
not a conclusion established by this document.

Company-operated relay and broker deployments require separate review. A
licensed partner operating company liquidity does not automatically cover
independent dealer Cyphers.

Sanctions controls must be assigned by actor. A static OFAC wallet list on
relay nodes is not treated as complete compliance, and the immutable settlement
protocol should not depend on one company-controlled blacklist.

## Phase 0 Relay Exit Checklist

- [x] Relay and broker are distinct roles.
- [x] Ordinary forwarding has no per-hop reward.
- [x] Relay authority excludes pricing, custody, route selection, and
  settlement truth.
- [x] The first route, canonical assets, and tiny limits are recorded.
- [x] Privacy and retention requirements are recorded.
- [x] Abuse controls are recorded.
- [x] Legal and sanctions boundaries are explicit open review items.

Phase 1 may define schemas and state machines. It may not add financial custody
or production FX behavior to the relay.

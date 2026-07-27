# FX Phase 8 Evidence Boundary

The relay fleet remains transport infrastructure during Agentic FX Phase 8.

It may:

- carry signed RFQs, quotes, acceptances, reservations, and settlement
  coordination envelopes
- carry signed abandonment evidence
- retain bounded Waku Store history
- apply ordinary payload-size and network abuse controls

It must not:

- declare a source or destination lock canonical
- decide that a requester or dealer is guilty
- publish a global reputation score
- reserve dealer inventory
- select a mandatory route
- inspect private secrets
- become a settlement or refund authority

Evidence observer signatures prove who made a report, not that the report is
true. Receiving clients independently verify message lineage and canonical
chain state before applying local policy. Two clients may reasonably assign
different local trust after observing different evidence or using different
bounds.

`fxTransportStatus()` exposes this boundary directly:

- `abandonmentEvidencePassThrough: true`
- `abandonmentEvidenceTopics: "sharded-store-backed"`
- `evidenceValidation: false`
- `reputationAuthority: "receiving-clients-only"`
- `requestScoring: false`

The production node startup imports only the blind transport status. Phase 8
does not add dealer keys, requester keys, settlement keys, or adjudication
credentials to the relay process.

# Agentic FX Protocol V1 In The Relay

Status: Phase 1 executable specification

The canonical protocol description is maintained in the client repository:

`versus-cypher/docs/fx/PROTOCOL_V1.md`

The relay contains an independent implementation at:

`src/fx-protocol.mjs`

No FX Waku topic, broker API, settlement watcher, or production configuration
is enabled by Phase 1.

## What The Relay Can Validate

The Phase 1 validator can:

- reject unsupported protocol versions
- reject unknown fields
- normalize exact typed payloads
- enforce sender role by message type
- compute canonical message IDs
- verify sender signatures
- enforce message lifetimes
- recompute deterministic single-dealer routes
- advance the specified settlement and local case state machines

It cannot:

- prove a transaction occurred
- determine finality
- prove a token is canonical
- prove a quote is economically wise
- resolve a default globally
- hold, claim, or refund principal

## Independent Interoperability Vector

The relay fixture at `fixtures/fx-phase1-v1.json` mirrors the client RFQ vector.
Both implementations compute:

```text
0xa79ffb683f60b819beac7a9e07adf69c7d154b9d2642f41bee651fe011cc9fac
```

Any divergence is a protocol-breaking failure.

## Future Admission Pipeline

When Phase 6 activates Waku transport, an incoming FX message should pass:

1. transport size and topic limits
2. JSON parse
3. exact schema normalization
4. message ID recomputation
5. sender signature verification
6. replay and expiry policy
7. bounded Store admission
8. delivery to requesting clients

Chain evidence remains a client, adapter, or separately configured watcher
responsibility. A relay observation never upgrades an economic claim into
truth.

## Broker Separation

The route function exists in the relay repository to prove deterministic
interoperability. It does not turn the relay into a broker.

A future broker must use a distinct:

- service identity
- API
- configuration
- fee
- metrics surface
- legal and sanctions posture

Ordinary forwarding remains unpaid.

## Privacy Boundary

Relays may see public discovery fields in the first prototype. They should not
require:

- raw swap secrets
- requester funding addresses in broad RFQs
- destination addresses in broad RFQs
- exact dealer balances
- unrelated wallet history

Short retention and progressive disclosure are required before Waku activation.

## Phase 1 Evidence

Run:

```powershell
npm test
```

The focused `fx-protocol.test.mjs` suite verifies:

- the cross-repository canonical vector
- all eleven message schemas
- protocol, deployment, trade, and type domain separation
- signature and role binding
- unknown and secret-field rejection
- accepted-fee arithmetic and requester all-in caps
- settlement and case transitions
- route recomputation
- stale and manipulated quote exclusion

The final parity run feeds all eleven client fixtures through both independent
validators and requires identical canonical bytes and message IDs.

Phase 1 is protocol work only. Infrastructure behavior remains unchanged.

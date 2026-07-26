# Agentic FX Phase 6 transport

The production Versus Waku fleet carries Agentic FX coordination as blind,
content-topic-scoped traffic. It does not parse quotes, choose routes, approve
counterparties, hold swap secrets, sign settlement actions, or decide whether a
trade completed.

Phase 6 clients use one deployment-scoped RFQ discovery topic and four
deterministic trade shards. Filter provides live delivery. The relay's existing
bounded Store retention provides restart recovery. Messages remain signed and
deployment scoped end to end; clients enforce expiry, sequence, replay,
lineage, rate, active-RFQ, and pending-dependency limits locally.

The relay therefore remains replaceable:

- missing delivery cannot redirect funds;
- Store loss cannot falsely complete a trade;
- independent nodes deliver the same signed envelope;
- chain adapters and their receipts remain settlement truth;
- ordinary Waku forwarding earns no protocol fee.

The `/health` and `/metrics` responses expose this boundary under
`fxTransport`. `payloadInspection`, `quoteSelection`, and
`settlementAuthority` must remain `false`.

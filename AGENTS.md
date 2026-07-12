# Agent guide

This repository contains public transport infrastructure, not the Versus desktop client or economic contracts.

Before implementation:

1. Preserve the rule that desktop clients are Waku light clients and require no inbound ports.
2. Keep relay availability separate from application trust. Registered-Cypher ownership, daily voice, signatures, and payment proofs must remain end-to-end verifiable.
3. Do not add a centralized Versus message authority, global social ranking, private-message inspection, or model-controlled infrastructure credentials.
4. Record deployment assumptions, retention limits, abuse controls, monitoring, and recovery behavior explicitly.
5. Treat the first relay fleet as an honest availability dependency in documentation and marketing.

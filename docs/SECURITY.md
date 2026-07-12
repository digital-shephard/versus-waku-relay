# Security boundary

## Secrets on a relay host

The only application-specific secret is the nwaku node key, which stabilizes its PeerID. Caddy also maintains private ACME material. Neither key controls a Cypher, contract, wallet, message author, ticket, reward, mission, or protocol decision.

Never place these on a relay host:

- Cypher or deployment private keys;
- RPC provider credentials unless a future reviewed feature explicitly requires them;
- model or OpenRouter credentials;
- desktop wallet archives;
- signing certificates for desktop releases;
- a database of decrypted private thoughts.

## Exposed surface

- Public: TCP 80/443 through Caddy and nwaku TCP 60000.
- Private loopback: nwaku REST and metrics.
- Disabled: REST admin, public Docker socket, public database, custom execution hooks.

Containers drop Linux capabilities and enable `no-new-privileges`. Host firewalling, security updates, Docker daemon protection, SSH hardening, and provider access controls remain operator responsibilities.

## Abuse policy

V1 uses connection, payload, request, subscription, retention, and disk bounds. It does not claim Sybil-proof relay admission. Application messages become meaningful only after each receiving Cypher verifies Base registration, current ownership, daily voice, signature, fixed-price payment proof, freshness, and local policy.

RLN or a Base-aware ingress validator remains future research. It must not become a hidden social authority or a reason to weaken end-to-end validation.

Report vulnerabilities privately to the repository security contact once one is published. Until that exists, this repository is not approved for unrestricted public deployment.

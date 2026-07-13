# Security boundary

## Secrets on a node host

The host contains a Waku node key, a non-funded rain-attestor key, an RPC provider URL, and Caddy ACME material. None controls a Cypher, contract, ticket, reward, mission, or protocol decision. The attestor key can affect visible weather, so compromise requires key rotation and removal from the client allowlist.

If the optional graduation keeper is enabled, the host also contains one funded EOA. It has no privileged contract role and can only invoke public methods, but compromise can spend that EOA's own ETH. Keep only a deliberately small gas balance, use the configured execution-fee ceiling, and never reuse a Cypher owner, deployer, Safe owner, Waku, or rain-attestor identity. Base's L1 data fee is additional; the wallet balance remains the final loss bound. Disable the keeper or replace its SSM key independently of rain attestation.

Never place these on a relay host:

- Cypher or deployment private keys;
- protocol Safe-owner keys;
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

V1 uses connection, payload, request, subscription, retention, and disk bounds. It does not claim Sybil-proof relay admission. Application postcards become meaningful only after each receiving Cypher verifies Base registration, current ownership, daily voice, signature, fixed-price payment proof, freshness, and local policy. Rain uses a separate topic and accepts only signed, deployment-scoped event windows from configured Versus nodes.

RLN for general postcard ingress remains future research. Rain verification is deliberately narrow and cannot inspect, rank, or suppress agent speech.

The graduation journal contains a signed raw public transaction, not a private key. It is stored mode `0600` and safe to replay because it pins one class and the contract rejects duplicate graduation. A malicious RPC can delay or misreport reads just as it can for rain indexing; canonical contract state remains final, and the keeper checks the configured chain ID plus Arena-derived wiring before signing.

Report vulnerabilities privately to the repository security contact once one is published. Until that exists, this repository is not approved for unrestricted public deployment.

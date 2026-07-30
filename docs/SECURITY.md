# Security boundary

## Secrets on a node host

The host contains a Waku node key, a non-funded rain-attestor key, an RPC provider URL, and Caddy ACME material. None controls a Cypher, contract, ticket, reward, mission, or protocol decision. The attestor key can affect visible weather, so compromise requires key rotation and removal from the client allowlist.

If the optional graduation keeper is enabled, the host also contains one funded EOA. It has no privileged contract role and can only invoke public methods, but compromise can spend that EOA's own ETH. Keep only a deliberately small gas balance, use the configured execution-fee ceiling, and never reuse a Cypher owner, deployer, Safe owner, Waku, or rain-attestor identity. Base's L1 data fee is additional; the wallet balance remains the final loss bound. Disable the keeper or replace its SSM key independently of rain attestation.

If the public-testnet FX sidecar is enabled, the host also contains a distinct
non-funded broker identity and Base Sepolia plus Arbitrum Sepolia read-only RPC
URLs. The key signs route proposals only. It cannot claim an HTLC, hold dealer
inventory, execute a destination transfer, spend requester funds, or charge a
fee. Keep its encrypted journal and key separate from Waku, rain, keeper,
Cypher, dealer, requester, and deployer identities.

Never place these on a relay host:

- Cypher or deployment private keys;
- protocol Safe-owner keys;
- model or OpenRouter credentials;
- desktop wallet archives;
- signing certificates for desktop releases;
- a database of decrypted private thoughts.

## Exposed surface

- Public: TCP 80/443 through Caddy, read-only cached `GET/HEAD /v1/hatch-quote`, optional bounded `POST /v1/fx/swaps` on public testnets, and nwaku TCP 60000.
- Private loopback: nwaku REST and metrics, Versus-node health, and optional FX-broker health.
- Disabled: REST admin, public Docker socket, public database, custom execution hooks.

Containers drop Linux capabilities and enable `no-new-privileges`. Host firewalling, security updates, Docker daemon protection, SSH hardening, and provider access controls remain operator responsibilities.

## Abuse policy

V1 uses connection, payload, request, subscription, retention, and disk bounds. It does not claim Sybil-proof relay admission. Application postcards become meaningful only after each receiving Cypher verifies Base registration, current ownership, daily voice, signature, fixed-price payment proof, freshness, and local policy. Rain uses a separate topic and accepts only signed, deployment-scoped event windows from configured Versus nodes.

Agentic FX uses separate deployment-scoped content topics. The relay treats
those payloads as opaque bytes. Signed RFQs and coordination messages become
meaningful only after each endpoint verifies their deployment, role, sequence,
expiry, lineage, replay nullifier, and local limits. Relays never select a
quote or attest settlement; chain adapters and receipts remain authoritative.
The HTTP sidecar applies independent per-IP and global concurrency ceilings,
limits bodies to 256 KiB at Caddy, caps active RFQs, and journals accepted
coordination messages. These are resource controls, not Sybil resistance.

RLN for general postcard ingress remains future research. Rain verification is deliberately narrow and cannot inspect, rank, or suppress agent speech.

The hatch quote is available before Cypher registration, so it has no identity gate. It is safe to expose because requests only read a bounded in-memory value and cannot trigger provider calls, signing, fee-tier probes, or writes. The quote is deployment-scoped and signed; clients reject unknown attestors, altered economics, invalid timestamps, and expired payloads. Normal HTTP connection and request limits still apply to protect host bandwidth and process availability.

The graduation journal contains a signed raw public transaction, not a private key. It is stored mode `0600` and safe to replay because it pins one class and the contract rejects duplicate graduation. A malicious RPC can delay or misreport reads just as it can for rain indexing; canonical contract state remains final, and the keeper checks the configured chain ID plus Arena-derived wiring before signing.

Report vulnerabilities privately to the repository security contact once one is published. Until that exists, this repository is not approved for unrestricted public deployment.

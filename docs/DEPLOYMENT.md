# Deployment

## Host requirements

- A small Linux VM with Docker Engine and Compose.
- At least 2 GB RAM for a WSS service node.
- Persistent disk for Waku Store, the Versus-node block cursor, and Caddy state.
- Public TCP 80, 443, and 60000.
- DNS A/AAAA record pointing the relay domain at the host.
- Host firewall denying every other inbound port.

## Two-host ceremony

1. Clone this repository independently on Host A and Host B.
2. Run `npm run configure`, `npm run identity`, and `npm run attestor` on each host. Store each transport key, attestor key, and RPC URL as secrets; publish only peer IDs and attestor addresses.
3. Set each public domain and IP. Do not copy `.env` between hosts.
4. Run `npm run identity` on each host and exchange the printed public TCP multiaddresses.
5. Set `VERSUS_WAKU_STATIC_PEER` on A to B and on B to A.
6. Run `npm run preflight` on each host.
7. Start A, then B, with `npm run up`.
8. Confirm `npm run health` locally, `npm run smoke` through public TLS, and that `GET https://<relay>/v1/hatch-quote` plus `GET https://<relay>/v1/fx/prices` return signed fresh payloads without changing provider request counters on repeated reads.
9. Put both printed WSS multiaddresses and both public rain-attestor addresses into a test desktop configuration.
10. Complete the separate-machine paid postcard, verified-rain, cached-quote failover, two-attestor FX price agreement, stale-oracle rejection, Store recovery, and relay failover acceptance tests before adding either node to a stable client release.

Graduation submission is not part of relay availability and remains disabled by default. To opt one host in, create a separate keeper with `npm run keeper`, store it as an encrypted host secret, fund only its public address with a bounded Base gas balance, set `VERSUS_GRADUATION_ENABLED=true`, and verify its canonical wiring through loopback `/metrics`. Never reuse either host's rain-attestor or any Cypher/deployment identity. Other operators can independently enable their own keeper; no allowlist or designated operator exists.

Never expose ports 8645 or 8008 publicly. Never use the deterministic keys from `deploy/local-compose.yml`. Never use `latest` image tags. Upgrades require reading every intermediate nwaku migration note and repeating the controlled tests.

## Public-testnet FX sidecar

This is testnet-only. Do not put mainnet RPCs, production funds, dealer
inventory, or a Cypher key on either relay.

For each host create four region-local `SecureString` parameters:

```text
/versus/production/relay-a/fx-broker-key
/versus/production/relay-a/fx-exact-settler-key
/versus/production/relay-a/fx-base-sepolia-rpc-url
/versus/production/relay-a/fx-avalanche-fuji-rpc-url
```

Use the corresponding `relay-b` names in its region. Broker keys must be
unique per host and distinct from the exact settler, rain, keeper, deployment,
requester, dealer, and Waku identities. The exact settler key must also be
unique per host and funded with only a small testnet gas balance. Configure
`fx.enabled = true`, freeze the repository to
the reviewed commit, run `terraform plan`, and apply only the IAM policy
changes. Existing hosts ignore changed user data by design.

After the reviewed commit is present on a host, enable through SSM:

```sh
sudo AWS_REGION=<region> \
  FX_BROKER_KEY_PARAMETER_NAME=<broker-key-parameter> \
  FX_EXACT_SETTLER_KEY_PARAMETER_NAME=<settler-key-parameter> \
  FX_BASE_SEPOLIA_RPC_PARAMETER_NAME=<base-rpc-parameter> \
  FX_AVALANCHE_FUJI_RPC_PARAMETER_NAME=<fuji-rpc-parameter> \
  /opt/versus-waku-relay/deploy/enable-fx-testnet.sh
```

The script fetches secrets directly from SSM, writes both FX keys to separate
mode-0400 files, preserves any existing broker journal, builds the vendored
runtime, starts the `fx-testnet` profile, and waits on loopback health. It
never writes the private key into `.env`.

Validate both public hosts:

```sh
curl -i -X OPTIONS https://relay-a.versuscypher.com/v1/fx/swaps
curl -i -X OPTIONS https://relay-b.versuscypher.com/v1/fx/swaps
curl -i -X OPTIONS https://relay-a.versuscypher.com/v1/fx/exact
curl -i -X OPTIONS https://relay-b.versuscypher.com/v1/fx/exact
```

After each host starts, verify its exact checkout, frozen broker package,
container health, loopback health, and public route:

```sh
sudo env \
  VERSUS_EXPECTED_REPOSITORY_REF=<full-approved-commit> \
  /opt/versus-waku-relay/deploy/verify-fx-testnet.sh
```

After both hosts pass independently, verify that the public domains expose
two distinct Waku identities and two live HTTPS FX routes:

```sh
npm run accept:fx:public
```

This probe is intentionally read-only. It never publishes an RFQ or moves
testnet funds. Economic acceptance remains a separate explicit requester and
dealer test after both sidecars pass the infrastructure gate.

Then complete tiny Base Sepolia/Avalanche Fuji requests through each host with
USDC and EURC using an independently running dealer. Verify the requester
funds its own source HTLC, the arbitrary destination recipient needs no gas,
the broker fee is zero, and all lock/claim receipts match the frozen V3
manifest.

Rollback stops only the sidecar and preserves recovery data:

```sh
sudo /opt/versus-waku-relay/deploy/disable-fx-testnet.sh
```

## Cloud independence

The friend-ready gate requires two independently reachable hosts. Prefer separate providers or at least separate failure domains. One Compose project containing two containers on one VM is useful for validation but is not service redundancy.

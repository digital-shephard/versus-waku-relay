# FX relay wallet operations

Each relay has a broker identity and a separate exact-settlement EVM identity.
The settlement identity pays source-chain transaction gas and receives the
relay's disclosed facilitator fee. It never owns dealer inventory and cannot
redirect HTLC principal.

The current deployment uses one settlement key across its managed EVM chains,
so its address is stable while each chain holds an independent gas balance.
Relay A and Relay B must never share keys. Supporting per-chain settlement keys
later requires updating the broker signer map and the wallet manifest together;
the management CLI does not pretend a key override is active before then.

## Status and gas runway

Run on the relay host:

```sh
npm run wallet:status
npm run wallet:funding-plan
npm run wallet:verify
```

Add `-- --json` for machine-readable output. The status command reads every
configured RPC, verifies its chain ID, derives the settlement address from the
mode-0400 key file, reports native gas, estimates remaining settlement calls,
and reports balances of every EIP-3009 asset in the frozen exact-factory
manifest. Key paths and secret material are excluded from JSON output.

The funding plan never moves funds. It prints the exact address and native
amount required to restore the configured target transaction runway. Operators
fund gas manually and keep only a bounded operational balance on each chain.

## Consolidating earned fees through Versus

An operator may use the network itself to move earned facilitator tokens to a
settlement address on another managed chain:

```sh
npm run wallet:sweep -- \
  --from 84532 \
  --to 421614 \
  --output 10.00 \
  --max-input 10.02
```

The command generates a requester secret locally, writes encrypted recovery
before publishing an RFQ, obtains a real dealer quote, displays exact output
and all-in input with the short-lived quote deadline, and requires the operator
to type `YES` before signing. An expired quote is rejected before payment. It
then makes a standard x402 EIP-3009 payment, waits for the confirmed destination
lock before revealing, and records public completion evidence.

The default destination is this relay's settlement address on the destination
chain. `--destination` may select another explicit corporate address. Prefer
the other independently operated Versus relay as `VERSUS_FX_SWEEP_ENDPOINT`;
routing through the same relay makes its facilitator fee circular and provides
less useful availability evidence.

Sweeps are optional and manual. The command fails before payment when no dealer
can fill the route, the quote exceeds `--max-input`, the earned token balance
is insufficient, the endpoint is not HTTPS/loopback, or recovery encryption is
not configured. A declined quote leaves only a temporary dealer reservation,
which expires normally.

Required private host configuration:

```text
VERSUS_FX_SWEEP_ENDPOINT=https://<other-relay>/v1/fx/exact
VERSUS_FX_SWEEP_RECOVERY_DIR=/var/lib/versus-fx-wallet-recovery
VERSUS_FX_SWEEP_RECOVERY_PASSWORD_FILE=/var/lib/versus-fx-secrets/sweep-password
```

The recovery password file must be mode 0400 and distinct from every wallet
key. Never place it in the repository or command history. `--yes` is intended
only for a separately reviewed automation wrapper; ordinary operation should
retain the interactive confirmation.

## Rotation and incident response

The management CLI does not rotate keys or sweep funds automatically. Rotation
changes the public facilitator
recipient and therefore requires a reviewed configuration rollout, independent
host verification, and a tiny acceptance swap. After a suspected compromise,
disable only the FX sidecar, preserve its journal, move remaining gas and earned
fees with an offline wallet, and issue a new frozen relay configuration.

#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root through SSM." >&2
  exit 1
fi

root="${VERSUS_RELAY_ROOT:-/opt/versus-waku-relay}"
expected_ref="${VERSUS_EXPECTED_REPOSITORY_REF:?set VERSUS_EXPECTED_REPOSITORY_REF}"
env_file="$root/.env"
compose_file="$root/deploy/docker-compose.yml"

if [[ ! "$expected_ref" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected repository ref must be a full commit hash." >&2
  exit 1
fi

actual_ref=$(git -C "$root" rev-parse HEAD)
if [[ "$actual_ref" != "$expected_ref" ]]; then
  echo "Relay checkout does not match the approved commit." >&2
  exit 1
fi

node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const path = require("node:path");
  const root = process.argv[1];
  const provenance = JSON.parse(
    fs.readFileSync(path.join(root, "broker", "PROVENANCE.json"), "utf8")
  );
  const manifest = fs.readFileSync(
    path.join(root, "config", "fx-v3-public-testnet.json")
  );
  const tarball = fs.readFileSync(
    path.join(root, "broker", "vendor", "versus-network-0.1.0.tgz")
  );
  const sha256 = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  if (sha256(manifest) !== provenance.manifestSha256) {
    throw new Error("frozen FX manifest hash mismatch");
  }
  if (
    sha256(tarball) !== provenance.tarballSha256 ||
    tarball.length !== provenance.tarballBytes
  ) {
    throw new Error("vendored broker package provenance mismatch");
  }
' "$root"

if [[ ! -f "$env_file" || ! -f "$compose_file" ]]; then
  echo "Versus relay deployment is incomplete." >&2
  exit 1
fi

if ! grep -q '^VERSUS_FX_ENABLED=true$' "$env_file"; then
  echo "FX sidecar is not enabled in the host environment." >&2
  exit 1
fi

docker compose \
  --profile fx-testnet \
  --env-file "$env_file" \
  --file "$compose_file" \
  ps --status running --services |
  grep -qx 'nwaku'
docker compose \
  --profile fx-testnet \
  --env-file "$env_file" \
  --file "$compose_file" \
  ps --status running --services |
  grep -qx 'versus-node'
docker compose \
  --profile fx-testnet \
  --env-file "$env_file" \
  --file "$compose_file" \
  ps --status running --services |
  grep -qx 'fx-broker'

curl --fail --silent --show-error \
  "http://127.0.0.1:${VERSUS_FX_BROKER_HEALTH_PORT:-18788}/health" |
  node -e '
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => {
      const status = JSON.parse(body);
      if (status.ok !== true || status.active !== true) {
        throw new Error("FX broker health is not active");
      }
    });
  '

public_domain=$(sed -n 's/^PUBLIC_DOMAIN=//p' "$env_file")
if [[ -z "$public_domain" ]]; then
  echo "PUBLIC_DOMAIN is missing." >&2
  exit 1
fi

status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --request OPTIONS "https://${public_domain}/v1/fx/swaps")
if [[ "$status" != "204" ]]; then
  echo "Public FX endpoint returned HTTP $status." >&2
  exit 1
fi

printf '{"healthy":true,"commit":"%s","domain":"%s","fxEndpoint":"https://%s/v1/fx/swaps"}\n' \
  "$actual_ref" "$public_domain" "$public_domain"

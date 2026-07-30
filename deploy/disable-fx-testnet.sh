#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root through SSM." >&2
  exit 1
fi

root="/opt/versus-waku-relay"
env_file="$root/.env"
compose_file="$root/deploy/docker-compose.yml"
temporary=$(mktemp "$root/.env.fx.XXXXXX")
trap 'rm -f "$temporary"' EXIT

grep -v '^VERSUS_FX_ENABLED=' "$env_file" > "$temporary"
printf '%s\n' "VERSUS_FX_ENABLED=false" >> "$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$env_file"

docker compose \
  --profile fx-testnet \
  --env-file "$env_file" \
  --file "$compose_file" \
  stop fx-broker

echo "FX broker stopped. Its key and journal remain preserved for recovery."

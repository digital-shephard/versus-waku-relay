#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root through SSM." >&2
  exit 1
fi

region="${AWS_REGION:?set AWS_REGION}"
broker_parameter="${FX_BROKER_KEY_PARAMETER_NAME:?set FX_BROKER_KEY_PARAMETER_NAME}"
settler_parameter="${FX_EXACT_SETTLER_KEY_PARAMETER_NAME:?set FX_EXACT_SETTLER_KEY_PARAMETER_NAME}"
base_parameter="${FX_BASE_SEPOLIA_RPC_PARAMETER_NAME:?set FX_BASE_SEPOLIA_RPC_PARAMETER_NAME}"
arbitrum_parameter="${FX_ARBITRUM_SEPOLIA_RPC_PARAMETER_NAME:?set FX_ARBITRUM_SEPOLIA_RPC_PARAMETER_NAME}"
root="/opt/versus-waku-relay"
env_file="$root/.env"
compose_file="$root/deploy/docker-compose.yml"
data_directory="/var/lib/versus-fx-broker"
target_deployment="0x5f6e0d22253c91a77b25e50add622e1e172c8a7f30a4b1cbfb652e8d680dbf45"
deployment_marker="$data_directory/.deployment-id"

if [[ ! -f "$env_file" || ! -f "$compose_file" ]]; then
  echo "Versus relay deployment is incomplete." >&2
  exit 1
fi

broker_key=$(aws ssm get-parameter \
  --region "$region" \
  --name "$broker_parameter" \
  --with-decryption \
  --query Parameter.Value \
  --output text)
settler_key=$(aws ssm get-parameter \
  --region "$region" \
  --name "$settler_parameter" \
  --with-decryption \
  --query Parameter.Value \
  --output text)
base_rpc_url=$(aws ssm get-parameter \
  --region "$region" \
  --name "$base_parameter" \
  --with-decryption \
  --query Parameter.Value \
  --output text)
arbitrum_rpc_url=$(aws ssm get-parameter \
  --region "$region" \
  --name "$arbitrum_parameter" \
  --with-decryption \
  --query Parameter.Value \
  --output text)

if [[ ! "$broker_key" =~ ^0x[0-9a-fA-F]{64}$ ]] ||
   [[ ! "$settler_key" =~ ^0x[0-9a-fA-F]{64}$ ]] ||
   [[ ! "$base_rpc_url" =~ ^https:// ]] ||
   [[ ! "$arbitrum_rpc_url" =~ ^https:// ]]; then
  echo "FX broker key or testnet RPC URL is invalid." >&2
  exit 1
fi

rain_key=$(sed -n 's/^VERSUS_RAIN_ATTESTOR_PRIVATE_KEY=//p' "$env_file")
keeper_key=$(sed -n 's/^VERSUS_GRADUATION_KEEPER_PRIVATE_KEY=//p' "$env_file")
if [[ "${broker_key,,}" == "${rain_key,,}" ]] ||
   [[ "${settler_key,,}" == "${rain_key,,}" ]] ||
   [[ "${settler_key,,}" == "${broker_key,,}" ]] ||
   [[ -n "$keeper_key" && "${broker_key,,}" == "${keeper_key,,}" ]] ||
   [[ -n "$keeper_key" && "${settler_key,,}" == "${keeper_key,,}" ]]; then
  echo "FX broker and exact settler identities must remain distinct." >&2
  exit 1
fi

install -d -o 1000 -g 1000 -m 0700 "$data_directory"
install -d -m 0700 /var/lib/versus-fx-secrets
install -o 1000 -g 1000 -m 0400 /dev/null /var/lib/versus-fx-secrets/broker-key
printf '%s\n' "$broker_key" > /var/lib/versus-fx-secrets/broker-key
install -o 1000 -g 1000 -m 0400 /dev/null /var/lib/versus-fx-secrets/exact-settler-key
printf '%s\n' "$settler_key" > /var/lib/versus-fx-secrets/exact-settler-key

existing_deployment=""
if [[ -f "$deployment_marker" ]]; then
  existing_deployment=$(tr -d '\r\n' < "$deployment_marker")
else
  existing_deployment=$(sed -n 's/^VERSUS_FX_DEPLOYMENT_ID=//p' "$env_file" | tail -n 1)
fi

runtime_entries=(
  phase7-broker-coordination.sqlite
  phase7-broker-coordination.sqlite-shm
  phase7-broker-coordination.sqlite-wal
  x402-swaps
  x402-exact-swaps
)
has_runtime=false
for entry in "${runtime_entries[@]}"; do
  if [[ -e "$data_directory/$entry" ]]; then
    has_runtime=true
    break
  fi
done

if [[ "$has_runtime" == "true" ]] &&
   { [[ ! -f "$deployment_marker" ]] || [[ "$existing_deployment" != "$target_deployment" ]]; }; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  label=${existing_deployment#0x}
  [[ "$label" =~ ^[0-9a-fA-F]{64}$ ]] || label="legacy-unmarked"
  archive_directory="$data_directory/archive/$stamp-$label"
  install -d -o 1000 -g 1000 -m 0700 "$archive_directory"
  for entry in "${runtime_entries[@]}"; do
    if [[ -e "$data_directory/$entry" ]]; then
      mv "$data_directory/$entry" "$archive_directory/$entry"
    fi
  done
  printf '%s\n' "${existing_deployment:-unknown}" > "$archive_directory/deployment-id.txt"
  chown -R 1000:1000 "$archive_directory"
  chmod 0600 "$archive_directory/deployment-id.txt"
fi

install -o 1000 -g 1000 -m 0600 /dev/null "$deployment_marker"
printf '%s\n' "$target_deployment" > "$deployment_marker"

temporary=$(mktemp "$root/.env.fx.XXXXXX")
trap 'rm -f "$temporary"; unset broker_key settler_key rain_key keeper_key base_rpc_url arbitrum_rpc_url' EXIT
grep -vE '^VERSUS_FX_' "$env_file" > "$temporary"
cat >> "$temporary" <<EOF
VERSUS_FX_ENABLED=true
VERSUS_FX_BROKER_IMAGE=versus-fx-broker:0.1.0
VERSUS_FX_DEPLOYMENT_ID=$target_deployment
VERSUS_FX_WAKU_PEERS=/dns4/relay-a.versuscypher.com/tcp/443/wss/p2p/16Uiu2HAmCQArrt8ND7sTzPCg76YmQPab7HKjSrVZeyeTVZdQyPWy,/dns4/relay-b.versuscypher.com/tcp/443/wss/p2p/16Uiu2HAkx96y18XpzAybpmi1zzdMQZFvsRPZfkku8R9T4KJFMr2P
VERSUS_FX_OBSERVATION_WINDOW_MS=20000
VERSUS_FX_MAX_ACTIVE_RFQS=32
VERSUS_FX_HTTP_ROUTES_PER_MINUTE_PER_IP=12
VERSUS_FX_HTTP_MAX_CONCURRENT_ROUTES=16
VERSUS_FX_HTTP_REQUESTS_PER_MINUTE_PER_IP=120
VERSUS_FX_HTTP_MAX_CONCURRENT_REQUESTS=16
VERSUS_FX_BASE_SEPOLIA_RPC_URL=$base_rpc_url
VERSUS_FX_ARBITRUM_SEPOLIA_RPC_URL=$arbitrum_rpc_url
VERSUS_FX_BROKER_DATA_DIR=/var/lib/versus-fx-broker
VERSUS_FX_BROKER_KEY_PATH=/var/lib/versus-fx-secrets/broker-key
VERSUS_FX_EXACT_SETTLER_KEY_PATH=/var/lib/versus-fx-secrets/exact-settler-key
VERSUS_FX_EXACT_FACILITATOR_FEE_ATOMIC=${FX_EXACT_FACILITATOR_FEE_ATOMIC:-1000}
VERSUS_FX_BROKER_HEALTH_PORT=18788
EOF
chmod 0600 "$temporary"
mv -f "$temporary" "$env_file"

docker compose \
  --profile fx-testnet \
  --env-file "$env_file" \
  --file "$compose_file" \
  up --detach --build --remove-orphans
docker compose \
  --profile fx-testnet \
  --env-file "$env_file" \
  --file "$compose_file" \
  restart caddy

for ((attempt = 1; attempt <= 60; attempt += 1)); do
  if curl --fail --silent --show-error \
    "http://127.0.0.1:18788/health" >/dev/null; then
    exit 0
  fi
  sleep 2
done

echo "FX broker did not become healthy." >&2
exit 1

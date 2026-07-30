#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root through SSM." >&2
  exit 1
fi

region="${AWS_REGION:?set AWS_REGION}"
broker_parameter="${FX_BROKER_KEY_PARAMETER_NAME:?set FX_BROKER_KEY_PARAMETER_NAME}"
base_parameter="${FX_BASE_SEPOLIA_RPC_PARAMETER_NAME:?set FX_BASE_SEPOLIA_RPC_PARAMETER_NAME}"
arbitrum_parameter="${FX_ARBITRUM_SEPOLIA_RPC_PARAMETER_NAME:?set FX_ARBITRUM_SEPOLIA_RPC_PARAMETER_NAME}"
root="/opt/versus-waku-relay"
env_file="$root/.env"
compose_file="$root/deploy/docker-compose.yml"

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
   [[ ! "$base_rpc_url" =~ ^https:// ]] ||
   [[ ! "$arbitrum_rpc_url" =~ ^https:// ]]; then
  echo "FX broker key or testnet RPC URL is invalid." >&2
  exit 1
fi

rain_key=$(sed -n 's/^VERSUS_RAIN_ATTESTOR_PRIVATE_KEY=//p' "$env_file")
keeper_key=$(sed -n 's/^VERSUS_GRADUATION_KEEPER_PRIVATE_KEY=//p' "$env_file")
if [[ "${broker_key,,}" == "${rain_key,,}" ]] ||
   [[ -n "$keeper_key" && "${broker_key,,}" == "${keeper_key,,}" ]]; then
  echo "FX broker identity must not reuse another relay identity." >&2
  exit 1
fi

install -d -o 1000 -g 1000 -m 0700 /var/lib/versus-fx-broker
install -d -m 0700 /var/lib/versus-fx-secrets
install -o 1000 -g 1000 -m 0400 /dev/null /var/lib/versus-fx-secrets/broker-key
printf '%s\n' "$broker_key" > /var/lib/versus-fx-secrets/broker-key

temporary=$(mktemp "$root/.env.fx.XXXXXX")
trap 'rm -f "$temporary"; unset broker_key rain_key keeper_key base_rpc_url arbitrum_rpc_url' EXIT
grep -vE '^VERSUS_FX_' "$env_file" > "$temporary"
cat >> "$temporary" <<EOF
VERSUS_FX_ENABLED=true
VERSUS_FX_BROKER_IMAGE=versus-fx-broker:0.1.0
VERSUS_FX_DEPLOYMENT_ID=0x1edf9c4dca5cbcb8b1875f4ce950844237258367d51e5d02dc3de577b3088494
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

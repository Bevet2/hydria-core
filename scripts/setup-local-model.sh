#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
CONFIG_PATH="$ROOT_DIR/models/local/config/model.json"

read_env_value() {
  local name="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep -m 1 "^${name}=" "$ENV_FILE" | cut -d '=' -f 2- || true
  fi
}

MODEL=""
OLLAMA_HOST_VALUE=""
MODELS_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --ollama-host)
      OLLAMA_HOST_VALUE="${2:-}"
      shift 2
      ;;
    --models-dir)
      MODELS_DIR="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

MODEL="${MODEL:-$(read_env_value LOCAL_MODEL_NAME)}"
MODEL="${MODEL:-qwen2.5:3b}"
OLLAMA_HOST_VALUE="${OLLAMA_HOST_VALUE:-$(read_env_value OLLAMA_PROJECT_HOST)}"
OLLAMA_HOST_VALUE="${OLLAMA_HOST_VALUE:-127.0.0.1:11435}"
MODELS_DIR="${MODELS_DIR:-$(read_env_value OLLAMA_PROJECT_MODELS_DIR)}"
MODELS_DIR="${MODELS_DIR:-$ROOT_DIR/models/local/ollama-store}"

if [[ "$OLLAMA_HOST_VALUE" == http://* || "$OLLAMA_HOST_VALUE" == https://* ]]; then
  BASE_URL="$OLLAMA_HOST_VALUE"
else
  BASE_URL="http://$OLLAMA_HOST_VALUE"
fi

command -v ollama >/dev/null 2>&1 || {
  echo "ollama is required on PATH." >&2
  exit 1
}

mkdir -p "$MODELS_DIR" "$(dirname "$CONFIG_PATH")"

if ! curl -fsS "$BASE_URL/api/tags" >/dev/null 2>&1; then
  echo "Starting dedicated Ollama endpoint on $BASE_URL"
  OLLAMA_HOST="$OLLAMA_HOST_VALUE" \
    OLLAMA_MODELS="$MODELS_DIR" \
    OLLAMA_API_KEY="ollama-local" \
    ollama serve >/tmp/hydria-ollama.log 2>&1 &

  ready="false"
  for _ in $(seq 1 30); do
    sleep 1
    if curl -fsS "$BASE_URL/api/tags" >/dev/null 2>&1; then
      ready="true"
      break
    fi
  done

  if [[ "$ready" != "true" ]]; then
    echo "Dedicated Ollama endpoint did not start on $BASE_URL. See /tmp/hydria-ollama.log." >&2
    exit 1
  fi
fi

export OLLAMA_HOST="$OLLAMA_HOST_VALUE"
export OLLAMA_MODELS="$MODELS_DIR"
export OLLAMA_API_KEY="ollama-local"

echo "Pulling $MODEL into $MODELS_DIR through $BASE_URL"
ollama pull "$MODEL"

healthcheck="$(
  curl -fsS -X POST "$BASE_URL/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"Reply with OK.\",\"stream\":false}" |
    sed -n 's/.*"response":"\([^"]*\)".*/\1/p'
)"

models_dir_for_config="$MODELS_DIR"
case "$MODELS_DIR" in
  "$ROOT_DIR"/*)
    models_dir_for_config="${MODELS_DIR#"$ROOT_DIR"/}"
    ;;
esac

cat > "$CONFIG_PATH" <<JSON
{
  "provider": "ollama",
  "runtimeModel": "$MODEL",
  "upstreamModel": "Qwen/Qwen2.5-3B-Instruct",
  "host": "$OLLAMA_HOST_VALUE",
  "baseUrl": "$BASE_URL",
  "modelsDir": "$models_dir_for_config",
  "role": "local student model",
  "lastSetupAt": "$(date -Iseconds)",
  "healthcheck": "$healthcheck"
}
JSON

echo "Local model setup completed for $MODEL at $BASE_URL"

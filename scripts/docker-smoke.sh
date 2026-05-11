#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_NAME="${HYDRIA_SMOKE_IMAGE:-hydria-core:smoke}"
CONTAINER_NAME="${HYDRIA_SMOKE_CONTAINER:-hydria-core-smoke}"
HOST_PORT="${HYDRIA_SMOKE_PORT:-18080}"
BASE_URL="http://127.0.0.1:${HOST_PORT}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup

echo "Building ${IMAGE_NAME}"
docker build -t "$IMAGE_NAME" .

echo "Starting ${CONTAINER_NAME} on ${BASE_URL}"
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${HOST_PORT}:8080" \
  -e SERVER_PORT=8080 \
  -e WEB_ORIGIN="http://localhost:${HOST_PORT}" \
  -e VITE_API_BASE_URL="http://localhost:${HOST_PORT}" \
  -e OPENROUTER_API_KEY=ci-placeholder \
  -e LOCAL_MODEL_PROVIDER=ollama \
  -e LOCAL_MODEL_NAME=ci-missing-model \
  -e LOCAL_MODEL_BASE_URL=http://127.0.0.1:65535 \
  -e LOCAL_MODEL_TIMEOUT_MS=1000 \
  -e LOCAL_MODEL_OBSERVER_ENABLED=false \
  "$IMAGE_NAME" >/dev/null

health_json=""
for _ in $(seq 1 60); do
  if health_json="$(curl -fsS "${BASE_URL}/api/health" 2>/dev/null)"; then
    break
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "Container exited before healthcheck passed." >&2
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  fi

  sleep 1
done

if [[ -z "$health_json" ]]; then
  echo "Timed out waiting for ${BASE_URL}/api/health" >&2
  docker logs "$CONTAINER_NAME" >&2 || true
  exit 1
fi

HEALTH_JSON="$health_json" node <<'NODE'
const health = JSON.parse(process.env.HEALTH_JSON ?? "{}");
const failures = [];

if (health.status !== "ok") {
  failures.push(`expected status ok, got ${health.status}`);
}
if (health.localModel?.reachable !== false) {
  failures.push("expected localModel.reachable=false when Ollama is unavailable in smoke mode");
}
const dbPath = String(health.persistence?.databaseFile ?? "");
if (!dbPath.startsWith("/app/storage/")) {
  failures.push(`expected persistence database under /app/storage, got ${dbPath || "(missing)"}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
NODE

curl -fsS "${BASE_URL}/" >/tmp/hydria-smoke-home.html
if ! grep -qi "<html" /tmp/hydria-smoke-home.html; then
  echo "Expected built web UI HTML at ${BASE_URL}/" >&2
  exit 1
fi

echo "Docker smoke passed: API health, no-Ollama degraded local model, /app/storage persistence, and web root are healthy."

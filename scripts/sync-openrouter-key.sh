#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ENV="${1:-"$ROOT_DIR/.env"}"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
WORKSPACE_PARENT="$(dirname "$ROOT_DIR")"

if [[ ! -f "$ENV_EXAMPLE" ]]; then
  echo ".env.example not found in $ROOT_DIR" >&2
  exit 1
fi

candidate_sources=()
if [[ -n "${HYDRIA_ENV_SOURCE:-}" ]]; then
  candidate_sources+=("$HYDRIA_ENV_SOURCE")
fi
candidate_sources+=(
  "$ROOT_DIR/.env"
  "$WORKSPACE_PARENT/hydria/backend/.env"
  "$WORKSPACE_PARENT/hydria/.env"
  "$WORKSPACE_PARENT/hydria-studio/backend/.env"
  "$WORKSPACE_PARENT/hydria-studio/.env"
)

source_path=""
openrouter_key="${OPENROUTER_API_KEY:-}"
if [[ -n "$openrouter_key" ]]; then
  source_path="process env OPENROUTER_API_KEY"
fi

if [[ -z "$openrouter_key" ]]; then
  for candidate in "${candidate_sources[@]}"; do
    if [[ -f "$candidate" ]]; then
      line="$(grep -m 1 '^OPENROUTER_API_KEY=' "$candidate" || true)"
      if [[ -n "$line" ]]; then
        openrouter_key="${line#OPENROUTER_API_KEY=}"
        source_path="$candidate"
        break
      fi
    fi
  done
fi

if [[ -z "$openrouter_key" ]]; then
  echo "OPENROUTER_API_KEY not found. Set OPENROUTER_API_KEY or HYDRIA_ENV_SOURCE." >&2
  exit 1
fi

template="$TARGET_ENV"
if [[ ! -f "$template" ]]; then
  template="$ENV_EXAMPLE"
fi

tmp_file="$(mktemp)"
replaced="false"
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == OPENROUTER_API_KEY=* ]]; then
    printf 'OPENROUTER_API_KEY=%s\n' "$openrouter_key" >> "$tmp_file"
    replaced="true"
  else
    printf '%s\n' "$line" >> "$tmp_file"
  fi
done < "$template"

if [[ "$replaced" == "false" ]]; then
  printf 'OPENROUTER_API_KEY=%s\n' "$openrouter_key" >> "$tmp_file"
fi

mv "$tmp_file" "$TARGET_ENV"

if (( ${#openrouter_key} >= 8 )); then
  masked="${openrouter_key:0:4}...${openrouter_key: -4}"
else
  masked="****"
fi

echo "OpenRouter key synced to $TARGET_ENV from $source_path (masked: $masked)"

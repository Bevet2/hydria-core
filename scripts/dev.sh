#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  if [[ -n "${OPENROUTER_API_KEY:-}" || -n "${HYDRIA_ENV_SOURCE:-}" ]]; then
    bash scripts/sync-openrouter-key.sh
  else
    cp .env.example .env
    echo "Created .env from .env.example. Set OPENROUTER_API_KEY for live arena runs."
  fi
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run dev

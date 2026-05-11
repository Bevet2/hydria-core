#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Delegating to the cross-platform TypeScript PostgreSQL smoke."
npm run persistence:postgres:smoke

# OVH Production Runbook

Purpose: operate the first Hydria Core cloud deployment on the OVH VPS.

## Instance

- Domain: `https://app.hydria.click`
- VPS IPv4: `51.210.46.30`
- VPS hostname: `vps-0b45a86c.vps.ovh.net`
- OS: Ubuntu 24.04 LTS
- App path: `/opt/hydria-core`
- Runtime: Docker Compose
- Reverse proxy: Caddy
- Persistence: PostgreSQL in Docker

PostgreSQL is not exposed publicly. Hydria Core is bound to `127.0.0.1:8080`, and Caddy exposes HTTPS on ports `80` and `443`.
Production must use the dedicated PostgreSQL schema `hydria_prod`; do not run production on `public`.

## DNS

OVH DNS entries:

```text
A     app     51.210.46.30
AAAA  app     2001:41d0:404:200::1ad2
```

## Health Checks

From any machine:

```bash
curl -fsS https://app.hydria.click/api/health
curl -fsS https://app.hydria.click/api/health/persistence
curl -fsS https://app.hydria.click/api/models/capabilities
```

From the VPS:

```bash
cd /opt/hydria-core
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS http://127.0.0.1:8080/api/health/persistence
sudo docker ps
sudo systemctl status caddy --no-pager
```

Expected:

- Hydria Core container is `healthy`.
- Postgres container is `healthy`.
- Persistence reports `adapter: postgres`.
- Persistence reports `postgresSchema: hydria_prod`.
- Public `:8080` must not answer from outside the VPS.

## Real Chat Smoke

```bash
curl -fsS https://app.hydria.click/api/chat/message \
  -H 'content-type: application/json' \
  -d '{"message":"Reponds en une phrase : quel est le role de Hydria Core ?"}'
```

This validates DNS, TLS, Caddy, API, PostgreSQL, and the direct student chat runtime. Chat is based on the student prompt and `StudentAnswer` schema through `StudentChatAdapter`, but it does not run the full Student Lab benchmark/research/analyze pipeline. If Ollama is unavailable or too slow on the VPS, the student chat draft should fall back to OpenRouter.

Full production smoke from any machine with this repo:

```bash
npm run prod:smoke -- --base-url=https://app.hydria.click --expected-schema=hydria_prod
```

This writes:

```text
storage/training/hydria-production-smoke-v1.json
```

The smoke is blocking on HTTPS/web/API failures, PostgreSQL not being active, production using schema `public`, schema mismatch, single-turn chat failure, broken session continuity, and `ActiveConstraintCapsule` missing a short-answer preference in a multi-turn conversation. Local Ollama being unreachable is only a warning when the cloud fallback is configured; add `--require-local-model` after Ollama is installed on the VPS.

## Deploy Current Branch

```bash
cd /opt/hydria-core
git fetch origin codex/strategic-coherence-gap-v1
git checkout codex/strategic-coherence-gap-v1
git reset --hard origin/codex/strategic-coherence-gap-v1
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml build hydria-core
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml up -d
```

Then run the health checks.

## Model Capability Manifest

Hydria exposes the planned multi-model routing catalog at:

```bash
curl -fsS https://app.hydria.click/api/models/capabilities
curl -fsS https://app.hydria.click/api/models/providers
curl -fsS https://app.hydria.click/api/models/select \
  -H 'content-type: application/json' \
  -d '{"purpose":"deep_reasoning","category":"mixed_reasoning","latencyPreference":"quality"}'
curl -fsS https://app.hydria.click/api/models/plan \
  -H 'content-type: application/json' \
  -d '{"purpose":"main_reasoning","category":"architecture_design","preferredProvider":"ollama"}'
```

The manifest registers Qwen 14B/32B, DeepSeek-Coder-V2, Qwen-Coder, DeepSeek-R1-Distill-Qwen, Mistral/Mixtral, BGE-M3, BGE Reranker, Phi mini, and Qwen 3B as candidate model roles. These entries are routing contracts first; live execution still requires configuring the actual serving backend on OVH or a GPU provider.

Live `/api/models/complete` is disabled by default. When enabled, it is protected by Hydria API keys and route-level rate limits:

```text
MODEL_ROUTER_EXECUTION_ENABLED=false
MODEL_ROUTER_ALLOW_CLOUD=false
MODEL_ROUTER_MAX_COST_TIER=medium
MODEL_ROUTER_MAX_OUTPUT_TOKENS=900
MODEL_ROUTER_VLLM_BASE_URL=
MODEL_ROUTER_OPENAI_COMPAT_BASE_URL=
MODEL_ROUTER_EMBEDDING_BASE_URL=
HYDRIA_API_KEYS=
HYDRIA_API_KEY_SHA256_HASHES=
HYDRIA_RATE_LIMIT_WINDOW_MS=60000
HYDRIA_API_RATE_LIMIT_MAX_REQUESTS=120
MODEL_ROUTER_PLAN_RATE_LIMIT_MAX_REQUESTS=60
MODEL_ROUTER_COMPLETE_RATE_LIMIT_MAX_REQUESTS=12
```

Use `HYDRIA_API_KEY_SHA256_HASHES` instead of plain keys when possible:

```bash
printf 'your-secret-key' | sha256sum
```

Authenticated model execution:

```bash
curl -fsS https://app.hydria.click/api/models/complete \
  -H 'content-type: application/json' \
  -H 'x-hydria-api-key: <secret>' \
  -d '{"purpose":"main_reasoning","category":"architecture_design","prompt":"Design a small event bus."}'
```

Request bodies can only tighten execution policy. They cannot enable model execution, cloud providers, higher cost tiers, or larger token limits beyond the server environment.

Current OVH self-hosted Ollama backend:

```text
Ollama host bind: 0.0.0.0:11435
Hydria container URL: http://host.docker.internal:11435
Firewall: 11435 allowed only from the Hydria Docker subnet
API key file: /opt/hydria-core/.hydria-api-key
```

Installed open-weight models:

```text
phi3:mini              routing fast path
qwen2.5:3b            routing fallback / small local model
qwen2.5:14b           main local reasoning brain
qwen2.5-coder:7b      code specialist
deepseek-r1:14b       deep reasoning specialist
bge-m3                embeddings / retrieval base
mistral:7b            writing / business fallback
```

Before first production cutover to the dedicated schema:

```bash
cd /opt/hydria-core
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml up -d postgres
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml run --rm hydria-core \
  npm run persistence:postgres:cutover-check -- --schema hydria_prod --reset-schema
```

Only run this destructive `--reset-schema` command before production traffic uses the schema.

## Restart

```bash
cd /opt/hydria-core
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml restart hydria-core
```

## Logs

```bash
cd /opt/hydria-core
sudo docker logs --tail=200 hydria-core-hydria-core-1
sudo journalctl -u caddy --no-pager -n 100
```

## Environment

Production secrets live on the VPS in:

```text
/opt/hydria-core/.env.docker
```

Do not commit this file. Required values:

```text
OPENROUTER_API_KEY=<secret>
POSTGRES_PASSWORD=<secret>
POSTGRES_SCHEMA=hydria_prod
HYDRIA_CORE_PORT=127.0.0.1:8080
HYDRIA_DOCKER_WEB_ORIGIN=https://app.hydria.click
HYDRIA_DOCKER_API_BASE_URL=https://app.hydria.click
HYDRIA_DOCKER_HTTP_REFERER=https://app.hydria.click
LOCAL_STUDENT_FALLBACK_MODEL=openai/gpt-5.4-mini
LOCAL_MODEL_NAME=phi3:mini
HYDRIA_DOCKER_LOCAL_MODEL_BASE_URL=http://host.docker.internal:11435
LOCAL_MODEL_TIMEOUT_MS=1000
MODEL_ROUTER_LOCAL_TIMEOUT_MS=120000
HYDRIA_DOCKER_LOCAL_MODEL_OBSERVER_ENABLED=false
```

The model router can still route heavier specialist calls to the installed Ollama models (`qwen2.5:14b`, `qwen2.5-coder:7b`, `deepseek-r1:14b`, `mistral:7b`). Keep the direct chat/local-student timeout low on the CPU VPS so the UI does not block when a local draft is too slow and has to fall back.

Then rerun the production smoke:

```bash
npm run prod:smoke -- --base-url=https://app.hydria.click --expected-schema=hydria_prod
```

## Firewall

Expected UFW rules:

```bash
sudo ufw status
```

Only these public ports should be open:

```text
OpenSSH
80/tcp
443/tcp
```

Do not expose `5432` or `8080` publicly.

## Backup

OVH automated backup is enabled. For an application-level PostgreSQL dump:

```bash
cd /opt/hydria-core
sudo docker exec hydria-core-postgres-1 pg_dump -U hydria -d hydria > hydria-postgres-$(date +%Y%m%d-%H%M%S).sql
```

## Rollback

Rollback to the previous Git commit:

```bash
cd /opt/hydria-core
git log --oneline -5
git reset --hard <previous-commit>
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml build hydria-core
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml up -d
```

Then rerun health and chat smoke.

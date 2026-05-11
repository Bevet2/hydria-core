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
- Public `:8080` must not answer from outside the VPS.

## Real Chat Smoke

```bash
curl -fsS https://app.hydria.click/api/chat/message \
  -H 'content-type: application/json' \
  -d '{"message":"Reponds en une phrase : quel est le role de Hydria Core ?"}'
```

This validates DNS, TLS, Caddy, API, PostgreSQL, and the student runtime. If Ollama is unavailable on the VPS, the student draft should fall back to OpenRouter.

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
HYDRIA_CORE_PORT=127.0.0.1:8080
HYDRIA_DOCKER_WEB_ORIGIN=https://app.hydria.click
HYDRIA_DOCKER_API_BASE_URL=https://app.hydria.click
HYDRIA_DOCKER_HTTP_REFERER=https://app.hydria.click
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

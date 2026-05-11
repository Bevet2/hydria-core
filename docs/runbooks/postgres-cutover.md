# PostgreSQL Cutover Runbook

Purpose: validate a controlled Hydria persistence move from SQLite to PostgreSQL while keeping SQLite as rollback.

## Preconditions

- SQLite source is intact: `storage/history/hydria-state-v1.sqlite`.
- PostgreSQL is reachable through `POSTGRES_URL`.
- Use a staging schema first, for example `hydria_staging`.
- Do not use `public` unless this is an intentional final cutover.

## Validation

Run the automated cutover check:

```bash
POSTGRES_URL=postgres://hydria:hydria@localhost:5432/hydria \
npm run persistence:postgres:cutover-check -- --schema hydria_staging --reset-schema
```

The check:

- verifies PostgreSQL connectivity
- refuses `public` unless `--allow-public` is present
- optionally resets the target schema with `--reset-schema`
- migrates SQLite into PostgreSQL
- compares table counts
- starts Hydria with `PERSISTENCE_ADAPTER=postgres`
- checks `GET /api/health/persistence`
- runs `runtime:release-gate -- --smoke`
- writes `storage/training/hydria-postgres-cutover-check-v1.json`

## Promotion

Only promote PostgreSQL staging when:

- cutover report has `passed: true`
- server health reports `adapter: postgres`
- arena and student session counts match the SQLite migration report
- runtime release gate smoke passes

Then set:

```text
PERSISTENCE_ADAPTER=postgres
POSTGRES_URL=<staging-or-prod-url>
POSTGRES_SCHEMA=<target-schema>
```

Restart Hydria and re-check:

```bash
curl http://localhost:8080/api/health/persistence
```

## Rollback

Rollback is environment-only while SQLite remains available:

```text
PERSISTENCE_ADAPTER=sqlite
```

Restart Hydria. Keep the PostgreSQL schema for inspection unless it was a disposable validation schema.

## Final Cutover To Public

Use `public` only when the target database is dedicated to Hydria:

```bash
POSTGRES_URL=postgres://hydria:hydria@localhost:5432/hydria \
npm run persistence:postgres:cutover-check -- --schema public --allow-public
```

Never combine `--reset-schema` with `--schema public`.

# Hydria Core

Hydria Core is a decision, evaluation, and learning engine for LLM workflows.

It is not an agent OS and it does not directly execute arbitrary system actions. The core:

- routes requests between general response, research, tools, skills, and specialized agents
- runs arena-style comparisons and a local student learning loop
- stores rounds, sessions, governance state, skills, tools, and agents in SQLite
- promotes, guards, demotes, or rejects learned behaviors under governance
- exposes observability and learning reports through the API and the web UI

Hydria OS or any external executor is responsible for real execution. Hydria Core stays the brain.

## What Exists In The Repo

The current codebase already includes:

- `arena` orchestration with respondents, red team, judge, synthesizer, refine routing, research, and local student observation
- `student lab` with preview, analyze, impact tracking, knowledge injection, and governed learning
- a `truth / research` stack with planning, acquisition, extraction, verification, replay, and temporal freshness handling
- a `tool-first` router for live, external, calculable, repo, and file-oriented tasks
- a `skill system` for reusable validated procedures
- a `tool candidate system` for detecting missing capabilities and proposing governed tool manifests
- a `specialized agent system` that groups validated skills into domain-specific agent recommendations
- a `model capability manifest` for routing Qwen, DeepSeek, Mistral/Mixtral, BGE, Phi, and Qwen-router roles
- a `learning loop` that turns observations into hotspots, hypotheses, policies, active memory, and regression monitoring
- SQLite persistence with JSON projections and self-healing derived artifacts
- a React playground for arena, benchmark, student, persistence, workflow, and learning inspection

## Core Principles

- Hydria Core is decision-first, not execution-first.
- Learning is governed, local, observable, and reversible.
- Skills, tools, and specialized agents are recommendations and contracts, not hidden side effects.
- Live or current questions must route to tools or explicit failure, not improvised answers.
- New capabilities must pass through validation, watchlists, and rollback paths.

## High-Level Architecture

```text
user request
  -> tool routing
  -> skill routing
  -> specialized agent routing
  -> research / policy / planning when needed
  -> arena or student execution flow
  -> trace + persistence
  -> learning governance
  -> active memory / guarded policies / regression monitoring
```

Repo layout:

```text
.
|- apps
|  |- server
|  |  |- src
|  |  |  |- data
|  |  |  |- prompts
|  |  |  |- routes
|  |  |  |- scripts
|  |  |  |- services
|  |  |  |  |- agents
|  |  |  |  |- arena
|  |  |  |  |- core
|  |  |  |  |- research
|  |  |  |  |- skills
|  |  |  |  |- storage
|  |  |  |  |- student
|  |  |  |  `- tools
|  |  |  |- tests
|  |  |  |- types
|  |  |  `- utils
|  |  `- package.json
|  `- web
|     |- src
|     |  |- components
|     |  |- lib
|     |  `- styles
|     `- package.json
|- docs
|  `- architecture
|- models
|- scripts
|- storage
|- start.cmd
`- README.md
```

## Main Subsystems

### Arena

The arena runs a structured round:

1. respondent A
2. respondent B
3. red team critique
4. refine routing
5. judge scoring
6. synthesizer answer
7. local student observation
8. persistence, workflow trace, memory snapshot, quality analytics

The arena also records:

- Hydria workflow status: `completed` or `partial`
- degradation reasons
- tool routing and agent routing decisions
- respondent failure causes and rescued rounds

### Student Lab

The student flow has two modes:

- `answer -> analyze`
- `run` in one shot

It stores:

- preview and final draft
- research / tool usage
- teacher, red team, and judge feedback
- rule, strategy, and tool impact
- workflow and memory snapshots

### Research / Truth Engine

The research stack is split into explicit layers:

- decision policy
- planner
- acquisition
- extractor
- verifier
- impact accounting

It supports:

- temporal queries
- replay / record evaluation
- freshness checks
- official source preference
- live / current / latest handling

### Tool Routing

Hydria now treats tools as a first-class routing layer, not only as optional fact-checking.

The router distinguishes at least:

- live data: weather, prices, sports, time
- fresh data: latest version, latest announcement, this week
- external lookup: websites, current executives, GitHub repos
- calculation / conversion
- repo / file analysis
- action / execution requests
- no-tool tasks: writing, reformulation, stable explanations

### Skill System

A skill is a reusable validated procedure. Hydria can:

- extract `SkillCandidate` objects from repeated successful execution patterns
- store governed `SkillDefinition` records in SQLite
- route to matching skills before the normal planning path
- monitor skill usage and confidence

Skills are procedural memory, not direct execution.

### Tool Candidate System

When Hydria repeatedly hits a missing capability, it can:

- detect the gap
- produce a `ToolCandidate`
- materialize a governed `ToolManifest` and `ToolContract`
- propose tests, permissions, risks, and activation policy
- ask an external OS / executor to generate or validate the tool

Hydria Core never activates high-risk tools automatically.

### Specialized Agents

Hydria can group validated skills into specialized agents.

A specialized agent:

- has a domain
- binds required and optional skills
- declares allowed and forbidden intents
- has a local memory profile
- has activation conditions, metrics, and safety constraints

The core only recommends specialized agents. It does not execute them directly.

### Model Capability Manifest

Hydria now has a declarative multi-model catalog and selection service. This is the routing contract for future execution backends; it does not replace the current v10-light runtime by itself.

Registered roles:

- Qwen 14B/32B Instruct: primary reasoning brain
- DeepSeek-Coder-V2 and Qwen-Coder: code and repo diagnostics
- DeepSeek-R1-Distill-Qwen: deep reasoning escalation
- Mistral/Mixtral: writing, business, and stakeholder synthesis
- BGE-M3 and BGE Reranker: memory retrieval and reranking
- Phi mini and Qwen 3B: fast routing and extraction

The OVH CPU backend currently runs the practical local subset through Ollama: `phi3:mini`, `qwen2.5:3b`, `qwen2.5:14b`, `qwen2.5-coder:7b`, `deepseek-r1:14b`, `bge-m3`, and `mistral:7b`. Larger targets such as Qwen 32B and Mixtral are reserved for a GPU/vLLM layer.

The API exposes:

- `GET /api/models/capabilities`
- `POST /api/models/select`
- `GET /api/models/providers`
- `POST /api/models/plan`
- `POST /api/models/complete`

Provider identifiers in the manifest are deployment targets. Configure the actual Ollama, vLLM, OpenRouter, or OpenAI-compatible serving names before enabling live execution. The completion endpoint is protected by `MODEL_ROUTER_EXECUTION_ENABLED=false` by default, plus server-side cloud/cost/token caps. When execution is enabled, `/api/models/complete` requires `X-Hydria-API-Key`, `X-API-Key`, or `Authorization: Bearer ...`; request bodies can only tighten budget policy, never loosen the server limits.

### Learning Governance

The learning loop closes the cycle:

```text
observation
-> hotspot detection
-> hypothesis / candidate generation
-> replay / validation
-> promotion / guard / rejection
-> active memory update
-> live monitoring
-> rollback or archive if regressions appear
```

Governance currently manages:

- research policies
- strategies
- rule-like learning items
- tool candidates / manifests
- specialized agents

## Persistence Model

SQLite is the default source of truth.

Runtime services go through a `PersistenceAdapter` factory. `PERSISTENCE_ADAPTER=sqlite` is the supported default, and `PERSISTENCE_ADAPTER=postgres` enables the PostgreSQL adapter when `POSTGRES_URL` is set.

The repo also keeps JSON projections and derived artifacts for compatibility and inspection, but the major stores and trackers recover from SQLite when those files are missing or corrupted.

Important persisted families include:

- arena rounds
- student sessions
- skills
- tool manifests
- specialized agents
- learning governance report
- active learning memory

Health endpoints expose persistence status and projection drift.

SQLite to PostgreSQL migration:

```bash
POSTGRES_URL=postgres://hydria:hydria@localhost:5432/hydria npm run persistence:migrate:postgres -- --dry-run
POSTGRES_URL=postgres://hydria:hydria@localhost:5432/hydria npm run persistence:migrate:postgres
```

Use `POSTGRES_SCHEMA=hydria_dev` when you want an isolated schema instead of `public`.

## Quick Start

### Prerequisites

- Node.js 24 on `PATH`
- npm on `PATH`
- Ollama on `PATH`
- an OpenRouter API key if you want live arena runs

### Install

```bash
npm install
```

### Sync the OpenRouter key

Linux / macOS:

```bash
bash scripts/sync-openrouter-key.sh
```

Windows PowerShell:

```powershell
npm run sync:openrouter
```

### Prepare the local model

Linux / macOS:

```bash
bash scripts/setup-local-model.sh
```

Windows PowerShell:

```powershell
npm run setup:local-model
```

### Start development

Fastest option:

Linux / macOS:

```bash
bash scripts/dev.sh
```

Windows:

```powershell
.\start.cmd
```

Equivalent commands:

```bash
npm run dev
```

Windows helper:

```powershell
npm run dev:ps
```

### Build

```bash
npm run build
```

### Validate

```bash
npm run check
npm run test
```

Linux helper scripts:

```bash
bash scripts/check.sh
bash scripts/test.sh
```

### Docker

Build and run the minimal cloud-ready package:

```bash
cp .env.docker.example .env.docker
docker compose up --build
```

The container serves the API and the built web UI on:

```text
http://localhost:8080
```

By default Docker connects to a host Ollama endpoint at `http://host.docker.internal:11435`.
Override it with `HYDRIA_DOCKER_LOCAL_MODEL_BASE_URL` in `.env.docker` when needed.
The base Docker package keeps `PERSISTENCE_ADAPTER=sqlite`.

Run the PostgreSQL topology with:

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build
```

The local PostgreSQL compose override uses `POSTGRES_SCHEMA=hydria_dev` by default, not `public`.

The first Docker target is still intentionally minimal: API + built web + persistent `storage` volume. Workers and model-router are planned as the next compose expansion.

Docker smoke gate:

```bash
npm run docker:smoke
```

The smoke gate builds the image, starts Hydria without Ollama, checks `GET /api/health`, verifies that the API stays healthy with `localModel.reachable=false`, confirms persistence uses `/app/storage`, and verifies the built web UI responds on `/`.

PostgreSQL persistence smoke gate:

```bash
POSTGRES_URL=postgres://hydria:hydria@localhost:5432/hydria npm run persistence:postgres:smoke
```

This runs the PostgreSQL adapter integration test, migrates SQLite data into an isolated smoke schema, compares table counts, starts Hydria with `PERSISTENCE_ADAPTER=postgres`, and checks `GET /api/health/persistence`. Override the isolated schema with `HYDRIA_POSTGRES_SMOKE_SCHEMA`; the script refuses `public` and drops the smoke schema by default. Set `HYDRIA_POSTGRES_SMOKE_KEEP_SCHEMA=true` to inspect it after the run.

PostgreSQL cutover validation:

```bash
POSTGRES_URL=postgres://hydria:hydria@localhost:5432/hydria npm run persistence:postgres:cutover-check -- --schema hydria_staging --reset-schema
```

This produces `storage/training/hydria-postgres-cutover-check-v1.json` and runs migration parity, PostgreSQL runtime health, and the runtime release gate smoke. The operational procedure is in `docs/runbooks/postgres-cutover.md`.

Production OVH deployment:

```text
https://app.hydria.click
```

The operational procedure, health checks, DNS records, Caddy reverse proxy, firewall expectations, backup command, and rollback steps are documented in `docs/runbooks/ovh-production.md`.

Production smoke gate:

```bash
npm run prod:smoke -- --base-url=https://app.hydria.click --expected-schema=hydria_prod
```

This verifies HTTPS, API health, PostgreSQL persistence on the expected schema, local-model/fallback status, single-turn chat, and multi-turn memory/capsule handling.

### Runtime Release Gate

Hydria Core now has a release gate that consolidates the runtime regression artifacts before a release or push.

Smoke verdict over the latest persisted benchmark reports plus direct tool-routing regression eval:

```bash
npm run runtime:release-gate -- --smoke
```

Full-mode verdict uses the same persisted artifacts, but records the run as a release validation:

```bash
npm run runtime:release-gate -- --full
```

The report is written to:

```text
storage/training/hydria-core-runtime-release-gate-v1.json
```

It checks the 350 single-turn artifact, hidden tool/research gate, Conversation Gate v3 hidden full60, Strategic Constraint Conflict full40, the runtime mini multi-turn gate, and direct tool-routing regression accuracy. The 350 historical wrong-language/tool/source counts are monitored as warnings unless `--strict-monitored-counts` is used; broken answers, short high-confidence answers, prompt-injection unsafe answers, failed cases, tool/research hidden regressions, and strategic conflict regressions are blocking.

### Strategic Coherence Fine Gate

The fine coherence gate targets the current multi-turn gap after context tracking: choosing a firm default under conflicting constraints while still naming the condition that would revise the choice.

```bash
npm run conversation:strategic-coherence
```

It writes:

```text
storage/training/strategic-coherence-fine-benchmark-v1.json
storage/training/strategic-coherence-fine-diagnostics-v1.json
```

## Useful Scripts

Workspace-level scripts:

- `npm run dev`
- `npm run build`
- `npm run check`
- `npm run test`
- `npm run docker:smoke`
- `npm run persistence:migrate:postgres`
- `npm run persistence:postgres:smoke`
- `npm run persistence:postgres:cutover-check`
- `npm run prod:smoke`
- `npm run learning:loop`
- `npm run student:temporal-eval`
- `npm run student:temporal-eval:record`
- `npm run student:temporal-eval:replay`
- `npm run conversation:runtime-mini`
- `npm run conversation:strategic-conflict`
- `npm run conversation:strategic-coherence`
- `npm run runtime:release-gate`
- `npm run tool:routing-eval`
- `npm run dev:sh`
- `npm run check:sh`
- `npm run test:sh`

Server-only equivalents live in `apps/server/package.json`.

## Main API Surface

### Health

- `GET /api/health`
- `GET /api/health/persistence`

### Arena

- `POST /api/arena/run`
- `GET /api/arena/quality`
- `GET /api/arena/history`

### Student

- `GET /api/student/history`
- `GET /api/student/history/:sessionId`
- `POST /api/student/answer`
- `POST /api/student/analyze`
- `POST /api/student/run`

### Benchmark

- `GET /api/benchmark/...`

### Learning

- `GET /api/learning/report`

### Local Model

- `GET /api/local-model/health`
- `POST /api/local-model/test`

### Models

- `GET /api/models/capabilities`
- `POST /api/models/select`
- `GET /api/models/providers`
- `POST /api/models/plan`
- `POST /api/models/complete`

## Example Commands

Health:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:8080/api/health
```

Arena quality:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:8080/api/arena/quality
```

Learning report:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:8080/api/learning/report
```

Student preview:

```powershell
$body = @{ question = "What is the latest stable TypeScript release?" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/student/answer -ContentType "application/json" -Body $body
```

## Web UI

The frontend exposes:

- Hydria Core Playground
- Benchmark Summary
- Tool Benchmark
- Student Lab
- workflow and memory panels
- trace panels
- persistence health
- arena quality analytics
- learning governance report

## Current Boundaries

Hydria Core does not:

- execute shell commands on behalf of learned tools
- directly browse or manipulate the local repo as an autonomous OS layer
- auto-activate dangerous tools
- bypass governance for skills, tools, or specialized agents

That separation is intentional.

## Documentation

Architecture notes live in:

- [docs/architecture/overview.md](docs/architecture/overview.md)
- [docs/architecture/hydria-core.md](docs/architecture/hydria-core.md)
- [docs/architecture/learning-loop.md](docs/architecture/learning-loop.md)

## Practical Status

Hydria Core is no longer just a simple arena prototype.

It is now a governed experimentation and learning engine with:

- explicit contracts
- routeable tools
- procedural skills
- governed tool creation proposals
- specialized agent recommendations
- live regression monitoring
- reversible learning

The next improvements should keep following the same rule:

learn locally, validate explicitly, activate carefully, and roll back when reality disagrees.

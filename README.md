# Hydria Core

Hydria Core is a decision, evaluation, and learning engine for LLM workflows.

It is not an agent OS and it does not directly execute arbitrary system actions. The core:

- routes requests between general response, research, tools, skills, and specialized agents
- runs arena-style comparisons and a local student learning loop
- stores rounds, sessions, governance state, skills, tools, and agents in SQLite
- promotes, guards, demotes, or rejects learned behaviors under governance
- exposes observability and learning reports through the API and the web UI

Hydria OS or any external executor is responsible for real execution. Hydria Core stays the brain.

## Current Status

Hydria Core is deployed on OVH at:

```text
https://app.hydria.click
```

Current production baseline:

- Docker Compose on Ubuntu OVH VPS
- Caddy HTTPS reverse proxy
- PostgreSQL persistence on schema `hydria_prod`
- public chat served by local Ollama models, not OpenRouter
- OpenRouter reserved for controlled training/evaluation
- multi-model local routing through Qwen, Qwen-Coder, DeepSeek-R1, Mistral, Phi, and BGE roles
- governed tools, source-backed answerability, model telemetry, execution audit, and knowledge scheduler
- GraphRAG v1 and DSPy-like optimization v1 added as gated contract layers

Latest validated deployment:

```text
320be62 add graph rag and policy optimization gates
```

Latest validation set:

```text
npm run check                                      OK
npm run test -w @hydria-arena/server               OK
npm run knowledge:graph-gate                       OK
npm run optimization:gate                          OK
npm run prod:smoke -- --base-url=https://app.hydria.click --expected-schema=hydria_prod  OK
```

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
- a `GraphRAG v1` contract with persistent typed graph nodes, typed edges, and hybrid graph/lexical retrieval
- a `DSPy-like optimization v1` contract with traces, policy variants, A/B gate, and zero-regression promotion rules
- dry-run execution governance contracts for browser/acquisition, sandbox commands, and dev-agent plans
- a `learning loop` that turns observations into hotspots, hypotheses, policies, active memory, and regression monitoring
- SQLite/PostgreSQL persistence with JSON projections and self-healing derived artifacts
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
|- services
|  `- bge-reranker
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

On production, Student Lab can be enabled for browser-driven VPS training without asking the user to paste an API key by setting `TRAINING_ENDPOINTS_ENABLED=true` and `STUDENT_LAB_PUBLIC_ENABLED=true`. That exception applies to `/api/student/*`; arena, benchmark, learning, and model-execution routes keep their separate guards.

It stores:

- preview and final draft
- research / tool usage
- teacher, red team, and judge feedback
- rule, strategy, and tool impact
- workflow and memory snapshots

### Chat Runtime

The web chat uses `ChatRuntimeService` plus a dedicated `StudentChatAdapter`.

This path is still based on the local student identity and `StudentAnswer` schema, but it does not run the full Student Lab preview/analyze/research pipeline. The chat runtime prepares the current message with conversation state, `ActiveConstraintCapsule`, answer policy, recent turns, resolved follow-up task, and governed tool context, then routes to a local specialist model. Runtime chat is local open-weight only; OpenRouter is reserved for controlled training/evaluation jobs and is not part of the public runtime path.

Local chat specialist routing:

- `phi3:mini`: fast routing trace
- `qwen2.5:3b`: CPU-aware standard-light route for short definitions, simple conceptual answers, French writing, and stable factual fallback
- `qwen2.5:14b`: main reasoning brain for complex standard synthesis and multi-constraint answers
- `qwen2.5-coder:7b`: code and debug specialist
- `deepseek-r1:14b`: deep reasoning / conflict arbitration
- `mistral:7b`: English writing/business, practical recipe/how-to answers, and stable biographical/history answers, with Qwen 3B as the stable factual light fallback

The public chat path is guarded by **Model Runtime Governor v1**. Each turn receives a runtime budget profile:

- `fast_tool`: verified deterministic tool answers, short timeout, small output budget
- `standard_light_chat`: CPU-aware stable definitions and simple conceptual answers on the 3B route
- `stable_fact_chat`: Mistral factual writing for stable biographies/history, with a CPU-safe `qwen2.5:3b` fallback and no 14B fallback
- `standard_chat`: primary-brain chat, capped timeout and serialized heavy-model concurrency
- `code_chat`: code/debug specialist budget
- `writing_chat`: business/writing/practical-response budget using Qwen 3B for French writing and Mistral for English or recipe/how-to turns
- `deep_reasoning`: explicit deep-reasoning escalation budget

The governor records profile, timeout, queue time, budget-exceeded status, and provider/model attempts into the chat trace and model ops telemetry.

The Chat UI exposes an **Orchestration Trace** for each answer. It shows the observable runtime path only: language/context detection, task routing, tool routing, verified facts, selected model/provider, runtime budget, attempts, quality gate, and latency. It deliberately does not expose hidden prompts or private chain-of-thought.

The UI also exposes an **Execution Audit** panel backed by `/api/execution/audit`. It is read-only and shows governed dry-run decisions for future browser/acquisition/execution actions: selected capability, permission state, risk level, denial reasons, rollback hints, provenance, and sanitized acquisition scoring. This does not enable real browser navigation, shell commands, or filesystem access.

Chat tool flow:

- `ToolRoutingService` decides whether a governed tool is required or recommended.
- `LocalToolExecutionService` executes deterministic tools for live/current facts, time/date, weather, finance, calculator/conversions, release/status lookups, and repo structure.
- For exact tool facts such as time/date, calculator, weather, finance, and current-status lookups, Hydria can answer directly from the verified tool result without a model call.
- Hydria injects only verified facts, summaries, and sources into the specialist model prompt when a model is still needed.
- If a required tool result is unavailable, the model is instructed to ask for missing input or state the verification limit instead of inventing.

Retrieval/reranking flow:

- `BGE-M3` remains the embedding/retrieval base model.
- `bge-reranker` now has a dedicated optional local runtime through `docker-compose.reranker.yml`.
- `GovernedRerankerService` reranks memory/source candidates before compact prompt injection.
- If the reranker runtime is unavailable, Hydria falls back to deterministic lexical ranking and records that the BGE runtime was not used.
- `scrapling-fetcher` is an optional source-acquisition sidecar through `docker-compose.scrapling.yml`. It gives the watcher/source pipeline a Scrapling-backed fallback when a public HTML source blocks normal fetch or parses empty, while browser-backed dynamic/stealth scraping remains disabled by default.
- Source acquisition now emits plan-only execution audit events for HTTP and Scrapling acquisition attempts. Source runs keep their `executionAuditIds`, and the audit events remain dry-run traces: selected capability, sanitized headers, scoring, provenance, and rollback policy, with no added browser/shell/filesystem execution.
- Promotion-sensitive checks should run with `--require-runtime`; fallback mode is only a safety path.

Execution governance gates:

- `npm run browser:automation-gate` validates the browser/acquisition planning contract in dry-run mode.
- `npm run execution:audit-gate` validates JSONL persistence, read-by-id lookup, sanitized headers, rollback visibility, disabled browser capabilities, and that no dry-run step can execute.

Relevant runtime knobs:

- `STUDENT_CHAT_LOCAL_MODEL_NAME`
- `STUDENT_CHAT_LOCAL_TIMEOUT_MS`
- `MODEL_RUNTIME_GOVERNOR_ENABLED`
- `MODEL_RUNTIME_FAST_TIMEOUT_MS`
- `MODEL_RUNTIME_STANDARD_TIMEOUT_MS`
- `MODEL_RUNTIME_CODE_TIMEOUT_MS`
- `MODEL_RUNTIME_DEEP_TIMEOUT_MS`
- `MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY`
- `MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY`
- `MODEL_ROUTER_RERANKER_BASE_URL`
- `npm run student:chat-prod-gate -- --base-url=https://app.hydria.click`
- `npm run prod:chat-warmup -- --base-url=https://app.hydria.click --timeout-ms=180000`
- `npm run models:pretraining-gate`
- `npm run models:routing-gate`
- `npm run prod:chat-slo-gate -- --base-url=https://app.hydria.click --timeout-ms=180000`
- `npm run prod:chat-capability-gate:segmented -- --base-url=https://app.hydria.click --segment-size=3 --delay-ms=1000 --timeout-ms=180000`
- `npm run prod:general-answerability-gate -- --base-url=https://app.hydria.click --timeout-ms=180000`
- `npm run prod:stable-factual-gate -- --base-url=https://app.hydria.click --limit=4`
- `npm run models:ops-gate`
- `npm run retrieval:reranker-gate -- --require-runtime`

### Economic Multi-Provider Router

`/api/models/plan` exposes the orchestration contract for the multi-provider runtime. It returns an economic v2 plan with selected model, provider target, fallback chain, relative cost units, criticality, and cost policy.

Example:

```bash
curl -fsS https://app.hydria.click/api/models/plan \
  -H 'content-type: application/json' \
  -d '{"purpose":"main_reasoning","category":"architecture_design","budget":{"costPolicy":"balanced","fallbackDepth":2,"maxEstimatedCostUnits":8}}'
```

Live `/api/models/complete` remains protected and disabled by default in production. Request budgets can tighten cost/cloud/token policy, but cannot loosen server limits.

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
- DeepSeek-R1-Distill-Qwen: guarded deep reasoning target for GPU/provider execution
- Mistral/Mixtral: stable factual prose and future business/writing capacity on stronger backends
- BGE-M3 and BGE Reranker: memory retrieval and reranking
- Phi mini and Qwen 3B: fast routing, extraction, and CPU-aware standard-light definitions

The OVH CPU backend currently runs the practical local subset through Ollama: `phi3:mini`, `qwen2.5:3b`, `qwen2.5:14b`, `qwen2.5-coder:7b`, `deepseek-r1:14b`, `bge-m3`, and `mistral:7b`. Public chat uses CPU-safe routing: deterministic tool answers for exact weather/finance/time/calculator/current-status facts, Qwen 3B for standard-light definitions and French writing, Mistral for English writing and stable factual turns, Qwen-Coder for code/debug, and Qwen 14B for strategic deep reasoning. `deepseek-r1:14b` stays installed but guarded for public chat until a GPU/provider backend makes it reliable enough. Larger targets such as Qwen 32B and Mixtral are reserved for a GPU/vLLM layer.

The API exposes:

- `GET /api/models/capabilities`
- `POST /api/models/select`
- `GET /api/models/providers`
- `GET /api/models/ops`
- `POST /api/models/plan`
- `POST /api/models/complete`

Provider identifiers in the manifest are deployment targets. Configure the actual Ollama, vLLM, or OpenAI-compatible serving names before enabling live execution. The completion endpoint is protected by `MODEL_ROUTER_EXECUTION_ENABLED=false` by default, plus server-side cloud/cost/token caps. Public runtime keeps `MODEL_ROUTER_ALLOW_CLOUD=false`; OpenRouter is reserved for controlled training/evaluation jobs. When execution is enabled, `/api/models/complete` requires `X-Hydria-API-Key`, `X-API-Key`, or `Authorization: Bearer ...`; request bodies can only tighten budget policy, never loosen the server limits.

Model governance validation:

```bash
npm run models:routing-gate
```

This writes `storage/training/model-routing-economics-gate-v1.json` and checks that chat/provider routing selects the expected specialist role, keeps public runtime local-first, avoids unnecessary deep-reasoning escalation on simple explanations, keeps conceptual API questions off the code specialist, and respects relative cost budgets. Run it before changing model routing, expanding watchers, or starting role-specific training.

Model runtime ops validation:

```bash
npm run models:ops-gate
```

This writes `storage/training/model-runtime-ops-gate-v1.json` from `storage/observability/model-runtime-events-v1.jsonl` and blocks runtime changes when latency, retry rate, static fallbacks, cloud runtime use, deep-reasoning escalation, or per-budget p95 latency drifts beyond the configured thresholds. Local environments without runtime traffic can use `npm run models:ops-gate -- --allow-empty`; production should run it after a smoke or chat gate has generated telemetry. The same summary is exposed through `GET /api/models/ops`.

Production chat warmup and SLO validation:

```bash
npm run prod:chat-warmup -- --base-url=https://app.hydria.click --timeout-ms=180000
npm run prod:chat-slo-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
```

The warmup hits the fast tool, standard-light, and stable factual chat paths before stricter SLO gates. The SLO report includes global p50/p95/max latency plus per-budget p95 latency for `fast_tool`, `standard_light_chat`, and `stable_fact_chat`.

Stable factual chat validation:

```bash
npm run prod:stable-factual-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
```

This writes `storage/training/stable-factual-chat-gate-v1.json` and `storage/training/stable-factual-chat-diagnostics-v1.json`. The gate checks stable biographies, history, and technical concepts with expected factual anchors plus forbidden confusion claims, so a route can fail even when the selected model and quality gate look healthy. Stable factual biographies should use Mistral first and may retry once on `qwen2.5:3b`; they must not fall through to a static fallback.

Full chat capability coverage:

```bash
npm run prod:chat-capability-gate:segmented -- --base-url=https://app.hydria.click --segment-size=3 --delay-ms=1000 --timeout-ms=180000
```

This writes `storage/training/chat-capability-coverage-gate-full-v1.json` plus one report per segment under `storage/training/chat-capability-coverage-segments-v1/`. The aggregate report is refreshed after every segment, so long CPU-VPS runs can resume without losing completed results.

General answerability validation:

```bash
npm run prod:general-answerability-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
npm run general:knowledge-reliability-gate
npm run prod:general-knowledge-reliability-gate -- --base-url=https://app.hydria.click --limit=20 --timeout-ms=180000 --delay-ms=500
npm run prod:semantic-answer-relevance-gate -- --base-url=https://app.hydria.click --case-ids=science_electric_motor_fr,history_berlin_wall_en --timeout-ms=180000 --delay-ms=500
npm run prod:semantic-answerability-phased-gate -- --base-url=https://app.hydria.click --phases=50,100 --timeout-ms=180000 --delay-ms=500
```

This writes `storage/training/general-answerability-gate-v1.json`. The gate checks that every public chat turn has an `EvidenceCapsule` and an `answerability` trace step, and that Hydria chooses the correct evidence path before generation: live tool, source-backed research, governed knowledge, conversation state, direct model knowledge, or specialist synthesis. It also includes multi-turn memory recall and false-positive routing guards for weather, file, repository, and document-like wording.

`general:knowledge-reliability-gate` writes `storage/training/general-knowledge-reliability-gate-v2.json`. It validates Answerability v2 on 100+ simple-but-critical cases: historical biographies, science/history definitions, ambiguous follow-ups, practical direct tasks, and live-tool questions. Stable factual/person/history/science questions must become source-backed; practical writing/recipes stay direct. Runtime fact-check research rejects off-subject sources, requires corroboration across at least two source families, tries Wikipedia/Wikidata/Britannica/search fallbacks, and abstains cleanly when corroboration is missing.

`prod:general-knowledge-reliability-gate` writes `storage/training/production-general-knowledge-reliability-gate-v2.json`. It runs the same reliability intent against the real public chat route. Source-backed factual cases must expose the answerability trace, use the research tool, return the expected subject, and include at least two distinct source families; practical direct cases must not be over-routed to tools. Use `--limit`/`--offset` for CPU-safe OVH batches, or omit `--limit` for a full run.

`prod:semantic-answer-relevance-gate` writes `storage/training/production-semantic-answer-relevance-gate-v1.json`. It checks the next reliability layer: source-backed answers must answer the question intent, not just mention the right source. It fails definition-instead-of-cause answers, mechanism questions answered by adjacent topics, weak subject anchoring, and source-backed answers with poor overlap against verified facts.

`prod:semantic-answerability-phased-gate` writes `storage/training/production-semantic-answerability-phased-gate-v1.json` plus one phase report per limit. The default phases are `50,100`: run 50 source-backed humiliating factual cases first, stop on failure, then broaden to 100 when clean. This keeps OVH CPU runs controlled while proving that semantic answerability generalizes beyond targeted repairs.

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

### GraphRAG V1

Hydria now has a gated GraphRAG layer above Knowledge Objects and the Markdown vault projection.

It defines persistent graph nodes for:

- concepts
- sources
- tools
- skills
- agents
- decisions

It also defines typed edges such as:

- `derived_from`
- `uses_skill`
- `supports`
- `depends_on`
- `related_to`
- `contradicts`

Retrieval is hybrid:

```text
query
-> lexical token match
-> vector-like token cosine score
-> graph path score
-> evidence paths
-> ranked graph hits
```

Validate the graph layer with:

```bash
npm run knowledge:graph-gate
```

This writes:

```text
storage/training/knowledge-graph-gate-v1.json
```

Current boundary: GraphRAG v1 is implemented as a governed retrieval contract and gate. It is not yet automatically replacing the current public chat retrieval path.

### DSPy-Like Optimization V1

Hydria now has a gated optimization layer for policies, prompts, routing, tools, retrieval, and model decisions.

The flow is:

```text
runtime / gate traces
-> failure labels
-> candidate policy variants
-> A/B evaluation
-> promotion decision
```

Promotion is intentionally strict:

- a candidate must improve at least one metric
- `regressionCount` must be `0`
- safety regressions block promotion
- human approval is still required
- no production policy is mutated automatically

Validate it with:

```bash
npm run optimization:gate
```

This writes:

```text
storage/training/policy-optimization-gate-v1.json
```

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
- an OpenRouter API key only for controlled training/evaluation jobs

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

This verifies HTTPS, API health, PostgreSQL persistence on the expected schema, guarded admin/training execution endpoints, public rate-limited local chat, and multi-turn memory/capsule handling.

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
- `npm run prod:chat-warmup`
- `npm run prod:chat-slo-gate`
- `npm run prod:stable-factual-gate`
- `npm run learning:loop`
- `npm run student:temporal-eval`
- `npm run student:temporal-eval:record`
- `npm run student:temporal-eval:replay`
- `npm run conversation:runtime-mini`
- `npm run conversation:strategic-conflict`
- `npm run conversation:strategic-coherence`
- `npm run runtime:release-gate`
- `npm run knowledge:graph-gate`
- `npm run optimization:gate`
- `npm run models:routing-gate`
- `npm run models:ops-gate`
- `npm run browser:automation-gate`
- `npm run execution:audit-gate`
- `npm run execution:sensitive-gate`
- `npm run execution:sandbox-gate`
- `npm run dev:agent-gate`
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
- `GET /api/learning/queue`
- `GET /api/learning/watchers`
- `GET /api/learning/source-acquisition`
- `GET /api/learning/knowledge-quality`
- `GET /api/learning/knowledge-scheduler`
- `GET /api/learning/promotion`
- `GET /api/learning/training-queue`

### Execution Audit

- `GET /api/execution/audit`
- `GET /api/execution/audit/:auditId`

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

Learning queue gate:

```powershell
npm run learning:queue-gate
Invoke-RestMethod -Method Get -Uri http://localhost:8080/api/learning/queue
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
- learning queue for governed runtime failure candidates

## Current Boundaries

Hydria Core does not:

- execute shell commands on behalf of learned tools
- directly browse or manipulate the local repo as an autonomous OS layer
- auto-activate dangerous tools
- bypass governance for skills, tools, or specialized agents
- auto-promote GraphRAG hits into public chat without a dedicated gate
- auto-apply DSPy-like optimization variants to production policy

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

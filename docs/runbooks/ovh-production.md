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

Admin execution routes require a Hydria API key in production. Public read dashboards such as health, benchmark summaries, arena history, learning report, and local model health are readable without a key. The public chat route does not require a key; it is protected by server-side IP rate limits. Student Lab can be opened for browser-driven VPS training without a browser API key when `TRAINING_ENDPOINTS_ENABLED=true` and `STUDENT_LAB_PUBLIC_ENABLED=true`; that exception is scoped to `/api/student/*`.

```bash
HYDRIA_API_KEY="$(ssh ubuntu@51.210.46.30 'cat /opt/hydria-core/.hydria-api-key')"
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

## Infrastructure Gate

Run this after any VPS reboot, Ollama/systemd change, Docker redeploy, or model install:

```bash
npm run prod:infra-gate -- --base-url=https://app.hydria.click --expected-schema=hydria_prod
```

This writes:

```text
storage/training/hydria-production-infra-gate-v1.json
```

The gate verifies the public API, PostgreSQL schema, local Ollama reachability, required local models, Caddy, Docker container health, and the OVH Ollama residency settings:

```text
OLLAMA_KEEP_ALIVE=30m
OLLAMA_MAX_LOADED_MODELS=2
OLLAMA_NUM_PARALLEL=1
```

These Ollama values are production-critical. `OLLAMA_MAX_LOADED_MODELS=1` forces swapping between `qwen2.5:3b` and `mistral:7b`, which makes the strict chat SLO gate fail even when answer quality is good.

## Real Chat Smoke

```bash
curl -fsS https://app.hydria.click/api/chat/message \
  -H 'content-type: application/json' \
  -d '{"message":"Reponds en une phrase : quel est le role de Hydria Core ?"}'
```

This validates DNS, TLS, Caddy, API, PostgreSQL, and the direct student chat runtime. Chat is based on the student prompt and `StudentAnswer` schema through `StudentChatAdapter`, but it does not run the full Student Lab benchmark/research/analyze pipeline. Runtime chat must be served by the local Ollama open-weight backend with local specialist routing: `qwen2.5:3b` for routing trace, concise turns, lightweight context turns, CPU-aware standard-light definitions, French writing, and fallback stable factual answers, `qwen2.5:14b` as the main reasoning brain for complex standard synthesis and practical recipe/how-to answers, `qwen2.5-coder:7b` for code/debug, `deepseek-r1:14b` for guarded deep reasoning capacity, and `mistral:7b` for English writing plus stable biographical/history answers. Public chat also runs governed tool routing before model generation: deterministic local tools can provide verified weather, finance, time/date, calculator/conversion, release/status, and repo facts. Exact verified tool facts can be returned directly; model prompts only receive verified facts/sources when verbalization or synthesis is still needed. OpenRouter is reserved for controlled training/evaluation jobs and is blocked from the public runtime path by default.

## Unified Core Ask Contract

`POST /api/core/ask` is the shared entrypoint for asking Hydria through a declared runtime mode. The browser actions that ask Hydria or start an execution now use this contract for Chat, Student Lab draft, Playground arena runs, benchmark starts, and local model tests. Legacy read/history/analyze routes remain available for compatibility and detailed inspection.

`POST /api/core/ask/stream` exposes the same contract as
`application/x-ndjson`. It emits `start`, native Ollama `delta`, and `final`
records. The `final.result` envelope is authoritative because the runtime may
normalize or repair the generated draft after token streaming.

Public modes:

```text
chat
student_preview when STUDENT_LAB_PUBLIC_ENABLED=true
```

Guarded modes:

```text
student_session
playground
benchmark
local_model when HYDRIA_PUBLIC_API_AUTH_REQUIRED=true
```

Example chat request:

```bash
curl -fsS https://app.hydria.click/api/core/ask \
  -H 'content-type: application/json' \
  -d '{"mode":"chat","question":"Donne moi une recette de tiramisu"}'
```

Example native stream request:

```bash
curl -N https://app.hydria.click/api/core/ask/stream \
  -H 'accept: application/x-ndjson' \
  -H 'content-type: application/json' \
  -d '{"mode":"chat","question":"Explique Hydria Core en une phrase"}'
```

Example Student Lab draft request:

```bash
curl -fsS https://app.hydria.click/api/core/ask \
  -H 'content-type: application/json' \
  -d '{"mode":"student_preview","question":"Explique Hydria Core en une phrase"}'
```

All responses return the same envelope: `answer`, `display`, `routing`, `artifacts`, `durationMs`, and the raw mode-specific `data` payload.

## Public API v1 For External Projects

Use `/api/v1/*` when another project needs to call Hydria as a product API. This path is separate from Playground/Arena and uses the normal local Hydria chat runtime.

It is API-key protected by default:

```bash
HYDRIA_API_KEY="$(ssh ubuntu@51.210.46.30 'cat /opt/hydria-core/.hydria-api-key')"
```

Ask Hydria:

```bash
curl -fsS https://app.hydria.click/api/v1/ask \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{"input":"Explique PostgreSQL simplement.","options":{"includeSources":true,"includeTrace":true}}'
```

Continue a conversation by reusing the returned `sessionId`:

```bash
curl -fsS https://app.hydria.click/api/v1/ask \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{"sessionId":"<sessionId>","input":"Donne un exemple concret."}'
```

Inspect API capabilities:

```bash
curl -fsS https://app.hydria.click/api/v1/capabilities \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

Response fields are stable for integration: `answer`, `sessionId`, `sources`, `tools`, `models`, `memory`, `quality`, optional `trace`, and optional `diagnostics`. The trace is runtime-only and does not expose private chain-of-thought.

## Interaction Audit Persistence

Production stores user-facing interactions in PostgreSQL and appends a JSONL audit projection at `storage/history/hydria-interactions.jsonl`.

Recorded scopes:

```text
chat_turn
student_preview
student_analysis
playground_round
benchmark_run
benchmark_prompt
local_model_test
```

Each record includes the question, answer, summary, route/provider/model, category when available, tool usage, quality issues, duration, and the raw mode-specific payload. Student Lab has two records when the full flow is used: one for the draft and one for `Analyze with teacher`. Playground arena rounds are recorded from `ArenaRunner`, so both `/api/core/ask` and direct `/api/arena/run` executions are covered. Benchmarks record the async run start plus one `benchmark_prompt` record per executed prompt.

The persistence health endpoint exposes `database.interactionRecordCount` so a production smoke can verify that interactions are being written.

## Interaction Learning Digest

Hydria does not fine-tune itself automatically from live traffic. The self-learning path is governed:

```text
interaction_records
-> hydria-interaction-learning-v1.json
-> active interaction hints
-> KnowledgeInjectionService
-> future answers as contextual guidance
```

Build or refresh the digest:

```bash
npm run learning:interactions -- --limit=1000
```

This writes `storage/learning/hydria-interaction-learning-v1.json`. It groups chat, Student Lab, Playground, and Benchmark records into guarded candidates such as `answer_pattern`, `supervised_correction`, `reasoning_example`, `tool_routing_signal`, and `repair_signal`. The runtime can use high-confidence hints, but raw answers are not blindly memorized and no model weights are changed.

## Knowledge Objects, Vault, and Watchers

The next memory layer is structured knowledge plus governed watcher candidates:

```text
interaction learning digest
-> internal/external watchers
-> Knowledge Objects
-> JSON canonical store
-> Markdown vault projection
-> KnowledgeInjectionService active hints
```

Build or refresh it:

```bash
npm run knowledge:consolidate -- --rebuild-interactions --limit=1000
```

Run the watchers before consolidation when you want Hydria to inspect its own gaps and prepare external acquisition tasks:

```bash
npm run watchers:run -- --scope=all --rebuild-interactions --limit=1000
npm run knowledge:source-acquire -- --network --max-packs=5 --max-sources-per-pack=2 --max-items-per-source=2
npm run knowledge:quality-gate
npm run knowledge:source-gate
npm run knowledge:consolidate -- --rebuild-interactions --limit=1000
npm run knowledge:promote -- --mode=dry_run --validation=none
npm run training:queue-validate
```

For production, prefer the governed scheduler instead of chaining these commands by hand:

```bash
npm run knowledge:scheduler -- --network --scope=all --limit=1000 --min-interval-minutes=360 --max-runtime-minutes=20 --max-packs=5 --max-sources-per-pack=2 --max-items-per-source=1 --timeout-ms=7000
```

This writes:

```text
storage/learning/hydria-knowledge-scheduler-v1.json
storage/learning/hydria-knowledge-scheduler-v1.lock.json
```

The scheduler is intentionally conservative:

```text
watchers
-> bounded source acquisition
-> source quality gate
-> Knowledge Object consolidation
-> promotion dry-run only
-> training queue validation only
```

It does not call local/cloud LLM generation, does not run SFT, does not apply active promotion, and uses a lock plus cooldown to avoid overlapping runs. The OVH timer runs it every 6 hours with a 30 minute randomized delay and a source budget of 10 remote fetches per run.

This writes:

```text
storage/learning/hydria-watchers-v1.json
storage/learning/hydria-source-acquisition-v1.json
storage/learning/hydria-knowledge-quality-gate-v1.json
storage/learning/hydria-knowledge-promotion-v1.json
storage/learning/hydria-training-candidate-queue-v1.json
storage/learning/hydria-training-queue-validation-v1.json
storage/learning/hydria-knowledge-scheduler-v1.json
storage/knowledge/hydria-knowledge-objects-v1.json
storage/knowledge/vault/index.md
storage/knowledge/vault/*.md
storage/training/source-acquisition-gate-v1.json
```

The JSON file is canonical. The Markdown vault is an Obsidian-like readable graph projection with frontmatter, tags, sources, and links.

Watcher v1 has two roles:

```text
internal watcher = control knowledge
external watcher = open knowledge
```

The internal watcher reads Hydria interaction learning and emits guarded repair/acquisition candidates for recurring failures, missing active knowledge, routing gaps, and quality risks. The external watcher emits governed source-pack candidates for areas where frozen open-weight models are likely stale or incomplete:

```text
cyber-vulnerability-source-pack = CISA KEV + NVD + OSV
code-runtime-source-pack = Node.js + Docker + PostgreSQL + Kubernetes
ai-model-research-source-pack = Hugging Face + Papers with Code + arXiv
stable-research-source-pack = OpenAlex + arXiv + Semantic Scholar + Crossref
wikidata-general-knowledge-source-pack = Wikidata + Wikipedia dumps + DBpedia
```

These packs are acquisition profiles. They do not bulk-import the sources, do not make the claims active, and do not train a model. `knowledge:source-acquire` fetches a limited number of sources, parses JSON/HTML into source acquisition items, assigns refresh/expiration policy, groups corroborated evidence, and writes `hydria-source-acquisition-v1.json`. `knowledge:quality-gate` then rejects generic landing pages, holds live/high-risk facts in guarded state, and marks only stable corroborated facts as promotable. After consolidation, accepted source-acquired items become non-active Knowledge Objects and are routed as `retrieval_knowledge` queue items until promotion and validation gates allow later use.

Source acquisition is explicit and bounded:

```bash
npm run knowledge:source-acquire -- --network --max-packs=5 --max-sources-per-pack=2 --max-items-per-source=2 --timeout-ms=7000
npm run knowledge:quality-gate
```

Optional Scrapling acquisition fallback:

```text
SCRAPLING_FETCHER_ENABLED=false
SCRAPLING_FETCHER_BASE_URL=http://scrapling-fetcher:8092
SCRAPLING_FETCHER_TIMEOUT_MS=10000
SCRAPLING_FETCHER_MAX_CHARS=120000
SCRAPLING_BROWSER_FETCH_ENABLED=false
```

`scrapling-fetcher` is a separate optional sidecar for source acquisition only. Hydria first uses the normal bounded HTTP fetch path; if a source blocks or returns an empty parse, it can fall back to Scrapling and tags resulting items with `scrapling-fetcher`. Browser-backed dynamic/stealth fetching stays disabled by default. Do not route public chat directly through Scrapling; source-acquired claims still pass quality gate, consolidation, promotion governance, and training queue validation before becoming usable knowledge.

Execution governance / browser contract:

```bash
npm run browser:automation-gate
npm run execution:audit-gate
curl -fsS https://app.hydria.click/api/execution/audit?limit=25
```

`/api/execution/audit` and `/api/execution/audit/:auditId` are read-only traces for governed execution plans. They expose permission decisions, risk level, dry-run plan, rollback hint, provenance, selected/recommended acquisition capability, and sanitized scoring metadata. They do not expose a POST/action endpoint and do not enable real browser navigation, shell commands, or filesystem access. Dynamic and stealth browser capabilities remain candidates only and are disabled by default.

Source acquisition writes plan-only execution audit events for each HTTP fetch attempt and each Scrapling fallback attempt. `sourceRuns[].executionAuditIds` links the knowledge acquisition report back to the execution governance trail. This is observability only: it does not add any browser runtime, command execution, or filesystem action to the acquisition pipeline.

Without `--network`, the acquisition run records skipped source checks and does not fetch remote content. The quality gate is deterministic and rejects poor/generic source items before consolidation. The offline source gate is deterministic and safe for CI:

```bash
npm run knowledge:source-gate
```

It validates the five source packs, bounded parsing, corroboration, high-risk guarding, refresh/decay policy, and retrieval selection against a fixture.

Important production rule: watchers do not fine-tune models, do not directly change runtime behavior, and do not auto-promote dynamic facts to active knowledge. They create governed candidates and acquisition tasks. A candidate must be corroborated, validated, and promoted through the Knowledge Object lifecycle before `KnowledgeInjectionService` can use it as active contextual memory.

Promotion is a separate governance step:

```text
watcher candidate
-> Knowledge Object candidate/guarded
-> promotion governance dry run
-> validation/non-regression gates
-> optional apply to validated/active
-> training candidate queue
-> external training job only if explicitly approved
```

Default promotion is non-mutating:

```bash
npm run knowledge:promote -- --mode=dry_run --validation=none
```

Apply is allowed only for lifecycle state changes already cleared by the policy. `active` promotion requires an explicit passed validation flag after benchmark gates:

```bash
npm run knowledge:promote -- --mode=apply --validation=passed
```

Without `--validation=passed`, objects can be prepared as `validated`, but they cannot become active runtime memory. Dynamic watcher knowledge and high-risk repair signals are blocked from direct activation and are written into `hydria-training-candidate-queue-v1.json` instead. That queue is a governed pre-training pack, not an SFT execution.

Training queue validation is the next gate:

```text
training candidate queue
-> target-specific validation
-> ready_for_pack | blocked | rejected
-> training authorization
```

Run it with:

```bash
npm run training:queue-validate
```

It writes `storage/learning/hydria-training-queue-validation-v1.json`. `student_sft` items can become `ready_for_pack`, but training remains blocked until at least `TRAINING_QUEUE_MIN_SFT_READY_ITEMS` entries are ready. `retrieval_knowledge` from external watchers is blocked until at least two sources are corroborated. Runtime memory requires a validated or active Knowledge Object, confidence >= 0.7, stable/non-dynamic knowledge, and repeated evidence.

Dataset expansion campaigns are bounded collection runs, not training:

```bash
npm run learning:dataset-expansion -- --duration-hours=52 --max-chat-turns=208 --max-student-previews=26
```

The campaign calls public chat and public Student Lab preview sequentially, with one request in flight, resource-pressure pauses, periodic watcher/consolidation/promotion dry-run, and training queue validation. It writes:

```text
storage/training/dataset-expansion-campaign-v1.json
storage/training/dataset-expansion-campaign-v1.jsonl
```

It does not call `student_session`, does not train a model, does not apply promotion, and does not activate runtime memory. Stop or pause thresholds are controlled by `--pause-memory-pct`, `--stop-memory-pct`, `--pause-load-ratio`, `--pause-ms`, and `--max-consecutive-pauses`.

The public read endpoint exposes the current watcher state:

```bash
curl -fsS https://app.hydria.click/api/learning/watchers
curl -fsS https://app.hydria.click/api/learning/source-acquisition
curl -fsS https://app.hydria.click/api/learning/knowledge-quality
curl -fsS https://app.hydria.click/api/learning/knowledge-scheduler
curl -fsS https://app.hydria.click/api/learning/promotion
curl -fsS https://app.hydria.click/api/learning/training-queue
curl -fsS https://app.hydria.click/api/learning/queue
```

Learning Queue v1 captures runtime failure candidates from public chat, including model fallback,
quality repair, language mismatch, tool-routing gaps, retrieval gaps, and source-grounding gaps.
It is a review queue only: it does not train, promote, or alter model weights. Validate it with:

```bash
npm run learning:queue-gate
```

This writes:

```text
storage/learning/hydria-learning-queue-gate-v1.json
```

Knowledge retrieval is injected into public chat in guarded mode only after tool routing. Verified tool context has priority; live/current tool routes skip static knowledge retrieval. Validate the runtime path with:

```bash
npm run knowledge:retrieval-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
```

This writes:

```text
storage/training/knowledge-retrieval-gate-v1.json
```

The gate checks that a source-acquired object can be retrieved and traced, that unrelated everyday chat such as a recipe does not receive off-topic knowledge, and that live tool questions keep tool priority. The Chat UI shows the public `Knowledge retrieval` trace step and the injected hit titles/summaries; this is a runtime trace, not private chain-of-thought.

## GraphRAG and policy optimization

Hydria now has a GraphRAG contract layer in addition to the existing Knowledge Objects and vault projection. This layer is still safe-by-default: it builds and queries a persistent graph, but it is not automatically promoted into public chat routing without a dedicated gate.

GraphRAG v1:

```text
Knowledge Objects / governed seeds
-> hydria-knowledge-graph-v1.json
-> nodes: concepts, sources, tools, skills, agents, decisions
-> typed edges: derived_from, uses_skill, related_to, supports, depends_on, etc.
-> hybrid retrieval: lexical token score + vector-like token cosine + graph path score
```

Validate it with:

```bash
npm run knowledge:graph-gate
```

This writes:

```text
storage/training/knowledge-graph-gate-v1.json
```

The gate checks persistence, all six required node types, typed edges, graph evidence paths, and hybrid retrieval on operational concepts, decisions, tools, skills, and watcher/acquisition links.

DSPy-like optimization v1 is also contract-only. It collects policy/routing/prompt traces, proposes bounded variants, evaluates A/B results, and blocks promotion if any metric regresses.

```text
runtime/gate traces
-> policy optimization traces
-> guarded variant proposals
-> A/B evaluation
-> promotion allowed only when regressionCount = 0
-> human approval still required
```

Validate it with:

```bash
npm run optimization:gate
```

This writes:

```text
storage/training/policy-optimization-gate-v1.json
```

This gate verifies variant generation for language, tool/evidence routing, and runtime fallback failures. It also verifies that a clean candidate can become `promotable` and that a regressed candidate is blocked. The optimization layer does not mutate production policy, activate prompts, or train models by itself.

External network checks are disabled by default. Enable only when the source-acquisition policy is ready:

```text
WATCHER_EXTERNAL_NETWORK_ENABLED=false
SOURCE_ACQUISITION_NETWORK_ENABLED=false
SOURCE_ACQUISITION_FILE=/app/storage/learning/hydria-source-acquisition-v1.json
KNOWLEDGE_QUALITY_GATE_FILE=/app/storage/learning/hydria-knowledge-quality-gate-v1.json
SOURCE_ACQUISITION_TIMEOUT_MS=7000
SOURCE_ACQUISITION_MAX_PACKS=5
SOURCE_ACQUISITION_MAX_SOURCES_PER_PACK=4
SOURCE_ACQUISITION_MAX_ITEMS_PER_SOURCE=4
KNOWLEDGE_SCHEDULER_REPORT_FILE=/app/storage/learning/hydria-knowledge-scheduler-v1.json
KNOWLEDGE_SCHEDULER_LOCK_FILE=/app/storage/learning/hydria-knowledge-scheduler-v1.lock.json
KNOWLEDGE_SCHEDULER_MIN_INTERVAL_MINUTES=360
KNOWLEDGE_SCHEDULER_MAX_RUNTIME_MINUTES=20
KNOWLEDGE_SCHEDULER_INTERACTION_LIMIT=1000
KNOWLEDGE_SCHEDULER_SOURCE_MAX_PACKS=5
KNOWLEDGE_SCHEDULER_SOURCE_MAX_SOURCES_PER_PACK=2
KNOWLEDGE_SCHEDULER_SOURCE_MAX_ITEMS_PER_SOURCE=1
KNOWLEDGE_SCHEDULER_SOURCE_TIMEOUT_MS=7000
KNOWLEDGE_PROMOTION_FILE=/app/storage/learning/hydria-knowledge-promotion-v1.json
TRAINING_CANDIDATE_QUEUE_FILE=/app/storage/learning/hydria-training-candidate-queue-v1.json
TRAINING_QUEUE_VALIDATION_FILE=/app/storage/learning/hydria-training-queue-validation-v1.json
TRAINING_QUEUE_MIN_SFT_READY_ITEMS=6
LEARNING_QUEUE_FILE=/app/storage/learning/hydria-learning-queue-v1.json
LEARNING_QUEUE_GATE_FILE=/app/storage/learning/hydria-learning-queue-gate-v1.json
```

Install or refresh the OVH systemd timer:

```bash
cd /opt/hydria-core
sudo cp ops/systemd/hydria-knowledge-scheduler.service /etc/systemd/system/
sudo cp ops/systemd/hydria-knowledge-scheduler.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hydria-knowledge-scheduler.timer
systemctl list-timers hydria-knowledge-scheduler.timer
```

Run one manual, bounded cycle:

```bash
sudo systemctl start hydria-knowledge-scheduler.service
journalctl -u hydria-knowledge-scheduler.service -n 120 --no-pager
curl -fsS https://app.hydria.click/api/learning/source-acquisition
curl -fsS https://app.hydria.click/api/learning/knowledge-quality
```

The service uses `MODEL_ROUTER_EXECUTION_ENABLED=false`, `MODEL_ROUTER_ALLOW_CLOUD=false`, and `LOCAL_MODEL_OBSERVER_ENABLED=false` inside `docker compose exec`; it is meant to protect the CPU/GPU layer by avoiding model generation entirely.

Full production smoke from any machine with this repo:

```bash
npm run prod:smoke -- --base-url=https://app.hydria.click --expected-schema=hydria_prod
```

This writes:

```text
storage/training/hydria-production-smoke-v1.json
```

The smoke is blocking on HTTPS/web/API failures, PostgreSQL not being active, production using schema `public`, schema mismatch, public training/evaluation endpoints not being guarded, missing local chat specialist routing, public single-turn chat failure, runtime chat not being served by local Ollama, broken session continuity, and `ActiveConstraintCapsule` missing a short-answer preference in a multi-turn conversation.

Student chat production gate:

```bash
npm run student:chat-prod-gate -- --base-url=https://app.hydria.click
```

This gate fails any runtime chat turn that is not served by the local Ollama student chat model.

Production chat routing gate:

```bash
npm run prod:chat-routing-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
```

This writes:

```text
storage/training/production-chat-routing-gate-v1.json
```

The routing gate covers calculator/tool bypass, concise chat, lightweight context setup, standard chat, writing, code, deep reasoning, live-tool routes, and memory turns. It records the `telemetrySince` timestamp in the report. Use that timestamp to inspect only the model events generated by this gate:

```bash
curl -fsS 'https://app.hydria.click/api/models/ops?limit=80&since=<telemetrySince>'
npm run models:ops-gate -- --since=<telemetrySince> --min-events=1
```

Chat capability coverage gate:

```bash
npm run prod:chat-capability-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
```

This writes:

```text
storage/training/chat-capability-coverage-gate-v1.json
```

The full capability gate can be slow on the CPU VPS because it intentionally covers tools, source-backed factual answers, code, writing, recipes, memory, context repair, and strategic decisions. Prefer the segmented runner for a complete report that survives local client timeouts. It writes each segment report independently and updates the aggregate report after every segment, so an interrupted run still leaves a usable partial report with `runner.complete=false`.

```bash
npm run prod:chat-capability-gate:segmented -- --base-url=https://app.hydria.click --segment-size=3 --delay-ms=1000 --timeout-ms=180000
```

This writes:

```text
storage/training/chat-capability-coverage-gate-full-v1.json
storage/training/chat-capability-coverage-segments-v1/*.json
```

The segmented runner resumes completed segment files by default. Use `--no-resume` for a clean run, `--offset`/`--limit` for a slice, and `--case-ids=case_a,case_b` for targeted reruns. Segment summaries include passed/failed counts and failed case IDs.

Last full segmented validation on 2026-05-19:

```text
18/18 cases passed
qualityFailureRate: 0
wrongLanguageRate: 0
genericFailureRate: 0
staticFallbackRate: 0
cloudRuntimeRate: 0
toolExpectedButNotUsed: 0
providers: tool 14 turns, ollama 13 turns
```

To avoid a local client timeout entirely, run the same gate inside the production container against the local app port:

```bash
cd /opt/hydria-core
sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.ovh.yml \
  -f docker-compose.reranker.yml \
  exec -T hydria-core \
  node apps/server/dist/scripts/runSegmentedChatCapabilityCoverageGate.js \
  --base-url=http://127.0.0.1:8080 \
  --segment-size=3 \
  --delay-ms=1000 \
  --timeout-ms=180000
```

General answerability gate:

```bash
npm run prod:general-answerability-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
npm run general:knowledge-reliability-gate
npm run prod:general-knowledge-reliability-gate -- --base-url=https://app.hydria.click --limit=20 --timeout-ms=180000 --delay-ms=500
```

This writes:

```text
storage/training/general-answerability-gate-v1.json
```

This gate checks the Answerability Orchestrator v1 surface: every chat turn must expose an `EvidenceCapsule`, the orchestration trace must include an `answerability` step, live/current questions must use tools or source-backed research, stable sourceable factual lookups must be source-backed, code and strategic questions must route through specialist synthesis, and direct practical answers must avoid static fallback or generic refusal. It also covers multi-turn memory recall and false-positive routing guards for weather, file, repository, and document-like wording.

`general:knowledge-reliability-gate` writes:

```text
storage/training/general-knowledge-reliability-gate-v2.json
```

This validates Answerability v2 / General Knowledge Reliability v2. Stable person, history, science, and factual definition questions must route to source-backed answerability. Practical writing and recipes must remain direct. The runtime fact-check tool rewrites aliases such as `Louis 9`, `Louis neuf`, `Saint-Louis`, and common acronyms; rejects the first source immediately when it is off-subject; requires corroboration from at least two source families; tries Wikipedia, Wikidata, Britannica, then search fallback; and returns a source-safe abstention when no reliable corroboration exists.

`prod:general-knowledge-reliability-gate` writes:

```text
storage/training/production-general-knowledge-reliability-gate-v2.json
```

This is the production end-to-end version of General Knowledge Reliability v2. It calls the real `/api/chat/message` route and fails a case when a factual/person/history/science answer is not source-backed, lacks the answerability trace, uses only one source family, misses the expected subject, falls back statically, switches language, or trips the conversation quality gate. For OVH CPU runs, use `--limit` and `--offset` to run safe batches; omit `--limit` only for the full 104-case pass.

Chat model warmup:

```bash
npm run prod:chat-warmup -- --base-url=https://app.hydria.click --timeout-ms=180000
```

This writes:

```text
storage/training/chat-model-warmup-v1.json
```

Run it immediately after deploy and before stricter latency gates. It warms the fast tool path, `qwen2.5:3b` standard-light path, and `mistral:7b` stable factual path, while checking that the route stays local and does not fall back to a static answer.

Stable factual chat gate:

```bash
npm run prod:stable-factual-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
```

This writes:

```text
storage/training/stable-factual-chat-gate-v1.json
storage/training/stable-factual-chat-diagnostics-v1.json
```

It checks biographies, history, and stable technical concepts with expected anchors and forbidden confusion claims. Use it after changing `standard_light_chat`, `stable_fact_chat`, Mistral/Qwen routing, or prompt context. Stable factual biographies should use Mistral first and may retry once on `qwen2.5:3b`; they must not fall through to a static fallback.

Chat runtime SLO gate:

```bash
npm run prod:chat-slo-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
```

This writes:

```text
storage/training/chat-runtime-slo-gate-v1.json
```

It validates public chat runtime observability and operational SLOs: orchestration trace coverage, local-only runtime, static fallback rate, cloud runtime rate, wrong language rate, quality failures, retry rate, and p95 latency. Default thresholds are production-safe for the current CPU VPS:

```text
max p95 latency: 60000 ms
max fast_tool p95 latency: 1500 ms
max standard_light_chat p95 latency: 45000 ms
max stable_fact_chat p95 latency: 60000 ms
max retry rate: 10%
max static fallback rate: 0%
max cloud runtime rate: 0%
max wrong language rate: 0%
max quality failure rate: 0%
min trace coverage: 100%
```

Use a stricter latency target while tuning:

```bash
npm run prod:chat-slo-gate -- --base-url=https://app.hydria.click --timeout-ms=180000 --max-p95-ms=45000 --max-stable-fact-p95-ms=45000
```

The report includes `summary.byBudgetProfile`, which is the first place to inspect when total p95 passes but a specific route drifts.

The Chat UI displays an **Orchestration Trace** panel. It is a runtime trace, not private chain-of-thought: it shows language/context, category, constraints, tool decision, verified facts, model/provider, budget profile, attempts, quality gate, and latency.

## Deploy Current Branch

```bash
cd /opt/hydria-core
git fetch origin codex/strategic-coherence-gap-v1
git checkout codex/strategic-coherence-gap-v1
git reset --hard origin/codex/strategic-coherence-gap-v1
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml build hydria-core
sudo docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.ovh.yml up -d
```

When the reranker runtime is enabled, deploy with the reranker override:

```bash
sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.ovh.yml \
  -f docker-compose.reranker.yml \
  build hydria-core
sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.ovh.yml \
  -f docker-compose.reranker.yml \
  up -d hydria-core bge-reranker
```

When the optional Scrapling source-acquisition fallback is enabled, include the Scrapling override too:

```bash
sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.ovh.yml \
  -f docker-compose.reranker.yml \
  -f docker-compose.scrapling.yml \
  up -d --build hydria-core bge-reranker scrapling-fetcher
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
  -d '{"purpose":"main_reasoning","category":"architecture_design","preferredProvider":"ollama","budget":{"costPolicy":"balanced","fallbackDepth":2,"maxEstimatedCostUnits":8}}'
```

The manifest registers Qwen 14B/32B, DeepSeek-Coder-V2, Qwen-Coder, DeepSeek-R1-Distill-Qwen, Mistral/Mixtral, BGE-M3, BGE Reranker, and Qwen 3B as candidate model roles. These entries are routing contracts first; live execution still requires configuring the actual serving backend on OVH or a GPU provider. On the current CPU VPS, public chat keeps DeepSeek-R1 guarded and uses Qwen 14B as the CPU-safe deep-reasoning route.

## Local BGE Reranker Runtime

`bge-reranker` is an optional local retrieval service. It is intentionally separated from Hydria Core so the heavy Python/model runtime can be started, stopped, or moved to GPU without changing the Node API container.

Start it with:

```bash
cd /opt/hydria-core
sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.ovh.yml \
  -f docker-compose.reranker.yml \
  up -d --build bge-reranker hydria-core
```

Check it from the VPS:

```bash
sudo docker compose --env-file .env.docker \
  -f docker-compose.yml \
  -f docker-compose.ovh.yml \
  -f docker-compose.reranker.yml \
  ps
sudo docker exec hydria-core-hydria-core-1 node -e "fetch('http://bge-reranker:8091/health').then(r=>r.json()).then(console.log)"
```

Required Hydria env when the reranker is enabled:

```text
MODEL_ROUTER_RERANKER_BASE_URL=http://bge-reranker:8091
MODEL_ROUTER_RERANKER_TIMEOUT_MS=30000
BGE_RERANKER_MODEL=BAAI/bge-reranker-v2-m3
BGE_RERANKER_DEVICE=cpu
```

Validation gates:

```bash
npm run models:pretraining-gate
npm run models:routing-gate
npm run prod:chat-warmup -- --base-url=https://app.hydria.click --timeout-ms=180000
npm run prod:chat-slo-gate -- --base-url=https://app.hydria.click --timeout-ms=180000
npm run prod:stable-factual-gate -- --base-url=https://app.hydria.click --limit=4
npm run models:ops-gate -- --allow-empty
npm run retrieval:reranker-gate -- --require-runtime
```

`retrieval:reranker-gate` without `--require-runtime` validates fallback precision only. Promotion of reranker-dependent retrieval requires the runtime-backed mode.
`models:routing-gate` writes `storage/training/model-routing-economics-gate-v1.json` and blocks model governance changes when a case selects the wrong specialist, violates local-only policy, over-escalates to heavy deep reasoning, or exceeds the expected relative cost budget.
`prod:chat-warmup` writes `storage/training/chat-model-warmup-v1.json` and verifies that fast tool, standard-light, and stable factual model paths are loaded and routed locally.
`prod:chat-slo-gate` writes `storage/training/chat-runtime-slo-gate-v1.json` and blocks trace loss, wrong language, static fallback, cloud runtime usage, quality failures, excessive retries, and p95 latency regression.
`prod:stable-factual-gate` writes stable factual gate and diagnostics reports, blocking anchor misses, known factual confusions, wrong language, static fallbacks, and route drift on stable chat answers.
`models:ops-gate` writes `storage/training/model-runtime-ops-gate-v1.json` from runtime telemetry. Use `--allow-empty` only before traffic exists; on production, run it after `prod:smoke` or `student:chat-prod-gate` so the gate validates real model events.

The model router returns an economic multi-provider v2 plan. The plan includes the selected model, provider target, fallback candidates, relative estimated cost units, criticality, and cost policy. Request bodies may tighten the policy with:

```json
{
  "budget": {
    "costPolicy": "minimize",
    "criticality": "normal",
    "fallbackDepth": 2,
    "maxEstimatedCostUnits": 8,
    "allowCloud": false,
    "maxCostTier": "medium"
  }
}
```

Live `/api/models/complete` is disabled by default. When enabled, it is protected by Hydria API keys and route-level rate limits:

```text
MODEL_ROUTER_EXECUTION_ENABLED=false
MODEL_ROUTER_ALLOW_CLOUD=false
MODEL_ROUTER_MAX_COST_TIER=medium
MODEL_ROUTER_MAX_OUTPUT_TOKENS=900
MODEL_ROUTER_VLLM_BASE_URL=
MODEL_ROUTER_OPENAI_COMPAT_BASE_URL=
MODEL_ROUTER_EMBEDDING_BASE_URL=
MODEL_ROUTER_RERANKER_BASE_URL=
MODEL_ROUTER_RERANKER_TIMEOUT_MS=30000
HYDRIA_API_KEYS=
HYDRIA_API_KEY_SHA256_HASHES=
HYDRIA_PUBLIC_API_AUTH_REQUIRED=true
HYDRIA_RATE_LIMIT_WINDOW_MS=60000
HYDRIA_CHAT_RATE_LIMIT_MAX_REQUESTS=30
HYDRIA_AUTH_RATE_LIMIT_MAX_REQUESTS=30
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

Request bodies can only tighten execution policy. They cannot enable model execution, cloud providers, higher cost tiers, or larger token limits beyond the server environment. If live execution is enabled and a primary provider fails, the v2 router tries the configured fallback targets that still satisfy budget and provider policy.

Current OVH self-hosted Ollama backend:

```text
Ollama host bind: 0.0.0.0:11435
Hydria container URL: http://host.docker.internal:11435
Firewall: 11435 allowed only from the Hydria Docker subnet
API key file: /opt/hydria-core/.hydria-api-key
Systemd drop-in: /etc/systemd/system/ollama.service.d/hydria.conf
OLLAMA_KEEP_ALIVE=30m
OLLAMA_MAX_LOADED_MODELS=2
OLLAMA_NUM_PARALLEL=1
```

The OVH CPU VPS should keep the two light public-chat runners resident together: `qwen2.5:3b` for standard-light/concise/French-writing turns and `mistral:7b` for English writing, recipe/how-to answers, and stable factual biographies. Keep `OLLAMA_NUM_PARALLEL=1` to avoid CPU contention, but do not drop `OLLAMA_MAX_LOADED_MODELS` back to `1`; that forces model swapping and makes the strict chat SLO gate fail. If this backend moves to a GPU host, revisit these limits.

Installed open-weight models:

```text
qwen2.5:3b            routing fast path / concise / context / standard-light definitions / French writing / stable factual fallback
qwen2.5:14b           main local reasoning brain for complex standard synthesis
qwen2.5-coder:7b      code specialist
deepseek-r1:14b       deep reasoning specialist
bge-m3                embeddings / retrieval base
mistral:7b            English writing / recipe-how-to / stable biographical answers
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
LOCAL_MODEL_NAME=qwen2.5:3b
STUDENT_CHAT_LOCAL_MODEL_NAME=mistral:7b
HYDRIA_DOCKER_LOCAL_MODEL_BASE_URL=http://host.docker.internal:11435
LOCAL_MODEL_TIMEOUT_MS=120000
STUDENT_CHAT_LOCAL_TIMEOUT_MS=45000
MODEL_ROUTER_LOCAL_TIMEOUT_MS=120000
MODEL_RUNTIME_GOVERNOR_ENABLED=true
MODEL_RUNTIME_FAST_TIMEOUT_MS=12000
MODEL_RUNTIME_STANDARD_TIMEOUT_MS=30000
MODEL_RUNTIME_CODE_TIMEOUT_MS=45000
MODEL_RUNTIME_DEEP_TIMEOUT_MS=120000
MODEL_RUNTIME_FAST_MAX_OUTPUT_TOKENS=96
MODEL_RUNTIME_STANDARD_MAX_OUTPUT_TOKENS=180
MODEL_RUNTIME_CODE_MAX_OUTPUT_TOKENS=240
MODEL_RUNTIME_DEEP_MAX_OUTPUT_TOKENS=260
MODEL_RUNTIME_FAST_MAX_CONCURRENCY=2
MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY=1
MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY=1
MODEL_ROUTER_RERANKER_BASE_URL=
MODEL_ROUTER_RERANKER_TIMEOUT_MS=30000
WATCHER_EXTERNAL_NETWORK_ENABLED=false
SOURCE_ACQUISITION_NETWORK_ENABLED=false
SOURCE_ACQUISITION_TIMEOUT_MS=7000
SOURCE_ACQUISITION_MAX_PACKS=5
SOURCE_ACQUISITION_MAX_SOURCES_PER_PACK=4
SOURCE_ACQUISITION_MAX_ITEMS_PER_SOURCE=4
KNOWLEDGE_QUALITY_GATE_FILE=/app/storage/learning/hydria-knowledge-quality-gate-v1.json
KNOWLEDGE_SCHEDULER_REPORT_FILE=/app/storage/learning/hydria-knowledge-scheduler-v1.json
KNOWLEDGE_SCHEDULER_LOCK_FILE=/app/storage/learning/hydria-knowledge-scheduler-v1.lock.json
KNOWLEDGE_SCHEDULER_MIN_INTERVAL_MINUTES=360
KNOWLEDGE_SCHEDULER_MAX_RUNTIME_MINUTES=20
KNOWLEDGE_SCHEDULER_INTERACTION_LIMIT=1000
KNOWLEDGE_SCHEDULER_SOURCE_MAX_PACKS=5
KNOWLEDGE_SCHEDULER_SOURCE_MAX_SOURCES_PER_PACK=2
KNOWLEDGE_SCHEDULER_SOURCE_MAX_ITEMS_PER_SOURCE=1
KNOWLEDGE_SCHEDULER_SOURCE_TIMEOUT_MS=7000
HYDRIA_DOCKER_LOCAL_MODEL_OBSERVER_ENABLED=false
TRAINING_ENDPOINTS_ENABLED=true
TRAINING_ENDPOINTS_REQUIRE_API_KEY=true
STUDENT_LAB_PUBLIC_ENABLED=true
HYDRIA_PUBLIC_API_AUTH_REQUIRED=true
HYDRIA_API_KEY_SHA256_HASHES=<sha256-secret>
HYDRIA_RATE_LIMIT_WINDOW_MS=60000
HYDRIA_CHAT_RATE_LIMIT_MAX_REQUESTS=30
HYDRIA_AUTH_RATE_LIMIT_MAX_REQUESTS=30
HYDRIA_API_RATE_LIMIT_MAX_REQUESTS=120
```

The model router can still route heavier specialist calls to the installed Ollama models (`qwen2.5:14b`, `qwen2.5-coder:7b`, `deepseek-r1:14b`, `mistral:7b`). Keep the Student Lab draft path on local Ollama with `LOCAL_MODEL_NAME=qwen2.5:3b` and `LOCAL_MODEL_TIMEOUT_MS=120000` for structured JSON. Model Runtime Governor v1 caps runtime chat by profile: fast verified tool answers, standard-light definitions, `stable_fact_chat` factual writing, standard chat, code, writing, and deep reasoning. Public chat uses plain final-text generation for writing, code, and deep-reasoning routes; strict JSON wrapping is kept off those CPU-heavy paths to avoid timeout cascades. Exact verified weather/finance/web/time/calculator facts are returned directly from the tool result. Writing uses Qwen 3B for French language stability, Mistral for English stakeholder/business writing, and Mistral with a light Qwen 3B retry for practical recipe/how-to turns. `stable_fact_chat` intentionally uses Mistral first with one `qwen2.5:3b` retry, without a Qwen 14B fallback. `code_chat` and public `deep_reasoning` use specialist-only attempts. DeepSeek-R1 remains installed but guarded on this CPU VPS because it is too slow/unstable for public chat; public deep reasoning uses Qwen 14B until a GPU/provider backend is available. Chat does not fall back to OpenRouter. Public chat is intentionally open but IP-rate-limited. On the OVH training box, `STUDENT_LAB_PUBLIC_ENABLED=true` lets the browser use Student Lab without pasting an API key while benchmark/arena/model-execution routes keep their own API-key guards.

Before changing the multi-model runtime, run:

```bash
npm run models:routing-gate
npm run models:ops-gate -- --allow-empty
```

Expected current baseline: all cases pass, no local-only violation, no unnecessary deep-reasoning escalation, and no failed critical case.

Then rerun the production smoke:

```bash
npm run prod:smoke -- --base-url=https://app.hydria.click --expected-schema=hydria_prod
```

After smoke traffic has created model telemetry, check runtime ops without `--allow-empty`:

```bash
npm run models:ops-gate
npm run prod:stable-factual-gate -- --base-url=https://app.hydria.click --limit=4
curl -fsS https://app.hydria.click/api/models/ops?limit=50
```

The ops gate tracks p95 latency, retry rate, local Ollama usage, static fallbacks, cloud runtime events, deep-reasoning escalation, per-budget p95 latency, budget-exceeded events, and tool/model role distribution.

## Governed execution contracts

Hydria Core now exposes the governance layer for future Hydria OS execution, but it still does not execute shell, browser, filesystem writes, or autonomous dev-agent loops directly.

Current contracts:

- `ExecutionGovernanceService`: permission, risk, rollback, dry-run plan, and audit event.
- `SandboxCommandPolicyService`: OpenInterpreter-like command contract with whitelist, dry-run requirement, cwd scope, timeout cap, structured logs, and destructive-command blocking.
- `DevAgentPlanningService`: OpenDevin-like dev-agent contract for repo read, patch plan, apply-patch handoff, test-command handoff, fix-loop handoff, and final report.

Safety baseline:

- real command execution: disabled
- filesystem writes: disabled
- patch application: Hydria OS handoff only
- test execution: Hydria OS sandbox handoff only
- fix loop: planned only, no autonomous mutation
- all sensitive plans emit execution audit events

Validation:

```bash
npm run execution:sandbox-gate
npm run dev:agent-gate
npm run execution:sensitive-gate
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

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

SQLite is the source of truth.

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

## Quick Start

### Prerequisites

- Windows
- Node.js on `PATH`
- `npm.cmd`
- Ollama on `PATH`
- an OpenRouter API key if you want live arena runs

### Install

```powershell
npm.cmd install
```

### Sync the OpenRouter key

```powershell
npm.cmd run sync:openrouter
```

### Prepare the local model

```powershell
npm.cmd run setup:local-model
```

### Start development

Fastest option:

```powershell
.\start.cmd
```

Equivalent commands:

```powershell
npm.cmd run dev
```

or

```powershell
npm.cmd run dev:ps
```

### Build

```powershell
npm.cmd run build
```

### Validate

```powershell
npm.cmd run check
npm.cmd run test
```

## Useful Scripts

Workspace-level scripts:

- `npm.cmd run dev`
- `npm.cmd run build`
- `npm.cmd run check`
- `npm.cmd run test`
- `npm.cmd run learning:loop`
- `npm.cmd run student:temporal-eval`
- `npm.cmd run student:temporal-eval:record`
- `npm.cmd run student:temporal-eval:replay`
- `npm.cmd run tool:routing-eval`

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

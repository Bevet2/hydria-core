# Hydria Arena

Hydria Arena is a pragmatic V1 arena that combines:

- a multi-LLM round over OpenRouter
- a dedicated local student model with its weights on `F:\`
- local JSON storage for rounds and feedback
- a codebase that is small enough to run now and modular enough to extend later

The goal is not to simulate a full agent operating system. This V1 focuses on one clean loop:

1. Respondent A answers.
2. Respondent B answers.
3. Red Team attacks both.
4. Judge scores both.
5. Synthesizer produces the final answer.
6. The local student model observes the round and emits learning notes.

## Official baseline

Hydria Core now has an official frozen baseline for all future comparisons:

- label: `Hydria Core Official Baseline`
- run id: `5626878c-70e3-4848-9409-1e8870581852`
- benchmark snapshot: [storage/benchmarks/official-baseline.json](/F:/hydria-arena/storage/benchmarks/official-baseline.json)
- default baseline models:
  - `respondentA = openai/gpt-5.4-mini`
  - `respondentB = openai/gpt-5.4-mini`
  - `redTeam = openai/gpt-5.4-mini`
  - `judge = openai/gpt-5.4-mini`
  - `synthesizer = openai/gpt-5.4-mini`

This mono-model baseline is the official reference because it is currently more stable, faster, and stronger than the multi-model setup. Multi-model experiments are paused until tool integration is in place.

## Why this local model

Hydria Arena V1 uses:

- runtime model: `qwen2.5:3b` through Ollama
- upstream open-weight base for future training work: `Qwen/Qwen2.5-3B-Instruct`

Why this choice:

- small enough for a realistic local setup
- strong enough for observation, light synthesis, and JSON-shaped outputs
- multilingual, including French
- easy to serve locally with a simple HTTP endpoint
- reasonable future candidate for LoRA / SFT using the upstream Hugging Face weights

Runtime choice details:

- local serving is done through a dedicated Ollama endpoint on `http://127.0.0.1:11435`
- weights are stored in `F:\hydria-arena\models\local\ollama-store`
- future fine-tuning should target the upstream model weights, not the Ollama runtime package

Reference links:

- Qwen2.5-3B-Instruct: https://huggingface.co/Qwen/Qwen2.5-3B-Instruct
- Ollama: https://ollama.com/
- Ollama API usage: https://docs.ollama.com/api/usage

## Architecture

```text
F:\hydria-arena
├─ apps
│  ├─ server
│  │  ├─ src
│  │  │  ├─ index.ts
│  │  │  ├─ prompts
│  │  │  ├─ routes
│  │  │  ├─ services
│  │  │  ├─ storage
│  │  │  ├─ types
│  │  │  └─ utils
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  └─ web
│     ├─ src
│     │  ├─ components
│     │  ├─ lib
│     │  └─ styles
│     ├─ package.json
│     └─ vite.config.ts
├─ models
│  └─ local
│     ├─ config
│     ├─ ollama-store
│     └─ README.md
├─ scripts
│  ├─ dev.ps1
│  ├─ setup-local-model.ps1
│  └─ sync-openrouter-key.ps1
├─ storage
│  └─ history
│     └─ history.json
├─ .env.example
├─ package.json
├─ tsconfig.base.json
└─ README.md
```

## Project roles

### Backend

- Express + TypeScript
- OpenRouter client service
- local Ollama client service
- arena runner orchestration
- Zod validation on requests and structured outputs
- JSON repair fallback when a model drifts outside strict JSON
- local history store in JSON

### Frontend

- React + Vite + TypeScript
- one main screen
- model selectors
- round detail view
- local model panel
- history panel

### Storage

- `F:\hydria-arena\storage\history\history.json`
- `F:\hydria-arena\storage\datasets\student-rounds.jsonl`

The JSONL dataset is append-only and stores normalized round packages for future student training work. No training is launched in the current codebase.

## Arena flow

### Step 1

Respondent A and Respondent B receive the same question and return strict JSON.

### Step 2

Red Team receives the question and both responses, then attacks weak points and selects a leader.

### Step 3

Judge scores A and B across clarity, relevance, robustness, hallucination risk, and overall quality.

### Step 4

Synthesizer builds the final answer from the best answer plus the valid critiques.

### Step 5

The local student model receives the round package and returns:

- a simpler student answer
- a compact summary
- learning notes for future imitation or supervised training

## OpenRouter configuration

This project is designed to reuse the existing OpenRouter key already present on `F:\`.

The included script:

- reads the current Hydria config
- extracts `OPENROUTER_API_KEY`
- writes a local `.env` for this project
- never prints the full key in the terminal

Default source searched first:

- `F:\hydria\backend\.env`

## Installation

### Prerequisites

- Windows with Node.js available on PATH
- `npm.cmd`
- Ollama installed and available on PATH

### 1. Create the local `.env`

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-openrouter-key.ps1
```

### 2. Install JavaScript dependencies

```powershell
npm.cmd install
```

### 3. Start the dedicated local model endpoint and pull the model

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-model.ps1
```

This creates or updates:

- `F:\hydria-arena\models\local\ollama-store`
- `F:\hydria-arena\models\local\config\model.json`

### 4. Start the app in development

```powershell
npm.cmd run dev
```

Or through the helper script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

## Environment variables

Main variables in `.env`:

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `ARENA_RESPONDENT_A_MODEL`
- `ARENA_RESPONDENT_B_MODEL`
- `ARENA_REDTEAM_MODEL`
- `ARENA_JUDGE_MODEL`
- `ARENA_SYNTHESIZER_MODEL`
- `LOCAL_MODEL_NAME`
- `LOCAL_MODEL_BASE_URL`
- `HISTORY_FILE`
- `ROUND_DATASET_FILE`

The default arena models are now aligned with the official mono-model baseline. If you want to test a non-baseline setup later, pass explicit models in the request instead of changing the frozen default reference.

## API

### `POST /api/arena/run`

Body:

```json
{
  "question": "What is the safest way to migrate a monolith to services?",
  "models": {
    "respondentA": "openai/gpt-5.4-mini",
    "respondentB": "openai/gpt-5.4-mini",
    "redTeam": "openai/gpt-5.4-mini",
    "judge": "openai/gpt-5.4-mini",
    "synthesizer": "openai/gpt-5.4-mini"
  }
}
```

### `GET /api/arena/history`

Returns the stored local history.

### `GET /api/local-model/health`

Returns whether the dedicated local Ollama endpoint is reachable and whether the selected model is installed.

### `POST /api/local-model/test`

Body:

```json
{
  "prompt": "Explain Hydria Arena in one sentence."
}
```

## Example API commands

Health:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:8080/api/health
```

Local model:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:8080/api/local-model/health
```

Arena run:

```powershell
$body = @{
  question = "Give me a pragmatic launch plan for a Node.js SaaS."
  models = @{
    respondentA = "openai/gpt-5.4-mini"
    respondentB = "openai/gpt-5.4-mini"
    redTeam = "openai/gpt-5.4-mini"
    judge = "openai/gpt-5.4-mini"
    synthesizer = "openai/gpt-5.4-mini"
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/arena/run -ContentType "application/json" -Body $body
```

## Frontend

The web UI exposes:

- a question form
- editable model selectors with suggestions
- respondent A and B outputs
- red-team critiques
- judge scores
- final synthesis
- local student output
- local model status and test panel
- round history with reopen support

## Limits of V1

- no RAG
- no persistent memory system beyond flat JSON storage
- no auth
- no SQL
- no WebSocket layer
- no hierarchical multi-agent planner
- no training pipeline yet
- local student is an observer, not a full participant in the arena

## Roadmap V2

- integrate tools for retrieval, verification, and enrichment before revisiting multi-model
- compare every future benchmark run against the frozen official baseline
- let the local student compete directly in the arena
- collect curated training examples from high-quality rounds
- add lightweight round tagging and curriculum generation
- add sub-arenas specialized by task type
- add memory modules only where they improve results
- add LoRA / SFT scripts using the upstream open-weight model
- add domain-specialized local students

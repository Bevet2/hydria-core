# System Overview

This document describes the current Hydria architecture as it exists in the repo.

## Main subsystems

### 1. Arena

Purpose:
- run multi-model comparative rounds
- critique them
- refine them
- judge them
- synthesize a final answer
- observe the round with the local student

Main entry points:
- `apps/server/src/services/arenaRunner.ts`
- `apps/server/src/services/arena/*`

Key supporting services:
- respondent execution
- structured judge / refine / synth steps
- local student observation
- round assembly and preparation

Persistence:
- `HistoryStore`
- SQLite through `HydriaStateDatabase`
- JSON projection for compatibility

### 2. Student Lab

Purpose:
- generate a local first draft
- optionally ground it through research
- analyze it with red team, teacher, and judge
- persist the session
- feed the learning loop

Main entry points:
- `apps/server/src/services/studentService.ts`
- `apps/server/src/services/student/*`

Persistence:
- `StudentSessionStore`
- SQLite through `HydriaStateDatabase`
- JSON projection and dataset outputs for compatibility and training artifacts

### 3. Research / Truth Engine

Purpose:
- detect when grounding is needed
- plan research queries
- acquire sources
- extract claims and dates
- verify freshness and truth support

Main modules:
- `research/decisionPolicy.ts`
- `research/planner.ts`
- `research/acquisitionService.ts`
- `research/retriever*.ts`
- `research/extractor*.ts`
- `research/verifier*.ts`

The research stack is now split into:
- decision
- acquisition
- extraction
- verification

### 4. Learning Loop

Purpose:
- aggregate signals from arena, student, research, and impacts
- detect hotspots
- score improvement
- generate governed policies
- promote, validate, guard, archive, or reject policies
- build active learning memory

Main files:
- `apps/server/src/types/learning.ts`
- `apps/server/src/services/learningConstitution.ts`
- `apps/server/src/services/learningImprovementScoreService.ts`
- `apps/server/src/services/learningHotspotService.ts`
- `apps/server/src/services/learningGovernanceService.ts`
- `apps/server/src/services/learningLoopService.ts`
- `apps/server/src/scripts/runLearningLoop.ts`

### 5. Knowledge Layer and Memory

Purpose:
- store analyzed lessons
- keep active memory separate from raw history
- influence future routing and student behavior

Important layers:
- raw memory
  - history and datasets
- analyzed memory
  - impact trackers, discoveries, knowledge summaries
- active memory
  - governance-approved learning memory
- archived / risky memory
  - rejected or guarded policies

Main files:
- `apps/server/src/services/knowledgeInjectionService.ts`
- `apps/server/src/services/knowledgeMemoryService.ts`
- `apps/server/src/services/storage/*`

## Persistence model

SQLite is the source of truth for:
- arena rounds
- student sessions

JSON files are projections or derived artifacts:
- history views
- knowledge summaries
- impact reports
- learning governance artifacts

The system already self-heals several derived artifacts from SQLite-backed data when possible.

## Learning lifecycle

Hydria now treats learning as a governed lifecycle:

1. observe
2. analyze
3. form hotspot or hypothesis
4. validate
5. activate or keep validating
6. monitor live behavior
7. guard, archive, or reject if it regresses

## Main risks to keep under control

- letting core builders absorb business logic
- letting raw memory influence live behavior too quickly
- over-promoting global policies on weak evidence
- depending too heavily on unstable live web retrieval
- failing too early in arena live runs before persistence

## Where to extend next

- stronger provider robustness
- more precise learning dashboards
- more deterministic replay and evaluation coverage
- tighter live-vs-replay regression monitoring

# Hydria Core

Hydria Core is the shared contract layer used by both the `arena` and `student` flows.

It is intentionally small:
- workflow
- messages
- handoffs
- tasks
- memory snapshots

The contract lives in `apps/server/src/types/core.ts` and is consumed through builders in `apps/server/src/services/core/`.

## Core principles

- The core is a translation layer, not a decision engine.
- Runtime services decide and execute.
- Core builders normalize runtime data into one Hydria-native language.
- Analytics and persistence read the Hydria contract instead of duplicating interpretation logic.

## Main contracts

- `HydriaWorkflowRun`
  - normalized trace of one run or session
- `HydriaWorkflowMessage`
  - typed message produced by a role
- `HydriaWorkflowHandoff`
  - explicit transfer between roles
- `HydriaWorkflowTask`
  - unit of work with owner and status
- `HydriaMemorySnapshot`
  - compact memory state injected or derived for a run

## Builders

- `apps/server/src/services/core/hydriaCoreWorkflowService.ts`
- `apps/server/src/services/core/hydriaCoreMemoryService.ts`
- `apps/server/src/services/core/hydriaArenaWorkflowBuilder.ts`
- `apps/server/src/services/core/hydriaArenaMemoryBuilder.ts`
- `apps/server/src/services/core/hydriaStudentWorkflowBuilder.ts`
- `apps/server/src/services/core/hydriaStudentMemoryBuilder.ts`

## Current scope

The `student` flow exposes:
- `preview.workflow`
- `preview.memory`
- `session.workflow`
- `session.memory`

The `arena` flow exposes:
- `round.workflow`
- `round.memory`

## Degradation semantics

Hydria uses stable workflow statuses:
- `completed`
- `partial`
- `failed`

`partial` is not a vague label. It means the run stayed usable, but one or more important parts degraded:
- critical role fallback
- research failure
- missing or degraded sub-step that did not invalidate the whole run

Those reasons are represented in `workflow.degradationReasons`.

## What must stay out of the core

The following must not migrate into builders:
- policy heuristics
- benchmark scoring
- persistence rules
- promotion or demotion logic
- product-facing decisions

If a rule changes behavior, it belongs in:
- `services/arena/*`
- `services/student/*`
- `services/research/*`
- `services/learning*`

and only the resulting trace belongs in Hydria Core.

## Related docs

- [System Overview](./overview.md)
- [Learning Loop](./learning-loop.md)

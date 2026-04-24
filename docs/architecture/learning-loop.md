# Learning Loop

This document describes the governed self-learning loop in Hydria.

## Goal

Hydria should not "learn everything".

It should learn:
- locally first
- on measurable evidence
- under rollback conditions
- through explicit promotion and demotion rules

## Loop stages

1. Observation
   - arena rounds
   - student sessions
   - respondent failures
   - research outcomes
   - impact trackers

2. Evaluation
   - improvement score
   - hotspot detection
   - quality analytics
   - temporal replay validation

3. Hypothesis
   - candidate rule
   - candidate strategy
   - candidate research policy
   - candidate respondent or local student policy

4. Validation
   - replay-first
   - then live monitoring after promotion

5. Activation
   - only when the constitution allows it
   - with explicit scope and rollback triggers

6. Surveillance
   - live monitoring window
   - false-positive detection
   - top gains and top regressions

7. Maintenance
   - remain active
   - move to guarded
   - archive
   - reject

## Core files

- `apps/server/src/types/learning.ts`
- `apps/server/src/services/learningConstitution.ts`
- `apps/server/src/services/learningGovernanceService.ts`
- `apps/server/src/services/learningLoopService.ts`
- `apps/server/src/services/learningHotspotService.ts`
- `apps/server/src/services/learningImprovementScoreService.ts`

## Constitution

The constitution defines:
- what is learnable
- what is protected
- minimum promotion thresholds
- demotion thresholds
- activation boundaries
- rollback guardrails

## Policy states

- `hypothesis`
- `validating`
- `active`
- `guarded`
- `rejected`
- `archived`

These states are not cosmetic. They control:
- whether a learning item becomes active memory
- whether it can affect future behavior
- whether it must be watched or rolled back

## Memory layers

- raw
  - logs, rounds, sessions
- analyzed
  - impacts, discoveries, hotspot summaries
- active
  - only governed, active or guarded items
- risky
  - guarded items
- archived
  - rejected or retired items

## Default validation mode

The learning loop now defaults to:
- `temporal_replay`

That means global or broad policies should not be promoted on weak live anecdotes alone.

## Current operational rule

The system should prefer:
- fewer active policies
- more local scope
- stronger replay evidence
- explicit rollback triggers

over:
- broad speculative activation
- uncontrolled accumulation of rules

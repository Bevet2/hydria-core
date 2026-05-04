# Local Student Training

This document defines the first governed training path for the local student model.

## Goal

Train the local student model, not the whole core.

Hydria Core should keep:
- explicit routing
- governance
- rollback logic
- tool, skill, and agent contracts

The trainable target is the local student behavior:
- clearer answers
- stronger rewrite behavior
- better honesty around tool-dependent or live data
- more stable pedagogical output

## Canonical Data Sources

The first training pack is built from three sources already present in the repo.

### 1. Curated rounds

Source:
- `storage/datasets/student-qwen-curated.jsonl`

Keep because:
- selected from successful arena rounds
- positive refine gain
- non-degrading refine verdicts
- already ranked by `selectionScore`

Use for:
- direct-answer supervision

### 2. Contrastive rounds

Source:
- `storage/datasets/student-qwen-contrastive.jsonl`

Keep because:
- they explicitly show weak answer -> stronger answer transformations
- useful for teaching the local student how to rewrite and repair

Use for:
- rewrite supervision

### 3. Student sessions

Source:
- persisted student sessions from SQLite

Keep because:
- they carry teacher/judge feedback
- they encode actual local student corrections
- they are the best place to preserve tool-safe abstention behavior

Use for:
- direct-answer supervision
- tool-safe supervision

## What To Keep

### Curated rounds

Keep when:
- `selectionScore >= 65`
- target answer is not too short
- target answer is not too long

Weighting:
- `gold` > `silver` > `bronze`
- extra weight if research helped

### Contrastive rounds

Keep when:
- `selectionScore >= 60`
- `improvedDelta >= 6`
- source and target are not effectively identical

Weighting:
- base rewrite weight
- extra weight for larger `improvedDelta`
- extra weight for `gold`/`silver`

### Student sessions

Keep when:
- verdict is `improved` or `minor`
- `worthIt = YES`
- `sessionScore >= 68`
- tool impact is not `negative`

Weighting:
- base session weight
- more weight when `deltaOverall` is high
- extra weight for tool-safe sessions with positive or honest failure behavior

## What To Reject

Reject reasons are explicit:

- `low_selection_score`
- `insufficient_delta`
- `negative_outcome`
- `negative_tool_impact`
- `target_too_short`
- `target_too_long`
- `duplicate_target`
- `low_session_score`
- `worth_it_no`

Rejected examples are written separately on purpose. They should not silently disappear.

## Output Format

Accepted examples are emitted as chat-style JSONL:

```json
{
  "datasetVersion": "hydria-local-student-sft-v1",
  "exampleId": "session::...",
  "sourceType": "student_session",
  "taskType": "tool_safe_answer",
  "qualityTier": "silver",
  "weight": 1.21,
  "keepReason": "Validated student session ...",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "targetAnswer": "...",
  "metadata": {
    "category": "technical_explanation",
    "researchUsed": true,
    "toolUsed": true
  }
}
```

This is intentionally simple for a first LoRA/SFT pass.

## Commands

Build the pack:

```powershell
npm.cmd run student:training-pack
```

Recommended pre-train checks:

```powershell
npm.cmd run check
npm.cmd run test -w @hydria-arena/server
npm.cmd run student:temporal-eval:replay
npm.cmd run tool:routing-eval
```

## First Training Recommendation

Start with:
- target model: `Qwen/Qwen2.5-3B-Instruct`
- method: short `LoRA SFT`
- epochs: `1`

Do not start with:
- full-model training
- training governance policies directly
- training the tool router or agent router as opaque model behavior

## Why This Order

The local student is the safest and most measurable training target.

Hydria should become better because:
- the model improves its supervised behavior
- the core remains governed and explicit

not because:
- hidden model changes replace routing, safety, or governance logic

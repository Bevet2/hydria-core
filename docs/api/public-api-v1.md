# Hydria Public API v1

Purpose: expose Hydria Core as a stable API for external projects.

The public API uses the normal Hydria chat runtime:

- local open-weight model routing
- governed tools and source-backed research
- session memory through `sessionId`
- interaction audit persistence and governed learning capture
- runtime trace without private chain-of-thought
- optional Hydria OS `workspaceContext` that returns governed `proposedActions`
- confirmed Hydria OS execution that creates persistent, editable, exportable work objects

It does not use Playground/Arena or OpenRouter.

## Authentication

All `/api/v1/*` endpoints require a Hydria API key by default.

Supported headers:

```http
Authorization: Bearer <key>
x-hydria-api-key: <key>
x-api-key: <key>
```

Configure keys with one of:

```env
HYDRIA_API_KEYS=hydria_live_xxx
HYDRIA_API_KEY_SHA256_HASHES=<sha256 key hash>
```

For local development only, auth can be disabled with:

```env
HYDRIA_EXTERNAL_API_AUTH_REQUIRED=false
```

## Ask

```bash
curl -fsS https://app.hydria.click/api/v1/ask \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{
    "input": "Qu est-ce que NVIDIA ?",
    "options": {
      "includeSources": true,
      "includeTrace": true
    }
  }'
```

Response shape:

```json
{
  "id": "request uuid",
  "object": "hydria.answer",
  "createdAt": "2026-05-27T12:00:00.000Z",
  "sessionId": "conversation uuid",
  "answer": "Final user-facing answer.",
  "language": "fr",
  "category": "technical_explanation",
  "confidence": 86,
  "sources": [
    {
      "title": "Wikipedia: Nvidia",
      "url": "https://fr.wikipedia.org/wiki/Nvidia",
      "snippet": "Short snippet.",
      "excerpt": "Verified excerpt."
    }
  ],
  "tools": {
    "used": true,
    "route": "used",
    "type": "research",
    "intent": "fact_check",
    "sourceCount": 2
  },
  "models": {
    "provider": "tool",
    "model": "research_fact_check",
    "specialistRole": "source_research",
    "attempts": ["qwen2.5:3b"]
  },
  "memory": {
    "sessionId": "conversation uuid",
    "userGoal": "Qu est-ce que NVIDIA ?",
    "activeConstraints": [],
    "contextTracked": true
  },
  "quality": {
    "passed": true,
    "issues": [],
    "retryUsed": false,
    "durationMs": 1234
  },
  "proposedActions": []
}
```

## Hydria OS Workspace Actions

External OS clients can pass workspace capabilities to let Core plan work. By default `/api/v1/ask`
returns `proposedActions` only. After OS confirmation, Hydria can now materialize those actions as
persistent `WorkObject`s.

Core remains the brain: it reasons, chooses tools/models, plans, verifies, and records memory.
The OS stays responsible for user permission, UI, and when to execute. Once confirmed, Core can create
or update the persisted work object state used by the OS.

```bash
curl -fsS https://app.hydria.click/api/v1/ask \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{
    "input": "Ajoute une colonne Priorite dans le tableur actif.",
    "workspaceContext": {
      "os": { "name": "Hydria OS" },
      "activeWorkObject": {
        "id": "work-object-1",
        "title": "Pipeline ventes",
        "kind": "dataset",
        "workspaceFamilyId": "data_spreadsheet",
        "entryPath": "table.csv",
        "contentPreview": "Client,Status",
        "editable": true
      },
      "capabilities": {
        "actions": ["reply", "create_artifact", "create_work_object", "update_work_object", "set_work_object_metadata", "workspace_tool_call"],
        "artifactFormats": ["xlsx", "csv", "docx", "pdf", "pptx", "md"],
        "workObjectKinds": ["document", "dataset", "presentation", "dashboard", "workflow", "project"],
        "workspaceTools": [
          "sheet.apply_formula",
          "sheet.set_cell",
          "sheet.add_column",
          "sheet.add_row",
          "sheet.insert_rows",
          "sheet.insert_columns",
          "sheet.rename_column",
          "sheet.delete_column",
          "sheet.delete_row",
          "sheet.delete_rows",
          "sheet.delete_columns",
          "sheet.resize_row",
          "sheet.resize_column",
          "sheet.set_range",
          "sheet.clear_cells",
          "sheet.sort_range",
          "sheet.filter_rows",
          "sheet.clear_filter",
          "sheet.format_cells",
          "sheet.clear_format",
          "sheet.merge_cells",
          "sheet.unmerge_cells",
          "sheet.set_note",
          "sheet.clear_note",
          "sheet.add_chart",
          "sheet.update_chart",
          "sheet.remove_chart",
          "sheet.set_data_validation",
          "sheet.clear_data_validation",
          "sheet.add_conditional_format",
          "sheet.remove_conditional_format",
          "sheet.add_table",
          "sheet.remove_table",
          "sheet.add_pivot_table",
          "sheet.remove_pivot_table",
          "sheet.add_sparkline",
          "sheet.remove_sparkline",
          "sheet.add_slicer",
          "sheet.remove_slicer",
          "sheet.add_named_range",
          "sheet.remove_named_range",
          "sheet.protect_sheet",
          "sheet.unprotect_sheet",
          "sheet.protect_range",
          "sheet.unprotect_range",
          "sheet.freeze_panes",
          "sheet.set_zoom",
          "sheet.show_gridlines",
          "sheet.add_sheet",
          "sheet.rename_sheet",
          "sheet.delete_sheet",
          "sheet.duplicate_sheet",
          "sheet.move_sheet",
          "sheet.set_active_sheet",
          "sheet.hide_sheet",
          "sheet.unhide_sheet",
          "doc.edit",
          "doc.insert_section",
          "doc.replace_block",
          "doc.append_paragraph",
          "doc.insert_table",
          "doc.delete_section",
          "doc.insert_list",
          "doc.insert_link",
          "doc.set_title",
          "slide.edit",
          "slide.add",
          "slide.update",
          "slide.reorder"
        ]
      },
      "executionPolicy": {
        "mode": "dry_run",
        "requireConfirmation": true
      }
    }
  }'
```

For spreadsheet/office manipulation, send a structured `activeWorkObject.contentPreview` when possible, not only
plain text. Keep it as valid JSON even when compacting large sheets; truncate rows/columns instead of cutting the
JSON string. A Hydria sheet preview should expose at least `kind`, `columns`, and a small sample of `rows`:

```json
{
  "kind": "hydria-sheet",
  "columns": ["nb de crayon gris", "nb de crayon noir", "prix", "Total"],
  "rows": [["10", "10", "0.5", "5"]]
}
```

With that context, a request like `Fais le total.` is planned as a workspace tool call on the active sheet:

```json
{
  "type": "workspace_tool_call",
  "payload": {
    "toolName": "sheet.apply_formula",
    "operations": [
      {
        "type": "sheet.set_range",
        "range": "D2:D2",
        "values": [["=SOMME(A2:B2)*C2"]]
      }
    ]
  }
}
```

This keeps the API generic: Core infers the operation from the active sheet semantics (`quantity` columns plus unit
`price` column), while the OS remains responsible for validation and execution.

Core can also plan non-formula Sheet operations from the same context: row/column insertion and deletion, resizing,
sorting, filtering, clearing cells or formats, merging ranges, notes, validations, conditional formats, tables,
pivot tables, charts, sparklines, slicers, named ranges, protections, frozen panes, zoom/gridlines, and sheet-tab
management. Prefer sending the full `workspaceTools` list so Core can choose the most specific operation.

Action response example:

```json
{
  "proposedActions": [
    {
      "id": "action uuid",
      "type": "update_work_object",
      "title": "Modifier Pipeline ventes",
      "target": {
        "workObjectId": "work-object-1",
        "entryPath": "table.csv"
      },
      "payload": {
        "instruction": "Ajoute une colonne Priorite dans le tableur actif.",
        "mode": "append",
        "answerDraft": "..."
      },
      "riskLevel": "medium",
      "requiresConfirmation": true,
      "dryRun": true,
      "rationale": "La requete demande de travailler sur l'objet actif.",
      "provenance": {
        "source": "hydria_core_public_api_v1",
        "requestId": "request uuid",
        "generatedAt": "2026-05-27T12:00:00.000Z"
      }
    }
  ]
}
```

Allowed action types:

- `reply`
- `create_artifact`
- `create_work_object`
- `update_work_object`
- `set_work_object_metadata`
- `workspace_tool_call`

`proposedActions` are contract objects. `/api/v1/ask` does not execute by default.

To execute in two steps:

```bash
curl -fsS https://app.hydria.click/api/v1/actions/execute \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{
    "confirmed": true,
    "sessionId": "conversation uuid",
    "action": { "...": "one proposed action from /api/v1/ask" }
  }'
```

To let the OS send an already-confirmed execution request in one call, set:

```json
{
  "workspaceContext": {
    "executionPolicy": {
      "mode": "execute_after_confirmation",
      "requireConfirmation": false
    }
  }
}
```

Then `/api/v1/ask` returns the normal answer plus:

```json
{
  "executedActions": [],
  "activeWorkObject": null,
  "workObjects": [],
  "artifacts": []
}
```

When an action is executed, these fields contain the created or modified work object and artifact metadata.

### Work Objects

Hydria work objects are the persistent OS-facing output layer. They are not chat text and they are
not simplified export files. They represent the same editable source state that Hydria OS workspaces
already know how to open:

- `document`
- `dataset`
- `presentation`
- `dashboard`
- `workflow`
- `project`
- `code`

Current storage:

- metadata: `storage/os/work-objects-v1.json`
- object content: `storage/os/work-objects`
- artifact mirrors: `storage/os/artifacts`

Main endpoints:

```http
GET   /api/v1/work-objects
GET   /api/v1/work-objects/:workObjectId
GET   /api/v1/work-objects/:workObjectId/content?entryPath=document.html
PATCH /api/v1/work-objects/:workObjectId/content
POST  /api/v1/work-objects/:workObjectId/operations
POST  /api/v1/actions/execute
GET   /api/v1/artifacts/:artifactId/download
GET   /api/v1/interactions
```

`PATCH /content` body:

```json
{
  "entryPath": "document.html",
  "content": "<h1>Updated document</h1>",
  "note": "Manual OS edit"
}
```

This means the API can now be used by another project as a brain + workspace backend:

1. call `/api/v1/ask`;
2. show the answer and proposed actions;
3. ask user confirmation in the OS UI;
4. call `/api/v1/actions/execute`;
5. render the returned `activeWorkObject`;
6. edit/save through `/api/v1/work-objects/:id/content`.

Hydria keeps workspace-native editable source objects and can export native Office binaries as mirrors:

- Docs / Word-like workspace: `document.html` plus `spec.json`
- Sheets / Excel-like workspace: `table.csv` containing the Hydria `hydria-sheet` JSON model plus `spec.json`
- Slides workspace: `slides.md` plus `spec.json`
- `docx` from document HTML or markdown
- `xlsx` from the Hydria sheet model
- `pptx` from presentation markdown

The `.docx`, `.xlsx`, and `.pptx` files are downloadable artifacts. The source of truth remains the
workspace object returned by `activeWorkObject`, so Hydria OS can keep editing it in its real document,
spreadsheet, and slide surfaces.

### Workspace Tool Calls

For live workspace operations, Core can return a `workspace_tool_call` action. This is the contract used
for user/workspace/Core exchange:

1. the user asks from the workspace;
2. the OS sends `workspaceContext`, active object, visible preview, and available `workspaceTools`;
3. Core proposes a structured tool operation;
4. the OS confirms and applies it with its real workspace engine, or calls the API executor for a persisted object;
5. the resulting work object revision is returned and kept in memory/history.

Example proposed action:

```json
{
  "type": "workspace_tool_call",
  "target": {
    "workObjectId": "sheet-1",
    "entryPath": "table.csv"
  },
  "payload": {
    "toolName": "sheet.apply_formula",
    "operations": [
      {
        "type": "sheet.add_column",
        "columnName": "Total",
        "formula": "=B2*C2",
        "target": {
          "columnName": "Total",
          "rowIndex": 0
        }
      }
    ]
  }
}
```

The same operation can be executed through the generic action endpoint or directly on a stored work object:

```bash
curl -fsS https://app.hydria.click/api/v1/work-objects/sheet-1/operations \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{
    "entryPath": "table.csv",
    "toolName": "sheet.apply_formula",
    "operations": [
      {
        "type": "sheet.set_formula",
        "formula": "=B2*C2",
        "target": { "cell": "D2" }
      }
    ],
    "confirmed": true
  }'
```

All `workspace_tool_call` actions returned by Core use the canonical payload shape:

```json
{
  "payload": {
    "contractVersion": "workspace_tool_call.v1",
    "toolName": "sheet.apply_formula",
    "expectedSurface": "sheet",
    "operations": [
      {
        "type": "sheet.set_formula",
        "target": { "cell": "D2" },
        "formula": "=B2*C2"
      }
    ]
  }
}
```

If a valid `workspace_tool_call` is present, Core keeps that action as the authoritative workspace action and
removes competing artifact-style actions from the response.

Supported persisted Sheet operations in this layer cover the workbook, grid, formulas, formatting,
data governance, analysis objects, protection, and view state:

- `sheet.add_column`
- `sheet.add_row`
- `sheet.insert_rows`
- `sheet.insert_columns`
- `sheet.rename_column`
- `sheet.delete_column`
- `sheet.delete_row`
- `sheet.delete_rows`
- `sheet.delete_columns`
- `sheet.resize_row`
- `sheet.resize_column`
- `sheet.set_formula`
- `sheet.set_cell`
- `sheet.set_range`
- `sheet.clear_cells`
- `sheet.sort_range`
- `sheet.filter_rows`
- `sheet.clear_filter`
- `sheet.format_cells`
- `sheet.clear_format`
- `sheet.merge_cells`
- `sheet.unmerge_cells`
- `sheet.set_note`
- `sheet.clear_note`
- `sheet.set_data_validation`
- `sheet.clear_data_validation`
- `sheet.add_conditional_format`
- `sheet.remove_conditional_format`
- `sheet.add_table`
- `sheet.remove_table`
- `sheet.add_pivot_table`
- `sheet.remove_pivot_table`
- `sheet.add_chart`
- `sheet.update_chart`
- `sheet.remove_chart`
- `sheet.add_sparkline`
- `sheet.remove_sparkline`
- `sheet.add_slicer`
- `sheet.remove_slicer`
- `sheet.add_named_range`
- `sheet.remove_named_range`
- `sheet.protect_sheet`
- `sheet.unprotect_sheet`
- `sheet.protect_range`
- `sheet.unprotect_range`
- `sheet.freeze_panes`
- `sheet.set_zoom`
- `sheet.show_gridlines`
- `sheet.add_sheet`
- `sheet.rename_sheet`
- `sheet.delete_sheet`
- `sheet.duplicate_sheet`
- `sheet.move_sheet`
- `sheet.set_active_sheet`
- `sheet.hide_sheet`
- `sheet.unhide_sheet`

Supported persisted document operations:

- `doc.insert_section`
- `doc.insert_heading`
- `doc.insert_paragraph`
- `doc.replace_block`
- `doc.replace_text`
- `doc.delete_text`
- `doc.append_paragraph`
- `doc.insert_table`
- `doc.delete_section`
- `doc.insert_list`
- `doc.insert_image`
- `doc.insert_link`
- `doc.insert_page_break`
- `doc.insert_toc`
- `doc.insert_quote`
- `doc.insert_code_block`
- `doc.format_block`
- `doc.set_title`
- `doc.set_metadata`
- `doc.add_comment`
- `doc.resolve_comment`

Supported persisted slide operations:

- `slide.add`
- `slide.update`

Hydria OS can expose either family tools (`sheet.apply_formula`, `doc.edit`, `slide.edit`) or operation tools
(`sheet.add_chart`, `doc.insert_section`, `slide.add`, etc.). Core treats same-surface tools as compatible
capability names and still emits one canonical `workspace_tool_call.v1` payload. The live list is available
from Hydria OS at `GET /api/hydria/control/schema`.

Every `/api/v1/ask` response and every confirmed workspace action is now stored in the interaction audit log.
This gives the OS a reusable memory trail: original user request, active workspace preview, proposed actions,
executed actions, model/tool routing, quality issues, and resulting work object IDs. Read it with:

```bash
curl -fsS "https://app.hydria.click/api/v1/interactions?sessionId=<sessionId>&limit=50" \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

Useful filters:

- `scope=public_api_ask`
- `scope=workspace_action`
- `sessionId=<conversation uuid>`

This is audit/learning memory. It does not expose private chain-of-thought and it does not train a model by itself.

The artifact download URL is returned on the artifact object:

```json
{
  "artifact": {
    "format": "docx",
    "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "downloadUrl": "/api/v1/artifacts/<artifactId>/download"
  }
}
```

### Office Workspace Gate

Hydria OS spreadsheet and document workspaces are covered by a dedicated Core gate:

```bash
npm run os:office-workspace-gate
```

The broader public API workspace scenario gate validates the user/workspace/Core exchange directly:

```bash
npm run os:workspace-scenario-gate
```

It covers plain questions, numbers-to-Excel extraction, active Sheet commentary, totals, sort/filter/format/chart
planning, document section edits, text replacement, links, code blocks, comments, summaries, and slide creation.

The gate validates:

- Excel/tableur actions: add columns, create `xlsx`, metadata rename, conceptual CSV no-op
- Word/document actions: add section, rewrite intro, create `docx`, metadata retitle, conceptual document no-op
- source-sensitive document requests, such as biographies or current AI news, do not use the deterministic fast path

It writes:

- `storage/training/hydria-os-office-workspace-action-gate-v1.json`
- `storage/training/hydria-os-office-workspace-action-sft-seed-v1.jsonl`

The JSONL file is a training seed for the workspace action planner. It is not a model training run by itself.

After training/importing the Office workspace student candidate, validate the served Ollama model with:

```bash
npm run os:office-workspace-model-gate
```

That gate renders the SFT examples with the Qwen raw chat template and checks that
`student-local-1p5b-toolbench-lora-v11-office-workspace-light:latest` returns valid JSON with dry-run
`proposedActions`. It writes:

- `storage/training/hydria-os-office-workspace-model-gate-v1.json`

The candidate is not promoted by that gate. Hydria keeps the v10 planner active until an A/B gate compares the
current public API planner against the v11 Office adapter:

```bash
npm run os:office-workspace-ab-gate
```

The A/B gate uses the raw Qwen adapter (`/api/generate`, `raw:true`) for
`student-local-1p5b-toolbench-lora-v11-office-workspace-light:latest`, verifies valid JSON, dry-run safety,
workspace targets, expected Excel/Word action shape, and writes:

- `storage/training/hydria-os-office-workspace-ab-gate-v1.json`

Promotion is deliberately not automatic. The report always keeps `promotion.recommended=false`; a separate
explicit runtime promotion step is required after review.

### v11 Office Shadow Mode

To observe the v11 Office workspace candidate on real `/api/v1/ask` traffic without changing user-visible
responses, enable shadow mode:

```env
HYDRIA_OS_OFFICE_V11_SHADOW_ENABLED=true
HYDRIA_OS_OFFICE_V11_SHADOW_MODEL=student-local-1p5b-toolbench-lora-v11-office-workspace-light:latest
HYDRIA_OS_OFFICE_V11_SHADOW_BASE_URL=http://127.0.0.1:11434
HYDRIA_OS_OFFICE_V11_SHADOW_FILE=storage/training/hydria-os-office-workspace-shadow-v1.jsonl
```

In shadow mode:

- v10 remains the official runtime response.
- v11-office runs through the raw Qwen adapter in the background.
- Hydria appends a JSONL comparison event with the official actions, candidate actions, differences, and dry-run safety.
- No OS action is executed and no promotion happens automatically.

Review accumulated shadow traffic with:

```bash
npm run os:office-workspace-shadow-report
```

The report writes:

- `storage/training/hydria-os-office-workspace-shadow-report-v1.json`

## Conversation Memory

Reuse the returned `sessionId` to continue the same conversation:

```bash
curl -fsS https://app.hydria.click/api/v1/ask \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{
    "sessionId": "conversation uuid",
    "input": "Et donne-moi un exemple concret."
  }'
```

Create a session explicitly:

```bash
curl -fsS -X POST https://app.hydria.click/api/v1/sessions \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

Reset a session:

```bash
curl -fsS -X POST https://app.hydria.click/api/v1/sessions/<sessionId>/reset \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

## JavaScript Example

```js
const response = await fetch("https://app.hydria.click/api/v1/ask", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.HYDRIA_API_KEY}`
  },
  body: JSON.stringify({
    input: "Explain PostgreSQL simply.",
    options: { includeSources: true }
  })
});

const answer = await response.json();
console.log(answer.answer);
```

## Python Example

```python
import os
import requests

response = requests.post(
    "https://app.hydria.click/api/v1/ask",
    headers={"Authorization": f"Bearer {os.environ['HYDRIA_API_KEY']}"},
    json={"input": "Explique PostgreSQL simplement."},
    timeout=180,
)
response.raise_for_status()
print(response.json()["answer"])
```

## Capabilities

```bash
curl -fsS https://app.hydria.click/api/v1/capabilities \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

This returns the available endpoints, runtime layers, tool categories, and local model roles.

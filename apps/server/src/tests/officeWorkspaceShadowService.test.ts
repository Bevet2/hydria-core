import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OfficeWorkspaceShadowService } from "../services/publicApi/officeWorkspaceShadowService.js";
import {
  publicApiAskRequestSchema,
  publicApiAskResponseSchema,
  type PublicApiProposedAction
} from "../types/publicApi.js";

const requestId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
const generatedAt = "2026-05-29T08:00:00.000Z";

function action(overrides: Partial<PublicApiProposedAction> = {}): PublicApiProposedAction {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    type: "update_work_object",
    title: "Modifier Pipeline",
    target: {
      workObjectId: "sheet-1",
      entryPath: "pipeline.csv"
    },
    payload: {
      instruction: "Ajoute une colonne Budget au tableur actif.",
      mode: "append",
      columns: ["Budget"]
    },
    riskLevel: "medium",
    requiresConfirmation: true,
    dryRun: true,
    rationale: "Action proposee en dry-run.",
    provenance: {
      source: "hydria_core_public_api_v1",
      requestId,
      generatedAt
    },
    ...overrides
  };
}

function request() {
  return publicApiAskRequestSchema.parse({
    input: "Ajoute une colonne Budget au tableur actif.",
    workspaceContext: {
      activeWorkObject: {
        id: "sheet-1",
        title: "Pipeline",
        kind: "dataset",
        entryPath: "pipeline.csv",
        contentPreview: "Client,Statut"
      },
      capabilities: {
        actions: ["reply", "update_work_object", "create_artifact"],
        artifactFormats: ["xlsx", "csv"],
        workObjectKinds: ["dataset"]
      }
    },
    options: {
      includeSources: true,
      includeTrace: true,
      includeDiagnostics: true,
      includeProposedActions: true
    }
  });
}

function official(actions = [action()]) {
  return publicApiAskResponseSchema.parse({
    id: requestId,
    object: "hydria.answer",
    createdAt: generatedAt,
    sessionId,
    answer: "Une action OS est proposee en dry-run.",
    language: "fr",
    category: "workspace_action",
    confidence: 92,
    sources: [],
    tools: {
      used: false,
      route: "not_needed",
      type: "none",
      intent: "workspace_action_plan",
      sourceCount: 0
    },
    models: {
      provider: "policy",
      model: "workspace_action_planner_v1",
      specialistRole: "os_action_contract",
      attempts: ["workspace_action_planner_v1"]
    },
    memory: {
      sessionId,
      userGoal: "Ajoute une colonne Budget au tableur actif.",
      activeConstraints: [],
      contextTracked: true
    },
    quality: {
      passed: true,
      issues: [],
      retryUsed: false,
      durationMs: 0
    },
    proposedActions: actions
  });
}

test("office workspace shadow service records a clean match without promotion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hydria-office-shadow-"));
  const logFile = join(dir, "shadow.jsonl");
  const service = new OfficeWorkspaceShadowService({
    logFile,
    now: () => new Date(generatedAt),
    eventId: () => "event-1",
    adapter: {
      async plan() {
        return {
          provider: "ollama",
          model: "office-candidate",
          promptTemplate: "qwen_raw_chat",
          durationMs: 12,
          rawResponse: "{\"proposedActions\":[]}",
          proposedActions: [action()],
          issues: []
        };
      }
    }
  });

  const event = await service.run({
    request: request(),
    official: official()
  });

  assert.equal(event.comparison.verdict, "match");
  assert.equal(event.comparison.dryRunSafe, true);
  assert.equal(event.promotion.eligibleForAutoPromotion, false);

  const lines = (await readFile(logFile, "utf8")).trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0] ?? "{}").eventId, "event-1");
});

test("office workspace shadow service records candidate diffs and unsafe dry-run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hydria-office-shadow-"));
  const service = new OfficeWorkspaceShadowService({
    logFile: join(dir, "shadow.jsonl"),
    now: () => new Date(generatedAt),
    eventId: () => "event-2",
    adapter: {
      async plan() {
        return {
          provider: "ollama",
          model: "office-candidate",
          promptTemplate: "qwen_raw_chat",
          durationMs: 12,
          rawResponse: "{\"proposedActions\":[]}",
          proposedActions: [
            action({
              type: "create_artifact",
              target: {
                workObjectId: null,
                entryPath: null
              },
              dryRun: false
            })
          ],
          issues: ["action_0_not_dry_run"]
        };
      }
    }
  });

  const event = await service.run({
    request: request(),
    official: official()
  });

  assert.equal(event.comparison.verdict, "candidate_diff");
  assert.equal(event.comparison.dryRunSafe, false);
  assert.ok(event.comparison.issues.some((issue) => issue.includes("not_dry_run")));
  assert.ok(event.comparison.issues.some((issue) => issue.includes("type:create_artifact")));
});

test("office workspace shadow report summarizes observed traffic", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hydria-office-shadow-"));
  const logFile = join(dir, "shadow.jsonl");
  const service = new OfficeWorkspaceShadowService({
    logFile,
    now: () => new Date(generatedAt),
    eventId: () => "event-3",
    adapter: {
      async plan() {
        return {
          provider: "ollama",
          model: "office-candidate",
          promptTemplate: "qwen_raw_chat",
          durationMs: 12,
          rawResponse: "{}",
          proposedActions: [action()],
          issues: []
        };
      }
    }
  });
  await service.run({
    request: request(),
    official: official()
  });

  const report = await service.writeReport(join(dir, "report.json"));

  assert.equal(report.summary.eventCount, 1);
  assert.equal(report.summary.matched, 1);
  assert.equal(report.promotion.recommended, false);
});

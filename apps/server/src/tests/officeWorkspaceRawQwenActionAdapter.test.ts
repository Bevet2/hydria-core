import test from "node:test";
import assert from "node:assert/strict";
import {
  OfficeWorkspaceRawQwenActionAdapter,
  renderOfficeWorkspaceQwenRawPrompt
} from "../services/publicApi/officeWorkspaceRawQwenActionAdapter.js";
import { publicApiAskRequestSchema } from "../types/publicApi.js";

function workspaceRequest(input = "Ajoute une colonne Budget au tableur actif.") {
  return publicApiAskRequestSchema.parse({
    input,
    workspaceContext: {
      os: {
        name: "Hydria OS"
      },
      activeWorkObject: {
        id: "sheet-1",
        title: "Pipeline",
        kind: "dataset",
        entryPath: "pipeline.csv",
        contentPreview: "Client,Statut",
        editable: true
      },
      capabilities: {
        actions: ["reply", "update_work_object", "create_artifact", "set_work_object_metadata"],
        artifactFormats: ["xlsx", "csv", "docx"],
        workObjectKinds: ["dataset", "document"]
      },
      executionPolicy: {
        mode: "dry_run",
        requireConfirmation: true
      }
    }
  });
}

test("office workspace raw adapter renders a Qwen raw chat prompt", () => {
  const prompt = renderOfficeWorkspaceQwenRawPrompt({
    request: workspaceRequest(),
    runtimeAnswer: "Runtime answer"
  });

  assert.match(prompt, /^<\|im_start\|>system/);
  assert.match(prompt, /dryRun must be true/);
  assert.match(prompt, /<\|im_start\|>assistant\n$/);
  assert.match(prompt, /"activeWorkObject"/);
});

test("office workspace raw adapter calls Ollama generate with raw Qwen mode", async () => {
  let capturedBody: any = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        response: JSON.stringify({
          proposedActions: [
            {
              type: "update_work_object",
              title: "Ajouter Budget",
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
              rationale: "Action OS proposee en dry-run."
            }
          ]
        })
      }),
      { status: 200 }
    );
  };

  const adapter = new OfficeWorkspaceRawQwenActionAdapter({
    fetchImpl,
    baseUrl: "http://127.0.0.1:11435",
    model: "office-candidate",
    timeoutMs: 1000
  });
  const result = await adapter.plan({
    request: workspaceRequest(),
    requestId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-05-29T08:00:00.000Z"
  });

  assert.equal(capturedBody.model, "office-candidate");
  assert.equal(capturedBody.raw, true);
  assert.equal(capturedBody.stream, false);
  assert.match(capturedBody.prompt, /<\|im_start\|>system/);
  assert.deepEqual(result.issues, []);
  assert.equal(result.proposedActions[0]?.type, "update_work_object");
  assert.equal(result.proposedActions[0]?.target.workObjectId, "sheet-1");
  assert.equal(result.proposedActions[0]?.dryRun, true);
});

test("office workspace raw adapter repairs fenced JSON and fills runtime answer draft", () => {
  const adapter = new OfficeWorkspaceRawQwenActionAdapter({ model: "office-candidate" });
  const result = adapter.parsePlan(
    "```json\n{\"proposedActions\":[{\"type\":\"create_artifact\",\"payload\":{\"format\":\"docx\",\"kind\":\"document\"},\"dryRun\":true}]}\n```",
    {
      request: workspaceRequest("Redige un document Word de synthese."),
      runtimeAnswer: "Synthese valide issue du runtime.",
      requestId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-05-29T08:00:00.000Z"
    }
  );

  assert.deepEqual(result.issues, []);
  assert.equal(result.proposedActions[0]?.type, "create_artifact");
  assert.equal(result.proposedActions[0]?.payload.answerDraft, "Synthese valide issue du runtime.");
});

test("office workspace raw adapter flags unsafe or malformed model actions", () => {
  const adapter = new OfficeWorkspaceRawQwenActionAdapter({ model: "office-candidate" });
  const result = adapter.parsePlan(
    JSON.stringify({
      proposedActions: [
        {
          type: "update_work_object",
          payload: {
            mode: "replace"
          },
          dryRun: false
        }
      ]
    }),
    {
      request: publicApiAskRequestSchema.parse({
        input: "Modifie le document actif.",
        workspaceContext: {
          capabilities: {
            actions: ["reply", "update_work_object"]
          }
        }
      }),
      requestId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-05-29T08:00:00.000Z"
    }
  );

  assert.equal(result.proposedActions[0]?.dryRun, true);
  assert.ok(result.issues.includes("action_0_not_dry_run"));
  assert.ok(result.issues.includes("action_0_missing_active_target"));
});

test("office workspace raw adapter coerces conceptual workspace questions back to reply", () => {
  const adapter = new OfficeWorkspaceRawQwenActionAdapter({ model: "office-candidate" });
  const result = adapter.parsePlan(
    JSON.stringify({
      proposedActions: [
        {
          type: "create_work_object",
          target: {
            workObjectId: "null"
          },
          payload: {
            instruction: "Comment structurer un document de migration ?"
          },
          dryRun: true
        }
      ]
    }),
    {
      request: workspaceRequest("Comment structurer un document de migration ?"),
      runtimeAnswer: "Structure le document en contexte, risques, plan et validation.",
      requestId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-05-29T08:00:00.000Z"
    }
  );

  assert.deepEqual(result.issues, []);
  assert.equal(result.proposedActions[0]?.type, "reply");
  assert.equal(result.proposedActions[0]?.target.workObjectId, null);
  assert.match(String(result.proposedActions[0]?.payload.content), /Structure/);
});

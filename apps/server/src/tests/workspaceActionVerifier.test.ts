import test from "node:test";
import assert from "node:assert/strict";
import { verifyPublicApiProposedActions } from "../services/publicApi/workspaceActionVerifier.js";
import {
  publicApiAskRequestSchema,
  publicApiProposedActionSchema,
  type PublicApiProposedAction
} from "../types/publicApi.js";

function action(partial: Partial<PublicApiProposedAction>): PublicApiProposedAction {
  return publicApiProposedActionSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    type: "workspace_tool_call",
    title: "Workspace action",
    target: {
      workObjectId: "sheet-1",
      entryPath: "table.csv"
    },
    payload: {
      instruction: "Applique une formule.",
      toolName: "sheet.apply_formula",
      operations: [
        {
          type: "sheet.set_formula",
          target: { cell: "D2" },
          formula: "=B2*C2"
        }
      ]
    },
    riskLevel: "medium",
    requiresConfirmation: true,
    dryRun: true,
    rationale: "Test action.",
    provenance: {
      source: "hydria_core_public_api_v1",
      requestId: "22222222-2222-4222-8222-222222222222",
      generatedAt: "2026-05-29T12:00:00.000Z"
    },
    ...partial
  });
}

test("workspace action verifier canonicalizes tuple operations and drops artifact parasites", () => {
  const request = publicApiAskRequestSchema.parse({
    input: "Applique =A2*B2 en A2.",
    metadata: {
      workspaceFamilyId: "data_spreadsheet"
    },
    workspaceContext: {
      activeWorkObject: {
        id: "sheet-1",
        title: "Ventes",
        kind: "dataset",
        workspaceFamilyId: "data_spreadsheet",
        entryPath: "table.csv",
        contentPreview: "{\"kind\":\"hydria-sheet\"}"
      },
      capabilities: {
        actions: ["workspace_tool_call", "create_artifact"],
        workspaceTools: ["sheet.apply_formula"],
        workObjectKinds: ["dataset"],
        artifactFormats: ["xlsx"]
      }
    }
  });

  const verified = verifyPublicApiProposedActions({
    request,
    actions: [
      action({
        payload: {
          instruction: "Applique =A2*B2 en A2.",
          toolName: "sheet.apply_formula",
          operations: [["A2", "=A2*B2"]]
        }
      }),
      action({
        id: "33333333-3333-4333-8333-333333333333",
        type: "create_artifact",
        title: "Bad competing artifact",
        target: {
          workObjectId: null,
          entryPath: null
        },
        payload: {
          instruction: "Applique =A2*B2 en A2.",
          format: "xlsx",
          kind: "dataset"
        },
        riskLevel: "low"
      })
    ]
  });

  assert.equal(verified.length, 1);
  assert.equal(verified[0]?.type, "workspace_tool_call");
  assert.equal(verified[0]?.payload.contractVersion, "workspace_tool_call.v1");
  assert.equal(verified[0]?.payload.toolName, "sheet.apply_formula");
  assert.equal((verified[0]?.payload.operations as any[])[0]?.type, "sheet.set_formula");
  assert.equal((verified[0]?.payload.operations as any[])[0]?.target.cell, "A2");
});

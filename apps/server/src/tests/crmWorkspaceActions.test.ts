import test from "node:test";
import assert from "node:assert/strict";
import { planPublicApiProposedActions } from "../services/publicApi/osActionPlanner.js";
import { verifyPublicApiProposedActions } from "../services/publicApi/workspaceActionVerifier.js";
import { publicApiAskRequestSchema } from "../types/publicApi.js";

function crmRequest(input: string) {
  return publicApiAskRequestSchema.parse({
    input,
    metadata: {
      workspaceFamilyId: "crm_sales"
    },
    workspaceContext: {
      activeWorkObject: {
        id: "crm-live",
        title: "Hydria CRM",
        kind: "app",
        workspaceFamilyId: "crm_sales",
        entryPath: "crm://live",
        contentPreview: JSON.stringify({
          kind: "hydria-crm",
          pipelineStages: [
            { id: "stage-new", name: "New" },
            { id: "stage-proposal", name: "Proposal" }
          ],
          recentDeals: [
            { id: "deal-atlas", name: "Migration Atlas" }
          ],
          recentCompanies: [{ id: "company-atlas", name: "Atlas" }],
          recentLeads: [{ id: "lead-jean", firstName: "Jean", lastName: "Dupont", email: "jean@example.com" }],
          openTasks: [{ id: "task-atlas", title: "Relancer Atlas", status: "TODO" }],
          products: [{ id: "product-audit", name: "Audit", sku: "AUDIT", unitPrice: 500 }]
        })
      },
      capabilities: {
        actions: ["workspace_tool_call", "create_artifact"],
        workspaceTools: [
          "crm.create_contact",
          "crm.create_company",
          "crm.create_lead",
          "crm.create_task",
          "crm.create_deal",
          "crm.update_deal_stage",
          "crm.update_lead",
          "crm.update_task",
          "crm.convert_lead",
          "crm.add_product_to_deal",
          "crm.create_quote",
          "crm.summarize_customer"
        ]
      },
      executionPolicy: {
        mode: "propose_only",
        requireConfirmation: false
      }
    }
  });
}

function plan(input: string) {
  const request = crmRequest(input);
  const actions = planPublicApiProposedActions({
    requestId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-06-09T12:00:00.000Z",
    request,
    answer: ""
  });
  return verifyPublicApiProposedActions({ request, actions });
}

test("CRM planner creates a canonical contact action in French", () => {
  const actions = plan("Ajoute un contact Jean Dupont email jean.dupont@example.com pour Atlas");
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.type, "workspace_tool_call");
  assert.equal(actions[0]?.payload.contractVersion, "workspace_tool_call.v1");
  assert.equal(actions[0]?.payload.toolName, "crm.create_contact");
  const operation = (actions[0]?.payload.operations as Array<Record<string, unknown>>)[0];
  assert.equal(operation?.type, "crm.create_contact");
  assert.equal(operation?.firstName, "Jean");
  assert.equal(operation?.lastName, "Dupont");
  assert.equal(operation?.email, "jean.dupont@example.com");
});

test("CRM planner moves an existing deal without creating an artifact", () => {
  const actions = plan("Move the deal Migration Atlas to Proposal");
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.type, "workspace_tool_call");
  assert.equal(actions[0]?.payload.toolName, "crm.update_deal_stage");
  const operation = (actions[0]?.payload.operations as Array<Record<string, unknown>>)[0];
  assert.equal(operation?.stageName, "Proposal");
  assert.deepEqual(operation?.target, { recordId: "deal-atlas" });
});

test("CRM planner converts a lead in French", () => {
  const actions = plan("Convertis le prospect Jean Dupont en client avec une opportunite");
  assert.equal(actions[0]?.payload.toolName, "crm.convert_lead");
  const operation = (actions[0]?.payload.operations as Array<Record<string, unknown>>)[0];
  assert.equal(operation?.type, "crm.convert_lead");
  assert.deepEqual(operation?.target, { recordId: "lead-jean" });
});

test("CRM planner creates a quote in English", () => {
  const actions = plan("Create a quote for the deal Migration Atlas");
  assert.equal(actions[0]?.payload.toolName, "crm.create_quote");
  const operation = (actions[0]?.payload.operations as Array<Record<string, unknown>>)[0];
  assert.equal(operation?.type, "crm.create_quote");
  assert.deepEqual(operation?.target, { recordId: "deal-atlas" });
});

test("CRM planner summarizes an existing customer without an artifact", () => {
  const actions = plan("Fais un resume du client Atlas");
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.payload.toolName, "crm.summarize_customer");
  assert.equal(actions.some((action) => action.type === "create_artifact"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelRoutingEconomicsGateReport,
  ModelRoutingGovernanceService
} from "../services/models/modelRoutingGovernanceService.js";
import { modelRoutingEconomicsEvalPack } from "../data/modelRoutingEconomicsEvalPack.js";

test("model routing economics gate passes the curated governance pack", () => {
  const report = buildModelRoutingEconomicsGateReport();

  assert.equal(report.version, "hydria-model-routing-economics-gate-v1");
  assert.equal(report.summary.totalCases, modelRoutingEconomicsEvalPack.length);
  assert.equal(report.passed, true);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.localOnlyViolations, 0);
  assert.equal(report.summary.unnecessaryEscalations, 0);
  assert.equal(report.summary.roleBreakdown.primary_brain > 0, true);
  assert.equal(report.summary.roleBreakdown.code_specialist > 0, true);
  assert.equal(report.summary.roleBreakdown.deep_reasoner > 0, true);
  assert.equal(report.summary.roleBreakdown.embedding > 0, true);
  assert.equal(report.summary.roleBreakdown.reranker > 0, true);
});

test("model routing governance keeps API definitions off the code specialist", () => {
  const service = new ModelRoutingGovernanceService();
  const result = service.evaluateCase(
    modelRoutingEconomicsEvalPack.find((caseDef) => caseDef.id === "chat_api_definition_primary_brain")!
  );

  assert.equal(result.status, "passed");
  assert.equal(result.selectedCapabilityId, "qwen-3b-standard-light");
  assert.equal(result.selectedRole, "primary_brain");
  assert.equal(result.issues.includes("forbidden_capability_selected:qwen-coder-code"), false);
});

test("model routing governance keeps simple rollback explanations off the deep reasoner", () => {
  const service = new ModelRoutingGovernanceService();
  const result = service.evaluateCase(
    modelRoutingEconomicsEvalPack.find((caseDef) => caseDef.id === "chat_simple_rollback_explanation_primary_brain")!
  );

  assert.equal(result.status, "passed");
  assert.equal(result.selectedCapabilityId, "qwen-14b-instruct-main");
  assert.equal(result.selectedRole, "primary_brain");
});

test("model routing governance escalates a writing-phrased strategic decision to the deep reasoner", () => {
  const service = new ModelRoutingGovernanceService();
  const result = service.evaluateCase(
    modelRoutingEconomicsEvalPack.find(
      (caseDef) => caseDef.id === "chat_strategic_decision_phrased_as_writing_request"
    )!
  );

  assert.equal(result.status, "passed");
  assert.equal(result.selectedCapabilityId, "qwen-14b-instruct-main");
  assert.equal(result.selectedRole, "deep_reasoner");
});

test("model routing governance detects estimated cost budget violations", () => {
  const service = new ModelRoutingGovernanceService();
  const baseCase = modelRoutingEconomicsEvalPack.find(
    (caseDef) => caseDef.id === "chat_strategic_conflict_deep_reasoner"
  )!;
  const result = service.evaluateCase({
    ...baseCase,
    expected: {
      ...baseCase.expected,
      maxEstimatedCostUnits: 0.1
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.issues.some((issue) => issue.startsWith("estimated_cost_exceeded")), true);
});

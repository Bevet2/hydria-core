import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelRolePreTrainingGateReport,
  modelRolePreTrainingGateCases
} from "../scripts/runModelRolePreTrainingGate.js";

test("model role pre-training gate covers every specialist role before training", () => {
  const report = buildModelRolePreTrainingGateReport();
  const roles = new Set(report.results.map((result) => result.role));

  assert.equal(report.version, "hydria-model-role-pretraining-gate-v1");
  assert.equal(report.purpose, "pre_training_role_readiness");
  assert.equal(report.summary.totalRoles, modelRolePreTrainingGateCases.length);
  assert.equal(roles.has("fast_router"), true);
  assert.equal(roles.has("primary_brain"), true);
  assert.equal(roles.has("code_specialist"), true);
  assert.equal(roles.has("deep_reasoner"), true);
  assert.equal(roles.has("writing_business"), true);
  assert.equal(roles.has("embedding"), true);
  assert.equal(roles.has("reranker"), true);
});

test("model role pre-training gate blocks training when a role has no local runtime target", () => {
  const report = buildModelRolePreTrainingGateReport();
  const reranker = report.results.find((result) => result.id === "reranker_bge");

  assert.ok(reranker);
  assert.equal(reranker.selectedId, "bge-reranker-retrieval");
  assert.equal(reranker.status, "blocked");
  assert.equal(reranker.issues.includes("runtime_target_missing"), true);
  assert.equal(report.summary.trainingAllowed, false);
});

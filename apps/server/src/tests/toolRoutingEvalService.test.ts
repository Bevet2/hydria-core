import test from "node:test";
import assert from "node:assert/strict";
import { ToolRoutingEvalService } from "../services/toolRoutingEvalService.js";

test("tool routing eval service reports expected pack accuracy", () => {
  const service = new ToolRoutingEvalService();
  const report = service.run(4);

  assert.equal(report.total, 4);
  assert.ok(report.passed >= 3);
  assert.ok(report.accuracyPct >= 75);
});

import test from "node:test";
import assert from "node:assert/strict";
import { retrievalRerankerMiniGatePack } from "../data/retrievalRerankerMiniGatePack.js";
import { buildRetrievalRerankerMiniGateReport } from "../scripts/runRetrievalRerankerMiniGate.js";
import { GovernedRerankerService } from "../services/retrieval/governedRerankerService.js";

test("retrieval reranker mini gate covers precision-oriented retrieval cases", () => {
  assert.equal(retrievalRerankerMiniGatePack.length >= 4, true);
  assert.ok(retrievalRerankerMiniGatePack.some((entry) => entry.id.includes("memory_rule")));
  assert.ok(retrievalRerankerMiniGatePack.some((entry) => entry.id.includes("source_selection")));
  assert.ok(retrievalRerankerMiniGatePack.every((entry) => entry.rejectedTopIds.length > 0));
});

test("retrieval reranker mini gate passes with deterministic fallback ranking", async () => {
  const report = await buildRetrievalRerankerMiniGateReport({
    service: new GovernedRerankerService({
      client: {
        isConfigured: () => false,
        rerank: async () => {
          throw new Error("not configured");
        }
      }
    })
  });

  assert.equal(report.version, "hydria-retrieval-reranker-mini-gate-v1");
  assert.equal(report.passed, true);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.fallbackUsed, report.summary.total);
});

test("retrieval reranker mini gate fails promotion mode when runtime is required but unused", async () => {
  const report = await buildRetrievalRerankerMiniGateReport({
    requireRuntime: true,
    service: new GovernedRerankerService({
      client: {
        isConfigured: () => false,
        rerank: async () => {
          throw new Error("not configured");
        }
      }
    })
  });

  assert.equal(report.passed, false);
  assert.ok(report.results.every((result) => result.issues.includes("runtime_not_used")));
});

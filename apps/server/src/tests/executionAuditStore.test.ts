import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import test from "node:test";
import { browserAutomationGatePack } from "../data/browserAutomationGatePack.js";
import { createExecutionRouter } from "../routes/execution.js";
import { BrowserAutomationPolicyService } from "../services/browser/browserAutomationPolicyService.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";

async function withExecutionAuditStore<T>(fn: (store: ExecutionAuditStore) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "hydria-execution-audit-"));
  try {
    return await fn(new ExecutionAuditStore({ filePath: join(dir, "audit.jsonl"), maxEvents: 100 }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function recordGateCase(store: ExecutionAuditStore, caseId: string) {
  const gateCase = browserAutomationGatePack.find((item) => item.id === caseId);
  assert.ok(gateCase, `Missing gate case ${caseId}`);
  const service = new BrowserAutomationPolicyService({
    auditStore: store,
    now: () => new Date("2026-05-20T10:00:00.000Z")
  });
  return service.plan(gateCase.request);
}

test("execution audit store persists sanitized events and builds read-only summaries", async () => {
  await withExecutionAuditStore(async (store) => {
    await recordGateCase(store, "cookie-session-secret-refused");
    await recordGateCase(store, "scrapling-fallback-after-parse-fail");

    const summary = await store.buildSummary({ limit: 20 });
    assert.equal(summary.window.eventCount, 2);
    assert.equal(summary.totals.sensitiveHeaderLeakCount, 0);
    assert.equal(summary.totals.realExecutionStepCount, 0);
    assert.equal(summary.totals.rollbackRequiredCount, 1);
    assert.equal(summary.byCapability.fetcher_scrapling?.count, 1);

    const headers = summary.recentEvents.flatMap((event) =>
      Object.keys(event.acquisitionScore?.responseHeaders ?? {})
    );
    assert.equal(headers.some((header) => /cookie|authorization|api-key/i.test(header)), false);

    const first = summary.recentEvents[0];
    assert.ok(first);
    const fetched = await store.getById(first.auditId);
    assert.equal(fetched?.auditId, first.auditId);
  });
});

test("execution audit router exposes only read-only summary and event lookup", async () => {
  await withExecutionAuditStore(async (store) => {
    await recordGateCase(store, "allowed-domain-navigation");
    const summary = await store.buildSummary();
    const auditId = summary.recentEvents[0]?.auditId;
    assert.ok(auditId);

    const app = express();
    app.use("/api/execution", createExecutionRouter(store, { requireApiKey: () => false }));
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected an ephemeral TCP test server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const summaryResponse = await fetch(`${baseUrl}/api/execution/audit?limit=10`);
      assert.equal(summaryResponse.status, 200);
      const body = (await summaryResponse.json()) as Awaited<ReturnType<ExecutionAuditStore["buildSummary"]>>;
      assert.equal(body.version, "hydria-execution-audit-v1");
      assert.equal(body.window.eventCount, 1);
      assert.equal(body.totals.realExecutionStepCount, 0);

      const eventResponse = await fetch(`${baseUrl}/api/execution/audit/${encodeURIComponent(auditId)}`);
      assert.equal(eventResponse.status, 200);
      const eventBody = (await eventResponse.json()) as { event: { auditId: string } };
      assert.equal(eventBody.event.auditId, auditId);

      const missingResponse = await fetch(`${baseUrl}/api/execution/audit/not-found`);
      assert.equal(missingResponse.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

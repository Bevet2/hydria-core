import test from "node:test";
import assert from "node:assert/strict";
import {
  ModelRuntimeGovernorService,
  type ModelRuntimeBudget
} from "../services/models/modelRuntimeGovernor.js";

const budget: ModelRuntimeBudget = {
  profile: "standard_chat",
  label: "test",
  reason: "test",
  timeoutMs: 1000,
  maxLatencyMs: 10,
  maxOutputTokens: 64,
  maxConcurrent: 1,
  fallbackDepth: 0,
  concurrencyKey: "test-key"
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("model runtime governor serializes calls by concurrency key", async () => {
  const governor = new ModelRuntimeGovernorService();
  let inFlight = 0;
  let maxInFlight = 0;

  const [first, second] = await Promise.all([
    governor.run(budget, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(20);
      inFlight -= 1;
      return "first";
    }),
    governor.run(budget, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight -= 1;
      return "second";
    })
  ]);

  assert.equal(maxInFlight, 1);
  assert.equal(first.result, "first");
  assert.equal(second.result, "second");
  assert.equal(second.queueMs > 0, true);
  assert.equal(first.budgetExceeded, true);
});

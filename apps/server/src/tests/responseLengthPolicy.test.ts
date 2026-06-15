import test from "node:test";
import assert from "node:assert/strict";
import { planResponseLength } from "../services/response/responseLengthPolicy.js";

test("response length policy allocates a real budget for explicit long-form requests", () => {
  const plan = planResponseLength(
    "Explique en profondeur, en au moins 900 mots, avec introduction, analyse et conclusion."
  );

  assert.equal(plan.mode, "long_form");
  assert.equal(plan.requestedMinimumWords, 900);
  assert.ok((plan.maxOutputTokens ?? 0) >= 1500);
  assert.match(plan.guidance.join(" "), /at least 900 words/i);
});

test("response length policy preserves explicit concise requests", () => {
  const plan = planResponseLength("Reponds en moins de 20 mots.");

  assert.equal(plan.mode, "concise");
  assert.equal(plan.maxOutputTokens, null);
});

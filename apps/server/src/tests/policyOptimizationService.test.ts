import test from "node:test";
import assert from "node:assert/strict";
import {
  policyOptimizationBaselineAbTraces,
  policyOptimizationCandidateAbTraces,
  policyOptimizationFailureTraces
} from "../data/policyOptimizationGatePack.js";
import { PolicyOptimizationService } from "../services/optimization/policyOptimizationService.js";

test("policy optimization generates guarded variants from failure traces", () => {
  const service = new PolicyOptimizationService({
    traceStore: {
      async listTraces() {
        return policyOptimizationFailureTraces;
      },
      async upsertVariants(variants) {
        return {
          version: "hydria-policy-optimization-variants-v1",
          generatedAt: new Date().toISOString(),
          variants
        };
      }
    }
  });
  const variants = service.generateVariants(policyOptimizationFailureTraces);
  const changeIds = variants.flatMap((variant) => variant.changes.map((change) => change.changeId));

  assert.equal(variants.length, 2);
  assert.equal(changeIds.includes("add-language-consistency-guard"), true);
  assert.equal(changeIds.includes("tighten-evidence-routing-threshold"), true);
  assert.equal(changeIds.includes("lower-runtime-budget-for-timeout-prone-route"), true);
  assert.equal(
    variants.every((variant) => variant.safeguards.some((safeguard) => /regressionCount/i.test(safeguard))),
    true
  );
});

test("policy optimization promotes only when A/B candidate has zero regression", () => {
  const service = new PolicyOptimizationService();
  const evaluation = service.evaluateVariant({
    variantId: "variant::clean",
    baselinePolicyId: "answerability-policy-v1",
    candidatePolicyId: "answerability-policy-v1-candidate",
    baselineTraces: policyOptimizationBaselineAbTraces,
    candidateTraces: policyOptimizationCandidateAbTraces
  });

  assert.equal(evaluation.regressionCount, 0);
  assert.equal(evaluation.promotionDecision.allowed, true);
  assert.equal(evaluation.promotionDecision.state, "promotable");
  assert.equal(evaluation.promotionDecision.requiresHumanApproval, true);
});

test("policy optimization blocks candidate when any metric regresses", () => {
  const service = new PolicyOptimizationService();
  const evaluation = service.evaluateVariant({
    variantId: "variant::regressed",
    baselinePolicyId: "answerability-policy-v1",
    candidatePolicyId: "answerability-policy-v1-regressed",
    baselineTraces: policyOptimizationCandidateAbTraces,
    candidateTraces: policyOptimizationBaselineAbTraces
  });

  assert.equal(evaluation.regressionCount > 0, true);
  assert.equal(evaluation.promotionDecision.allowed, false);
  assert.equal(evaluation.promotionDecision.state, "blocked");
});

import { createHash } from "node:crypto";
import type {
  OptimizationSurface,
  PolicyOptimizationTrace,
  PolicyVariantChange,
  PolicyVariantEvaluation,
  PolicyVariantMetrics,
  PolicyVariantProposal
} from "../../types/policyOptimization.js";
import { PolicyOptimizationTraceStore } from "./policyOptimizationTraceStore.js";

type PolicyOptimizationServiceOptions = {
  traceStore?: Pick<PolicyOptimizationTraceStore, "listTraces" | "upsertVariants">;
};

function rate(count: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return Number(((count / total) * 100).toFixed(2));
}

function avg(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function stableId(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function tracesMetrics(traces: PolicyOptimizationTrace[]): PolicyVariantMetrics {
  return {
    caseCount: traces.length,
    passRate: rate(traces.filter((trace) => trace.metrics.passed).length, traces.length),
    averageQualityScore: avg(traces.map((trace) => trace.metrics.qualityScore)),
    averageLatencyMs: avg(traces.map((trace) => trace.metrics.latencyMs)),
    averageEstimatedCostUnits: avg(traces.map((trace) => trace.metrics.estimatedCostUnits)),
    retryRate: rate(
      traces.filter((trace) => trace.metrics.retryCount > 0).length,
      traces.length
    ),
    fallbackRate: rate(
      traces.filter((trace) => trace.metrics.fallbackUsed).length,
      traces.length
    ),
    safetyRegressionCount: traces.reduce(
      (sum, trace) => sum + trace.metrics.regressionLabels.filter((label) => /unsafe|safety|leak/i.test(label)).length,
      0
    )
  };
}

function variantChangeForFailure(label: string): PolicyVariantChange {
  if (/wrong_language|language/i.test(label)) {
    return {
      changeId: "add-language-consistency-guard",
      target: "prompt_policy.language",
      operation: "add_instruction",
      description: "Force same-language answers and add targeted retry when observed language mismatches the prompt.",
      expectedImpact: "Reduce wrong-language regressions without changing routing."
    };
  }
  if (/tool|source|research|evidence/i.test(label)) {
    return {
      changeId: "tighten-evidence-routing-threshold",
      target: "answerability.evidence_requirement",
      operation: "tighten_threshold",
      description: "Require external evidence only when the answer depends on live/source-backed data.",
      expectedImpact: "Reduce missing tools and false-positive research routes."
    };
  }
  if (/timeout|fallback|latency/i.test(label)) {
    return {
      changeId: "lower-runtime-budget-for-timeout-prone-route",
      target: "model_runtime.budget",
      operation: "lower_budget",
      description: "Route timeout-prone low-risk prompts to lighter local specialists before heavy models.",
      expectedImpact: "Reduce fallback and retry rates under CPU VPS constraints."
    };
  }
  if (/hallucination|current|live/i.test(label)) {
    return {
      changeId: "add-live-data-abstain-guard",
      target: "answerability.live_data_policy",
      operation: "abstain_guard",
      description: "Abstain or require source-backed evidence for current/live claims.",
      expectedImpact: "Reduce live-data hallucination risk."
    };
  }
  return {
    changeId: "add-specificity-and-decision-guard",
    target: "prompt_policy.answer_shape",
    operation: "add_instruction",
    description: "Require the answer to use the decisive constraint and make a concrete recommendation when asked.",
    expectedImpact: "Reduce generic answers while preserving response style."
  };
}

function dominantSurface(traces: PolicyOptimizationTrace[]): OptimizationSurface {
  const counts = new Map<OptimizationSurface, number>();
  for (const trace of traces) {
    counts.set(trace.surface, (counts.get(trace.surface) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "policy";
}

function uniqueChanges(changes: PolicyVariantChange[]) {
  const byId = new Map<string, PolicyVariantChange>();
  for (const change of changes) {
    byId.set(change.changeId, change);
  }
  return [...byId.values()];
}

function allFailureLabels(traces: PolicyOptimizationTrace[]) {
  return [
    ...new Set(
      traces.flatMap((trace) =>
        trace.metrics.regressionLabels.length > 0
          ? trace.metrics.regressionLabels
          : trace.metrics.passed
            ? []
            : ["generic_failure"]
      )
    )
  ];
}

function compareMetrics(args: {
  baseline: PolicyVariantMetrics;
  candidate: PolicyVariantMetrics;
}) {
  const regressions: string[] = [];
  if (args.candidate.caseCount < args.baseline.caseCount) {
    regressions.push("candidate_case_coverage_regressed");
  }
  if (args.candidate.passRate < args.baseline.passRate) {
    regressions.push("pass_rate_regressed");
  }
  if (args.candidate.averageQualityScore < args.baseline.averageQualityScore) {
    regressions.push("quality_score_regressed");
  }
  if (args.candidate.averageLatencyMs > args.baseline.averageLatencyMs) {
    regressions.push("latency_regressed");
  }
  if (args.candidate.averageEstimatedCostUnits > args.baseline.averageEstimatedCostUnits) {
    regressions.push("cost_regressed");
  }
  if (args.candidate.retryRate > args.baseline.retryRate) {
    regressions.push("retry_rate_regressed");
  }
  if (args.candidate.fallbackRate > args.baseline.fallbackRate) {
    regressions.push("fallback_rate_regressed");
  }
  if (args.candidate.safetyRegressionCount > args.baseline.safetyRegressionCount) {
    regressions.push("safety_regressed");
  }
  return regressions;
}

export class PolicyOptimizationService {
  private readonly traceStore: Pick<PolicyOptimizationTraceStore, "listTraces" | "upsertVariants">;

  constructor(options: PolicyOptimizationServiceOptions = {}) {
    this.traceStore = options.traceStore ?? new PolicyOptimizationTraceStore();
  }

  async generateVariantsFromRecentTraces(limit = 1000) {
    const traces = await this.traceStore.listTraces(limit);
    const variants = this.generateVariants(traces);
    if (variants.length > 0) {
      await this.traceStore.upsertVariants(variants);
    }
    return variants;
  }

  generateVariants(traces: PolicyOptimizationTrace[]) {
    const failed = traces.filter(
      (trace) => !trace.metrics.passed || trace.metrics.regressionLabels.length > 0
    );
    if (failed.length === 0) {
      return [];
    }
    const grouped = new Map<string, PolicyOptimizationTrace[]>();
    for (const trace of failed) {
      grouped.set(trace.policyId, [...(grouped.get(trace.policyId) ?? []), trace]);
    }
    return [...grouped.entries()].map(([targetPolicyId, policyTraces]) => {
      const labels = allFailureLabels(policyTraces);
      const changes = uniqueChanges(labels.map(variantChangeForFailure)).slice(0, 6);
      const surface = dominantSurface(policyTraces);
      const variantId = `variant::${targetPolicyId}::${stableId([
        targetPolicyId,
        surface,
        ...changes.map((change) => change.changeId)
      ])}`;
      return {
        variantId,
        createdAt: new Date().toISOString(),
        sourceTraceIds: policyTraces.map((trace) => trace.traceId).slice(0, 200),
        targetPolicyId,
        surface,
        state: "candidate",
        hypothesis: `Repair ${labels.slice(0, 5).join(", ")} for ${targetPolicyId} without changing the production baseline.`,
        riskLevel: changes.some((change) => change.operation === "reroute" || change.operation === "raise_budget")
          ? "medium"
          : "low",
        changes,
        safeguards: [
          "A/B gate must compare against the current baseline.",
          "Promotion is blocked if regressionCount is greater than 0.",
          "No automatic production activation from this service."
        ]
      } satisfies PolicyVariantProposal;
    });
  }

  evaluateVariant(args: {
    variantId: string;
    baselinePolicyId: string;
    candidatePolicyId: string;
    baselineTraces: PolicyOptimizationTrace[];
    candidateTraces: PolicyOptimizationTrace[];
  }): PolicyVariantEvaluation {
    const baseline = tracesMetrics(args.baselineTraces);
    const candidate = tracesMetrics(args.candidateTraces);
    const regressions = compareMetrics({ baseline, candidate });
    const improvement =
      candidate.passRate > baseline.passRate ||
      candidate.averageQualityScore > baseline.averageQualityScore ||
      candidate.retryRate < baseline.retryRate ||
      candidate.fallbackRate < baseline.fallbackRate;
    const allowed = regressions.length === 0 && improvement;

    return {
      version: "hydria-policy-variant-evaluation-v1",
      generatedAt: new Date().toISOString(),
      variantId: args.variantId,
      baselinePolicyId: args.baselinePolicyId,
      candidatePolicyId: args.candidatePolicyId,
      baseline,
      candidate,
      regressionCount: regressions.length,
      regressions,
      promotionDecision: {
        allowed,
        state: allowed ? "promotable" : "blocked",
        reason: allowed
          ? "Candidate improves at least one metric and has zero regressions."
          : regressions.length > 0
            ? `Promotion blocked by regressions: ${regressions.join(", ")}.`
            : "Promotion blocked because the candidate does not clearly improve the baseline.",
        requiresHumanApproval: true
      }
    };
  }
}

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  policyOptimizationBaselineAbTraces,
  policyOptimizationCandidateAbTraces,
  policyOptimizationFailureTraces
} from "../data/policyOptimizationGatePack.js";
import { PolicyOptimizationService } from "../services/optimization/policyOptimizationService.js";
import { PolicyOptimizationTraceStore } from "../services/optimization/policyOptimizationTraceStore.js";

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "policy-optimization-gate-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput)
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runPolicyOptimizationGate(args = parseArgs()) {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-policy-optimization-gate-"));
  try {
    const traceStore = new PolicyOptimizationTraceStore(
      join(tempRoot, "traces.jsonl"),
      join(tempRoot, "variants.json")
    );
    await traceStore.appendTraces(policyOptimizationFailureTraces);
    const service = new PolicyOptimizationService({ traceStore });
    const variants = await service.generateVariantsFromRecentTraces();
    const registry = await traceStore.loadVariantRegistry();
    const evaluation = service.evaluateVariant({
      variantId: variants[0]?.variantId ?? "variant::missing",
      baselinePolicyId: "answerability-policy-v1",
      candidatePolicyId: "answerability-policy-v1-candidate",
      baselineTraces: policyOptimizationBaselineAbTraces,
      candidateTraces: policyOptimizationCandidateAbTraces
    });
    const negativeEvaluation = service.evaluateVariant({
      variantId: "variant::regression-control",
      baselinePolicyId: "answerability-policy-v1",
      candidatePolicyId: "answerability-policy-v1-regressed",
      baselineTraces: policyOptimizationCandidateAbTraces,
      candidateTraces: policyOptimizationBaselineAbTraces
    });
    const issues: string[] = [];

    if (variants.length < 2) {
      issues.push("not_enough_variants_generated");
    }
    if (!variants.some((variant) => variant.changes.some((change) => change.changeId === "add-language-consistency-guard"))) {
      issues.push("missing_language_variant");
    }
    if (!variants.some((variant) => variant.changes.some((change) => change.changeId === "tighten-evidence-routing-threshold"))) {
      issues.push("missing_tool_or_evidence_variant");
    }
    if (!variants.some((variant) => variant.changes.some((change) => change.changeId === "lower-runtime-budget-for-timeout-prone-route"))) {
      issues.push("missing_runtime_budget_variant");
    }
    if (registry.variants.length !== variants.length) {
      issues.push("variant_registry_not_persisted");
    }
    if (!evaluation.promotionDecision.allowed || evaluation.regressionCount !== 0) {
      issues.push("clean_candidate_not_promotable");
    }
    if (negativeEvaluation.promotionDecision.allowed || negativeEvaluation.regressionCount === 0) {
      issues.push("regressed_candidate_not_blocked");
    }
    if (!evaluation.promotionDecision.requiresHumanApproval) {
      issues.push("promotion_missing_human_approval");
    }

    const report = {
      version: "hydria-policy-optimization-gate-v1",
      generatedAt: new Date().toISOString(),
      passed: issues.length === 0,
      summary: {
        failureTraceCount: policyOptimizationFailureTraces.length,
        variantsGenerated: variants.length,
        persistedVariants: registry.variants.length,
        cleanCandidatePromotable: evaluation.promotionDecision.allowed,
        regressionCandidateBlocked: !negativeEvaluation.promotionDecision.allowed,
        issues
      },
      variants,
      evaluation,
      negativeEvaluation
    };
    await writeJson(args.output, report);
    return report;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? "") === currentFilePath) {
  runPolicyOptimizationGate()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            summary: report.summary,
            output: parseArgs().output
          },
          null,
          2
        )
      );
      if (!report.passed) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

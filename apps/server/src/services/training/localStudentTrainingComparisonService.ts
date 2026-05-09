import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  localStudentComparisonReportSchema,
  localStudentTrainingBaselineReportSchema,
  type LocalStudentComparisonReport,
  type LocalStudentTrainingBaselineReport
} from "../../types/training.js";
import { projectRoot } from "../../utils/env.js";
import { LocalStudentTrainingBaselineService } from "./localStudentTrainingBaselineService.js";
import { LocalStudentVariantRegistry } from "./localStudentVariantRegistry.js";

type CompareLocalStudentVariantArgs = {
  beforeBaselineFile: string;
  afterVariantId: string;
  outputFile?: string;
  promoteIfGood?: boolean;
};

function delta(after: number, before: number) {
  return Math.round((after - before) * 10) / 10;
}

function defaultComparisonFile(afterVariantId: string) {
  return resolve(projectRoot, "storage", "training", `${afterVariantId}-comparison-v1.json`);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

export class LocalStudentTrainingComparisonService {
  private readonly variantRegistry = new LocalStudentVariantRegistry();

  constructor(private readonly baselineService: LocalStudentTrainingBaselineService) {}

  async run(
    args: CompareLocalStudentVariantArgs
  ): Promise<{ report: LocalStudentComparisonReport; outputFile: string }> {
    const before = await this.readBaseline(args.beforeBaselineFile);
    const afterRun = await this.baselineService.run({
      variantId: args.afterVariantId,
      persistRegistry: false
    });
    const outputFile = args.outputFile
      ? resolve(args.outputFile)
      : defaultComparisonFile(args.afterVariantId);

    const report = this.compareReports(before, afterRun.report);
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    await this.variantRegistry.ensureBaseVariant();
    const existing = await this.variantRegistry.getVariant(args.afterVariantId);
    if (existing) {
      const action = args.promoteIfGood ? report.decision.action : existing.state;
      if (args.promoteIfGood) {
        const nextState =
          action === "promote"
            ? "active"
            : action === "guard"
              ? "guarded"
              : action === "reject"
                ? "rejected"
                : existing.state;
        await this.variantRegistry.updateVariantState(args.afterVariantId, nextState, {
          comparisonFile: outputFile,
          confidenceScore: this.deriveConfidence(report),
          notes: [...existing.notes, `Comparison decision: ${report.decision.reason}`].slice(-8)
        });
      } else {
        await this.variantRegistry.updateVariantState(args.afterVariantId, existing.state, {
          comparisonFile: outputFile,
          confidenceScore: this.deriveConfidence(report),
          notes: [...existing.notes].slice(-8)
        });
      }
    }

    return { report, outputFile };
  }

  compareReports(
    before: LocalStudentTrainingBaselineReport,
    after: LocalStudentTrainingBaselineReport
  ): LocalStudentComparisonReport {
    const deltas = {
      temporalExplicitDateAnchoringRate: delta(
        after.temporalReplay.explicitDateAnchoringRate,
        before.temporalReplay.explicitDateAnchoringRate
      ),
      temporalStaleAbstentionRate: delta(
        after.temporalReplay.staleAbstentionRate,
        before.temporalReplay.staleAbstentionRate
      ),
      temporalAnswerChangedRate: delta(
        after.temporalReplay.answerChangedRate,
        before.temporalReplay.answerChangedRate
      ),
      stabilityStrictRate: delta(after.stability.strictRate, before.stability.strictRate),
      stabilityFallbackRate: delta(after.stability.fallbackRate, before.stability.fallbackRate),
      stabilityRetryRate: delta(after.stability.retryRate, before.stability.retryRate),
      liveAverageSessionScore: delta(after.live.averageSessionScore, before.live.averageSessionScore),
      liveAverageDeltaOverall: delta(after.live.averageDeltaOverall, before.live.averageDeltaOverall),
      liveImprovedRate: delta(after.live.improvedRate, before.live.improvedRate),
      liveWorthItRate: delta(after.live.worthItRate, before.live.worthItRate),
      livePositiveToolImpactRate: delta(
        after.live.positiveToolImpactRate,
        before.live.positiveToolImpactRate
      ),
      toolRoutingAccuracyPct: delta(after.toolRouting.accuracyPct, before.toolRouting.accuracyPct)
    };

    const regressionScore = clampScore(
      Math.round(
      Math.max(0, deltas.stabilityFallbackRate) * 2 +
        Math.max(0, -deltas.stabilityStrictRate) +
        Math.max(0, -deltas.temporalStaleAbstentionRate) +
        Math.max(0, -deltas.liveAverageSessionScore) * 3 +
        Math.max(0, -deltas.liveImprovedRate) +
        Math.max(0, -deltas.liveWorthItRate) +
        Math.max(0, -deltas.livePositiveToolImpactRate) +
        Math.max(0, -deltas.toolRoutingAccuracyPct) * 5
      )
    );
    const gainScore = clampScore(
      Math.round(
      Math.max(0, deltas.stabilityStrictRate) +
        Math.max(0, -deltas.stabilityFallbackRate) * 2 +
        Math.max(0, deltas.temporalExplicitDateAnchoringRate) +
        Math.max(0, deltas.temporalStaleAbstentionRate) +
        Math.max(0, deltas.liveAverageSessionScore) * 3 +
        Math.max(0, deltas.liveImprovedRate) +
        Math.max(0, deltas.liveWorthItRate) +
        Math.max(0, deltas.livePositiveToolImpactRate)
      )
    );

    let action: LocalStudentComparisonReport["decision"]["action"] = "keep_validating";
    let reason = "Variant needs more evidence before it can replace the governed baseline.";

    const hardRegression =
      deltas.stabilityFallbackRate > 10 ||
      deltas.liveAverageSessionScore < -3 ||
      deltas.liveImprovedRate < -10 ||
      deltas.toolRoutingAccuracyPct < 0;

    if (hardRegression) {
      action = "reject";
      reason = "Variant regressed on structure stability or live teaching quality.";
    } else if (
      gainScore >= 18 &&
      regressionScore <= 6 &&
      deltas.stabilityFallbackRate <= 0 &&
      deltas.liveAverageSessionScore >= 1
    ) {
      action = "promote";
      reason = "Variant improved live quality without harming structure stability or tool safety.";
    } else if (gainScore >= 8 && regressionScore <= 12) {
      action = "guard";
      reason = "Variant shows partial gains but still needs guarded monitoring before activation.";
    }

    return localStudentComparisonReportSchema.parse({
      version: "hydria-local-student-comparison-v1",
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
      beforeVariantId: before.variantId,
      afterVariantId: after.variantId,
      beforeModelName: before.modelName,
      afterModelName: after.modelName,
      before,
      after,
      deltas,
      decision: {
        action,
        gainScore,
        regressionScore,
        reason
      }
    });
  }

  private deriveConfidence(report: LocalStudentComparisonReport) {
    const raw = 0.4 + report.decision.gainScore / 100 - report.decision.regressionScore / 150;
    return Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
  }

  private async readBaseline(filePath: string) {
    const raw = await readFile(resolve(filePath), "utf8");
    return localStudentTrainingBaselineReportSchema.parse(JSON.parse(raw));
  }
}

export type { CompareLocalStudentVariantArgs };

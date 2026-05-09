import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalModelService } from "../localModel.js";
import { ResearchToolService } from "../researchToolService.js";
import {
  StudentTemporalEvalService,
  type StudentTemporalEvalReport
} from "../studentTemporalEvalService.js";
import { ToolRoutingEvalService } from "../toolRoutingEvalService.js";
import {
  localStudentTrainingBaselineReportSchema,
  type LocalStudentTrainingBaselineReport
} from "../../types/training.js";
import { env, projectRoot } from "../../utils/env.js";
import { LocalStudentStabilityEvalService } from "./localStudentStabilityEvalService.js";
import { LocalStudentLiveEvalService } from "./localStudentLiveEvalService.js";
import { LocalStudentVariantRegistry } from "./localStudentVariantRegistry.js";

type RunLocalStudentTrainingBaselineArgs = {
  variantId?: string;
  outputFile?: string;
  persistRegistry?: boolean;
};

function defaultBaselineFile(variantId: string) {
  return resolve(projectRoot, "storage", "training", `${variantId}-baseline-v1.json`);
}

export class LocalStudentTrainingBaselineService {
  private readonly variantRegistry = new LocalStudentVariantRegistry();

  constructor(private readonly localModelService: LocalModelService) {}

  async run(
    args: RunLocalStudentTrainingBaselineArgs = {}
  ): Promise<{ report: LocalStudentTrainingBaselineReport; outputFile: string }> {
    const variantId = args.variantId ?? "student-local-base";
    const outputFile = args.outputFile ? resolve(args.outputFile) : defaultBaselineFile(variantId);

    const temporalReplay = await this.runTemporalReplay();
    const toolRouting = new ToolRoutingEvalService().run();
    const stability = await new LocalStudentStabilityEvalService(this.localModelService).run();
    const live = await new LocalStudentLiveEvalService(this.localModelService).run();

    const report = localStudentTrainingBaselineReportSchema.parse({
      version: "hydria-local-student-baseline-v1",
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
      variantId,
      modelName: this.localModelService.getConfiguredModelName(),
      temporalReplay: {
        totalCases: temporalReplay.summary.totalCases,
        queryTypeMatchRate: temporalReplay.summary.queryTypeMatchRate,
        researchUsedRate: temporalReplay.summary.researchUsedRate,
        freshnessSatisfiedRate: temporalReplay.summary.freshnessSatisfiedRate,
        noReliableSourceRate: temporalReplay.summary.noReliableSourceRate,
        explicitDateAnchoringRate: temporalReplay.summary.explicitDateAnchoringRate,
        staleAbstentionRate: temporalReplay.summary.staleAbstentionRate,
        answerChangedRate: temporalReplay.summary.answerChangedRate,
        averageDurationMs: temporalReplay.summary.averageDurationMs
      },
      toolRouting: {
        total: toolRouting.total,
        passed: toolRouting.passed,
        accuracyPct: toolRouting.accuracyPct
      },
      stability,
      live
    });

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    if (args.persistRegistry ?? true) {
      const existing = await this.variantRegistry.getVariant(variantId);
      await this.variantRegistry.registerVariant({
        id: variantId,
        name: existing?.name ?? (variantId === "student-local-base" ? "Student Local Base" : variantId),
        description:
          existing?.description ??
          (variantId === "student-local-base"
            ? "Baseline governed local student variant."
            : `Governed local student variant ${variantId}.`),
        servedModelName: report.modelName,
        baseModelName: existing?.baseModelName ?? report.modelName,
        adapterPath: existing?.adapterPath ?? null,
        trainingPackFile: existing?.trainingPackFile ?? null,
        baselineFile: outputFile,
        comparisonFile: existing?.comparisonFile ?? null,
        confidenceScore: existing?.confidenceScore ?? (variantId === "student-local-base" ? 0.85 : 0.5),
        notes: existing?.notes ?? [],
        state: existing?.state ?? (variantId === "student-local-base" ? "active" : "candidate")
      });
    }

    return { report, outputFile };
  }

  private async runTemporalReplay(): Promise<StudentTemporalEvalReport> {
    const researchToolService = new ResearchToolService({
      acquisitionMode: "replay",
      fixtureFile: env.RESEARCH_EVAL_FIXTURE_FILE,
      sourceCacheEnabled: false
    });
    const temporalEvalService = new StudentTemporalEvalService(
      this.localModelService,
      researchToolService
    );

    return temporalEvalService.run({
      acquisitionMode: "replay",
      fixtureFile: env.RESEARCH_EVAL_FIXTURE_FILE,
      sourceCacheEnabled: false,
      continueOnError: true
    });
  }
}

export type { RunLocalStudentTrainingBaselineArgs };

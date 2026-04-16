import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { OFFICIAL_BASELINE_RUN_ID } from "../data/officialBaseline.js";
import {
  benchmarkPromptResultSchema,
  type BenchmarkRun
} from "../types/benchmark.js";
import { knowledgeLayerSchema } from "../types/knowledge.js";
import {
  roundDatasetEntrySchema,
  type RoundDatasetEntry
} from "../types/roundDataset.js";
import { env } from "../utils/env.js";
import { buildLegacyOrchestrationPolicy } from "./orchestrationPolicy.js";
import { buildCategoryInsight } from "./knowledge/insights.js";
import {
  average,
  defaultDatasetResearch,
  knowledgeCategories,
  median
} from "./knowledge/common.js";
import {
  buildContrastiveStudentExamples,
  buildCuratedStudentExamples
} from "./knowledge/studentExamples.js";

export class KnowledgeLayerService {
  constructor(
    private readonly benchmarkRunsFile = env.BENCHMARK_RUNS_FILE,
    private readonly roundDatasetFile = env.ROUND_DATASET_FILE,
    private readonly knowledgeFile = env.KNOWLEDGE_LAYER_FILE,
    private readonly curatedStudentDatasetFile = env.STUDENT_CURATED_DATASET_FILE,
    private readonly contrastiveStudentDatasetFile = env.STUDENT_CONTRASTIVE_DATASET_FILE
  ) {}

  async loadKnowledgeLayer() {
    try {
      const raw = await readFile(this.knowledgeFile, "utf8");
      return knowledgeLayerSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async buildAndPersist() {
    const benchmarkRuns = await this.readBenchmarkRuns();
    const roundDatasetEntries = await this.readRoundDatasetEntries();
    const categoryInsights = knowledgeCategories.map((category) =>
      buildCategoryInsight(category, benchmarkRuns, roundDatasetEntries)
    );
    const curatedStudentExamples = buildCuratedStudentExamples(
      roundDatasetEntries,
      categoryInsights
    );
    const contrastiveStudentExamples = buildContrastiveStudentExamples(
      curatedStudentExamples,
      roundDatasetEntries,
      categoryInsights
    );

    const coreRuns = benchmarkRuns.filter(
      (run) => run.status === "completed" && run.benchmarkId !== "tool-benchmark-v1"
    );
    const coreResults = coreRuns
      .flatMap((run) => run.results)
      .filter((result) => result.status === "completed");
    const sortedCategoryInsights = [...categoryInsights]
      .filter((entry) => entry.category !== "other")
      .sort((left, right) => right.benchmark.averageGain - left.benchmark.averageGain);

    const knowledgeLayer = knowledgeLayerSchema.parse({
      version: "hydria-knowledge-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        benchmarkRunsAnalyzed: benchmarkRuns.length,
        benchmarkPromptResultsAnalyzed: benchmarkRuns.reduce(
          (sum, run) => sum + run.results.length,
          0
        ),
        roundDatasetEntriesAnalyzed: roundDatasetEntries.length,
        curatedStudentExamples: curatedStudentExamples.length
      },
      globalSummary: {
        officialBaselineRunId: OFFICIAL_BASELINE_RUN_ID,
        averageCoreGain: average(coreResults.map((result) => result.globalGain ?? 0)),
        medianCoreGain: median(coreResults.map((result) => result.globalGain ?? 0)),
        strongestCategories: sortedCategoryInsights.slice(0, 3).map((entry) => entry.category),
        weakestCategories: [...sortedCategoryInsights]
          .sort((left, right) => left.benchmark.averageGain - right.benchmark.averageGain)
          .slice(0, 3)
          .map((entry) => entry.category),
        note: "Offline knowledge layer built from stored benchmark runs and curated round datasets. Use it to steer routing and student preparation without calling external APIs."
      },
      categories: categoryInsights
    });

    await mkdir(dirname(this.knowledgeFile), { recursive: true });
    await writeFile(this.knowledgeFile, `${JSON.stringify(knowledgeLayer, null, 2)}\n`, "utf8");

    const curatedLines = curatedStudentExamples.map((entry) => JSON.stringify(entry)).join("\n");
    await mkdir(dirname(this.curatedStudentDatasetFile), { recursive: true });
    await writeFile(
      this.curatedStudentDatasetFile,
      curatedLines.length > 0 ? `${curatedLines}\n` : "",
      "utf8"
    );

    const contrastiveLines = contrastiveStudentExamples
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    await mkdir(dirname(this.contrastiveStudentDatasetFile), { recursive: true });
    await writeFile(
      this.contrastiveStudentDatasetFile,
      contrastiveLines.length > 0 ? `${contrastiveLines}\n` : "",
      "utf8"
    );

    return {
      knowledgeLayer,
      curatedStudentExamples,
      contrastiveStudentExamples
    };
  }

  private async readBenchmarkRuns() {
    try {
      const raw = await readFile(this.benchmarkRunsFile, "utf8");
      const parsed = JSON.parse(raw) as { runs?: unknown[] };
      return (parsed.runs ?? [])
        .filter((entry) => typeof entry === "object" && entry !== null)
        .map((entry) => {
          const current = entry as Record<string, unknown>;
          return {
            ...(current as unknown as BenchmarkRun),
            results: Array.isArray(current.results)
              ? current.results.map((result) => benchmarkPromptResultSchema.parse(result))
              : []
          } as BenchmarkRun;
        });
    } catch {
      return [] as BenchmarkRun[];
    }
  }

  private async readRoundDatasetEntries() {
    try {
      const raw = await readFile(this.roundDatasetFile, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseRoundDatasetEntry(line));
    } catch {
      return [] as RoundDatasetEntry[];
    }
  }
}

function parseRoundDatasetEntry(line: string) {
  const current = JSON.parse(line) as Record<string, unknown>;
  const rawResearch =
    typeof current.research === "object" && current.research !== null
      ? (current.research as Record<string, unknown>)
      : {};
  const question = typeof current.question === "string" ? current.question : "";

  return roundDatasetEntrySchema.parse({
    ...current,
    orchestration:
      typeof current.orchestration === "object" && current.orchestration !== null
        ? current.orchestration
        : buildLegacyOrchestrationPolicy(question),
    research: {
      ...defaultDatasetResearch,
      ...rawResearch,
      decision: {
        ...defaultDatasetResearch.decision,
        ...(typeof rawResearch.decision === "object" && rawResearch.decision !== null
          ? (rawResearch.decision as Record<string, unknown>)
          : {})
      },
      queryPlan: {
        ...defaultDatasetResearch.queryPlan,
        ...(typeof rawResearch.queryPlan === "object" && rawResearch.queryPlan !== null
          ? (rawResearch.queryPlan as Record<string, unknown>)
          : {})
      },
      verification: {
        ...defaultDatasetResearch.verification,
        ...(typeof rawResearch.verification === "object" && rawResearch.verification !== null
          ? (rawResearch.verification as Record<string, unknown>)
          : {})
      },
      appliedTo: {
        ...defaultDatasetResearch.appliedTo,
        ...(typeof rawResearch.appliedTo === "object" && rawResearch.appliedTo !== null
          ? (rawResearch.appliedTo as Record<string, unknown>)
          : {})
      },
      impact: {
        ...defaultDatasetResearch.impact,
        ...(typeof rawResearch.impact === "object" && rawResearch.impact !== null
          ? (rawResearch.impact as Record<string, unknown>)
          : {})
      }
    }
  });
}

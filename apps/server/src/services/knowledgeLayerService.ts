import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { OFFICIAL_BASELINE_RUN_ID } from "../data/officialBaseline.js";
import {
  benchmarkPromptResultSchema,
  type BenchmarkPromptResult,
  type BenchmarkRun
} from "../types/benchmark.js";
import {
  type QuestionCategory
} from "../types/arena.js";
import {
  knowledgeLayerSchema,
  studentCuratedExampleSchema,
  type KnowledgeCategoryInsight,
  type KnowledgeCategoryStrategy,
  type KnowledgePattern
} from "../types/knowledge.js";
import {
  roundDatasetEntrySchema,
  type RoundDatasetEntry
} from "../types/roundDataset.js";
import { env } from "../utils/env.js";

const knowledgeCategories = [
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning",
  "other"
] as const satisfies QuestionCategory[];

type PatternDefinition = {
  label: string;
  matchers: RegExp[];
};

type SideSample = {
  slot: "A" | "B";
  gain: number;
  qualityScore: number;
  riskScore: number;
  directCritiques: number;
  structuralRiskCount: number;
  executed: boolean;
  useful: boolean;
  weak: boolean;
};

const positivePatternDefinitions: PatternDefinition[] = [
  {
    label: "Make step ordering and execution sequence explicit.",
    matchers: [/step ordering/i, /\bsequence/i, /\bphase\b/i, /\broadmap\b/i, /\bpriorit/i]
  },
  {
    label: "Preserve evidence and name concrete validation checks.",
    matchers: [
      /\bevidence\b/i,
      /\bforensic/i,
      /\baudit/i,
      /\bvalidate/i,
      /\bhealth check/i,
      /\brollback/i
    ]
  },
  {
    label: "State assumptions, constraints, and uncertainties explicitly.",
    matchers: [/\bassumption/i, /\bconstraint/i, /\buncertain/i, /\bdepends\b/i, /\blimit/i]
  },
  {
    label: "Add concrete risks, dependencies, and fallback conditions.",
    matchers: [/\brisk/i, /\bdependency/i, /\bfallback/i, /\bcontingency/i, /\bcutover/i]
  },
  {
    label: "Add metrics, success criteria, or validation signals.",
    matchers: [/\bmetric/i, /\bsuccess/i, /\bkpi/i, /\bvalidation signal/i, /\badoption/i]
  },
  {
    label: "Clarify tradeoffs instead of presenting one perfect answer.",
    matchers: [/\btrade[- ]?off/i, /\balternative/i, /\bcompromise/i, /\bwhere supported/i]
  },
  {
    label: "Reduce hallucination risk by qualifying provider- or context-specific claims.",
    matchers: [/\bprovider\b/i, /\bcontext\b/i, /\bplatform limitation/i, /\bwhere supported/i]
  },
  {
    label: "Improve pedagogy with examples, contrasts, and clearer definitions.",
    matchers: [/\bexample/i, /\bcontrast/i, /\bdefinition/i, /\bclarif/i]
  }
];

const negativePatternDefinitions: PatternDefinition[] = [
  {
    label: "Avoid generic best-practice language that does not change execution.",
    matchers: [/\bgeneric/i, /\bbest practice/i, /\bboilerplate/i, /\btemplate/i, /\bvague/i]
  },
  {
    label: "Avoid plans without prioritization or sequencing.",
    matchers: [/\bpriorit/i, /\bsequence/i, /\border/i, /\bphase/i]
  },
  {
    label: "Avoid unsupported specificity or potentially false claims.",
    matchers: [/\bpotentially false/i, /\boverstate/i, /\bunsupported/i, /\bhallucination/i]
  },
  {
    label: "Avoid missing metrics, success criteria, or validation gates.",
    matchers: [/\bmetric/i, /\bsuccess/i, /\bkpi/i, /\bvalidation/i]
  },
  {
    label: "Avoid weak tradeoff handling and missing constraints.",
    matchers: [/\btrade[- ]?off/i, /\bconstraint/i, /\bdependency/i, /\blimit/i]
  },
  {
    label: "Avoid overconfident diagnostics without evidence collection.",
    matchers: [/\bevidence gap/i, /\blogging incomplete/i, /\bcannot prove/i, /\bproof\b/i]
  },
  {
    label: "Avoid noise that adds wording without new facts or operational detail.",
    matchers: [/\bnoise\b/i, /\bfluff\b/i, /\bcorporate\b/i, /\bbuzzword/i]
  }
];

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return roundToOneDecimal((sorted[middle - 1]! + sorted[middle]!) / 2);
  }

  return roundToOneDecimal(sorted[middle]!);
}

function percentage(part: number, whole: number) {
  if (whole === 0) {
    return 0;
  }

  return roundToOneDecimal((part / whole) * 100);
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

const defaultDatasetResearch = {
  considered: false,
  used: false,
  route: "not_needed" as const,
  decision: {
    shouldUse: false,
    mode: "off" as const,
    expectedValue: "low" as const,
    expectedCostMs: 0,
    triggerSignals: ["dataset_backfill"],
    targetClaims: [],
    reasoning: "Legacy dataset entry stored before research decision accounting was introduced."
  },
  queryPlan: {
    intent: "fact_check" as const,
    queries: [],
    selectedQuery: null,
    requiredTerms: [],
    preferredDomains: [],
    factFocusTerms: []
  },
  query: null,
  reasons: ["Legacy dataset entry stored before research-tool logging was introduced."],
  summary: [],
  sources: [],
  verification: {
    sourceCount: 0,
    extractedSourceCount: 0,
    corroboratedSignals: []
  },
  appliedTo: {
    A: false,
    B: false
  },
  impact: {
    refineChangedBecauseOfTool: false,
    addedFactsCount: 0,
    correctedClaimsCount: 0,
    sourceBackedClaimsCount: 0,
    costSharePct: 0,
    netImpact: "unknown" as const
  },
  impactNotes: [],
  durationMs: 0
};

const defaultStrategies: Record<QuestionCategory, KnowledgeCategoryStrategy> = {
  incident_response: {
    routingRecommendation: "selective",
    routerBias: 8,
    toolRecommendation: "verify_only",
    refineWhen: { minRiskScore: 52, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 72 },
    skipWhen: { maxRiskScore: 28, minQualityScore: 84, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "High factual or operational risk",
      "Evidence preservation missing",
      "Rollback or validation not explicit"
    ],
    lowValueSignals: [
      "Already concrete and low risk",
      "Mostly stylistic clean-up",
      "No provider-specific claim to verify"
    ],
    note: "Refine helps when incident handling is concrete, operational, and risk-aware."
  },
  architecture_design: {
    routingRecommendation: "selective",
    routerBias: 3,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 58, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 68 },
    skipWhen: { maxRiskScore: 26, minQualityScore: 84, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Tradeoffs are missing",
      "Constraints or scale assumptions are weak",
      "A specific provider constraint needs validation"
    ],
    lowValueSignals: [
      "Already balanced on tradeoffs",
      "Purely generic system-design search query",
      "Good answer with low structural risk"
    ],
    note: "Architecture refine is valuable when it sharpens constraints and tradeoffs, not when it adds generic system-design prose."
  },
  technical_explanation: {
    routingRecommendation: "prefer_refine",
    routerBias: 10,
    toolRecommendation: "prefer_grounded",
    refineWhen: { minRiskScore: 46, minDirectCritiques: 1, minStructuralRiskCount: 3, maxQualityScore: 78 },
    skipWhen: { maxRiskScore: 22, minQualityScore: 88, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Definition or mechanism is under-specified",
      "Provider, standard, or protocol claim appears",
      "Examples or contrasts are missing"
    ],
    lowValueSignals: [
      "Already precise and well-scaffolded",
      "No factual claim worth grounding",
      "Purely stylistic rewrite"
    ],
    note: "Technical explanation is a strong category when refine improves pedagogy and factual precision together."
  },
  debug_diagnostic: {
    routingRecommendation: "selective",
    routerBias: 5,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 62, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 64 },
    skipWhen: { maxRiskScore: 30, minQualityScore: 82, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Diagnosis sounds too certain",
      "Checks or next steps are missing",
      "Known product behavior or error semantics must be verified"
    ],
    lowValueSignals: [
      "Already hypothesis-driven and cautious",
      "Search would only pull generic troubleshooting lists",
      "Little factual claim to verify"
    ],
    note: "Debug refine helps when it keeps the answer evidence-driven and prevents overconfident diagnosis."
  },
  product_strategy: {
    routingRecommendation: "selective",
    routerBias: 6,
    toolRecommendation: "avoid",
    refineWhen: { minRiskScore: 56, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 66 },
    skipWhen: { maxRiskScore: 34, minQualityScore: 80, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Priorities or phases are missing",
      "No metrics or validation gates",
      "Strategy sounds polished but non-actionable"
    ],
    lowValueSignals: [
      "Already concrete with sequencing and metrics",
      "External grounding would just add generic market advice",
      "Low-risk answer with explicit tradeoffs"
    ],
    note: "Product strategy gains mostly from prioritization, metrics, and anti-fluff discipline, not from web enrichment."
  },
  operational_writing: {
    routingRecommendation: "prefer_refine",
    routerBias: 12,
    toolRecommendation: "avoid",
    refineWhen: { minRiskScore: 42, minDirectCritiques: 1, minStructuralRiskCount: 2, maxQualityScore: 82 },
    skipWhen: { maxRiskScore: 20, minQualityScore: 90, maxDirectCritiques: 0, maxStructuralRiskCount: 1 },
    highValueSignals: [
      "Structure is unclear",
      "Too much noise for an execution-oriented message",
      "Operational hierarchy is weak"
    ],
    lowValueSignals: [
      "Already concise and directly usable",
      "Grounding would add templates rather than value",
      "Low-risk answer with clean structure"
    ],
    note: "Operational writing benefits from sharper structure and signal density, not from more external content."
  },
  mixed_reasoning: {
    routingRecommendation: "prefer_refine",
    routerBias: 9,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 50, minDirectCritiques: 2, minStructuralRiskCount: 3, maxQualityScore: 74 },
    skipWhen: { maxRiskScore: 26, minQualityScore: 86, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Theory and application are disconnected",
      "One subpart contains factual risk",
      "Reasoning needs explicit limits or tradeoffs"
    ],
    lowValueSignals: [
      "Reasoning is already balanced",
      "Grounding would over-weight the factual subpart",
      "Low-risk answer with strong structure"
    ],
    note: "Mixed reasoning works best when refine keeps breadth but tightens the factual subpart and the decision logic."
  },
  other: {
    routingRecommendation: "insufficient_data",
    routerBias: 0,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 55, minDirectCritiques: 2, minStructuralRiskCount: 3, maxQualityScore: 70 },
    skipWhen: { maxRiskScore: 25, minQualityScore: 84, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: ["High risk and clear critique volume"],
    lowValueSignals: ["Low risk and already strong quality"],
    note: "Fallback strategy used when category-specific evidence is sparse."
  }
};

export class KnowledgeLayerService {
  constructor(
    private readonly benchmarkRunsFile = env.BENCHMARK_RUNS_FILE,
    private readonly roundDatasetFile = env.ROUND_DATASET_FILE,
    private readonly knowledgeFile = env.KNOWLEDGE_LAYER_FILE,
    private readonly curatedStudentDatasetFile = env.STUDENT_CURATED_DATASET_FILE
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
      this.buildCategoryInsight(category, benchmarkRuns, roundDatasetEntries)
    );
    const curatedStudentExamples = this.buildCuratedStudentExamples(
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

    const curatedLines = curatedStudentExamples
      .map((entry) => JSON.stringify(studentCuratedExampleSchema.parse(entry)))
      .join("\n");
    await mkdir(dirname(this.curatedStudentDatasetFile), { recursive: true });
    await writeFile(
      this.curatedStudentDatasetFile,
      curatedLines.length > 0 ? `${curatedLines}\n` : "",
      "utf8"
    );

    return {
      knowledgeLayer,
      curatedStudentExamples
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
        .map((line) => {
          const current = JSON.parse(line) as Record<string, unknown>;
          const rawResearch =
            typeof current.research === "object" && current.research !== null
              ? (current.research as Record<string, unknown>)
              : {};

          return roundDatasetEntrySchema.parse({
            ...current,
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
                ...(typeof rawResearch.queryPlan === "object" &&
                rawResearch.queryPlan !== null
                  ? (rawResearch.queryPlan as Record<string, unknown>)
                  : {})
              },
              verification: {
                ...defaultDatasetResearch.verification,
                ...(typeof rawResearch.verification === "object" &&
                rawResearch.verification !== null
                  ? (rawResearch.verification as Record<string, unknown>)
                  : {})
              },
              appliedTo: {
                ...defaultDatasetResearch.appliedTo,
                ...(typeof rawResearch.appliedTo === "object" &&
                rawResearch.appliedTo !== null
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
        });
    } catch {
      return [] as RoundDatasetEntry[];
    }
  }

  private buildCategoryInsight(
    category: QuestionCategory,
    benchmarkRuns: BenchmarkRun[],
    roundDatasetEntries: RoundDatasetEntry[]
  ): KnowledgeCategoryInsight {
    const defaultStrategy = defaultStrategies[category];
    const coreResults = benchmarkRuns
      .filter((run) => run.status === "completed" && run.benchmarkId !== "tool-benchmark-v1")
      .flatMap((run) => run.results)
      .filter(
        (result) =>
          result.status === "completed" && result.detectedCategory === category
      );
    const toolResults = benchmarkRuns
      .filter((run) => run.status === "completed" && run.benchmarkId === "tool-benchmark-v1")
      .flatMap((run) => run.results)
      .filter(
        (result) =>
          result.status === "completed" && result.detectedCategory === category
      );
    const categoryRounds = roundDatasetEntries.filter((entry) => entry.category === category);
    const benchmark = this.buildCategoryBenchmarkSnapshot(coreResults);
    const winningPatterns = this.extractPatterns({
      definitions: positivePatternDefinitions,
      rounds: categoryRounds.filter((entry) => this.isWinningRound(entry)),
      polarity: "positive"
    });
    const losingPatterns = this.extractPatterns({
      definitions: negativePatternDefinitions,
      rounds: categoryRounds.filter((entry) => this.isLosingRound(entry)),
      polarity: "negative"
    });

    const strategy = this.deriveStrategy({
      category,
      benchmark,
      toolResults,
      rounds: categoryRounds,
      winningPatterns,
      losingPatterns,
      defaultStrategy
    });

    const references = [...categoryRounds].sort(
      (left, right) => right.metrics.refineGain.global - left.metrics.refineGain.global
    );

    return {
      category,
      benchmark,
      winningPatterns,
      losingPatterns,
      bestRounds: references.slice(0, 3).map((entry) => ({
        roundId: entry.roundId,
        prompt: entry.question,
        gain: entry.metrics.refineGain.global,
        note:
          entry.metrics.scoreExplanation[
            entry.studentSignals.preferredWinner === "B" ? "B" : "A"
          ]?.main_driver ??
          "High-gain round worth reusing as an orchestration reference."
      })),
      worstRounds: [...references]
        .reverse()
        .slice(0, 3)
        .map((entry) => ({
          roundId: entry.roundId,
          prompt: entry.question,
          gain: entry.metrics.refineGain.global,
          note:
            entry.metrics.scoreExplanation.A.regressions[0] ??
            entry.metrics.scoreExplanation.B.regressions[0] ??
            "Low-gain round that exposes a weak orchestration pattern."
        })),
      strategy
    };
  }

  private buildCategoryBenchmarkSnapshot(results: BenchmarkPromptResult[]) {
    const respondentSlotCount = results.reduce(
      (sum, result) => sum + result.respondentSlotCount,
      0
    );
    const respondentPrimarySuccessCount = results.reduce(
      (sum, result) => sum + result.respondentPrimarySuccessCount,
      0
    );

    return {
      sampleSize: results.length,
      averageGain: average(results.map((result) => result.globalGain ?? 0)),
      medianGain: median(results.map((result) => result.globalGain ?? 0)),
      worthItRate: percentage(
        results.filter((result) => result.refineDecision === "YES").length,
        results.length
      ),
      degradingRate: percentage(
        results.filter((result) => result.degrading).length,
        results.length
      ),
      refineExecutionRate: percentage(
        results.reduce((sum, result) => sum + result.refineExecutedCount, 0),
        Math.max(1, results.length * 2)
      ),
      researchUsageRate: percentage(
        results.filter((result) => result.researchUsed).length,
        results.length
      ),
      respondentPrimarySuccessRate: percentage(
        respondentPrimarySuccessCount,
        respondentSlotCount
      )
    };
  }

  private deriveStrategy(args: {
    category: QuestionCategory;
    benchmark: KnowledgeCategoryInsight["benchmark"];
    toolResults: BenchmarkPromptResult[];
    rounds: RoundDatasetEntry[];
    winningPatterns: KnowledgePattern[];
    losingPatterns: KnowledgePattern[];
    defaultStrategy: KnowledgeCategoryStrategy;
  }): KnowledgeCategoryStrategy {
    const sideSamples = this.extractSideSamples(args.rounds);
    const positiveSideSamples = sideSamples.filter((sample) => sample.useful);
    const weakSideSamples = sideSamples.filter((sample) => sample.weak);

    let routerBias = args.defaultStrategy.routerBias;
    if (args.benchmark.averageGain >= 14 && args.benchmark.worthItRate >= 80) {
      routerBias += 4;
    } else if (args.benchmark.averageGain >= 8 && args.benchmark.worthItRate >= 60) {
      routerBias += 2;
    } else if (args.benchmark.averageGain <= 2 || args.benchmark.worthItRate < 35) {
      routerBias -= 4;
    }
    if (args.benchmark.degradingRate >= 20) {
      routerBias -= 3;
    }

    const toolRecommendation = this.deriveToolRecommendation(
      args.category,
      args.toolResults,
      args.defaultStrategy.toolRecommendation
    );

    const refineWhen = {
      minRiskScore:
        positiveSideSamples.length >= 2
          ? clampInt(median(positiveSideSamples.map((sample) => sample.riskScore)) - 5, 25, 90)
          : args.defaultStrategy.refineWhen.minRiskScore,
      minDirectCritiques:
        positiveSideSamples.length >= 2
          ? clampInt(median(positiveSideSamples.map((sample) => sample.directCritiques)), 1, 5)
          : args.defaultStrategy.refineWhen.minDirectCritiques,
      minStructuralRiskCount:
        positiveSideSamples.length >= 2
          ? clampInt(
              median(positiveSideSamples.map((sample) => sample.structuralRiskCount)),
              1,
              15
            )
          : args.defaultStrategy.refineWhen.minStructuralRiskCount,
      maxQualityScore:
        positiveSideSamples.length >= 2
          ? clampInt(
              median(positiveSideSamples.map((sample) => sample.qualityScore)) + 8,
              40,
              90
            )
          : args.defaultStrategy.refineWhen.maxQualityScore
    };

    const skipWhen = {
      maxRiskScore:
        weakSideSamples.length >= 2
          ? clampInt(median(weakSideSamples.map((sample) => sample.riskScore)) + 4, 15, 70)
          : args.defaultStrategy.skipWhen.maxRiskScore,
      minQualityScore:
        weakSideSamples.length >= 2
          ? clampInt(median(weakSideSamples.map((sample) => sample.qualityScore)) + 6, 55, 95)
          : args.defaultStrategy.skipWhen.minQualityScore,
      maxDirectCritiques:
        weakSideSamples.length >= 2
          ? clampInt(median(weakSideSamples.map((sample) => sample.directCritiques)), 0, 4)
          : args.defaultStrategy.skipWhen.maxDirectCritiques,
      maxStructuralRiskCount:
        weakSideSamples.length >= 2
          ? clampInt(
              median(weakSideSamples.map((sample) => sample.structuralRiskCount)),
              0,
              12
            )
          : args.defaultStrategy.skipWhen.maxStructuralRiskCount
    };

    const highValueSignals = uniqueStrings([
      ...args.defaultStrategy.highValueSignals,
      ...args.winningPatterns.slice(0, 3).map((pattern) => pattern.text)
    ]).slice(0, 8);
    const lowValueSignals = uniqueStrings([
      ...args.defaultStrategy.lowValueSignals,
      ...args.losingPatterns.slice(0, 3).map((pattern) => pattern.text)
    ]).slice(0, 8);

    const noteParts = [
      args.defaultStrategy.note,
      args.benchmark.sampleSize > 0
        ? `Observed avg gain ${args.benchmark.averageGain} with worth-it ${args.benchmark.worthItRate}%.`
        : "Data is sparse; fall back to category priors.",
      args.winningPatterns[0]?.text
        ? `Winning pattern: ${args.winningPatterns[0].text}`
        : null,
      args.losingPatterns[0]?.text
        ? `Recurring failure: ${args.losingPatterns[0].text}`
        : null
    ].filter(Boolean);

    return {
      routingRecommendation:
        args.benchmark.sampleSize >= 3
          ? args.defaultStrategy.routingRecommendation === "insufficient_data"
            ? "selective"
            : args.defaultStrategy.routingRecommendation
          : args.defaultStrategy.routingRecommendation,
      routerBias: clampInt(routerBias, -30, 30),
      toolRecommendation,
      refineWhen,
      skipWhen,
      highValueSignals,
      lowValueSignals,
      note: noteParts.join(" ")
    };
  }

  private deriveToolRecommendation(
    category: QuestionCategory,
    toolResults: BenchmarkPromptResult[],
    fallback: KnowledgeCategoryStrategy["toolRecommendation"]
  ): KnowledgeCategoryStrategy["toolRecommendation"] {
    if (toolResults.length === 0) {
      return fallback;
    }

    const usageRate = percentage(
      toolResults.filter((result) => result.researchUsed).length,
      toolResults.length
    );
    const usedResults = toolResults.filter((result) => result.researchUsed);
    const positiveRate = percentage(
      usedResults.filter((result) => result.researchNetImpact === "positive").length,
      usedResults.length
    );
    const avgGainWhenUsed = average(usedResults.map((result) => result.globalGain ?? 0));
    const avgGainWhenUnused = average(
      toolResults
        .filter((result) => !result.researchUsed)
        .map((result) => result.globalGain ?? 0)
    );

    if (
      category === "technical_explanation" &&
      usageRate >= 20 &&
      avgGainWhenUsed >= avgGainWhenUnused
    ) {
      return "prefer_grounded";
    }

    if (usageRate === 0) {
      return fallback;
    }

    if (avgGainWhenUsed >= avgGainWhenUnused + 2 && positiveRate >= 40) {
      return "prefer_grounded";
    }

    if (positiveRate >= 20) {
      return "verify_only";
    }

    return fallback === "prefer_grounded" ? "verify_only" : fallback;
  }

  private extractSideSamples(rounds: RoundDatasetEntry[]): SideSample[] {
    return rounds.flatMap((entry) => {
      const slots: Array<"A" | "B"> = ["A", "B"];
      return slots.map((slot) => {
        const verdict = slot === "A" ? entry.verdicts.refineA : entry.verdicts.refineB;
        const refined = entry.steps.refined[slot];
        const signal = entry.router.sideSignals[slot];
        const gain = entry.metrics.refineGain[slot];
        const executed = refined.routerSkipped !== true;
        const useful =
          executed &&
          gain >= 5 &&
          verdict !== "degrading" &&
          verdict !== "fallback_preserved";
        const weak =
          !executed ||
          gain <= 0 ||
          verdict === "degrading" ||
          verdict === "fallback_preserved";

        return {
          slot,
          gain,
          qualityScore: signal.qualityScore,
          riskScore: signal.riskScore,
          directCritiques: signal.directCritiques,
          structuralRiskCount: signal.structuralRiskCount,
          executed,
          useful,
          weak
        };
      });
    });
  }

  private extractPatterns(args: {
    definitions: PatternDefinition[];
    rounds: RoundDatasetEntry[];
    polarity: "positive" | "negative";
  }) {
    const patternMap = new Map<string, { count: number; exampleRoundIds: string[] }>();

    for (const round of args.rounds) {
      const texts =
        args.polarity === "positive"
          ? [
              ...round.metrics.scoreExplanation.A.improvements,
              ...round.metrics.scoreExplanation.B.improvements,
              ...round.steps.refined.A.fixes_applied,
              ...round.steps.refined.B.fixes_applied,
              ...round.steps.synthesizer.improvements_added,
              ...round.studentSignals.learningNotes
            ]
          : [
              ...round.metrics.scoreExplanation.A.regressions,
              ...round.metrics.scoreExplanation.B.regressions,
              ...round.steps.redTeam.shared_risks,
              ...round.steps.redTeam.failure_scenarios,
              ...round.steps.redTeam.hidden_assumptions,
              ...round.steps.refined.A.remaining_uncertainties,
              ...round.steps.refined.B.remaining_uncertainties
            ];

      const matchedLabels = new Set<string>();
      for (const text of texts) {
        const normalized = normalizeText(text);
        if (!normalized) {
          continue;
        }

        for (const definition of args.definitions) {
          if (definition.matchers.some((matcher) => matcher.test(normalized))) {
            matchedLabels.add(definition.label);
          }
        }
      }

      for (const label of matchedLabels) {
        const current = patternMap.get(label) ?? { count: 0, exampleRoundIds: [] };
        current.count += 1;
        if (current.exampleRoundIds.length < 5) {
          current.exampleRoundIds.push(round.roundId);
        }
        patternMap.set(label, current);
      }
    }

    return [...patternMap.entries()]
      .map(([text, details]) => ({
        text,
        count: details.count,
        exampleRoundIds: details.exampleRoundIds
      }))
      .sort((left, right) => right.count - left.count || left.text.localeCompare(right.text))
      .slice(0, 10);
  }

  private buildCuratedStudentExamples(
    roundDatasetEntries: RoundDatasetEntry[],
    categoryInsights: KnowledgeCategoryInsight[]
  ) {
    const insightMap = new Map(
      categoryInsights.map((insight) => [insight.category, insight])
    );

    const strictCandidates = roundDatasetEntries
      .filter((entry) => entry.studentSignals.roundUsefulForTraining)
      .filter((entry) => entry.metrics.refineGain.global >= 8)
      .filter((entry) => entry.refineDecision.global === "YES")
      .filter((entry) => entry.verdicts.refineA !== "degrading")
      .filter((entry) => entry.verdicts.refineB !== "degrading")
      .filter((entry) => entry.research.impact.netImpact !== "negative");
    const relaxedCandidates = roundDatasetEntries
      .filter((entry) => entry.studentSignals.roundUsefulForTraining)
      .filter((entry) => entry.metrics.refineGain.global >= 4)
      .filter((entry) => entry.refineDecision.global === "YES")
      .filter((entry) => entry.verdicts.refineA !== "degrading")
      .filter((entry) => entry.verdicts.refineB !== "degrading")
      .filter((entry) => entry.metrics.scoreAverages.refined >= 84)
      .filter((entry) => entry.research.impact.netImpact !== "negative");
    const compareEntries = (left: RoundDatasetEntry, right: RoundDatasetEntry) => {
      if (right.metrics.refineGain.global !== left.metrics.refineGain.global) {
        return right.metrics.refineGain.global - left.metrics.refineGain.global;
      }

      return (
        right.metrics.scoreAverages.refined - left.metrics.scoreAverages.refined ||
        right.createdAt.localeCompare(left.createdAt)
      );
    };

    const selectedRoundIds = new Set<string>();
    const selectedEntries: RoundDatasetEntry[] = [];

    for (const category of knowledgeCategories.filter((entry) => entry !== "other")) {
      const strictForCategory = strictCandidates
        .filter((entry) => entry.category === category)
        .sort(compareEntries)
        .slice(0, 12);
      for (const entry of strictForCategory) {
        if (!selectedRoundIds.has(entry.roundId)) {
          selectedRoundIds.add(entry.roundId);
          selectedEntries.push(entry);
        }
      }

      if (strictForCategory.length >= 4) {
        continue;
      }

      const relaxedForCategory = relaxedCandidates
        .filter((entry) => entry.category === category && !selectedRoundIds.has(entry.roundId))
        .sort(compareEntries)
        .slice(0, 4 - strictForCategory.length);
      for (const entry of relaxedForCategory) {
        if (!selectedRoundIds.has(entry.roundId)) {
          selectedRoundIds.add(entry.roundId);
          selectedEntries.push(entry);
        }
      }
    }

    for (const entry of [...strictCandidates].sort(compareEntries)) {
      if (selectedEntries.length >= 80) {
        break;
      }
      if (!selectedRoundIds.has(entry.roundId)) {
        selectedRoundIds.add(entry.roundId);
        selectedEntries.push(entry);
      }
    }

    return selectedEntries
      .sort(compareEntries)
      .slice(0, 80)
      .map((entry) => {
        const insight = insightMap.get(entry.category);
        const coachingNotes = uniqueStrings([
          ...entry.studentSignals.learningNotes,
          ...entry.metrics.scoreExplanation.A.improvements,
          ...entry.metrics.scoreExplanation.B.improvements,
          ...(insight?.winningPatterns.slice(0, 3).map((pattern) => pattern.text) ?? [])
        ]).slice(0, 12);

        return studentCuratedExampleSchema.parse({
          datasetVersion: "hydria-student-curated-v1",
          roundId: entry.roundId,
          createdAt: entry.createdAt,
          category: entry.category,
          prompt: entry.question,
          targetAnswer: entry.studentSignals.preferredAnswer,
          preferredWinner: entry.studentSignals.preferredWinner,
          globalGain: entry.metrics.refineGain.global,
          refinedAverageScore: entry.metrics.scoreAverages.refined,
          researchUsed: entry.research.used,
          coachingNotes:
            coachingNotes.length > 0
              ? coachingNotes
              : [
                  "Prefer the synthesized answer that best integrates critique and keeps uncertainty explicit."
                ],
          winningPatterns:
            insight?.winningPatterns.slice(0, 4).map((pattern) => pattern.text) ?? []
        });
      });
  }

  private isWinningRound(entry: RoundDatasetEntry) {
    return (
      entry.metrics.refineGain.global > 0 &&
      entry.refineDecision.global === "YES" &&
      entry.verdicts.refineA !== "degrading" &&
      entry.verdicts.refineB !== "degrading"
    );
  }

  private isLosingRound(entry: RoundDatasetEntry) {
    return (
      entry.metrics.refineGain.global <= 0 ||
      entry.refineDecision.global === "NO" ||
      entry.verdicts.refineA === "degrading" ||
      entry.verdicts.refineB === "degrading"
    );
  }
}

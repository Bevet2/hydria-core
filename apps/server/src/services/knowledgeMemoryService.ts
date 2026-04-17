import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QuestionCategory } from "../types/arena.js";
import {
  knowledgeLayerSchema,
  knowledgeMemorySchema,
  type KnowledgeCategoryInsight,
  type KnowledgeLayer,
  type KnowledgeMemory,
  type KnowledgeMemoryCategory,
  type KnowledgeMemoryRule
} from "../types/knowledge.js";
import { studentSessionHistorySchema, type StudentSession } from "../types/student.js";
import { env } from "../utils/env.js";
import { deepSanitizeStrings } from "../utils/textCleanup.js";
import { knowledgeCategories } from "./knowledge/common.js";
import { enrichStudentSession } from "./studentLearning.js";

type StudentRuleGroup = {
  rule: string;
  failureType: string;
  count: number;
  errors: string[];
  corrections: string[];
  conditions: string[];
  averageConfidence: number;
  evidenceCount: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundToTwoDecimals(value: number) {
  return Math.round(value * 100) / 100;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(value: string, max = 160) {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function confidenceFromEvidence(args: {
  sampleSize: number;
  repeatedLessonCount?: number;
  qualitySignal: number;
}) {
  return roundToTwoDecimals(
    clamp(
      0.35 +
        Math.min(args.sampleSize, 30) / 100 +
        Math.min(args.repeatedLessonCount ?? 0, 6) / 20 +
        args.qualitySignal / 200,
      0.2,
      0.95
    )
  );
}

function inferConditionSignals(text: string) {
  const lower = text.toLowerCase();
  const signals: string[] = [];

  if (/(assumption|uncertain|unknown|depends)/.test(lower)) signals.push("uncertainty");
  if (/(metric|kpi|success|validation signal|gate)/.test(lower)) signals.push("metrics_missing");
  if (/(risk|constraint|dependency|tradeoff|limit)/.test(lower)) signals.push("risk_or_tradeoff");
  if (/(example|definition|contrast|clarify|pedagog)/.test(lower)) signals.push("pedagogy_gap");
  if (/(phase|priorit|sequenc|roadmap|first move|wedge)/.test(lower)) signals.push("sequencing_missing");
  if (/(fact|source|verify|provider|protocol|standard|docs)/.test(lower)) signals.push("factual_claims");
  if (/(step|rollback|containment|check|triage|evidence)/.test(lower)) signals.push("execution_gap");
  if (/(fluff|generic|buzzword|corporate|template)/.test(lower)) signals.push("generic_noise");

  return uniqueStrings(signals);
}

function aggregateStudentRules(sessions: StudentSession[]) {
  const byRule = new Map<string, StudentRuleGroup>();

  for (const session of sessions) {
    for (const lesson of session.lessonsLearned) {
      const key = `${lesson.failureType}:${normalize(lesson.rule)}`;
      const current = byRule.get(key) ?? {
        rule: lesson.rule,
        failureType: lesson.failureType,
        count: 0,
        errors: [],
        corrections: [],
        conditions: [],
        averageConfidence: 0,
        evidenceCount: 0
      };
      current.count += 1;
      current.errors.push(lesson.error);
      current.corrections.push(lesson.correction);
      current.conditions.push(...lesson.conditions);
      current.averageConfidence += lesson.confidence;
      current.evidenceCount += lesson.evidenceCount;
      byRule.set(key, current);
    }
  }

  return [...byRule.values()]
    .map((entry) => ({
      ...entry,
      errors: uniqueStrings(entry.errors).slice(0, 3),
      corrections: uniqueStrings(entry.corrections).slice(0, 3),
      conditions: uniqueStrings(entry.conditions).slice(0, 4),
      averageConfidence: roundToTwoDecimals(entry.averageConfidence / Math.max(entry.count, 1))
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.averageConfidence - left.averageConfidence ||
        right.evidenceCount - left.evidenceCount
    );
}

function buildRoutingRule(
  category: QuestionCategory,
  insight: KnowledgeCategoryInsight | null,
  studentSessionCount: number
): KnowledgeMemoryRule {
  const recommendation = insight?.strategy.routingRecommendation ?? "selective";
  const benchmark = insight?.benchmark;
  const confidence = confidenceFromEvidence({
    sampleSize: benchmark?.sampleSize ?? 0,
    qualitySignal:
      recommendation === "prefer_refine"
        ? benchmark?.worthItRate ?? 35
        : recommendation === "prefer_skip"
          ? benchmark ? 100 - benchmark.worthItRate : 35
          : 50
  });
  const conditionSignals =
    recommendation === "prefer_refine"
      ? ["direct_critiques", "structural_risk", "positive_refine_roi"]
      : recommendation === "prefer_skip"
        ? ["no_op_high", "static_fallback_high", "high_quality_low_risk"]
        : ["selective_refine", "mixed_signal"];
  const lesson =
    recommendation === "prefer_refine"
      ? "This category usually benefits from refine when critique pressure or structural risk is explicit."
      : recommendation === "prefer_skip"
        ? "This category loses value when refine is used on already-strong low-risk drafts."
        : "This category needs selective refine based on live critique and risk signals.";
  const recommendedStrategy =
    recommendation === "prefer_refine"
      ? `Keep refine active when Red Team surfaces concrete issues in ${category}.`
      : recommendation === "prefer_skip"
        ? `Skip refine in ${category} unless the round shows strong critique pressure or clear missing structure.`
        : `Use category-specific signals to decide refine on ${category}, not a blanket policy.`;

  return {
    ruleId: `${category}-routing-core`,
    category,
    domain: "routing",
    conditions:
      recommendation === "prefer_refine"
        ? insight?.strategy.highValueSignals.slice(0, 3) ?? ["High critique pressure", "Structural risk", "Strong refine ROI"]
        : recommendation === "prefer_skip"
          ? insight?.strategy.lowValueSignals.slice(0, 3) ?? ["Already strong answer", "Low structural risk", "Historically weak refine ROI"]
          : [
              ...(insight?.strategy.highValueSignals.slice(0, 2) ?? ["Some critique pressure"]),
              ...(insight?.strategy.lowValueSignals.slice(0, 1) ?? ["Some low-risk cases"])
            ],
    conditionSignals,
    lesson,
    recommendedStrategy,
    confidence,
    evidence: {
      benchmarkSignals: uniqueStrings([
        `avg gain ${benchmark?.averageGain ?? 0}`,
        `worth-it ${benchmark?.worthItRate ?? 0}%`,
        `no-op ${benchmark?.noOpRate ?? 0}%`,
        `static fallback ${benchmark?.staticFallbackRate ?? 0}%`
      ]).slice(0, 4),
      roundCount: benchmark?.sampleSize ?? 0,
      studentSessionCount,
      repeatedLessonCount: 0
    },
    influence: {
      routingBias:
        recommendation === "prefer_refine" ? 8 : recommendation === "prefer_skip" ? -8 : 2,
      refineBias:
        recommendation === "prefer_refine" ? 6 : recommendation === "prefer_skip" ? -6 : 1,
      researchBias: 0
    }
  };
}

function buildRefineRule(
  category: QuestionCategory,
  insight: KnowledgeCategoryInsight | null,
  studentSessionCount: number
): KnowledgeMemoryRule {
  const benchmark = insight?.benchmark;
  const winningPattern = insight?.winningPatterns[0]?.text ?? "Make the answer more concrete and explicit.";
  const losingPattern = insight?.losingPatterns[0]?.text ?? "Avoid generic filler and unsupported claims.";
  const conservative = (benchmark?.staticFallbackRate ?? 0) >= 15 || (benchmark?.noOpRate ?? 0) >= 35;
  const confidence = confidenceFromEvidence({
    sampleSize: benchmark?.sampleSize ?? 0,
    qualitySignal: conservative ? 100 - (benchmark?.staticFallbackRate ?? 0) : benchmark?.worthItRate ?? 50
  });

  return {
    ruleId: `${category}-refine-core`,
    category,
    domain: "refine",
    conditions: conservative
      ? [
          "Refine often no-ops or falls back on weak signals.",
          "Use refine only when critique pressure is concrete.",
          losingPattern
        ]
      : [
          "Refine is usually useful when it applies category-specific structure.",
          winningPattern,
          losingPattern
        ],
    conditionSignals: conservative
      ? ["no_op_high", "static_fallback_high", "direct_critiques"]
      : uniqueStrings(["direct_critiques", "structural_risk", ...inferConditionSignals(winningPattern)]).slice(0, 6),
    lesson: conservative
      ? "Refine should stay disciplined and only fire on explicit weaknesses."
      : `Best refine gains come from this pattern: ${winningPattern}`,
    recommendedStrategy: conservative
      ? `Only refine ${category} when critiques are explicit; otherwise preserve strong drafts and avoid decorative rewrites.`
      : `Use refine in ${category} to ${winningPattern.toLowerCase()} and explicitly avoid: ${losingPattern.toLowerCase()}`,
    confidence,
    evidence: {
      benchmarkSignals: uniqueStrings([
        `avg gain ${benchmark?.averageGain ?? 0}`,
        `worth-it ${benchmark?.worthItRate ?? 0}%`,
        `no-op ${benchmark?.noOpRate ?? 0}%`,
        `static fallback ${benchmark?.staticFallbackRate ?? 0}%`
      ]).slice(0, 4),
      roundCount: benchmark?.sampleSize ?? 0,
      studentSessionCount,
      repeatedLessonCount: 0
    },
    influence: {
      routingBias: conservative ? -3 : 3,
      refineBias: conservative ? -6 : 7,
      researchBias: 0
    }
  };
}

function buildToolRule(
  category: QuestionCategory,
  insight: KnowledgeCategoryInsight | null,
  studentSessionCount: number
): KnowledgeMemoryRule {
  const benchmark = insight?.benchmark;
  const recommendation = insight?.strategy.toolRecommendation ?? "conditional";
  const confidence = confidenceFromEvidence({
    sampleSize: benchmark?.sampleSize ?? 0,
    qualitySignal:
      recommendation === "prefer_grounded"
        ? benchmark?.positiveResearchImpactRate ?? 40
        : recommendation === "avoid"
          ? 100 - (benchmark?.positiveResearchImpactRate ?? 0)
          : 50
  });

  return {
    ruleId: `${category}-tool-core`,
    category,
    domain: "tool_usage",
    conditions:
      recommendation === "prefer_grounded"
        ? insight?.strategy.highValueSignals.slice(0, 3) ?? ["Externally checkable claims", "Concept definitions", "Protocol or provider details"]
        : recommendation === "avoid"
          ? insight?.strategy.lowValueSignals.slice(0, 3) ?? ["Mostly stylistic task", "External search would add noise", "No factual claim to verify"]
          : [
              ...(insight?.strategy.highValueSignals.slice(0, 2) ?? ["Only verify factual subproblems"]),
              ...(insight?.strategy.lowValueSignals.slice(0, 1) ?? ["Avoid broad enrichment"])
            ],
    conditionSignals:
      recommendation === "prefer_grounded"
        ? ["factual_claims", "provider_specific", "concept_question"]
        : recommendation === "avoid"
          ? ["generic_noise", "low_external_value"]
          : ["factual_claims", "tool_conditional"],
    lesson:
      recommendation === "prefer_grounded"
        ? "Grounding helps when the answer depends on externally checkable facts."
        : recommendation === "avoid"
          ? "Grounding usually adds noise here unless the round contains explicit external claims."
          : "Grounding should be targeted at the factual sub-problem, not used as broad enrichment.",
    recommendedStrategy:
      recommendation === "prefer_grounded"
        ? `Use targeted verification in ${category} when protocols, standards, or provider details appear.`
        : recommendation === "avoid"
          ? `Keep tools off by default in ${category}; only verify explicit factual claims.`
          : `Use tools in ${category} only for narrow fact checking, not for generic expansion.`,
    confidence,
    evidence: {
      benchmarkSignals: uniqueStrings([
        `tool recommendation ${recommendation}`,
        `research usage ${benchmark?.researchUsageRate ?? 0}%`,
        `positive research impact ${benchmark?.positiveResearchImpactRate ?? 0}%`
      ]).slice(0, 3),
      roundCount: benchmark?.sampleSize ?? 0,
      studentSessionCount,
      repeatedLessonCount: 0
    },
    influence: {
      routingBias: 0,
      refineBias: 0,
      researchBias:
        recommendation === "prefer_grounded" ? 8 : recommendation === "avoid" ? -10 : -2
    }
  };
}

function buildReasoningRules(
  category: QuestionCategory,
  insight: KnowledgeCategoryInsight | null,
  sessions: StudentSession[]
): KnowledgeMemoryRule[] {
  const groups = aggregateStudentRules(sessions).slice(0, 3);
  const benchmarkSampleSize = insight?.benchmark.sampleSize ?? 0;

  if (groups.length === 0) {
    const winningPattern = insight?.winningPatterns[0]?.text;
    if (!winningPattern) {
      return [];
    }

    return [
      {
        ruleId: `${category}-reasoning-baseline`,
        category,
        domain: "reasoning",
        conditions: [winningPattern],
        conditionSignals: uniqueStrings(["reasoning_gap", ...inferConditionSignals(winningPattern)]).slice(0, 6),
        lesson: `Reasoning improves when the answer follows this pattern: ${winningPattern}`,
        recommendedStrategy: `Keep ${winningPattern.toLowerCase()}`,
        confidence: confidenceFromEvidence({
          sampleSize: benchmarkSampleSize,
          qualitySignal: insight?.benchmark.worthItRate ?? 40
        }),
        evidence: {
          benchmarkSignals: [`winning pattern ${winningPattern}`],
          roundCount: benchmarkSampleSize,
          studentSessionCount: sessions.length,
          repeatedLessonCount: 0
        },
        influence: {
          routingBias: 0,
          refineBias: 2,
          researchBias: 0
        }
      }
    ];
  }

  return groups.map((group, index) => ({
    ruleId: `${category}-reasoning-${index + 1}`,
    category,
    domain: "reasoning",
    conditions: uniqueStrings(
      [...group.conditions, ...group.errors, ...group.corrections].map((value) => truncate(value))
    ).slice(0, 4),
    conditionSignals: uniqueStrings([
      "reasoning_gap",
      group.failureType,
      ...inferConditionSignals(`${group.rule} ${group.conditions.join(" ")}`)
    ]).slice(0, 6),
    lesson: `Recurring ${group.failureType.replaceAll("_", " ")} pattern: ${group.rule}`,
    recommendedStrategy: group.rule,
    confidence: confidenceFromEvidence({
      sampleSize: benchmarkSampleSize,
      repeatedLessonCount: group.count,
      qualitySignal:
        sessions.filter((session) => session.judge.worthIt === "YES").length * 10 +
        Math.round(group.averageConfidence * 20)
    }),
    evidence: {
      benchmarkSignals: uniqueStrings([
        ...(insight?.winningPatterns.slice(0, 2).map((pattern) => pattern.text) ?? []),
        ...group.conditions
      ]).slice(0, 4),
      roundCount: benchmarkSampleSize,
      studentSessionCount: sessions.length,
      repeatedLessonCount: group.evidenceCount
    },
    influence: {
      routingBias: 0,
      refineBias: 2,
      researchBias: group.rule.toLowerCase().includes("fact") || group.rule.toLowerCase().includes("source") ? 2 : 0
    }
  }));
}

function buildCategorySummary(category: QuestionCategory, rules: KnowledgeMemoryRule[]) {
  const strongest = rules[0];
  const toolRule = rules.find((rule) => rule.domain === "tool_usage");
  return uniqueStrings([
    strongest ? strongest.lesson : null,
    toolRule ? toolRule.recommendedStrategy : null,
    `Use ${category} memory as a bias layer, not as a hard override.`
  ].filter(Boolean) as string[]).join(" ");
}

function buildCategoryMemory(args: {
  category: QuestionCategory;
  insight: KnowledgeCategoryInsight | null;
  sessions: StudentSession[];
}): KnowledgeMemoryCategory {
  const categoryRules = [
    buildRoutingRule(args.category, args.insight, args.sessions.length),
    buildRefineRule(args.category, args.insight, args.sessions.length),
    buildToolRule(args.category, args.insight, args.sessions.length),
    ...buildReasoningRules(args.category, args.insight, args.sessions)
  ]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 8);

  return {
    category: args.category,
    summary: buildCategorySummary(args.category, categoryRules),
    rules: categoryRules
  };
}

export class KnowledgeMemoryService {
  constructor(
    private readonly memoryFile = env.KNOWLEDGE_MEMORY_FILE,
    private readonly studentSessionHistoryFile = env.STUDENT_SESSION_HISTORY_FILE,
    private readonly knowledgeLayerFile = env.KNOWLEDGE_LAYER_FILE
  ) {}

  async loadMemory(): Promise<KnowledgeMemory | null> {
    try {
      const raw = await readFile(this.memoryFile, "utf8");
      return knowledgeMemorySchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async buildAndPersist(layer?: KnowledgeLayer | null): Promise<KnowledgeMemory | null> {
    const knowledgeLayer = layer ?? (await this.readKnowledgeLayer());
    if (!knowledgeLayer) {
      return null;
    }

    const studentSessions = await this.readStudentSessions();
    const lessonsLearnedAnalyzed = studentSessions.reduce(
      (sum, session) => sum + session.lessonsLearned.length,
      0
    );
    const categories = knowledgeCategories.map((category) =>
      buildCategoryMemory({
        category,
        insight: knowledgeLayer.categories.find((entry) => entry.category === category) ?? null,
        sessions: studentSessions.filter((session) => session.category === category)
      })
    );

    const memory = knowledgeMemorySchema.parse({
      version: "hydria-memory-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        benchmarkRunsAnalyzed: knowledgeLayer.sourceStats.benchmarkRunsAnalyzed,
        roundDatasetEntriesAnalyzed: knowledgeLayer.sourceStats.roundDatasetEntriesAnalyzed,
        studentSessionsAnalyzed: studentSessions.length,
        lessonsLearnedAnalyzed
      },
      categories
    });

    await mkdir(dirname(this.memoryFile), { recursive: true });
    await writeFile(this.memoryFile, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
    return memory;
  }

  async getRelevantRules(args: {
    category: QuestionCategory;
    activeSignals: string[];
    domains?: Array<KnowledgeMemoryRule["domain"]>;
    limit?: number;
  }): Promise<KnowledgeMemoryRule[]> {
    const memory = await this.loadMemory();
    const categoryEntry = memory?.categories.find((entry) => entry.category === args.category);
    if (!categoryEntry) {
      return [];
    }

    const active = new Set(args.activeSignals);
    const filtered = categoryEntry.rules.filter((rule) =>
      args.domains ? args.domains.includes(rule.domain) : true
    );

    return filtered
      .map((rule) => ({
        rule,
        score:
          rule.conditionSignals.filter((signal) => active.has(signal)).length * 10 +
          Math.round(rule.confidence * 10)
      }))
      .filter((entry) => entry.score > 0 || entry.rule.confidence >= 0.65)
      .sort((left, right) => right.score - left.score)
      .slice(0, args.limit ?? 4)
      .map((entry) => entry.rule);
  }

  private async readStudentSessions() {
    try {
      const raw = await readFile(this.studentSessionHistoryFile, "utf8");
      return studentSessionHistorySchema
        .parse(deepSanitizeStrings(JSON.parse(raw)))
        .sessions.map((session) => enrichStudentSession(session));
    } catch {
      return [] as StudentSession[];
    }
  }

  private async readKnowledgeLayer() {
    try {
      const raw = await readFile(this.knowledgeLayerFile, "utf8");
      return knowledgeLayerSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}

import { readFile } from "node:fs/promises";
import type { QuestionCategory } from "../types/arena.js";
import {
  knowledgeInjectionSchema,
  studentCuratedExampleSchema,
  type KnowledgeInjection,
  type StudentCuratedExample
} from "../types/knowledge.js";
import {
  studentSessionHistorySchema,
  type StudentRuleImpactContext,
  type StudentSession
} from "../types/student.js";
import { env } from "../utils/env.js";
import { deepSanitizeStrings } from "../utils/textCleanup.js";
import { KnowledgeLayerService } from "./knowledgeLayerService.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";
import { enrichStudentSession } from "./studentLearning.js";
import { buildStudentRuleContext, scoreStudentRuleContextMatch } from "./studentRuleContext.js";
import {
  StudentRuleImpactTrackerService,
  type StudentRuleImpactAggregate
} from "./studentRuleImpactTrackerService.js";
import { StudentStrategyAssetService } from "./studentStrategyAssetService.js";

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRuleId(category: QuestionCategory, failureType: string, rule: string) {
  const base = `${category}:${failureType}:${normalize(rule)}`;
  return base.length <= 160 ? base : `${base.slice(0, 157).trimEnd()}...`;
}

function summarizeStudentMemory(
  category: QuestionCategory,
  lessons: Array<{
    failureType: string;
    rule: string;
    confidence: number;
    evidenceCount: number;
    conditions: string[];
  }>
) {
  if (lessons.length === 0) {
    return `No recurring student-specific lessons are stored yet for ${category}.`;
  }

  const topFailures = uniqueStrings(lessons.map((lesson) => lesson.failureType.replaceAll("_", " "))).slice(0, 3);
  return `Recurring student weaknesses in ${category}: ${topFailures.join(", ")}. Apply the highest-confidence student rules before finalizing the answer.`;
}

export class KnowledgeInjectionService {
  private readonly knowledgeLayerService = new KnowledgeLayerService();
  private readonly knowledgeMemoryService = new KnowledgeMemoryService();
  private readonly studentRuleImpactTrackerService = new StudentRuleImpactTrackerService();
  private readonly studentStrategyAssetService = new StudentStrategyAssetService();
  private knowledgeLayerPromise: Promise<
    Awaited<ReturnType<KnowledgeLayerService["loadKnowledgeLayer"]>>
  > | null = null;
  private knowledgeMemoryPromise: Promise<
    Awaited<ReturnType<KnowledgeMemoryService["loadMemory"]>>
  > | null = null;
  private curatedDatasetPromise: Promise<StudentCuratedExample[]> | null = null;
  private studentSessionsPromise: Promise<StudentSession[]> | null = null;
  private studentRuleImpactPromise: Promise<
    Awaited<ReturnType<StudentRuleImpactTrackerService["load"]>>
  > | null = null;
  private readonly studentStrategyAssetsPromises = new Map<
    QuestionCategory,
    Promise<Awaited<ReturnType<StudentStrategyAssetService["listByCategory"]>>>
  >();

  async buildForCategory(
    category: QuestionCategory,
    args?: {
      question?: string;
    }
  ): Promise<KnowledgeInjection | null> {
    const [layer, memory, curatedExamples, studentSessions, studentRuleImpact, strategyAssets] = await Promise.all([
      this.loadKnowledgeLayer(),
      this.loadKnowledgeMemory(),
      this.loadCuratedDataset(),
      this.loadStudentSessions(),
      this.loadStudentRuleImpact(),
      this.loadStudentStrategyAssets(category)
    ]);
    const insight = layer?.categories.find((entry) => entry.category === category);
    const memoryEntry = memory?.categories.find((entry) => entry.category === category);
    const runtimeContext = args?.question ? buildStudentRuleContext(args.question, category) : null;
    const studentMemoryRules = this.buildStudentMemoryRules(
      category,
      studentSessions,
      studentRuleImpact?.rules ?? [],
      runtimeContext
    );
    const matchingStrategyAssets = runtimeContext
      ? strategyAssets
          .map((asset) => ({
            asset,
            matchScore: scoreStudentRuleContextMatch(runtimeContext, {
              questionType: asset.context.questionType,
              promptLength: asset.context.promptLength,
              promptWordCount: runtimeContext.promptWordCount,
              signals: asset.context.signals
            })
          }))
          .filter((entry) => entry.matchScore >= 5)
          .sort(
            (left, right) =>
              right.matchScore - left.matchScore ||
              right.asset.evidence.observations - left.asset.evidence.observations ||
              right.asset.evidence.averageJudgeDelta - left.asset.evidence.averageJudgeDelta
          )
          .slice(0, 2)
          .map((entry) => entry.asset)
      : strategyAssets.slice(0, 2);
    const coachingHints = uniqueStrings(
      [
        ...curatedExamples
          .filter((entry) => entry.category === category)
          .sort((left, right) => right.selectionScore - left.selectionScore)
          .slice(0, 3)
          .flatMap((entry) => entry.coachingNotes),
        ...matchingStrategyAssets.map((asset) => `Adopted strategy asset: ${asset.learning.summary}`),
        ...matchingStrategyAssets.map((asset) => `Strategy hint: ${asset.learning.promptHint}`)
      ]
    ).slice(0, 8);

    if (!insight && !memoryEntry && studentMemoryRules.length === 0 && coachingHints.length === 0) {
      return null;
    }

    return knowledgeInjectionSchema.parse({
      category,
      routingRecommendation: insight?.strategy.routingRecommendation ?? "selective",
      toolRecommendation: insight?.strategy.toolRecommendation ?? "conditional",
      strategyNote:
        insight?.strategy.note ??
        memoryEntry?.summary ??
        `No benchmark-derived strategy note is available yet for ${category}; rely on compact student memory rules.`,
      winningPatterns: insight?.winningPatterns.slice(0, 4).map((pattern) => pattern.text) ?? [],
      antiPatterns: insight?.losingPatterns.slice(0, 4).map((pattern) => pattern.text) ?? [],
      highValueSignals: insight?.strategy.highValueSignals.slice(0, 5) ?? [],
      lowValueSignals: insight?.strategy.lowValueSignals.slice(0, 5) ?? [],
      coachingHints,
      bestRoundReferences: insight?.bestRounds.slice(0, 3).map((entry) => ({
        roundId: entry.roundId,
        gain: entry.gain,
        note: entry.note
      })) ?? [],
      memorySummary:
        memoryEntry?.summary ??
        `No knowledge memory summary available yet for ${category}.`,
      memoryRules: (memoryEntry?.rules ?? []).slice(0, 4).map((rule) => ({
        domain: rule.domain,
        lesson: rule.lesson,
        recommendedStrategy: rule.recommendedStrategy,
        confidence: rule.confidence
      })),
      studentMemorySummary: summarizeStudentMemory(category, studentMemoryRules),
      studentMemoryRules
    });
  }

  invalidateStudentLearningCaches() {
    this.knowledgeMemoryPromise = null;
    this.studentSessionsPromise = null;
    this.studentRuleImpactPromise = null;
    this.studentStrategyAssetsPromises.clear();
  }

  private async loadKnowledgeLayer() {
    if (!this.knowledgeLayerPromise) {
      this.knowledgeLayerPromise = this.knowledgeLayerService.loadKnowledgeLayer();
    }

    return this.knowledgeLayerPromise;
  }

  private async loadKnowledgeMemory() {
    if (!this.knowledgeMemoryPromise) {
      this.knowledgeMemoryPromise = this.knowledgeMemoryService.loadMemory();
    }

    return this.knowledgeMemoryPromise;
  }

  private async loadCuratedDataset() {
    if (!this.curatedDatasetPromise) {
      this.curatedDatasetPromise = this.readCuratedDataset();
    }

    return this.curatedDatasetPromise;
  }

  private async loadStudentSessions() {
    if (!this.studentSessionsPromise) {
      this.studentSessionsPromise = this.readStudentSessions();
    }

    return this.studentSessionsPromise;
  }

  private async loadStudentRuleImpact() {
    if (!this.studentRuleImpactPromise) {
      this.studentRuleImpactPromise = this.studentRuleImpactTrackerService.load();
    }

    return this.studentRuleImpactPromise;
  }

  private async loadStudentStrategyAssets(category: QuestionCategory) {
    if (!this.studentStrategyAssetsPromises.has(category)) {
      this.studentStrategyAssetsPromises.set(
        category,
        this.studentStrategyAssetService.listByCategory(category)
      );
    }

    return this.studentStrategyAssetsPromises.get(category)!;
  }

  private async readCuratedDataset() {
    try {
      const raw = await readFile(env.STUDENT_CURATED_DATASET_FILE, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => studentCuratedExampleSchema.parse(JSON.parse(line)));
    } catch {
      return [] as StudentCuratedExample[];
    }
  }

  private async readStudentSessions() {
    try {
      const raw = await readFile(env.STUDENT_SESSION_HISTORY_FILE, "utf8");
      return studentSessionHistorySchema
        .parse(deepSanitizeStrings(JSON.parse(raw)))
        .sessions.map((session) => enrichStudentSession(session));
    } catch {
      return [] as StudentSession[];
    }
  }

  private buildStudentMemoryRules(
    category: QuestionCategory,
    sessions: StudentSession[],
    impactRules: StudentRuleImpactAggregate[],
    runtimeContext: StudentRuleImpactContext | null
  ) {
    const relevantSessions = sessions.filter((session) => session.category === category);
    const byRule = new Map<
      string,
      {
        ruleId: string;
        failureType: string;
        rule: string;
        confidenceTotal: number;
        evidenceCountTotal: number;
        hitCount: number;
        conditions: string[];
      }
    >();

    for (const session of relevantSessions) {
      for (const lesson of session.lessonsLearned) {
        const key = buildRuleId(category, lesson.failureType, lesson.rule);
        const current = byRule.get(key) ?? {
          ruleId: key,
          failureType: lesson.failureType,
          rule: lesson.rule,
          confidenceTotal: 0,
          evidenceCountTotal: 0,
          hitCount: 0,
          conditions: []
        };
        current.confidenceTotal += lesson.confidence;
        current.evidenceCountTotal += lesson.evidenceCount;
        current.hitCount += 1;
        current.conditions.push(...lesson.conditions);
        byRule.set(key, current);
      }
    }

    return [...byRule.values()]
      .map((entry) => ({
        ruleId: entry.ruleId,
        failureType: entry.failureType,
        rule: entry.rule,
        confidence: Math.round((entry.confidenceTotal / Math.max(entry.hitCount, 1)) * 100) / 100,
        evidenceCount: Math.min(entry.evidenceCountTotal, 50),
        conditions: uniqueStrings(entry.conditions).slice(0, 4)
      }))
      .map((entry) => {
        const impact = impactRules.find((rule) => rule.ruleId === entry.ruleId);
        const contextualImpact = this.studentRuleImpactTrackerService.findBestContext(
          impact ?? null,
          runtimeContext
        );
        const contextHasStrongEvidence = (contextualImpact?.observations ?? 0) >= 2;
        const contextIsNegative =
          (contextualImpact?.averageJudgeDelta ?? 0) < 0 ||
          (contextualImpact?.positiveImpactRate ?? 100) < 35;
        const effectiveImpact =
          contextualImpact && (contextHasStrongEvidence || contextIsNegative)
            ? contextualImpact
            : impact ?? null;
        const activationConfidence = effectiveImpact
          ? Math.round(((entry.confidence * 0.55 + effectiveImpact.empiricalConfidence * 0.45) * 100)) / 100
          : entry.confidence;
        const active = effectiveImpact
          ? effectiveImpact.activation === "active"
          : entry.confidence >= 0.55;
        const activationMode = contextualImpact && effectiveImpact === contextualImpact
          ? "contextual"
          : impact
            ? "overall"
            : "fallback";
        const activationReason = contextualImpact && effectiveImpact === contextualImpact
          ? `Contextual rule impact for ${contextualImpact.questionType}/${contextualImpact.promptLength} is ${contextualImpact.activation} over ${contextualImpact.observations} observations.`
          : impact
            ? `Overall rule impact is ${impact.activation} with average judge delta ${impact.averageJudgeDelta}.`
            : "No empirical rule impact yet; using lesson confidence fallback.";

        return {
          ...entry,
          confidence: activationConfidence,
          activationConfidence,
          activationMode,
          activationReason,
          active
        };
      })
      .sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          right.activationConfidence - left.activationConfidence ||
          right.evidenceCount - left.evidenceCount
      )
      .filter((entry) => entry.active)
      .slice(0, 4);
  }
}

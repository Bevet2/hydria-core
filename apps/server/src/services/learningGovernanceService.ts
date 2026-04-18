import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArenaRound } from "../types/arena.js";
import type { ArenaQualityAnalyticsReport } from "../types/analytics.js";
import {
  learningActiveMemorySchema,
  learningGovernanceReportSchema,
  type LearningActiveMemory,
  type LearningActiveMemoryItem,
  type LearningGovernanceReport,
  type LearningHotspot,
  type LearningLiveMonitoringStatus,
  type LearningPolicyItem,
  type LearningPolicyScope,
  type LearningPolicyState,
  type LearningPolicyTarget,
  type LearningValidationSummary
} from "../types/learning.js";
import type { KnowledgeLayer } from "../types/knowledge.js";
import type { StudentSession } from "../types/student.js";
import { env } from "../utils/env.js";
import {
  DEFAULT_LEARNING_IMPROVEMENT_WEIGHTS,
  LearningImprovementScoreService
} from "./learningImprovementScoreService.js";
import { HYDRIA_LEARNING_CONSTITUTION } from "./learningConstitution.js";
import { LearningHotspotService } from "./learningHotspotService.js";
import type { DiscoveryAdoption, StrategyDiscoveryFile } from "./studentStrategyDiscoveryService.js";
import type { StudentRuleImpactFile } from "./studentRuleImpactTrackerService.js";
import type { StudentStrategyImpactFile } from "./studentStrategyImpactTrackerService.js";
import type { StudentToolImpactFile } from "./studentToolImpactTrackerService.js";

type BuildGovernanceArgs = {
  rounds: ArenaRound[];
  sessions: StudentSession[];
  knowledgeLayer: KnowledgeLayer | null;
  arenaQuality: ArenaQualityAnalyticsReport;
  ruleImpact: StudentRuleImpactFile | null;
  strategyImpact: StudentStrategyImpactFile | null;
  toolImpact: StudentToolImpactFile | null;
  strategyDiscovery: StrategyDiscoveryFile | null;
  previousReport?: LearningGovernanceReport | null;
  validation?: LearningValidationSummary;
};

type LearningGovernanceServiceOptions = {
  governanceFile?: string;
  activeMemoryFile?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function percentage(matches: number, total: number) {
  if (total <= 0) {
    return null;
  }

  return Number(((matches / total) * 100).toFixed(1));
}

function buildScope(args: {
  category?: LearningPolicyScope["category"];
  questionType?: LearningPolicyScope["questionType"];
  promptLength?: LearningPolicyScope["promptLength"];
  signals?: LearningPolicyScope["signals"];
} = {}): LearningPolicyScope {
  return {
    category: args.category ?? null,
    questionType: args.questionType ?? null,
    promptLength: args.promptLength ?? null,
    signals: args.signals ?? []
  };
}

function stateToMemoryState(state: LearningPolicyState) {
  switch (state) {
    case "active":
      return "active" as const;
    case "guarded":
      return "risky" as const;
    case "archived":
      return "archived" as const;
    case "rejected":
      return "archived" as const;
    default:
      return "analyzed" as const;
  }
}

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function buildPolicyId(target: LearningPolicyTarget, targetId: string, scope: LearningPolicyScope) {
  const base = [
    target,
    targetId,
    scope.category ?? "global",
    scope.questionType ?? "any",
    scope.promptLength ?? "any",
    [...scope.signals].sort().join(",") || "none"
  ].join("::");

  if (base.length <= 120) {
    return base;
  }

  const hash = stableShortHash(base);
  return `${base.slice(0, 120 - hash.length - 2).trimEnd()}::${hash}`;
}

export class LearningGovernanceService {
  private readonly scoreService = new LearningImprovementScoreService();
  private readonly hotspotService = new LearningHotspotService();

  constructor(
    private readonly options: LearningGovernanceServiceOptions = {}
  ) {}

  buildReport(args: BuildGovernanceArgs): LearningGovernanceReport {
    const { weights, score } = this.scoreService.buildScore({
      rounds: args.rounds,
      sessions: args.sessions,
      knowledgeLayer: args.knowledgeLayer,
      toolImpact: args.toolImpact,
      arenaQuality: args.arenaQuality,
      weights: DEFAULT_LEARNING_IMPROVEMENT_WEIGHTS
    });
    const hotspots = this.hotspotService.buildHotspots({
      arenaQuality: args.arenaQuality,
      sessions: args.sessions,
      ruleImpact: args.ruleImpact,
      strategyImpact: args.strategyImpact,
      toolImpact: args.toolImpact
    });
    const draftPolicies = this.buildPolicies({
      hotspots,
      ruleImpact: args.ruleImpact,
      strategyImpact: args.strategyImpact,
      toolImpact: args.toolImpact,
      strategyDiscovery: args.strategyDiscovery
    });
    const rawMonitoringItems = this.buildLiveMonitoringItems({
      policies: draftPolicies,
      previousReport: args.previousReport ?? null,
      rounds: args.rounds,
      sessions: args.sessions
    });
    const policies = this.applyLiveMonitoring(draftPolicies, rawMonitoringItems);
    const liveMonitoring = this.buildLiveMonitoringSummary(policies, rawMonitoringItems);
    const lifecycle = {
      rawObservations: args.rounds.length + args.sessions.length,
      analyzedItems: hotspots.length + policies.length,
      activeItems: policies.filter((policy) => policy.state === "active").length,
      riskyItems: policies.filter((policy) => policy.state === "guarded").length,
      archivedItems: policies.filter((policy) =>
        policy.state === "archived" || policy.state === "rejected"
      ).length
    };

    return learningGovernanceReportSchema.parse({
      version: "hydria-learning-governance-v1",
      generatedAt: new Date().toISOString(),
      constitution: HYDRIA_LEARNING_CONSTITUTION,
      sourceStats: {
        arenaRoundsAnalyzed: args.rounds.length,
        studentSessionsAnalyzed: args.sessions.length,
        ruleObservationsAnalyzed: args.ruleImpact?.sourceStats.ruleObservations ?? 0,
        strategyObservationsAnalyzed: args.strategyImpact?.sourceStats.strategyObservations ?? 0,
        toolComparedSessionsAnalyzed: args.toolImpact?.sourceStats.comparedSessions ?? 0
      },
      weights,
      score,
      hotspots,
      policies,
      liveMonitoring,
      lifecycle,
      validation: args.validation ?? { mode: "none", summary: {} }
    });
  }

  buildActiveMemory(report: LearningGovernanceReport): LearningActiveMemory {
    const items: LearningActiveMemoryItem[] = report.policies
      .filter((policy) => policy.state === "active" || policy.state === "guarded")
      .sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidence - left.confidence ||
          (right.validation.averageJudgeDelta ?? 0) - (left.validation.averageJudgeDelta ?? 0)
      )
      .slice(0, 18)
      .map((policy) => ({
        itemId: policy.policyId,
        target: policy.target,
        state: policy.state,
        category: policy.scope.category,
        priority:
          policy.state === "active" && policy.confidence >= 0.8
            ? "high"
            : policy.state === "active"
              ? "medium"
              : "low",
        learned: policy.learned,
        modifies: policy.modifies,
        conditions: policy.conditions.slice(0, 4),
        confidence: policy.confidence,
        rationale: policy.rationale
      }));

    return learningActiveMemorySchema.parse({
      version: "hydria-learning-active-memory-v1",
      generatedAt: report.generatedAt,
      items
    });
  }

  async persistReport(report: LearningGovernanceReport) {
    const filePath = this.options.governanceFile ?? env.LEARNING_GOVERNANCE_FILE;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  async persistActiveMemory(memory: LearningActiveMemory) {
    const filePath = this.options.activeMemoryFile ?? env.LEARNING_ACTIVE_MEMORY_FILE;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  }

  async loadActiveMemory() {
    const filePath = this.options.activeMemoryFile ?? env.LEARNING_ACTIVE_MEMORY_FILE;

    try {
      const raw = await readFile(filePath, "utf8");
      return learningActiveMemorySchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async loadReport() {
    const filePath = this.options.governanceFile ?? env.LEARNING_GOVERNANCE_FILE;

    try {
      const raw = await readFile(filePath, "utf8");
      return learningGovernanceReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private buildPolicies(args: {
    hotspots: LearningHotspot[];
    ruleImpact: StudentRuleImpactFile | null;
    strategyImpact: StudentStrategyImpactFile | null;
    toolImpact: StudentToolImpactFile | null;
    strategyDiscovery: StrategyDiscoveryFile | null;
  }): LearningPolicyItem[] {
    const policies: LearningPolicyItem[] = [];
    const hotspotIdsByTarget = new Map<string, string[]>();

    for (const hotspot of args.hotspots) {
      const key = `${hotspot.target}:${hotspot.targetId ?? hotspot.role ?? hotspot.kind}`;
      const current = hotspotIdsByTarget.get(key) ?? [];
      current.push(hotspot.hotspotId);
      hotspotIdsByTarget.set(key, current);
    }

    for (const rule of args.ruleImpact?.rules ?? []) {
      const state: LearningPolicyState =
        rule.activation === "active"
          ? "active"
          : rule.activation === "inactive"
            ? "rejected"
            : "guarded";
      const scope = buildScope({ category: rule.category });
      const policyId = buildPolicyId("student_rule", rule.ruleId, scope);
      const key = `student_rule:${rule.ruleId}`;
      policies.push({
        policyId,
        target: "student_rule",
        targetId: rule.ruleId,
        state,
        memoryState: stateToMemoryState(state),
        scope,
        learned: rule.rule,
        modifies: "student memory injection and answer-shaping hints",
        conditions: uniqueStrings([rule.failureType.replaceAll("_", " "), ...rule.contexts.flatMap((context) => context.signals)]).slice(0, 6),
        confidence: rule.empiricalConfidence,
        stability: clamp(rule.observations / 6, 0, 1),
        sourceHotspotIds: hotspotIdsByTarget.get(key) ?? [],
        rationale:
          state === "active"
            ? `Observed positive judge delta ${rule.averageJudgeDelta} over ${rule.observations} rule comparison(s).`
            : `Rule is not consistently helping (${rule.averageJudgeDelta} average judge delta over ${rule.observations} observation(s)).`,
        validation: {
          observations: rule.observations,
          successRate: rule.successRate,
          positiveImpactRate: rule.positiveImpactRate,
          averageJudgeDelta: rule.averageJudgeDelta,
          averageGainGlobal: rule.averageGainGlobal,
          noReliableSourceRate: null,
          noOpRate: null,
          recencyWeight: clamp(rule.observations / 8, 0, 1),
          stabilityWeight: clamp(rule.positiveImpactRate / 100, 0, 1)
        },
        weights: {
          impactWeight: clamp(Math.max(rule.averageJudgeDelta, 0) / 6, 0, 1),
          confidenceWeight: rule.empiricalConfidence,
          stabilityWeight: clamp(rule.positiveImpactRate / 100, 0, 1),
          recencyWeight: clamp(rule.observations / 8, 0, 1)
        }
      });
    }

    for (const strategy of args.strategyImpact?.strategies ?? []) {
      const scope = buildScope();
      const policyId = buildPolicyId("student_strategy", strategy.strategyId, scope);
      const state: LearningPolicyState =
        strategy.activation === "active"
          ? "active"
          : strategy.activation === "inactive"
            ? "rejected"
            : "guarded";
      const key = `student_strategy:${strategy.strategyId}`;
      policies.push({
        policyId,
        target: "student_strategy",
        targetId: strategy.strategyId,
        state,
        memoryState: stateToMemoryState(state),
        scope,
        learned:
          state === "active"
            ? `Strategy ${strategy.strategyId} is empirically helpful in its observed contexts.`
            : `Strategy ${strategy.strategyId} is not yet stable enough to stay broadly active.`,
        modifies: "student strategy selection and fallback posture",
        conditions: uniqueStrings(strategy.contexts.flatMap((context) => context.signals)).slice(0, 6),
        confidence: strategy.empiricalConfidence,
        stability: clamp(strategy.observations / 8, 0, 1),
        sourceHotspotIds: hotspotIdsByTarget.get(key) ?? [],
        rationale:
          state === "active"
            ? `Average judge delta ${strategy.averageJudgeDelta} with positive impact rate ${strategy.positiveImpactRate}%.`
            : `Average judge delta ${strategy.averageJudgeDelta} with activation ${strategy.activation}.`,
        validation: {
          observations: strategy.observations,
          successRate: strategy.successRate,
          positiveImpactRate: strategy.positiveImpactRate,
          averageJudgeDelta: strategy.averageJudgeDelta,
          averageGainGlobal: strategy.averageGainGlobal,
          noReliableSourceRate: null,
          noOpRate: null,
          recencyWeight: clamp(strategy.observations / 8, 0, 1),
          stabilityWeight: clamp(strategy.positiveImpactRate / 100, 0, 1)
        },
        weights: {
          impactWeight: clamp(Math.max(strategy.averageJudgeDelta, 0) / 6, 0, 1),
          confidenceWeight: strategy.empiricalConfidence,
          stabilityWeight: clamp(strategy.positiveImpactRate / 100, 0, 1),
          recencyWeight: clamp(strategy.observations / 8, 0, 1)
        }
      });
    }

    for (const adoption of args.strategyDiscovery?.adoptions ?? []) {
      policies.push(this.buildDiscoveryPolicy(adoption));
    }

    if (args.toolImpact) {
      const noReliableSourceRate = args.toolImpact.overall.used.noReliableSourceRate;
      const judgeDelta = args.toolImpact.overall.averageJudgeDeltaDelta;
      const meetsPromotionBar =
        args.toolImpact.sourceStats.comparedSessions >=
          HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
        judgeDelta >= HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.minAverageJudgeDelta &&
        noReliableSourceRate <=
          HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.maxNoReliableSourceRate;
      const state: LearningPolicyState =
        noReliableSourceRate >= 50
          ? "guarded"
          : meetsPromotionBar
            ? "active"
            : "hypothesis";
      const scope = buildScope();
      const policyId = buildPolicyId("research_policy", "targeted_grounding", scope);
      policies.push({
        policyId,
        target: "research_policy",
        targetId: "targeted_grounding",
        state,
        memoryState: stateToMemoryState(state),
        scope,
        learned:
          state === "active"
            ? "Targeted research improves factual accuracy enough to stay active."
            : noReliableSourceRate >= 50
              ? "Targeted research remains useful, but too many runs still fail to find reliable sources."
              : "Research is promising but needs more validation before broader activation.",
        modifies: "research trigger posture and grounding trust",
        conditions: [
          "externally checkable claims",
          "temporal freshness queries",
          "provider-specific facts"
        ],
        confidence: clamp(
          (Math.max(args.toolImpact.overall.used.positiveImpactRate, 0) / 100) * 0.6 +
            clamp(args.toolImpact.sourceStats.comparedSessions / 8, 0, 1) * 0.4,
          0,
          1
        ),
        stability: clamp(1 - noReliableSourceRate / 100, 0, 1),
        sourceHotspotIds: [
          ...(hotspotIdsByTarget.get("research_policy:research") ?? []),
          ...(hotspotIdsByTarget.get("tool_policy:tool:weak-impact") ?? [])
        ].slice(0, 8),
        rationale:
          state === "active"
            ? `Average judge delta gain ${judgeDelta} with no-reliable-source rate ${noReliableSourceRate}%.`
            : `Guard research because no-reliable-source rate is ${noReliableSourceRate}% over ${args.toolImpact.sourceStats.comparedSessions} compared session(s).`,
        validation: {
          observations: args.toolImpact.sourceStats.comparedSessions,
          successRate: args.toolImpact.overall.used.successRate,
          positiveImpactRate: args.toolImpact.overall.used.positiveImpactRate,
          averageJudgeDelta: judgeDelta,
          averageGainGlobal: args.toolImpact.overall.averageJudgeDeltaDelta,
          noReliableSourceRate,
          noOpRate: null,
          recencyWeight: clamp(args.toolImpact.sourceStats.comparedSessions / 8, 0, 1),
          stabilityWeight: clamp(1 - noReliableSourceRate / 100, 0, 1)
        },
        weights: {
          impactWeight: clamp(Math.max(judgeDelta, 0) / 6, 0, 1),
          confidenceWeight: clamp(args.toolImpact.overall.used.positiveImpactRate / 100, 0, 1),
          stabilityWeight: clamp(1 - noReliableSourceRate / 100, 0, 1),
          recencyWeight: clamp(args.toolImpact.sourceStats.comparedSessions / 8, 0, 1)
        }
      });
    }

    return policies
      .sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidence - left.confidence ||
          right.validation.observations - left.validation.observations
      )
      .slice(0, 48);
  }

  private buildLiveMonitoringItems(args: {
    policies: LearningPolicyItem[];
    previousReport: LearningGovernanceReport | null;
    rounds: ArenaRound[];
    sessions: StudentSession[];
  }) {
    const windowStart = args.previousReport?.generatedAt ?? null;
    if (!windowStart) {
      return args.policies.map((policy) => ({
        policyId: policy.policyId,
        target: policy.target,
        targetId: policy.targetId,
        state: policy.state,
        status: "insufficient_data" as LearningLiveMonitoringStatus,
        windowStart: null,
        observations: 0,
        averageJudgeDelta: null,
        averageGainGlobal: null,
        positiveImpactRate: null,
        noOpRate: null,
        noReliableSourceRate: null,
        partialRate: null,
        regressionDelta: null,
        profitabilityScore: 0,
        riskScore: 0,
        summary: "No previous governance report exists yet, so live post-promotion monitoring has not started."
      }));
    }

    const startMs = new Date(windowStart).getTime();
    const recentSessions = args.sessions.filter(
      (session) => new Date(session.createdAt).getTime() >= startMs
    );
    const recentRounds = args.rounds.filter(
      (round) => new Date(round.createdAt).getTime() >= startMs
    );

    return args.policies.map((policy) => {
      const metrics = this.collectLiveMetrics(policy, recentSessions, recentRounds);
      const regressionDelta =
        metrics.averageJudgeDelta !== null && policy.validation.averageJudgeDelta !== null
          ? Number((metrics.averageJudgeDelta - policy.validation.averageJudgeDelta).toFixed(1))
          : null;
      const profitabilityScore = clamp(
        (Math.max(metrics.averageJudgeDelta ?? 0, 0) / 10) * 45 +
          ((metrics.positiveImpactRate ?? 0) / 100) * 35 +
          clamp(metrics.observations / 6, 0, 1) * 20,
        0,
        100
      );
      const riskScore = clamp(
        (Math.max(-(metrics.averageJudgeDelta ?? 0), 0) / 6) * 38 +
          ((metrics.noReliableSourceRate ?? 0) / 100) * 26 +
          ((metrics.noOpRate ?? 0) / 100) * 18 +
          ((metrics.partialRate ?? 0) / 100) * 18,
        0,
        100
      );
      const falsePositiveRisk =
        policy.state === "active" &&
        metrics.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
        ((metrics.averageJudgeDelta ?? 0) <= 0 ||
          (regressionDelta ?? 0) <=
            -HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.regressionTriggerDelta ||
          riskScore >= 60);
      let status: LearningLiveMonitoringStatus = "stable";
      let summary = "Policy stayed within its expected live behavior window.";

      if (metrics.observations === 0) {
        status = "insufficient_data";
        summary = "No live round or session has matched this policy since the previous learning cycle.";
      } else if (falsePositiveRisk) {
        status = "false_positive_risk";
        summary =
          "Live behavior is materially worse than validation suggested; keep this policy under watch.";
      } else if (
        regressionDelta !== null &&
        regressionDelta <= -HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.regressionTriggerDelta
      ) {
        status = "regressing";
        summary = "Live impact regressed versus the validation baseline for this policy.";
      } else if ((metrics.averageJudgeDelta ?? 0) >= Math.max(policy.validation.averageJudgeDelta ?? 0, 0)) {
        status = "improving";
        summary = "Live rounds confirm or exceed the validated improvement for this policy.";
      }

      return {
        policyId: policy.policyId,
        target: policy.target,
        targetId: policy.targetId,
        state: policy.state,
        status,
        windowStart,
        observations: metrics.observations,
        averageJudgeDelta: metrics.averageJudgeDelta,
        averageGainGlobal: metrics.averageGainGlobal,
        positiveImpactRate: metrics.positiveImpactRate,
        noOpRate: metrics.noOpRate,
        noReliableSourceRate: metrics.noReliableSourceRate,
        partialRate: metrics.partialRate,
        regressionDelta,
        profitabilityScore: Number(profitabilityScore.toFixed(1)),
        riskScore: Number(riskScore.toFixed(1)),
        summary
      };
    });
  }

  private collectLiveMetrics(
    policy: LearningPolicyItem,
    sessions: StudentSession[],
    rounds: ArenaRound[]
  ) {
    const judgeDeltas: number[] = [];
    const gains: number[] = [];
    let positiveCount = 0;
    let noOpCount = 0;
    let noReliableSourceCount = 0;
    let partialCount = 0;
    let observations = 0;

    if (policy.target === "student_rule") {
      for (const session of sessions) {
        if (!session.ruleImpact.compared) {
          continue;
        }

        const perRuleMatches = session.ruleImpact.perRule.filter(
          (entry) => entry.ruleId === policy.targetId
        );
        for (const entry of perRuleMatches) {
          observations += 1;
          judgeDeltas.push(entry.metrics.judgeOverallDelta);
          gains.push(entry.metrics.gainGlobal);
          positiveCount += Number(entry.metrics.success && entry.metrics.judgeOverallDelta > 0);
          noOpCount += Number(Math.abs(entry.metrics.judgeOverallDelta) < 1);
        }
      }
    } else if (policy.target === "student_strategy") {
      for (const session of sessions) {
        if (!session.strategyImpact.compared || session.strategyImpact.strategyId !== policy.targetId) {
          continue;
        }

        observations += 1;
        judgeDeltas.push(session.strategyImpact.metrics.judgeOverallDelta);
        gains.push(session.strategyImpact.metrics.gainGlobal);
        positiveCount += Number(
          session.strategyImpact.metrics.success && session.strategyImpact.metrics.judgeOverallDelta > 0
        );
        noOpCount += Number(Math.abs(session.strategyImpact.metrics.judgeOverallDelta) < 1);
      }
    } else if (policy.target === "research_policy" || policy.target === "tool_policy") {
      for (const session of sessions) {
        if (!session.tooling.compared || !session.tooling.toolUsed) {
          continue;
        }

        observations += 1;
        judgeDeltas.push(session.tooling.metrics.judgeOverallDelta);
        gains.push(session.tooling.metrics.gainGlobal);
        positiveCount += Number(
          session.tooling.metrics.success && session.tooling.metrics.judgeOverallDelta > 0
        );
        noOpCount += Number(Math.abs(session.tooling.metrics.judgeOverallDelta) < 1);
        noReliableSourceCount += Number(session.tooling.noReliableSource);
      }
    } else if (policy.target === "local_student_policy") {
      for (const round of rounds) {
        observations += 1;
        const localReasons = round.workflow.degradationReasons.filter(
          (reason) => reason.role === "local_student"
        );
        partialCount += Number(localReasons.length > 0);
        positiveCount += Number(localReasons.length === 0);
      }
    }

    return {
      observations,
      averageJudgeDelta: average(judgeDeltas),
      averageGainGlobal: average(gains),
      positiveImpactRate: percentage(positiveCount, observations),
      noOpRate: percentage(noOpCount, observations),
      noReliableSourceRate:
        policy.target === "research_policy" || policy.target === "tool_policy"
          ? percentage(noReliableSourceCount, observations)
          : null,
      partialRate: policy.target === "local_student_policy" ? percentage(partialCount, observations) : null
    };
  }

  private applyLiveMonitoring(
    policies: LearningPolicyItem[],
    items: Array<{
      policyId: string;
      status: LearningLiveMonitoringStatus;
      summary: string;
    }>
  ) {
    const itemById = new Map(items.map((item) => [item.policyId, item]));

    return policies.map((policy) => {
      const monitoring = itemById.get(policy.policyId);
      if (!monitoring) {
        return policy;
      }

      if (monitoring.status === "false_positive_risk" && policy.state === "active") {
        return {
          ...policy,
          state: "guarded" as const,
          memoryState: "risky" as const,
          rationale: `${policy.rationale} Live monitoring alert: ${monitoring.summary}`
        };
      }

      return policy;
    });
  }

  private buildLiveMonitoringSummary(
    policies: LearningPolicyItem[],
    rawItems: Array<{
      policyId: string;
      target: LearningPolicyTarget;
      targetId: string;
      state: LearningPolicyState;
      status: LearningLiveMonitoringStatus;
      windowStart: string | null;
      observations: number;
      averageJudgeDelta: number | null;
      averageGainGlobal: number | null;
      positiveImpactRate: number | null;
      noOpRate: number | null;
      noReliableSourceRate: number | null;
      partialRate: number | null;
      regressionDelta: number | null;
      profitabilityScore: number;
      riskScore: number;
      summary: string;
    }>
  ) {
    const policyById = new Map(policies.map((policy) => [policy.policyId, policy]));
    const items = rawItems.map((item) => ({
      ...item,
      state: policyById.get(item.policyId)?.state ?? item.state
    }));
    const withLiveData = items.filter((item) => item.observations > 0);
    const activeItems = items.filter((item) => item.state === "active" || item.state === "guarded");
    const topGains = [...withLiveData]
      .sort(
        (left, right) =>
          (right.averageJudgeDelta ?? -Infinity) - (left.averageJudgeDelta ?? -Infinity) ||
          right.profitabilityScore - left.profitabilityScore
      )
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.profitabilityScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));
    const topRegressions = [...withLiveData]
      .sort(
        (left, right) =>
          (left.regressionDelta ?? Infinity) - (right.regressionDelta ?? Infinity) ||
          (left.averageJudgeDelta ?? Infinity) - (right.averageJudgeDelta ?? Infinity)
      )
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.riskScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));
    const mostProfitableActive = [...activeItems]
      .sort((left, right) => right.profitabilityScore - left.profitabilityScore)
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.profitabilityScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));
    const mostRiskyActive = [...activeItems]
      .sort((left, right) => right.riskScore - left.riskScore)
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.riskScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));

    return {
      windowStart: rawItems[0]?.windowStart ?? null,
      monitoredPolicies: items.length,
      policiesWithLiveData: withLiveData.length,
      falsePositiveAlerts: items.filter((item) => item.status === "false_positive_risk").length,
      items,
      topGains,
      topRegressions,
      mostProfitableActive,
      mostRiskyActive
    };
  }

  private buildDiscoveryPolicy(adoption: DiscoveryAdoption): LearningPolicyItem {
    const meetsPromotionBar =
      adoption.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
      adoption.averageJudgeDelta >= HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.minAverageJudgeDelta;
    const state: LearningPolicyState =
      adoption.adoption === "adopted"
        ? meetsPromotionBar
          ? "active"
          : "validating"
        : adoption.adoption === "pending"
          ? "validating"
          : "rejected";
    const scope = buildScope({
      category: adoption.category,
      questionType: adoption.context.questionType,
      promptLength: adoption.context.promptLength,
      signals: adoption.context.signals
    });

    return {
      policyId: buildPolicyId(
        "student_strategy",
        `${adoption.baseStrategyId}->${adoption.candidateStrategyId}`,
        scope
      ),
      target: "student_strategy",
      targetId: adoption.candidateStrategyId,
      state,
      memoryState: stateToMemoryState(state),
      scope,
      learned: `Use ${adoption.candidateStrategyId} instead of ${adoption.baseStrategyId}.`,
      modifies: "contextual student strategy replacement",
      conditions: uniqueStrings([
        adoption.context.questionType,
        adoption.context.promptLength,
        ...adoption.context.signals
      ]).slice(0, 6),
      confidence: clamp(
        adoption.averageJudgeDelta / 8 * 0.4 +
          adoption.winRate / 100 * 0.3 +
          (adoption.productGuard.passed ? 0.3 : 0.15),
        0,
        1
      ),
      stability: clamp(adoption.observations / 6, 0, 1),
      sourceHotspotIds: [],
      rationale: adoption.reason,
      validation: {
        observations: adoption.observations,
        successRate: adoption.winRate,
        positiveImpactRate: adoption.winRate,
        averageJudgeDelta: adoption.averageJudgeDelta,
        averageGainGlobal: adoption.averageGainGlobal,
        noReliableSourceRate: null,
        noOpRate: null,
        recencyWeight: clamp(adoption.observations / 6, 0, 1),
        stabilityWeight: clamp(adoption.winRate / 100, 0, 1)
      },
      weights: {
        impactWeight: clamp(Math.max(adoption.averageJudgeDelta, 0) / 6, 0, 1),
        confidenceWeight: clamp(adoption.winRate / 100, 0, 1),
        stabilityWeight: adoption.productGuard.passed ? 0.9 : 0.4,
        recencyWeight: clamp(adoption.observations / 6, 0, 1)
      }
    };
  }
}

import type { ArenaQualityAnalyticsReport } from "../types/analytics.js";
import type {
  LearningHotspot,
  LearningHotspotKind,
  LearningHotspotSeverity,
  LearningPolicyTarget
} from "../types/learning.js";
import type { StudentSession } from "../types/student.js";
import type { StudentRuleImpactFile } from "./studentRuleImpactTrackerService.js";
import type { StudentStrategyImpactFile } from "./studentStrategyImpactTrackerService.js";
import type { StudentToolImpactFile } from "./studentToolImpactTrackerService.js";

type BuildHotspotsArgs = {
  arenaQuality: ArenaQualityAnalyticsReport;
  sessions: StudentSession[];
  ruleImpact: StudentRuleImpactFile | null;
  strategyImpact: StudentStrategyImpactFile | null;
  toolImpact: StudentToolImpactFile | null;
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function severityFromScore(score: number): LearningHotspotSeverity {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function weightedScore(args: { frequencyPct: number; severityScore: number; confidenceScore: number }) {
  return round(
    clamp(
      args.frequencyPct * 0.35 + args.severityScore * 0.45 + args.confidenceScore * 0.2,
      0,
      100
    )
  );
}

function pushHotspot(
  target: LearningHotspot[],
  args: {
    id: string;
    kind: LearningHotspotKind;
    source: LearningHotspot["source"];
    title: string;
    summary: string;
    targetType: LearningPolicyTarget;
    targetId?: string | null;
    category?: LearningHotspot["category"];
    role?: LearningHotspot["role"];
    frequencyPct: number;
    severityScore: number;
    confidenceScore: number;
    observations: number;
    whyItMatters: string;
    suggestedAction: string;
  }
) {
  target.push({
    hotspotId: args.id,
    kind: args.kind,
    severity: severityFromScore(args.severityScore),
    source: args.source,
    category: args.category ?? null,
    role: args.role ?? null,
    title: args.title,
    summary: args.summary,
    target: args.targetType,
    targetId: args.targetId ?? null,
    frequencyPct: round(args.frequencyPct),
    severityScore: round(args.severityScore),
    confidenceScore: round(args.confidenceScore),
    weightedScore: weightedScore(args),
    observations: args.observations,
    whyItMatters: args.whyItMatters,
    suggestedAction: args.suggestedAction
  });
}

export class LearningHotspotService {
  buildHotspots(args: BuildHotspotsArgs): LearningHotspot[] {
    const hotspots: LearningHotspot[] = [];

    for (const reason of args.arenaQuality.topDegradationReasons) {
      const kind: LearningHotspotKind =
        reason.code === "research_failed"
          ? "research"
          : reason.role === "local_student"
            ? "local_student"
            : "workflow";
      const severityScore =
        reason.impact === "step_missing"
          ? 88
          : reason.impact === "grounding_gap"
            ? 80
            : 72;
      pushHotspot(hotspots, {
        id: `arena:${reason.key}`,
        kind,
        source: "arena_quality",
        title: `${reason.code.replaceAll("_", " ")}${reason.role ? ` (${reason.role})` : ""}`,
        summary: `This degradation reason appears in ${reason.count} classified partial round(s).`,
        targetType:
          kind === "local_student"
            ? "local_student_policy"
            : kind === "research"
              ? "research_policy"
              : "memory_rule",
        role: reason.role,
        frequencyPct: reason.percentage,
        severityScore,
        confidenceScore: clamp(50 + reason.count * 8, 0, 95),
        observations: reason.count,
        whyItMatters:
          kind === "local_student"
            ? "Observer degradation creates partial rounds and weakens the learning signal."
            : kind === "research"
              ? "Research failures reduce factual grounding and make temporal verification brittle."
              : "Critical workflow degradations reduce trust in the pipeline even when the round completes.",
        suggestedAction:
          kind === "local_student"
            ? "Harden parsing, constrain outputs, and keep the fallback path explicit."
            : kind === "research"
              ? "Improve source acquisition or reduce over-triggering in contexts with weak proof availability."
              : "Reduce critical fallbacks on the implicated workflow role."
      });
    }

    for (const role of args.arenaQuality.roleBreakdown) {
      if (role.count <= 0) {
        continue;
      }

      pushHotspot(hotspots, {
        id: `arena-role:${role.role}`,
        kind: role.role === "local_student" ? "local_student" : "workflow",
        source: "arena_quality",
        title: `${role.role} degrades rounds frequently`,
        summary: `${role.role} is implicated in ${role.count} classified partial round(s).`,
        targetType: role.role === "local_student" ? "local_student_policy" : "memory_rule",
        role: role.role,
        frequencyPct: role.percentage,
        severityScore: clamp(55 + role.failureCount * 12 + role.fallbackCount * 8, 0, 95),
        confidenceScore: clamp(50 + role.count * 6, 0, 95),
        observations: role.count,
        whyItMatters: "Role-level degradation is the shortest path to a reliable system-wide quality gain.",
        suggestedAction: "Prioritize this role in targeted fixes before adding new capabilities."
      });
    }

    if (args.toolImpact) {
      if (args.toolImpact.overall.used.noReliableSourceRate >= 35) {
        pushHotspot(hotspots, {
          id: "tool:no-reliable-source",
          kind: "research",
          source: "student_tool_impact",
          title: "Grounding often fails to find reliable sources",
          summary: `Tool-assisted sessions still end in no reliable source ${args.toolImpact.overall.used.noReliableSourceRate}% of the time.`,
          targetType: "research_policy",
          frequencyPct: args.toolImpact.overall.used.noReliableSourceRate,
          severityScore: clamp(args.toolImpact.overall.used.noReliableSourceRate, 0, 95),
          confidenceScore: clamp(45 + args.toolImpact.overall.used.observations * 6, 0, 95),
          observations: args.toolImpact.overall.used.observations,
          whyItMatters: "A high no-reliable-source rate means research burns latency and cost without improving truth.",
          suggestedAction: "Improve retrieval/verification for the failing contexts or demote tool usage there."
        });
      }

      if (args.toolImpact.overall.averageJudgeDeltaDelta < 0.5) {
        pushHotspot(hotspots, {
          id: "tool:weak-impact",
          kind: "research",
          source: "student_tool_impact",
          title: "Research has weak or negative impact",
          summary: `Tool use changes judge delta by only ${args.toolImpact.overall.averageJudgeDeltaDelta}.`,
          targetType: "tool_policy",
          frequencyPct: args.toolImpact.overall.used.positiveImpactRate,
          severityScore: clamp(70 - args.toolImpact.overall.averageJudgeDeltaDelta * 8, 35, 90),
          confidenceScore: clamp(45 + args.toolImpact.sourceStats.comparedSessions * 4, 0, 95),
          observations: args.toolImpact.sourceStats.comparedSessions,
          whyItMatters: "Weak research ROI should not stay active as a broad default.",
          suggestedAction: "Restrict tooling to contexts where it yields verified improvements."
        });
      }
    }

    for (const strategy of args.strategyImpact?.strategies ?? []) {
      if (strategy.observations < 2 || strategy.activation !== "inactive") {
        continue;
      }

      pushHotspot(hotspots, {
        id: `strategy:${strategy.strategyId}`,
        kind: "strategy",
        source: "student_strategy_impact",
        title: `${strategy.strategyId} is empirically weak`,
        summary: `${strategy.strategyId} averages judge delta ${strategy.averageJudgeDelta} over ${strategy.observations} observations.`,
        targetType: "student_strategy",
        targetId: strategy.strategyId,
        frequencyPct: strategy.usageRate,
        severityScore: clamp(60 + Math.abs(Math.min(strategy.averageJudgeDelta, 0)) * 10, 0, 95),
        confidenceScore: clamp(strategy.empiricalConfidence * 100, 0, 95),
        observations: strategy.observations,
        whyItMatters: "Weak strategies should be demoted or narrowed before they keep shaping future answers.",
        suggestedAction: "Demote this strategy globally or localize it to the few contexts where it still helps."
      });
    }

    for (const rule of args.ruleImpact?.rules ?? []) {
      if (rule.observations < 2 || rule.activation === "active") {
        continue;
      }

      pushHotspot(hotspots, {
        id: `rule:${rule.ruleId}`,
        kind: rule.failureType === "unsupported_claim" ? "hallucination" : "refine",
        source: "student_rule_impact",
        title: `${rule.failureType.replaceAll("_", " ")} rule is not reliably helping`,
        summary: `${rule.rule} averages judge delta ${rule.averageJudgeDelta} over ${rule.observations} observations.`,
        targetType: "student_rule",
        targetId: rule.ruleId,
        category: rule.category,
        frequencyPct: rule.positiveImpactRate,
        severityScore: clamp(55 + Math.abs(Math.min(rule.averageJudgeDelta, 0)) * 10, 0, 95),
        confidenceScore: clamp(rule.empiricalConfidence * 100, 0, 95),
        observations: rule.observations,
        whyItMatters: "Low-performing rules pollute active memory and make the system harder to steer.",
        suggestedAction: "Guard or reject this rule until new evidence shows a stable positive effect."
      });
    }

    const unsupportedClaimSessions = args.sessions.filter((session) =>
      session.lessonsLearned.some((lesson) => lesson.failureType === "unsupported_claim")
    );
    if (unsupportedClaimSessions.length > 0) {
      const frequencyPct = (unsupportedClaimSessions.length / Math.max(args.sessions.length, 1)) * 100;
      pushHotspot(hotspots, {
        id: "sessions:unsupported-claim",
        kind: "hallucination",
        source: "student_sessions",
        title: "Unsupported-claim lessons keep recurring",
        summary: `${unsupportedClaimSessions.length} student session(s) recorded unsupported-claim lessons.`,
        targetType: "memory_rule",
        frequencyPct,
        severityScore: clamp(60 + frequencyPct * 0.4, 0, 95),
        confidenceScore: clamp(45 + unsupportedClaimSessions.length * 5, 0, 95),
        observations: unsupportedClaimSessions.length,
        whyItMatters: "Repeated unsupported-claim lessons are a direct signal of factuality drift.",
        suggestedAction: "Promote stronger verification heuristics or stricter claim phrasing in the affected categories."
      });
    }

    return hotspots
      .sort(
        (left, right) =>
          right.weightedScore - left.weightedScore ||
          right.observations - left.observations ||
          left.title.localeCompare(right.title)
      )
      .slice(0, 24);
  }
}

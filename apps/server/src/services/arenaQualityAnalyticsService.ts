import type { ArenaRound } from "../types/arena.js";
import { arenaQualityAnalyticsReportSchema, type ArenaQualityAnalyticsReport } from "../types/analytics.js";
import type { HydriaActorRole, HydriaWorkflowDegradationReason } from "../types/core.js";
import type {
  ArenaRespondentFailureCauseStat,
  ArenaRespondentFailureEvent,
  RespondentFailureClass,
  RespondentFailureStage,
  RespondentFailureSource,
  RespondentSlot
} from "../types/analytics.js";

const RECENT_WINDOW = 12;

function roundPct(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Number(((value / total) * 100).toFixed(1));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function compareByCreatedAtDesc(left: ArenaRound, right: ArenaRound) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function parseFailureClassFromTraceNote(note: string): RespondentFailureClass | null {
  const match = note.match(/Failure class=([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = (match[1] ?? "").toLowerCase();
  switch (value) {
    case "provider_error":
    case "timeout":
    case "empty_response":
    case "structured_output":
    case "quality_gate":
    case "unknown":
      return value;
    default:
      return null;
  }
}

function parseFailureStageFromTraceNote(note: string): RespondentFailureStage | null {
  const match = note.match(/stage=([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const value = (match[1] ?? "").toLowerCase();
  switch (value) {
    case "primary":
    case "repair_retry":
    case "fallback":
    case "unknown":
      return value;
    default:
      return null;
  }
}

function classifyPartialRound(round: ArenaRound): "classified" | "legacy" | null {
  if (round.workflow.status !== "partial") {
    return null;
  }

  return round.workflow.degradationReasons.length > 0 ? "classified" : "legacy";
}

function getWinnerScore(round: ArenaRound) {
  const winner = round.outputs.judge.winner;
  if (winner === "tie") {
    return average([
      round.outputs.judge.scores.A.overall,
      round.outputs.judge.scores.B.overall
    ]);
  }

  return round.outputs.judge.scores[winner].overall;
}

function buildImpactCohort(rounds: ArenaRound[]) {
  const winnerScores = rounds
    .map((round) => getWinnerScore(round))
    .filter((value): value is number => value !== null);
  const refinedScores = rounds.map((round) => round.metrics.scoreAverages.refined);
  const synthImprovements = rounds.map((round) => round.outputs.synthesizer.improvements_added.length);
  const localLearningNotes = rounds.map((round) => round.outputs.localStudent.learning_notes.length);
  const winnerDistribution = rounds.reduce(
    (distribution, round) => {
      distribution[round.outputs.judge.winner] += 1;
      return distribution;
    },
    {
      A: 0,
      B: 0,
      tie: 0
    }
  );

  return {
    count: rounds.length,
    averageWinnerScore: average(winnerScores),
    averageRefinedScore: average(refinedScores),
    averageSynthesisImprovements: average(synthImprovements),
    averageLocalLearningNotes: average(localLearningNotes),
    winnerDistribution,
    tieRatePct: rounds.length > 0 ? roundPct(winnerDistribution.tie, rounds.length) : null
  };
}

type ReasonAccumulator = {
  code: HydriaWorkflowDegradationReason["code"];
  impact: HydriaWorkflowDegradationReason["impact"];
  role: HydriaActorRole | null;
  count: number;
};

type RoleAccumulator = {
  role: HydriaActorRole;
  count: number;
  fallbackCount: number;
  failureCount: number;
  groundingGapCount: number;
};

type RespondentFailureAccumulator = {
  source: RespondentFailureSource;
  slot: RespondentSlot | null;
  failureClass: RespondentFailureClass;
  failureStage: RespondentFailureStage;
  count: number;
  stageFailureCount: number;
  rescuedCount: number;
  latestSeenAt: string | null;
};

export class ArenaQualityAnalyticsService {
  buildReport(
    rounds: ArenaRound[],
    respondentFailures: ArenaRespondentFailureEvent[] = []
  ): ArenaQualityAnalyticsReport {
    const sortedRounds = [...rounds].sort(compareByCreatedAtDesc);
    const completedRounds = sortedRounds.filter((round) => round.workflow.status === "completed");
    const partialRounds = sortedRounds.filter((round) => round.workflow.status === "partial");
    const classifiedPartialRounds = partialRounds.filter(
      (round) => classifyPartialRound(round) === "classified"
    );
    const legacyPartialRounds = partialRounds.filter(
      (round) => classifyPartialRound(round) === "legacy"
    );
    const failedRounds = sortedRounds.filter((round) => round.workflow.status === "failed");
    const recentRounds = sortedRounds.slice(0, RECENT_WINDOW);
    const reasonMap = new Map<string, ReasonAccumulator>();
    const roleMap = new Map<HydriaActorRole, RoleAccumulator>();
    const respondentFailureMap = new Map<string, RespondentFailureAccumulator>();
    let respondentStaticFallbackCount = 0;

    const registerRespondentFailure = (args: {
      source: RespondentFailureSource;
      slot: RespondentSlot | null;
      failureClass: RespondentFailureClass;
      failureStage: RespondentFailureStage;
      createdAt: string | null;
    }) => {
      const key = `${args.source}|${args.slot ?? "none"}|${args.failureClass}|${args.failureStage}`;
      const current = respondentFailureMap.get(key) ?? {
        source: args.source,
        slot: args.slot,
        failureClass: args.failureClass,
        failureStage: args.failureStage,
        count: 0,
        stageFailureCount: 0,
        rescuedCount: 0,
        latestSeenAt: null
      };
      current.count += 1;
      current.stageFailureCount += Number(args.source === "stage_failure");
      current.rescuedCount += Number(args.source === "rescued_round");
      if (args.createdAt && (!current.latestSeenAt || args.createdAt > current.latestSeenAt)) {
        current.latestSeenAt = args.createdAt;
      }
      respondentFailureMap.set(key, current);
    };

    for (const round of classifiedPartialRounds) {
      for (const reason of round.workflow.degradationReasons) {
        const key = `${reason.code}|${reason.impact}|${reason.role ?? "none"}`;
        const currentReason = reasonMap.get(key) ?? {
          code: reason.code,
          impact: reason.impact,
          role: reason.role,
          count: 0
        };
        currentReason.count += 1;
        reasonMap.set(key, currentReason);

        if (reason.role) {
          const currentRole = roleMap.get(reason.role) ?? {
            role: reason.role,
            count: 0,
            fallbackCount: 0,
            failureCount: 0,
            groundingGapCount: 0
          };
          currentRole.count += 1;
          if (reason.code === "critical_role_fallback") {
            currentRole.fallbackCount += 1;
          }
          if (reason.code === "critical_role_failure") {
            currentRole.failureCount += 1;
          }
          if (reason.impact === "grounding_gap") {
            currentRole.groundingGapCount += 1;
          }
          roleMap.set(reason.role, currentRole);
        }
      }
    }

    for (const round of sortedRounds) {
      const respondentTraces = [
        { slot: "A" as const, trace: round.trace.respondentA },
        { slot: "B" as const, trace: round.trace.respondentB }
      ];
      for (const respondentTrace of respondentTraces) {
        if (respondentTrace.trace.outcome !== "static_fallback") {
          continue;
        }
        respondentStaticFallbackCount += 1;
        registerRespondentFailure({
          source: "rescued_round",
          slot: respondentTrace.slot,
          failureClass:
            parseFailureClassFromTraceNote(respondentTrace.trace.note) ?? "unknown",
          failureStage:
            parseFailureStageFromTraceNote(respondentTrace.trace.note) ?? "unknown",
          createdAt: round.createdAt
        });
      }
    }

    for (const failure of respondentFailures) {
      registerRespondentFailure({
        source: "stage_failure",
        slot: failure.slot,
        failureClass: failure.failureClass,
        failureStage: failure.failureStage,
        createdAt: failure.createdAt
      });
    }

    const topDegradationReasons = [...reasonMap.entries()]
      .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
      .slice(0, 10)
      .map(([key, value]) => ({
        key,
        code: value.code,
        impact: value.impact,
        role: value.role,
        count: value.count,
        percentage: roundPct(value.count, classifiedPartialRounds.length)
      }));

    const roleBreakdown = [...roleMap.values()]
      .sort(
        (left, right) =>
          right.count - left.count ||
          (right.fallbackCount + right.failureCount) - (left.fallbackCount + left.failureCount) ||
          right.groundingGapCount - left.groundingGapCount ||
          left.role.localeCompare(right.role)
      )
      .slice(0, 12)
      .map((value) => ({
        role: value.role,
        count: value.count,
        percentage: roundPct(value.count, classifiedPartialRounds.length),
        fallbackCount: value.fallbackCount,
        failureCount: value.failureCount,
        groundingGapCount: value.groundingGapCount
      }));

    const totalRespondentFailureSignals =
      respondentFailures.length + respondentStaticFallbackCount;
    const topRespondentFailureCauses: ArenaRespondentFailureCauseStat[] = [...respondentFailureMap.entries()]
      .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
      .slice(0, 10)
      .map(([key, value]) => ({
        key,
        source: value.source,
        slot: value.slot,
        failureClass: value.failureClass,
        failureStage: value.failureStage,
        count: value.count,
        percentage: roundPct(value.count, totalRespondentFailureSignals),
        stageFailureCount: value.stageFailureCount,
        rescuedCount: value.rescuedCount,
        latestSeenAt: value.latestSeenAt
      }));

    const completedImpact = buildImpactCohort(completedRounds);
    const classifiedPartialImpact = buildImpactCohort(classifiedPartialRounds);
    const legacyPartialImpact = buildImpactCohort(legacyPartialRounds);
    const recentPartialRounds = recentRounds.filter((round) => round.workflow.status === "partial");
    const recentClassifiedPartialRounds = recentPartialRounds.filter(
      (round) => classifyPartialRound(round) === "classified"
    );
    const recentLegacyPartialRounds = recentPartialRounds.filter(
      (round) => classifyPartialRound(round) === "legacy"
    );

    return arenaQualityAnalyticsReportSchema.parse({
      generatedAt: new Date().toISOString(),
      summary: {
        totalRounds: sortedRounds.length,
        completedRounds: completedRounds.length,
        partialRounds: partialRounds.length,
        classifiedPartialRounds: classifiedPartialRounds.length,
        legacyPartialRounds: legacyPartialRounds.length,
        failedRounds: failedRounds.length,
        partialRatePct: roundPct(partialRounds.length, sortedRounds.length),
        classifiedPartialRatePct: roundPct(classifiedPartialRounds.length, sortedRounds.length),
        legacyPartialRatePct: roundPct(legacyPartialRounds.length, sortedRounds.length),
        recentWindow: RECENT_WINDOW,
        recentPartialRatePct:
          recentRounds.length > 0
            ? roundPct(recentPartialRounds.length, recentRounds.length)
            : null,
        recentClassifiedPartialRatePct:
          recentRounds.length > 0
            ? roundPct(recentClassifiedPartialRounds.length, recentRounds.length)
            : null,
        recentLegacyPartialRatePct:
          recentRounds.length > 0
            ? roundPct(recentLegacyPartialRounds.length, recentRounds.length)
            : null,
        topDegradingRole: roleBreakdown[0]?.role ?? null,
        respondentStageFailureCount: respondentFailures.length,
        respondentStageFailureRatePct: roundPct(
          respondentFailures.length,
          sortedRounds.length + respondentFailures.length
        ),
        respondentStaticFallbackCount,
        respondentStaticFallbackRatePct: roundPct(
          respondentStaticFallbackCount,
          Math.max(sortedRounds.length * 2, 1)
        ),
        averageJudgeWinnerScoreCompleted: completedImpact.averageWinnerScore,
        averageJudgeWinnerScoreClassifiedPartial: classifiedPartialImpact.averageWinnerScore,
        averageJudgeWinnerScoreLegacyPartial: legacyPartialImpact.averageWinnerScore
      },
      recentStatuses: recentRounds.map((round) => ({
        roundId: round.roundId,
        createdAt: round.createdAt,
        status: round.workflow.status,
        partialKind: classifyPartialRound(round)
      })),
      topDegradationReasons,
      roleBreakdown,
      respondentReliability: {
        stageFailures: respondentFailures.length,
        rescuedStaticFallbacks: respondentStaticFallbackCount,
        topFailureCauses: topRespondentFailureCauses,
        recentFailures: [...respondentFailures]
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 8)
      },
      impact: {
        completed: completedImpact,
        classifiedPartial: classifiedPartialImpact,
        legacyPartial: legacyPartialImpact
      }
    });
  }
}

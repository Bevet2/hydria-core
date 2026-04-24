import { z } from "zod";
import {
  hydriaActorRoleSchema,
  hydriaWorkflowDegradationCodeSchema,
  hydriaWorkflowDegradationImpactSchema,
  hydriaWorkflowStatusSchema
} from "./core.js";

const winnerSchema = z.enum(["A", "B", "tie"]);
const arenaQualityPartialKindSchema = z.enum(["classified", "legacy"]);
export const respondentFailureClassSchema = z.enum([
  "provider_error",
  "timeout",
  "empty_response",
  "structured_output",
  "quality_gate",
  "unknown"
]);
export const respondentFailureStageSchema = z.enum([
  "primary",
  "repair_retry",
  "fallback",
  "unknown"
]);
export const respondentFailureSourceSchema = z.enum(["stage_failure", "rescued_round"]);
export const respondentSlotSchema = z.enum(["A", "B"]);

export const arenaQualitySummarySchema = z.object({
  totalRounds: z.number().int().nonnegative(),
  completedRounds: z.number().int().nonnegative(),
  partialRounds: z.number().int().nonnegative(),
  classifiedPartialRounds: z.number().int().nonnegative(),
  legacyPartialRounds: z.number().int().nonnegative(),
  failedRounds: z.number().int().nonnegative(),
  partialRatePct: z.number().min(0).max(100),
  classifiedPartialRatePct: z.number().min(0).max(100),
  legacyPartialRatePct: z.number().min(0).max(100),
  recentWindow: z.number().int().positive().max(50),
  recentPartialRatePct: z.number().min(0).max(100).nullable(),
  recentClassifiedPartialRatePct: z.number().min(0).max(100).nullable(),
  recentLegacyPartialRatePct: z.number().min(0).max(100).nullable(),
  topDegradingRole: hydriaActorRoleSchema.nullable(),
  respondentStageFailureCount: z.number().int().nonnegative(),
  respondentStageFailureRatePct: z.number().min(0).max(100),
  respondentStaticFallbackCount: z.number().int().nonnegative(),
  respondentStaticFallbackRatePct: z.number().min(0).max(100),
  averageJudgeWinnerScoreCompleted: z.number().min(0).max(100).nullable(),
  averageJudgeWinnerScoreClassifiedPartial: z.number().min(0).max(100).nullable(),
  averageJudgeWinnerScoreLegacyPartial: z.number().min(0).max(100).nullable()
});

export const arenaQualityRecentStatusSchema = z.object({
  roundId: z.string().uuid(),
  createdAt: z.string().datetime(),
  status: hydriaWorkflowStatusSchema,
  partialKind: arenaQualityPartialKindSchema.nullable()
});

export const arenaQualityDegradationReasonStatSchema = z.object({
  key: z.string().min(1).max(160),
  code: hydriaWorkflowDegradationCodeSchema,
  impact: hydriaWorkflowDegradationImpactSchema,
  role: hydriaActorRoleSchema.nullable(),
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100)
});

export const arenaQualityRoleStatSchema = z.object({
  role: hydriaActorRoleSchema,
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  fallbackCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  groundingGapCount: z.number().int().nonnegative()
});

export const arenaRespondentFailureEventSchema = z.object({
  eventId: z.string().uuid(),
  roundId: z.string().uuid(),
  createdAt: z.string().datetime(),
  category: z.string().min(1).max(80),
  slot: respondentSlotSchema,
  requestedModel: z.string().min(1).max(160),
  finalModel: z.string().min(1).max(160),
  failureClass: respondentFailureClassSchema,
  failureStage: respondentFailureStageSchema,
  attemptsCount: z.number().int().nonnegative().max(6),
  validationFailures: z.number().int().nonnegative().max(6),
  usedRetry: z.boolean(),
  usedFallback: z.boolean(),
  failureMessage: z.string().min(1).max(240),
  note: z.string().min(1).max(320)
});

export const arenaRespondentFailureLogSchema = z.object({
  version: z.literal("hydria-respondent-failures-v1"),
  events: z.array(arenaRespondentFailureEventSchema).max(500)
});

export const arenaRespondentFailureCauseStatSchema = z.object({
  key: z.string().min(1).max(160),
  source: respondentFailureSourceSchema,
  slot: respondentSlotSchema.nullable(),
  failureClass: respondentFailureClassSchema,
  failureStage: respondentFailureStageSchema,
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  stageFailureCount: z.number().int().nonnegative(),
  rescuedCount: z.number().int().nonnegative(),
  latestSeenAt: z.string().datetime().nullable()
});

export const arenaRespondentReliabilitySchema = z.object({
  stageFailures: z.number().int().nonnegative(),
  rescuedStaticFallbacks: z.number().int().nonnegative(),
  topFailureCauses: z.array(arenaRespondentFailureCauseStatSchema).max(10),
  recentFailures: z.array(arenaRespondentFailureEventSchema).max(8)
});

export const arenaQualityWinnerDistributionSchema = z.object({
  A: z.number().int().nonnegative(),
  B: z.number().int().nonnegative(),
  tie: z.number().int().nonnegative()
});

export const arenaQualityImpactCohortSchema = z.object({
  count: z.number().int().nonnegative(),
  averageWinnerScore: z.number().min(0).max(100).nullable(),
  averageRefinedScore: z.number().min(0).max(100).nullable(),
  averageSynthesisImprovements: z.number().min(0).nullable(),
  averageLocalLearningNotes: z.number().min(0).nullable(),
  winnerDistribution: arenaQualityWinnerDistributionSchema,
  tieRatePct: z.number().min(0).max(100).nullable()
});

export const arenaQualityImpactSchema = z.object({
  completed: arenaQualityImpactCohortSchema,
  classifiedPartial: arenaQualityImpactCohortSchema,
  legacyPartial: arenaQualityImpactCohortSchema
});

export const arenaQualityAnalyticsReportSchema = z.object({
  generatedAt: z.string().datetime(),
  summary: arenaQualitySummarySchema,
  recentStatuses: z.array(arenaQualityRecentStatusSchema).max(20),
  topDegradationReasons: z.array(arenaQualityDegradationReasonStatSchema).max(10),
  roleBreakdown: z.array(arenaQualityRoleStatSchema).max(12),
  respondentReliability: arenaRespondentReliabilitySchema,
  impact: arenaQualityImpactSchema
});

export type ArenaQualitySummary = z.infer<typeof arenaQualitySummarySchema>;
export type ArenaQualityRecentStatus = z.infer<typeof arenaQualityRecentStatusSchema>;
export type ArenaQualityPartialKind = z.infer<typeof arenaQualityPartialKindSchema>;
export type ArenaQualityDegradationReasonStat = z.infer<
  typeof arenaQualityDegradationReasonStatSchema
>;
export type ArenaQualityRoleStat = z.infer<typeof arenaQualityRoleStatSchema>;
export type RespondentFailureClass = z.infer<typeof respondentFailureClassSchema>;
export type RespondentFailureStage = z.infer<typeof respondentFailureStageSchema>;
export type RespondentFailureSource = z.infer<typeof respondentFailureSourceSchema>;
export type RespondentSlot = z.infer<typeof respondentSlotSchema>;
export type ArenaRespondentFailureEvent = z.infer<typeof arenaRespondentFailureEventSchema>;
export type ArenaRespondentFailureLog = z.infer<typeof arenaRespondentFailureLogSchema>;
export type ArenaRespondentFailureCauseStat = z.infer<
  typeof arenaRespondentFailureCauseStatSchema
>;
export type ArenaRespondentReliability = z.infer<typeof arenaRespondentReliabilitySchema>;
export type ArenaQualityWinnerDistribution = z.infer<
  typeof arenaQualityWinnerDistributionSchema
>;
export type ArenaQualityImpactCohort = z.infer<typeof arenaQualityImpactCohortSchema>;
export type ArenaQualityImpact = z.infer<typeof arenaQualityImpactSchema>;
export type ArenaQualityAnalyticsReport = z.infer<typeof arenaQualityAnalyticsReportSchema>;
export type ArenaQualityWinner = z.infer<typeof winnerSchema>;

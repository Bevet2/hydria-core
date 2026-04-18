import { z } from "zod";
import {
  hydriaActorRoleSchema,
  hydriaWorkflowDegradationCodeSchema,
  hydriaWorkflowDegradationImpactSchema,
  hydriaWorkflowStatusSchema
} from "./core.js";

const winnerSchema = z.enum(["A", "B", "tie"]);
const arenaQualityPartialKindSchema = z.enum(["classified", "legacy"]);

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
  impact: arenaQualityImpactSchema
});

export type ArenaQualitySummary = z.infer<typeof arenaQualitySummarySchema>;
export type ArenaQualityRecentStatus = z.infer<typeof arenaQualityRecentStatusSchema>;
export type ArenaQualityPartialKind = z.infer<typeof arenaQualityPartialKindSchema>;
export type ArenaQualityDegradationReasonStat = z.infer<
  typeof arenaQualityDegradationReasonStatSchema
>;
export type ArenaQualityRoleStat = z.infer<typeof arenaQualityRoleStatSchema>;
export type ArenaQualityWinnerDistribution = z.infer<
  typeof arenaQualityWinnerDistributionSchema
>;
export type ArenaQualityImpactCohort = z.infer<typeof arenaQualityImpactCohortSchema>;
export type ArenaQualityImpact = z.infer<typeof arenaQualityImpactSchema>;
export type ArenaQualityAnalyticsReport = z.infer<typeof arenaQualityAnalyticsReportSchema>;
export type ArenaQualityWinner = z.infer<typeof winnerSchema>;

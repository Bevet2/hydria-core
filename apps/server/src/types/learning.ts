import { z } from "zod";
import { questionCategorySchema } from "./arena.js";
import { hydriaActorRoleSchema } from "./core.js";
import {
  studentRuleImpactContextSignalSchema,
  studentRulePromptLengthSchema,
  studentRuleQuestionTypeSchema
} from "./student.js";

export const learningHotspotKindSchema = z.enum([
  "factuality",
  "research",
  "refine",
  "cost",
  "latency",
  "no_op",
  "hallucination",
  "strategy",
  "local_student",
  "workflow"
]);

export const learningHotspotSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical"
]);

export const learningSignalSourceSchema = z.enum([
  "arena_quality",
  "student_rule_impact",
  "student_strategy_impact",
  "student_tool_impact",
  "knowledge_layer",
  "strategy_discovery",
  "student_sessions",
  "validation_run"
]);

export const learningPolicyTargetSchema = z.enum([
  "student_rule",
  "student_strategy",
  "tool_policy",
  "research_policy",
  "local_student_policy",
  "memory_rule"
]);

export const learningPolicyStateSchema = z.enum([
  "hypothesis",
  "validating",
  "active",
  "guarded",
  "rejected",
  "archived"
]);

export const learningMemoryStateSchema = z.enum([
  "raw",
  "analyzed",
  "active",
  "archived",
  "risky"
]);

export const learningValidationModeSchema = z.enum([
  "none",
  "temporal_replay"
]);

export const learningImprovementWeightsSchema = z.object({
  factuality: z.number().min(0).max(1),
  researchImpact: z.number().min(0).max(1),
  refineImpact: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  costEfficiency: z.number().min(0).max(1),
  latency: z.number().min(0).max(1),
  noOpResistance: z.number().min(0).max(1),
  regressionResistance: z.number().min(0).max(1)
});

export const learningImprovementComponentSchema = z.object({
  score: z.number().min(0).max(100),
  rationale: z.string().min(1).max(320),
  observedValue: z.number().nullable()
});

export const learningImprovementScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  components: z.object({
    factuality: learningImprovementComponentSchema,
    researchImpact: learningImprovementComponentSchema,
    refineImpact: learningImprovementComponentSchema,
    stability: learningImprovementComponentSchema,
    costEfficiency: learningImprovementComponentSchema,
    latency: learningImprovementComponentSchema,
    noOpResistance: learningImprovementComponentSchema,
    regressionResistance: learningImprovementComponentSchema
  })
});

export const learningPolicyScopeSchema = z.object({
  category: questionCategorySchema.nullable(),
  questionType: studentRuleQuestionTypeSchema.nullable().default(null),
  promptLength: studentRulePromptLengthSchema.nullable().default(null),
  signals: z.array(studentRuleImpactContextSignalSchema).max(6).default([])
});

export const learningValidationMetricsSchema = z.object({
  observations: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(100).nullable(),
  positiveImpactRate: z.number().min(0).max(100).nullable(),
  averageJudgeDelta: z.number().min(-100).max(100).nullable(),
  averageGainGlobal: z.number().min(-100).max(100).nullable(),
  noReliableSourceRate: z.number().min(0).max(100).nullable(),
  noOpRate: z.number().min(0).max(100).nullable(),
  recencyWeight: z.number().min(0).max(1),
  stabilityWeight: z.number().min(0).max(1)
});

export const learningHotspotSchema = z.object({
  hotspotId: z.string().min(1).max(120),
  kind: learningHotspotKindSchema,
  severity: learningHotspotSeveritySchema,
  source: learningSignalSourceSchema,
  category: questionCategorySchema.nullable(),
  role: hydriaActorRoleSchema.nullable(),
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(320),
  target: learningPolicyTargetSchema,
  targetId: z.string().min(1).max(160).nullable(),
  frequencyPct: z.number().min(0).max(100),
  severityScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  weightedScore: z.number().min(0).max(100),
  observations: z.number().int().nonnegative(),
  whyItMatters: z.string().min(1).max(240),
  suggestedAction: z.string().min(1).max(240)
});

export const learningPolicyItemSchema = z.object({
  policyId: z.string().min(1).max(120),
  target: learningPolicyTargetSchema,
  targetId: z.string().min(1).max(160),
  state: learningPolicyStateSchema,
  memoryState: learningMemoryStateSchema,
  scope: learningPolicyScopeSchema,
  learned: z.string().min(1).max(240),
  modifies: z.string().min(1).max(240),
  conditions: z.array(z.string().min(1).max(180)).max(8),
  confidence: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  sourceHotspotIds: z.array(z.string().min(1).max(120)).max(8),
  rationale: z.string().min(1).max(320),
  validation: learningValidationMetricsSchema,
  weights: z.object({
    impactWeight: z.number().min(0).max(1),
    confidenceWeight: z.number().min(0).max(1),
    stabilityWeight: z.number().min(0).max(1),
    recencyWeight: z.number().min(0).max(1)
  })
});

export const learningLifecycleSummarySchema = z.object({
  rawObservations: z.number().int().nonnegative(),
  analyzedItems: z.number().int().nonnegative(),
  activeItems: z.number().int().nonnegative(),
  riskyItems: z.number().int().nonnegative(),
  archivedItems: z.number().int().nonnegative()
});

export const learningActiveMemoryItemSchema = z.object({
  itemId: z.string().min(1).max(120),
  target: learningPolicyTargetSchema,
  state: learningPolicyStateSchema,
  category: questionCategorySchema.nullable(),
  priority: z.enum(["high", "medium", "low"]),
  learned: z.string().min(1).max(240),
  modifies: z.string().min(1).max(240),
  conditions: z.array(z.string().min(1).max(180)).max(6),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(240)
});

export const learningActiveMemorySchema = z.object({
  version: z.literal("hydria-learning-active-memory-v1"),
  generatedAt: z.string().datetime(),
  items: z.array(learningActiveMemoryItemSchema).max(64)
});

export const learningValidationSummarySchema = z.object({
  mode: learningValidationModeSchema,
  summary: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).default({})
});

export const learningLiveMonitoringStatusSchema = z.enum([
  "insufficient_data",
  "improving",
  "stable",
  "regressing",
  "false_positive_risk"
]);

export const learningConstitutionSchema = z.object({
  version: z.literal("hydria-learning-constitution-v1"),
  defaultScope: z.enum(["local_first"]),
  learnableTargets: z.array(learningPolicyTargetSchema).min(1).max(12),
  protectedBehaviors: z.array(z.string().min(1).max(180)).max(12),
  promotionCriteria: z.object({
    minObservations: z.number().int().min(1).max(100),
    minConfidence: z.number().min(0).max(1),
    minStability: z.number().min(0).max(1),
    requireValidationForGlobalPromotion: z.boolean(),
    allowedValidationModes: z.array(learningValidationModeSchema).min(1).max(4)
  }),
  demotionCriteria: z.object({
    maxNoReliableSourceRate: z.number().min(0).max(100),
    minAverageJudgeDelta: z.number().min(-100).max(100),
    maxNoOpRate: z.number().min(0).max(100),
    regressionTriggerDelta: z.number().min(0).max(100)
  }),
  lifecycle: z.object({
    rawToAnalyzed: z.string().min(1).max(220),
    analyzedToActive: z.string().min(1).max(220),
    activeToRisky: z.string().min(1).max(220),
    riskyToArchived: z.string().min(1).max(220)
  }),
  guardrails: z.array(z.string().min(1).max(220)).max(12)
});

export const learningGovernanceReportSchema = z.object({
  version: z.literal("hydria-learning-governance-v1"),
  generatedAt: z.string().datetime(),
  constitution: learningConstitutionSchema,
  sourceStats: z.object({
    arenaRoundsAnalyzed: z.number().int().nonnegative(),
    studentSessionsAnalyzed: z.number().int().nonnegative(),
    ruleObservationsAnalyzed: z.number().int().nonnegative(),
    strategyObservationsAnalyzed: z.number().int().nonnegative(),
    toolComparedSessionsAnalyzed: z.number().int().nonnegative()
  }),
  weights: learningImprovementWeightsSchema,
  score: learningImprovementScoreSchema,
  hotspots: z.array(learningHotspotSchema).max(48),
  policies: z.array(learningPolicyItemSchema).max(96),
  liveMonitoring: z.object({
    windowStart: z.string().datetime().nullable(),
    monitoredPolicies: z.number().int().nonnegative(),
    policiesWithLiveData: z.number().int().nonnegative(),
    falsePositiveAlerts: z.number().int().nonnegative(),
    items: z.array(
      z.object({
        policyId: z.string().min(1).max(120),
        target: learningPolicyTargetSchema,
        targetId: z.string().min(1).max(160),
        state: learningPolicyStateSchema,
        status: learningLiveMonitoringStatusSchema,
        windowStart: z.string().datetime().nullable(),
        observations: z.number().int().nonnegative(),
        averageJudgeDelta: z.number().min(-100).max(100).nullable(),
        averageGainGlobal: z.number().min(-100).max(100).nullable(),
        positiveImpactRate: z.number().min(0).max(100).nullable(),
        noOpRate: z.number().min(0).max(100).nullable(),
        noReliableSourceRate: z.number().min(0).max(100).nullable(),
        partialRate: z.number().min(0).max(100).nullable(),
        regressionDelta: z.number().min(-100).max(100).nullable(),
        profitabilityScore: z.number().min(0).max(100),
        riskScore: z.number().min(0).max(100),
        summary: z.string().min(1).max(320)
      })
    ).max(96),
    topGains: z.array(
      z.object({
        policyId: z.string().min(1).max(120),
        targetId: z.string().min(1).max(160),
        state: learningPolicyStateSchema,
        score: z.number().min(0).max(100),
        averageJudgeDelta: z.number().min(-100).max(100).nullable(),
        observations: z.number().int().nonnegative(),
        summary: z.string().min(1).max(240)
      })
    ).max(8),
    topRegressions: z.array(
      z.object({
        policyId: z.string().min(1).max(120),
        targetId: z.string().min(1).max(160),
        state: learningPolicyStateSchema,
        score: z.number().min(0).max(100),
        averageJudgeDelta: z.number().min(-100).max(100).nullable(),
        observations: z.number().int().nonnegative(),
        summary: z.string().min(1).max(240)
      })
    ).max(8),
    mostProfitableActive: z.array(
      z.object({
        policyId: z.string().min(1).max(120),
        targetId: z.string().min(1).max(160),
        state: learningPolicyStateSchema,
        score: z.number().min(0).max(100),
        averageJudgeDelta: z.number().min(-100).max(100).nullable(),
        observations: z.number().int().nonnegative(),
        summary: z.string().min(1).max(240)
      })
    ).max(8),
    mostRiskyActive: z.array(
      z.object({
        policyId: z.string().min(1).max(120),
        targetId: z.string().min(1).max(160),
        state: learningPolicyStateSchema,
        score: z.number().min(0).max(100),
        averageJudgeDelta: z.number().min(-100).max(100).nullable(),
        observations: z.number().int().nonnegative(),
        summary: z.string().min(1).max(240)
      })
    ).max(8)
  }),
  lifecycle: learningLifecycleSummarySchema,
  validation: learningValidationSummarySchema
});

export const learningGovernanceStateSchema = z.object({
  report: learningGovernanceReportSchema.nullable(),
  activeMemory: learningActiveMemorySchema.nullable()
});

export type LearningHotspotKind = z.infer<typeof learningHotspotKindSchema>;
export type LearningHotspotSeverity = z.infer<typeof learningHotspotSeveritySchema>;
export type LearningSignalSource = z.infer<typeof learningSignalSourceSchema>;
export type LearningPolicyTarget = z.infer<typeof learningPolicyTargetSchema>;
export type LearningPolicyState = z.infer<typeof learningPolicyStateSchema>;
export type LearningMemoryState = z.infer<typeof learningMemoryStateSchema>;
export type LearningValidationMode = z.infer<typeof learningValidationModeSchema>;
export type LearningImprovementWeights = z.infer<typeof learningImprovementWeightsSchema>;
export type LearningImprovementComponent = z.infer<typeof learningImprovementComponentSchema>;
export type LearningImprovementScore = z.infer<typeof learningImprovementScoreSchema>;
export type LearningPolicyScope = z.infer<typeof learningPolicyScopeSchema>;
export type LearningValidationMetrics = z.infer<typeof learningValidationMetricsSchema>;
export type LearningHotspot = z.infer<typeof learningHotspotSchema>;
export type LearningPolicyItem = z.infer<typeof learningPolicyItemSchema>;
export type LearningLifecycleSummary = z.infer<typeof learningLifecycleSummarySchema>;
export type LearningActiveMemoryItem = z.infer<typeof learningActiveMemoryItemSchema>;
export type LearningActiveMemory = z.infer<typeof learningActiveMemorySchema>;
export type LearningValidationSummary = z.infer<typeof learningValidationSummarySchema>;
export type LearningLiveMonitoringStatus = z.infer<typeof learningLiveMonitoringStatusSchema>;
export type LearningConstitution = z.infer<typeof learningConstitutionSchema>;
export type LearningGovernanceReport = z.infer<typeof learningGovernanceReportSchema>;
export type LearningGovernanceState = z.infer<typeof learningGovernanceStateSchema>;

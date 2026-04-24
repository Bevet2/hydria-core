import { z } from "zod";
import { skillStateSchema } from "./skills.js";

const agentQuestionCategorySchema = z.enum([
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning",
  "other"
]);

export const agentStateSchema = z.enum([
  "candidate",
  "validating",
  "guarded",
  "active",
  "deprecated",
  "rejected"
]);

export const agentRiskLevelSchema = z.enum(["low", "medium", "high"]);

export const agentMemoryScopeLevelSchema = z.enum([
  "none",
  "task_local",
  "category_local",
  "domain_local"
]);

export const agentMemoryRetentionSchema = z.enum([
  "ephemeral",
  "session",
  "rolling"
]);

export const agentOutcomeSchema = z.enum([
  "recommended",
  "fallback_core",
  "guarded_fallback",
  "not_found",
  "rejected"
]);

export const agentSkillBindingSchema = z.object({
  skillId: z.string().min(1).max(160),
  intent: z.string().min(1).max(120),
  required: z.boolean().default(true),
  isKeySkill: z.boolean().default(false),
  state: skillStateSchema,
  confidenceScore: z.number().min(0).max(1)
});

export const agentActivationPolicySchema = z.object({
  minConfidence: z.number().min(0).max(1),
  minUsageCount: z.number().int().min(1).max(500),
  minBenchmarkLift: z.number().min(-100).max(100),
  requireCoreBaselineComparison: z.boolean(),
  requireAtLeastTwoActiveSkills: z.boolean(),
  allowGuardedRouting: z.boolean(),
  maxActiveAgentsPerDomain: z.number().int().min(1).max(16)
});

export const agentEvaluationProfileSchema = z.object({
  benchmarkCases: z.array(z.string().min(1).max(240)).max(12),
  evaluationMetrics: z.array(z.string().min(1).max(80)).max(12),
  baseline: z.literal("core_generalist"),
  targetJudgeDeltaLift: z.number().min(-100).max(100),
  maxFailureRatePct: z.number().min(0).max(100),
  maxCostOverheadPct: z.number().min(0).max(100)
});

export const agentMemoryProfileSchema = z.object({
  memoryScope: agentMemoryScopeLevelSchema,
  retention: agentMemoryRetentionSchema,
  keys: z.array(z.string().min(1).max(120)).max(12),
  rationale: z.string().min(1).max(240)
});

export const agentPerformanceReportSchema = z.object({
  agentId: z.string().min(1).max(160),
  observations: z.number().int().nonnegative(),
  averageJudgeDelta: z.number().min(-100).max(100).nullable(),
  successRatePct: z.number().min(0).max(100).nullable(),
  failureRatePct: z.number().min(0).max(100).nullable(),
  activationPrecisionPct: z.number().min(0).max(100).nullable(),
  regressionRiskScore: z.number().min(0).max(100),
  lastEvaluatedAt: z.string().datetime(),
  summary: z.string().min(1).max(320)
});

export const specializedAgentDefinitionSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  domain: z.string().min(1).max(80),
  description: z.string().min(1).max(320),
  responsibilities: z.array(z.string().min(1).max(180)).max(10),
  allowedIntents: z.array(z.string().min(1).max(120)).min(1).max(10),
  forbiddenIntents: z.array(z.string().min(1).max(120)).max(10),
  requiredSkills: z.array(agentSkillBindingSchema).min(1).max(8),
  optionalSkills: z.array(agentSkillBindingSchema).max(8),
  requiredTools: z.array(z.string().min(1).max(80)).max(10),
  memoryScope: agentMemoryProfileSchema,
  activationConditions: z.array(z.string().min(1).max(180)).max(10),
  successCriteria: z.array(z.string().min(1).max(180)).max(10),
  failureModes: z.array(z.string().min(1).max(180)).max(10),
  safetyConstraints: z.array(z.string().min(1).max(180)).max(10),
  evaluationMetrics: agentEvaluationProfileSchema,
  activationPolicy: agentActivationPolicySchema,
  confidenceScore: z.number().min(0).max(1),
  usageCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  state: agentStateSchema,
  version: z.string().min(1).max(32),
  performance: agentPerformanceReportSchema.nullable().default(null),
  primaryCategory: agentQuestionCategorySchema.nullable().default(null)
});

export const agentCandidateDetectionSchema = z.object({
  detected: z.boolean(),
  domain: z.string().min(1).max(80),
  reason: z.string().min(1).max(320),
  supportingSkillIds: z.array(z.string().min(1).max(160)).max(12),
  supportingRoundIds: z.array(z.string().min(1).max(160)).max(24),
  confidence: z.number().min(0).max(1),
  riskLevel: agentRiskLevelSchema
});

export const agentCandidateSchema = z.object({
  candidateId: z.string().min(1).max(160),
  sourceSignal: agentCandidateDetectionSchema,
  definition: specializedAgentDefinitionSchema,
  confidenceScore: z.number().min(0).max(1),
  specializationScore: z.number().min(0).max(100),
  stabilityScore: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  createdAt: z.string().datetime(),
  state: agentStateSchema.default("candidate")
});

export const agentValidationResultSchema = z.object({
  agentCandidateId: z.string().min(1).max(160),
  agentId: z.string().min(1).max(160),
  specializationScore: z.number().min(0).max(100),
  stabilityScore: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  state: agentStateSchema,
  accepted: z.boolean(),
  rollbackRecommended: z.boolean().default(false),
  reason: z.string().min(1).max(320)
});

export const agentRoutingRecommendationSchema = z.object({
  type: z.literal("agent_routing_recommendation"),
  agentId: z.string().min(1).max(160),
  domain: z.string().min(1).max(80),
  confidence: z.number().min(0).max(1),
  requiredSkills: z.array(z.string().min(1).max(160)).max(8),
  requiredTools: z.array(z.string().min(1).max(80)).max(10),
  reason: z.string().min(1).max(240),
  fallbackPlan: z.literal("core_generalist")
});

export const defaultAgentRoutingDecision = {
  considered: true,
  agentFound: false,
  agentId: null,
  domain: null,
  confidence: 0,
  reason: "No specialized agent matched this request strongly enough.",
  requiredSkills: [] as string[],
  fallbackToCore: true,
  recommendation: null
};

export const agentRoutingDecisionSchema = z.object({
  considered: z.boolean().default(true),
  agentFound: z.boolean().default(false),
  agentId: z.string().min(1).max(160).nullable().default(null),
  domain: z.string().min(1).max(80).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().min(1).max(240).default(defaultAgentRoutingDecision.reason),
  requiredSkills: z.array(z.string().min(1).max(160)).max(8).default([]),
  fallbackToCore: z.boolean().default(true),
  recommendation: agentRoutingRecommendationSchema.nullable().default(null)
});

export type AgentState = z.infer<typeof agentStateSchema>;
export type AgentRiskLevel = z.infer<typeof agentRiskLevelSchema>;
export type AgentOutcome = z.infer<typeof agentOutcomeSchema>;
export type AgentSkillBinding = z.infer<typeof agentSkillBindingSchema>;
export type AgentActivationPolicy = z.infer<typeof agentActivationPolicySchema>;
export type AgentEvaluationProfile = z.infer<typeof agentEvaluationProfileSchema>;
export type AgentMemoryProfile = z.infer<typeof agentMemoryProfileSchema>;
export type AgentPerformanceReport = z.infer<typeof agentPerformanceReportSchema>;
export type SpecializedAgentDefinition = z.infer<typeof specializedAgentDefinitionSchema>;
export type AgentCandidateDetection = z.infer<typeof agentCandidateDetectionSchema>;
export type AgentCandidate = z.infer<typeof agentCandidateSchema>;
export type AgentValidationResult = z.infer<typeof agentValidationResultSchema>;
export type AgentRoutingRecommendation = z.infer<typeof agentRoutingRecommendationSchema>;
export type AgentRoutingDecision = z.infer<typeof agentRoutingDecisionSchema>;

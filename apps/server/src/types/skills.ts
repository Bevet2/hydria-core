import { z } from "zod";

const skillQuestionCategorySchema = z.enum([
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning",
  "other"
]);

export const skillToolTypeSchema = z.enum([
  "research",
  "weather",
  "finance",
  "sports",
  "calculator",
  "repo",
  "file",
  "time",
  "web",
  "none"
]);

export const skillStateSchema = z.enum([
  "active",
  "guarded",
  "rejected",
  "archived"
]);

export const skillExecutionOutcomeSchema = z.enum([
  "recommended",
  "fallback",
  "not_found",
  "blocked"
]);

export const skillDataFieldTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "array",
  "object"
]);

export const skillIoFieldSchema = z.object({
  name: z.string().min(1).max(80),
  type: skillDataFieldTypeSchema,
  required: z.boolean().default(true),
  description: z.string().min(1).max(180)
});

export const skillExampleSchema = z.object({
  input: z.string().min(1).max(600),
  outcome: z.string().min(1).max(600)
});

export const skillStepSchema = z.object({
  stepId: z.string().min(1).max(80),
  title: z.string().min(1).max(140),
  description: z.string().min(1).max(240),
  toolHint: skillToolTypeSchema.nullable().default(null),
  expectedOutcome: z.string().min(1).max(180).nullable().default(null)
});

export const skillScopeSchema = z.object({
  category: skillQuestionCategorySchema.nullable().default(null),
  toolType: skillToolTypeSchema.nullable().default(null),
  taskPattern: z.string().min(1).max(120).nullable().default(null)
});

export const skillValidationMetricsSchema = z.object({
  usefulnessScore: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  generalizationScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(1),
  observedJudgeDelta: z.number().min(-100).max(100).nullable().default(null),
  observedSuccessRate: z.number().min(0).max(100).nullable().default(null)
});

export const skillDefinitionSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  intent: z.string().min(1).max(80),
  description: z.string().min(1).max(320),
  inputs: z.array(skillIoFieldSchema).max(12),
  outputs: z.array(skillIoFieldSchema).max(12),
  requiredTools: z.array(skillToolTypeSchema).max(6),
  steps: z.array(skillStepSchema).min(1).max(12),
  preconditions: z.array(z.string().min(1).max(180)).max(8),
  successCriteria: z.array(z.string().min(1).max(180)).max(8),
  failureModes: z.array(z.string().min(1).max(180)).max(8),
  safetyConstraints: z.array(z.string().min(1).max(180)).max(8),
  examples: z.array(skillExampleSchema).max(6),
  confidenceScore: z.number().min(0).max(1),
  usageCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  version: z.string().min(1).max(32),
  state: skillStateSchema,
  scope: skillScopeSchema.default({
    category: null,
    toolType: null,
    taskPattern: null
  }),
  validation: skillValidationMetricsSchema.default({
    usefulnessScore: 0,
    riskScore: 0,
    generalizationScore: 0,
    confidenceScore: 0,
    observedJudgeDelta: null,
    observedSuccessRate: null
  })
});

export const skillExecutionTraceSchema = z.object({
  traceId: z.string().min(1).max(160),
  question: z.string().min(1).max(8000),
  category: skillQuestionCategorySchema,
  intent: z.string().min(1).max(80),
  toolType: skillToolTypeSchema,
  steps: z.array(skillStepSchema).min(1).max(12),
  finalAnswerSummary: z.string().min(1).max(600),
  judgeDelta: z.number().min(-100).max(100).nullable().default(null),
  success: z.boolean(),
  createdAt: z.string().datetime()
});

export const skillCandidateSchema = z.object({
  candidateId: z.string().min(1).max(160),
  source: z.enum(["arena_round", "student_session", "execution_trace"]),
  sourceId: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  intent: z.string().min(1).max(80),
  description: z.string().min(1).max(320),
  inputs: z.array(skillIoFieldSchema).max(12),
  outputs: z.array(skillIoFieldSchema).max(12),
  requiredTools: z.array(skillToolTypeSchema).max(6),
  steps: z.array(skillStepSchema).min(1).max(12),
  preconditions: z.array(z.string().min(1).max(180)).max(8),
  successCriteria: z.array(z.string().min(1).max(180)).max(8),
  failureModes: z.array(z.string().min(1).max(180)).max(8),
  safetyConstraints: z.array(z.string().min(1).max(180)).max(8),
  examples: z.array(skillExampleSchema).max(4),
  scope: skillScopeSchema.default({
    category: null,
    toolType: null,
    taskPattern: null
  }),
  repeatable: z.boolean(),
  repeatabilityReason: z.string().min(1).max(240),
  usefulnessScore: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  generalizationScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(1),
  observedJudgeDelta: z.number().min(-100).max(100).nullable().default(null),
  observedSuccessRate: z.number().min(0).max(100).nullable().default(null),
  createdAt: z.string().datetime(),
  version: z.string().min(1).max(32).default("hydria-skill-candidate-v1")
});

export const skillValidationResultSchema = z.object({
  candidateId: z.string().min(1).max(160),
  skillId: z.string().min(1).max(160),
  usefulnessScore: z.number().min(0).max(100),
  riskScore: z.number().min(0).max(100),
  generalizationScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(1),
  state: skillStateSchema,
  accepted: z.boolean(),
  rollbackRecommended: z.boolean().default(false),
  reason: z.string().min(1).max(320)
});

export const defaultSkillRoutingDecision = {
  considered: true,
  skillFound: false,
  skillId: null,
  skillName: null,
  intent: null,
  confidence: 0,
  reason: "No reusable skill matched this request.",
  state: null,
  recommendedSteps: [] as string[]
};

export const skillRoutingDecisionSchema = z.object({
  considered: z.boolean().default(true),
  skillFound: z.boolean().default(false),
  skillId: z.string().min(1).max(160).nullable().default(null),
  skillName: z.string().min(1).max(160).nullable().default(null),
  intent: z.string().min(1).max(80).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().min(1).max(240).default(defaultSkillRoutingDecision.reason),
  state: skillStateSchema.nullable().default(null),
  recommendedSteps: z.array(z.string().min(1).max(180)).max(6).default([])
});

export type SkillToolType = z.infer<typeof skillToolTypeSchema>;
export type SkillState = z.infer<typeof skillStateSchema>;
export type SkillExecutionOutcome = z.infer<typeof skillExecutionOutcomeSchema>;
export type SkillIoField = z.infer<typeof skillIoFieldSchema>;
export type SkillExample = z.infer<typeof skillExampleSchema>;
export type SkillStep = z.infer<typeof skillStepSchema>;
export type SkillScope = z.infer<typeof skillScopeSchema>;
export type SkillValidationMetrics = z.infer<typeof skillValidationMetricsSchema>;
export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;
export type SkillExecutionTrace = z.infer<typeof skillExecutionTraceSchema>;
export type SkillCandidate = z.infer<typeof skillCandidateSchema>;
export type SkillValidationResult = z.infer<typeof skillValidationResultSchema>;
export type SkillRoutingDecision = z.infer<typeof skillRoutingDecisionSchema>;

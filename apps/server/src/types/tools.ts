import { z } from "zod";

export const toolStateSchema = z.enum([
  "proposed",
  "generated",
  "tested",
  "guarded",
  "active",
  "deprecated",
  "rejected"
]);

export const toolGapTypeSchema = z.enum([
  "missing_tool",
  "weak_tool",
  "manual_workaround",
  "repeated_failure"
]);

export const toolRiskLevelSchema = z.enum(["low", "medium", "high"]);

export const toolExecutionContextSchema = z.enum(["core", "os", "sandbox", "external"]);

export const toolCreationActionSchema = z.enum([
  "generate_adapter",
  "run_tests",
  "sandbox_validate",
  "activate"
]);

export const toolSchemaFieldTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "array",
  "object"
]);

export const toolSchemaFieldSchema = z.object({
  name: z.string().min(1).max(80),
  type: toolSchemaFieldTypeSchema,
  required: z.boolean().default(true),
  description: z.string().min(1).max(220)
});

export const toolBenchmarkCaseSchema = z.object({
  prompt: z.string().min(1).max(500),
  expectedIntent: z.string().min(1).max(120),
  expectedBehavior: z.string().min(1).max(240)
});

export const toolGapSignalSchema = z.object({
  signalId: z.string().min(1).max(160),
  detected: z.boolean(),
  gapType: toolGapTypeSchema,
  suggestedIntent: z.string().min(1).max(120),
  evidence: z.array(z.string().min(1).max(240)).max(12),
  frequency: z.number().int().nonnegative(),
  riskLevel: toolRiskLevelSchema,
  reason: z.string().min(1).max(320),
  createdAt: z.string().datetime(),
  toolType: z.string().min(1).max(40).default("none")
});

export const toolActivationPolicySchema = z.object({
  minFrequency: z.number().int().min(1).max(100),
  minUsefulnessScore: z.number().min(0).max(100),
  minReliabilityScore: z.number().min(0).max(100),
  minSafetyScore: z.number().min(0).max(100),
  minAdoptionScore: z.number().min(0).max(100),
  maxRegressionRiskScore: z.number().min(0).max(100),
  requiresHumanReview: z.boolean(),
  maxActiveToolsPerIntent: z.number().int().min(1).max(16)
});

export const toolContractSchema = z.object({
  contractId: z.string().min(1).max(160),
  toolCandidateId: z.string().min(1).max(160),
  manifestId: z.string().min(1).max(160),
  inputSchema: z.array(toolSchemaFieldSchema).max(12),
  outputSchema: z.array(toolSchemaFieldSchema).max(12),
  requiredPermissions: z.array(z.string().min(1).max(120)).max(12),
  successCriteria: z.array(z.string().min(1).max(220)).max(10),
  fallbackBehavior: z.string().min(1).max(240),
  proposedTests: z.array(z.string().min(1).max(220)).max(12),
  benchmarkCases: z.array(toolBenchmarkCaseSchema).max(10),
  version: z.string().min(1).max(32)
});

export const toolValidationResultSchema = z.object({
  toolCandidateId: z.string().min(1).max(160),
  manifestId: z.string().min(1).max(160),
  usefulnessScore: z.number().min(0).max(100),
  reliabilityScore: z.number().min(0).max(100),
  safetyScore: z.number().min(0).max(100),
  adoptionScore: z.number().min(0).max(100),
  regressionRiskScore: z.number().min(0).max(100),
  state: toolStateSchema,
  accepted: z.boolean(),
  requestedAction: toolCreationActionSchema.nullable().default(null),
  reason: z.string().min(1).max(320)
});

export const toolManifestSchema = z.object({
  id: z.string().min(1).max(160),
  candidateId: z.string().min(1).max(160).nullable().default(null),
  name: z.string().min(1).max(160),
  intent: z.string().min(1).max(120),
  description: z.string().min(1).max(320),
  inputSchema: z.array(toolSchemaFieldSchema).max(12),
  outputSchema: z.array(toolSchemaFieldSchema).max(12),
  requiredPermissions: z.array(z.string().min(1).max(120)).max(12),
  riskLevel: toolRiskLevelSchema,
  allowedExecutionContext: toolExecutionContextSchema,
  examples: z.array(z.string().min(1).max(240)).max(8),
  failureModes: z.array(z.string().min(1).max(220)).max(8),
  safetyConstraints: z.array(z.string().min(1).max(220)).max(10),
  benchmarkCases: z.array(toolBenchmarkCaseSchema).max(10),
  version: z.string().min(1).max(32),
  state: toolStateSchema,
  confidenceScore: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  toolContract: toolContractSchema.nullable().default(null),
  activationPolicy: toolActivationPolicySchema.nullable().default(null),
  validation: toolValidationResultSchema.nullable().default(null)
});

export const toolCandidateSchema = z.object({
  candidateId: z.string().min(1).max(160),
  gapSignal: toolGapSignalSchema,
  manifest: toolManifestSchema,
  contract: toolContractSchema,
  activationPolicy: toolActivationPolicySchema,
  confidenceScore: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  state: toolStateSchema.default("proposed")
});

export const toolCreationRequestSchema = z.object({
  type: z.literal("tool_creation_request"),
  toolCandidateId: z.string().min(1).max(160),
  manifest: toolManifestSchema,
  requestedAction: toolCreationActionSchema,
  reason: z.string().min(1).max(320)
});

export type ToolState = z.infer<typeof toolStateSchema>;
export type ToolGapType = z.infer<typeof toolGapTypeSchema>;
export type ToolRiskLevel = z.infer<typeof toolRiskLevelSchema>;
export type ToolExecutionContext = z.infer<typeof toolExecutionContextSchema>;
export type ToolCreationAction = z.infer<typeof toolCreationActionSchema>;
export type ToolSchemaField = z.infer<typeof toolSchemaFieldSchema>;
export type ToolBenchmarkCase = z.infer<typeof toolBenchmarkCaseSchema>;
export type ToolGapSignal = z.infer<typeof toolGapSignalSchema>;
export type ToolActivationPolicy = z.infer<typeof toolActivationPolicySchema>;
export type ToolContract = z.infer<typeof toolContractSchema>;
export type ToolValidationResult = z.infer<typeof toolValidationResultSchema>;
export type ToolManifest = z.infer<typeof toolManifestSchema>;
export type ToolCandidate = z.infer<typeof toolCandidateSchema>;
export type ToolCreationRequest = z.infer<typeof toolCreationRequestSchema>;

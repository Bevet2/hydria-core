import { z } from "zod";
import {
  executionTraceSchema,
  judgeSideScoreSchema,
  orchestrationPolicySchema,
  questionCategorySchema,
  researchToolLogSchema,
  redTeamOutputSchema,
  refinerOutputSchema
} from "./arena.js";
import {
  hydriaMemorySnapshotSchema,
  hydriaWorkflowRunSchema
} from "./core.js";
import { knowledgeInjectionSchema } from "./knowledge.js";

const boundedScoreSchema = z.preprocess((value) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 50;
}, z.number().min(0).max(100));
const LEGACY_NIL_UUID = "00000000-0000-0000-0000-000000000000";
const LEGACY_DATETIME = "1970-01-01T00:00:00.000Z";

export const studentSessionRequestSchema = z.object({
  question: z.string().trim().min(3).max(8000)
});

export const studentAnswerSchema = z.object({
  modelRole: z.literal("student"),
  answer: z.string().min(1),
  key_points: z.array(z.string()).max(12),
  assumptions: z.array(z.string()).max(12),
  confidence: boundedScoreSchema
});

export const studentAnalyzeRequestSchema = z.object({
  previewId: z.string().uuid()
});

export const studentJudgeOutputSchema = z.object({
  modelRole: z.literal("student_judge"),
  initial_score: judgeSideScoreSchema,
  improved_score: judgeSideScoreSchema,
  verdict: z.enum(["improved", "minor", "needs_work", "regressed"]),
  worthIt: z.enum(["YES", "NO"]),
  reasoning: z.string().min(1),
  weak_points: z.array(z.string()).max(8),
  strong_points: z.array(z.string()).max(8)
});

export const studentRuleQuestionTypeSchema = z.enum([
  "open",
  "factual",
  "explanatory",
  "strategic"
]);

export const studentRulePromptLengthSchema = z.enum([
  "short",
  "medium",
  "long"
]);

export const studentRuleImpactContextSignalSchema = z.enum([
  "uncertainty",
  "claims",
  "abstraction"
]);

export const studentRuleImpactContextSchema = z.object({
  questionType: studentRuleQuestionTypeSchema,
  promptLength: studentRulePromptLengthSchema,
  promptWordCount: z.number().int().min(1).max(400),
  signals: z.array(studentRuleImpactContextSignalSchema).max(3)
});

export const studentStrategyProfileSchema = z.enum([
  "open_short",
  "open_scope_anchor",
  "open_medium",
  "open_long",
  "factual_short",
  "factual_medium",
  "factual_verify_first",
  "factual_long",
  "explanatory_short",
  "explanatory_compact_example",
  "explanatory_medium",
  "explanatory_long",
  "reasoning_bridge_medium",
  "strategic_short",
  "strategic_medium",
  "strategic_long"
]);

export const studentStrategyImpactStatusSchema = z.enum([
  "active",
  "cautious",
  "inactive"
]);

export const studentStrategyActivationModeSchema = z.enum([
  "contextual",
  "overall",
  "fallback"
]);

export const studentResponseStrategySchema = z.object({
  strategyId: studentStrategyProfileSchema,
  context: studentRuleImpactContextSchema,
  impactStatus: studentStrategyImpactStatusSchema.default("cautious"),
  activationMode: studentStrategyActivationModeSchema.default("fallback"),
  impactConfidence: z.number().min(0).max(1).default(0.5),
  impactReason: z.string().min(1).max(320).default("No empirical strategy impact yet."),
  targetLengthWords: z.object({
    min: z.number().int().min(20).max(400),
    max: z.number().int().min(30).max(500)
  }),
  directives: z.array(z.string().min(1).max(180)).min(2).max(8),
  avoidances: z.array(z.string().min(1).max(180)).max(8),
  influencedBy: z.object({
    signals: z.array(z.string().min(1).max(80)).max(8),
    studentRuleIds: z.array(z.string().min(1).max(160)).max(8),
    memoryDomains: z.array(z.string().min(1).max(32)).max(6),
    winningPatterns: z.array(z.string().min(1).max(200)).max(4)
  }),
  reasoning: z.array(z.string().min(1).max(220)).min(2).max(10)
});

const defaultStudentStrategy = {
  strategyId: "open_short" as const,
  context: {
    questionType: "open" as const,
    promptLength: "short" as const,
    promptWordCount: 1,
    signals: []
  },
  impactStatus: "cautious" as const,
  activationMode: "fallback" as const,
  impactConfidence: 0.5,
  impactReason: "Legacy student session loaded without an explicit empirical strategy signal.",
  targetLengthWords: {
    min: 70,
    max: 110
  },
  directives: [
    "Broaden slightly beyond a bare definition.",
    "Add one useful angle such as example, limit, or implication."
  ],
  avoidances: ["Do not stop at a thin textbook definition."],
  influencedBy: {
    signals: [],
    studentRuleIds: [],
    memoryDomains: [],
    winningPatterns: []
  },
  reasoning: [
    "Legacy student session loaded without an explicit strategy.",
    "Fallback open_short strategy applied for compatibility."
  ]
};

const defaultHydriaMemorySnapshot = {
  snapshotId: LEGACY_NIL_UUID,
  question: "Legacy student session",
  category: "other" as const,
  summary: "Legacy session loaded before Hydria core memory snapshots were recorded.",
  core: [],
  episodic: [],
  semantic: [],
  archival: [],
  retrieval: {
    strategyId: "legacy",
    researchIntent: null,
    temporalQueryType: null,
    preferredDomains: [],
    studentRuleIds: []
  }
};

const defaultHydriaWorkflowRun = {
  runId: LEGACY_NIL_UUID,
  scope: "student_session" as const,
  status: "partial" as const,
  question: "Legacy student session",
  category: "other" as const,
  startedAt: LEGACY_DATETIME,
  completedAt: LEGACY_DATETIME,
  messages: [],
  handoffs: [],
  tasks: [],
  degradationReasons: [],
  outcome: "Legacy session loaded before Hydria workflow metadata was recorded."
};

export const studentAnswerPreviewSchema = z.object({
  previewId: z.string().uuid(),
  question: z.string().min(1),
  category: questionCategorySchema,
  knowledge: knowledgeInjectionSchema.nullable(),
  memory: hydriaMemorySnapshotSchema,
  orchestration: orchestrationPolicySchema,
  research: researchToolLogSchema,
  strategy: studentResponseStrategySchema,
  workflow: hydriaWorkflowRunSchema,
  student: z.object({
    rawDraft: studentAnswerSchema,
    draft: studentAnswerSchema,
    baselineDraft: studentAnswerSchema.nullable().default(null),
    toolApplied: z.boolean().default(false)
  }),
  trace: z.object({
    student: executionTraceSchema
  }),
  durationMs: z.number().int().nonnegative()
});

export const studentSessionModelsSchema = z.object({
  studentLocalModel: z.string().min(1),
  teacherModel: z.string().min(1),
  redTeamModel: z.string().min(1),
  judgeModel: z.string().min(1)
});

export const studentSessionTraceSchema = z.object({
  student: executionTraceSchema,
  redTeam: executionTraceSchema,
  teacher: executionTraceSchema,
  judge: executionTraceSchema
});

export const studentRuleImpactJudgeSchema = z.object({
  initial_score: judgeSideScoreSchema,
  improved_score: judgeSideScoreSchema,
  verdict: z.enum(["improved", "minor", "needs_work", "regressed"]),
  worthIt: z.enum(["YES", "NO"]),
  reasoning: z.string().min(1)
});

export const studentRuleImpactMetricsSchema = z.object({
  judgeOverallDelta: z.number().min(-100).max(100),
  gainGlobal: z.number().min(-100).max(100),
  lengthDeltaWords: z.number().int().min(-2000).max(2000),
  keyPointsDelta: z.number().int().min(-20).max(20),
  assumptionsDelta: z.number().int().min(-20).max(20),
  structureDelta: z.number().int().min(-40).max(40),
  success: z.boolean()
});

export const studentRuleImpactRuleResultSchema = z.object({
  ruleId: z.string().min(1).max(160),
  failureType: z.string().min(1).max(64),
  rule: z.string().min(1).max(240),
  activationConfidence: z.number().min(0).max(1),
  evidenceCount: z.number().int().min(1).max(50),
  conditions: z.array(z.string().min(1).max(160)).max(4),
  metrics: studentRuleImpactMetricsSchema
});

export const studentRuleImpactSchema = z.object({
  compared: z.boolean(),
  baselineAvailable: z.boolean(),
  context: studentRuleImpactContextSchema.default({
    questionType: "open",
    promptLength: "short",
    promptWordCount: 1,
    signals: []
  }),
  activatedRuleIds: z.array(z.string().min(1).max(160)).max(8),
  judge: studentRuleImpactJudgeSchema.nullable(),
  metrics: studentRuleImpactMetricsSchema,
  perRule: z.array(studentRuleImpactRuleResultSchema).max(8)
});

export const studentToolImpactLabelSchema = z.enum([
  "improved_factual_accuracy",
  "reduced_uncertainty",
  "no_impact",
  "no_reliable_source",
  "negative"
]);

export const studentToolImpactSchema = z.object({
  toolUsed: z.boolean(),
  toolReason: z.string().min(1).max(400),
  toolImpact: studentToolImpactLabelSchema,
  compared: z.boolean(),
  baselineAvailable: z.boolean(),
  context: studentRuleImpactContextSchema.default({
    questionType: "open",
    promptLength: "short",
    promptWordCount: 1,
    signals: []
  }),
  noReliableSource: z.boolean().default(false),
  confidenceScore: z.number().min(0).max(1).default(0),
  judge: studentRuleImpactJudgeSchema.nullable(),
  metrics: studentRuleImpactMetricsSchema
});

export const studentStrategyImpactSchema = z.object({
  compared: z.boolean(),
  baselineAvailable: z.boolean(),
  strategyId: studentStrategyProfileSchema,
  activationMode: studentStrategyActivationModeSchema.default("fallback"),
  impactStatus: studentStrategyImpactStatusSchema.default("cautious"),
  impactConfidence: z.number().min(0).max(1).default(0.5),
  context: studentRuleImpactContextSchema.default({
    questionType: "open",
    promptLength: "short",
    promptWordCount: 1,
    signals: []
  }),
  judge: studentRuleImpactJudgeSchema.nullable(),
  metrics: studentRuleImpactMetricsSchema
});

export const studentLessonFailureTypeSchema = z.enum([
  "too_generic",
  "vague_definition",
  "missing_examples",
  "missing_limits",
  "unsupported_claim",
  "missing_metrics",
  "missing_risk_tradeoff",
  "hidden_assumptions",
  "weak_structure",
  "low_actionability",
  "diagnostic_overclaim",
  "other"
]);

export const studentLessonLearnedSchema = z.object({
  lessonId: z.string().min(1).max(120).default("legacy-lesson"),
  failureType: studentLessonFailureTypeSchema.default("other"),
  error: z.string().min(1).max(400),
  correction: z.string().min(1).max(400),
  rule: z.string().min(1).max(240),
  conditions: z.array(z.string().min(1).max(160)).max(5).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  evidenceCount: z.number().int().min(1).max(20).default(1)
});

export const studentProgressionSchema = z.object({
  sessionScore: boundedScoreSchema,
  deltaOverall: z.number().min(-100).max(100),
  draftOverall: boundedScoreSchema,
  improvedOverall: boundedScoreSchema,
  verdictWeight: z.number().min(-30).max(30),
  trend: z.enum(["up", "flat", "down"])
});

export const studentCompressedCycleSchema = z.object({
  input: z.string().min(1).max(8000),
  weakAnswer: z.string().min(1),
  correctedAnswer: z.string().min(1),
  keyCorrection: z.string().min(1).max(240)
});

export const studentSessionSchema = z.object({
  sessionId: z.string().uuid(),
  createdAt: z.string().datetime(),
  question: z.string().min(1),
  category: questionCategorySchema,
  models: studentSessionModelsSchema,
  orchestration: orchestrationPolicySchema,
  knowledge: knowledgeInjectionSchema.nullable(),
  memory: hydriaMemorySnapshotSchema.default(defaultHydriaMemorySnapshot),
  strategy: studentResponseStrategySchema.default(defaultStudentStrategy),
  research: researchToolLogSchema,
  workflow: hydriaWorkflowRunSchema.default(defaultHydriaWorkflowRun),
  student: z.object({
    draft: studentAnswerSchema,
    final: studentAnswerSchema,
    toolApplied: z.boolean()
  }),
  redTeam: redTeamOutputSchema,
  judge: studentJudgeOutputSchema,
  teacher: refinerOutputSchema,
  weakPoints: z.array(z.string()).max(12),
  coachingNotes: z.array(z.string()).max(12),
  lessonsLearned: z.array(studentLessonLearnedSchema).max(8).default([]),
  progression: studentProgressionSchema.default({
    sessionScore: 50,
    deltaOverall: 0,
    draftOverall: 50,
    improvedOverall: 50,
    verdictWeight: 0,
    trend: "flat"
  }),
  compressedCycle: studentCompressedCycleSchema.default({
    input: "Legacy student session",
    weakAnswer: "Legacy student answer unavailable.",
    correctedAnswer: "Legacy teacher answer unavailable.",
    keyCorrection: "Make the answer more concrete and easier to validate."
  }),
  tooling: studentToolImpactSchema.default({
    toolUsed: false,
    toolReason: "Legacy student session loaded without explicit tool tracking.",
    toolImpact: "no_impact",
    compared: false,
    baselineAvailable: false,
    context: {
      questionType: "open",
      promptLength: "short",
      promptWordCount: 1,
      signals: []
    },
    noReliableSource: false,
    confidenceScore: 0,
    judge: null,
    metrics: {
      judgeOverallDelta: 0,
      gainGlobal: 0,
      lengthDeltaWords: 0,
      keyPointsDelta: 0,
      assumptionsDelta: 0,
      structureDelta: 0,
      success: false
    }
  }),
  ruleImpact: studentRuleImpactSchema.default({
    compared: false,
    baselineAvailable: false,
    context: {
      questionType: "open",
      promptLength: "short",
      promptWordCount: 1,
      signals: []
    },
    activatedRuleIds: [],
    judge: null,
    metrics: {
      judgeOverallDelta: 0,
      gainGlobal: 0,
      lengthDeltaWords: 0,
      keyPointsDelta: 0,
      assumptionsDelta: 0,
      structureDelta: 0,
      success: false
    },
    perRule: []
  }),
  strategyImpact: studentStrategyImpactSchema.default({
    compared: false,
    baselineAvailable: false,
    strategyId: "open_short",
    activationMode: "fallback",
    impactStatus: "cautious",
    impactConfidence: 0.5,
    context: {
      questionType: "open",
      promptLength: "short",
      promptWordCount: 1,
      signals: []
    },
    judge: null,
    metrics: {
      judgeOverallDelta: 0,
      gainGlobal: 0,
      lengthDeltaWords: 0,
      keyPointsDelta: 0,
      assumptionsDelta: 0,
      structureDelta: 0,
      success: false
    }
  }),
  traces: studentSessionTraceSchema,
  durationMs: z.number().int().nonnegative()
});

export const studentProgressSummarySchema = z.object({
  totalSessions: z.number().int().nonnegative(),
  averageSessionScore: boundedScoreSchema,
  latestSessionScore: boundedScoreSchema,
  averageDeltaOverall: z.number().min(-100).max(100),
  improvedRate: boundedScoreSchema,
  worthItRate: boundedScoreSchema,
  recentTrend: z.enum(["up", "flat", "down"]),
  categoryHighlights: z
    .array(
      z.object({
        category: questionCategorySchema,
        averageSessionScore: boundedScoreSchema,
        sessions: z.number().int().positive()
      })
    )
    .max(8)
});

export const studentSessionHistorySchema = z.object({
  sessions: z.array(studentSessionSchema)
});

export const studentSessionHistoryResponseSchema = z.object({
  sessions: z.array(studentSessionSchema),
  summary: studentProgressSummarySchema
});

export const studentCycleDatasetEntrySchema = z.object({
  datasetVersion: z.literal("hydria-student-cycle-v2"),
  sessionId: z.string().uuid(),
  createdAt: z.string().datetime(),
  question: z.string().min(1),
  category: questionCategorySchema,
  studentAnswer: z.string().min(1),
  teacherAnswer: z.string().min(1),
  verdict: z.enum(["improved", "minor", "needs_work", "regressed"]),
  worthIt: z.enum(["YES", "NO"]),
  weakPoints: z.array(z.string()).max(12),
  coachingNotes: z.array(z.string()).max(12),
  lessonsLearned: z.array(studentLessonLearnedSchema).max(8),
  progressionScore: boundedScoreSchema,
  researchUsed: z.boolean(),
  tooling: studentToolImpactSchema,
  knowledgeStrategy: z.string().min(1).max(400),
  ruleImpact: studentRuleImpactSchema,
  strategyImpact: studentStrategyImpactSchema,
  compressedCycle: studentCompressedCycleSchema
});

export type StudentAnswer = z.infer<typeof studentAnswerSchema>;
export type StudentAnswerPreview = z.infer<typeof studentAnswerPreviewSchema>;
export type StudentJudgeOutput = z.infer<typeof studentJudgeOutputSchema>;
export type StudentRuleQuestionType = z.infer<typeof studentRuleQuestionTypeSchema>;
export type StudentRulePromptLength = z.infer<typeof studentRulePromptLengthSchema>;
export type StudentRuleImpactContextSignal = z.infer<
  typeof studentRuleImpactContextSignalSchema
>;
export type StudentRuleImpactContext = z.infer<typeof studentRuleImpactContextSchema>;
export type StudentStrategyProfile = z.infer<typeof studentStrategyProfileSchema>;
export type StudentResponseStrategy = z.infer<typeof studentResponseStrategySchema>;
export type StudentLessonFailureType = z.infer<typeof studentLessonFailureTypeSchema>;
export type StudentLessonLearned = z.infer<typeof studentLessonLearnedSchema>;
export type StudentRuleImpact = z.infer<typeof studentRuleImpactSchema>;
export type StudentToolImpactLabel = z.infer<typeof studentToolImpactLabelSchema>;
export type StudentToolImpact = z.infer<typeof studentToolImpactSchema>;
export type StudentStrategyImpactStatus = z.infer<typeof studentStrategyImpactStatusSchema>;
export type StudentStrategyActivationMode = z.infer<typeof studentStrategyActivationModeSchema>;
export type StudentStrategyImpact = z.infer<typeof studentStrategyImpactSchema>;
export type StudentProgression = z.infer<typeof studentProgressionSchema>;
export type StudentCompressedCycle = z.infer<typeof studentCompressedCycleSchema>;
export type StudentProgressSummary = z.infer<typeof studentProgressSummarySchema>;
export type StudentSession = z.infer<typeof studentSessionSchema>;
export type StudentCycleDatasetEntry = z.infer<typeof studentCycleDatasetEntrySchema>;

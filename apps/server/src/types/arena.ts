import { z } from "zod";

const boundedScoreSchema = z.coerce.number().min(0).max(100);
const refineConfidenceSchema = z.coerce.number().int().min(0).max(10);
const activeProviderSchema = z.enum(["openrouter", "ollama"]);
export const questionCategorySchema = z.enum([
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning",
  "other"
]);
const traceProviderSchema = z.enum([
  "openrouter",
  "ollama",
  "router",
  "fallback",
  "disabled",
  "legacy"
]);
const traceOutcomeSchema = z.enum([
  "success",
  "retry_success",
  "fallback_success",
  "failure",
  "skipped",
  "static_fallback",
  "disabled",
  "legacy"
]);
const attemptModeSchema = z.enum(["primary", "repair_retry", "fallback"]);
const signedScoreDeltaSchema = z.coerce.number().int().min(-100).max(100);
const gainClassificationSchema = z.enum(["negligible", "weak", "moderate", "strong"]);
const refineDecisionValueSchema = z.enum(["YES", "NO"]);
export const routerEstimatedValueSchema = z.enum(["low", "medium", "high"]);
export const refineRouterStrategySchema = z.enum([
  "refine_all",
  "refine_selective",
  "skip_refine"
]);
export const orchestrationFocusSchema = z.enum([
  "risk_containment",
  "execution_clarity",
  "tradeoff_clarity",
  "pedagogy_precision",
  "diagnostic_caution",
  "strategy_actionability",
  "balanced_reasoning",
  "factual_grounding",
  "general_quality"
]);
export const orchestrationRefinePolicySchema = z.enum([
  "aggressive",
  "balanced",
  "conservative"
]);
export const orchestrationResearchPolicySchema = z.enum([
  "off",
  "verify_only",
  "ground_if_needed",
  "targeted"
]);
export const orchestrationCostPolicySchema = z.enum([
  "latency_guarded",
  "balanced",
  "quality_first"
]);
export const researchRouteSchema = z.enum(["not_needed", "used", "failed"]);
export const researchDecisionModeSchema = z.enum([
  "off",
  "targeted_verify",
  "constraint_check",
  "fact_check_only",
  "verify_factual_subpart"
]);
export const researchIntentSchema = z.enum([
  "definition",
  "fact_check",
  "product_docs",
  "constraint_check",
  "incident_guidance",
  "diagnostic_docs",
  "metric_verification"
]);
export const researchExpectedValueSchema = z.enum(["low", "medium", "high"]);
export const researchNetImpactSchema = z.enum([
  "positive",
  "neutral",
  "negative",
  "unknown"
]);
export const routingRecommendationSchema = z.enum([
  "prefer_refine",
  "prefer_skip",
  "selective",
  "insufficient_data"
]);
const redTeamRiskLevelSchema = z
  .preprocess((value) => {
    if (typeof value === "string") {
      const match = value.match(/-?\d+/);
      return match ? Number(match[0]) : undefined;
    }

    return value;
  }, z.coerce.number().min(0).max(100))
  .catch(50);
const redTeamWinnerSchema = z
  .preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "a") {
      return "A";
    }
    if (normalized === "b") {
      return "B";
    }
    if (normalized === "tie") {
      return "tie";
    }

    return value;
  }, z.enum(["A", "B", "tie"]))
  .catch("tie");

export const modelSelectionSchema = z.object({
  respondentA: z.string().min(1),
  respondentB: z.string().min(1),
  redTeam: z.string().min(1),
  judge: z.string().min(1),
  synthesizer: z.string().min(1)
});

export const arenaRunRequestSchema = z.object({
  question: z.string().trim().min(3).max(8000),
  models: modelSelectionSchema
});

export const respondentOutputSchema = z.object({
  modelRole: z.literal("respondent"),
  answer: z.string().min(1),
  key_points: z.array(z.string()).min(1).max(12),
  assumptions: z.array(z.string()).max(12),
  confidence: boundedScoreSchema
});

export const redTeamOutputSchema = z.object({
  modelRole: z.literal("redteam"),
  attacks_on_a: z.array(z.string()).max(12).catch([]),
  attacks_on_b: z.array(z.string()).max(12).catch([]),
  shared_risks: z.array(z.string()).max(12).catch([]),
  failure_scenarios: z.array(z.string()).max(12).catch([]),
  hidden_assumptions: z.array(z.string()).max(12).catch([]),
  potentially_false_claims: z.array(z.string()).max(12).catch([]),
  factual_risk_level: redTeamRiskLevelSchema,
  reasoning_risk_level: redTeamRiskLevelSchema,
  winner_so_far: redTeamWinnerSchema
});

export const refinerOutputSchema = z.object({
  modelRole: z.literal("refiner"),
  improved_answer: z.string().min(1),
  fixes_applied: z.array(z.string()).max(12),
  remaining_uncertainties: z.array(z.string()).max(12),
  confidence: refineConfidenceSchema,
  routerSkipped: z.boolean().default(false)
});

export const judgeSideScoreSchema = z.object({
  clarity: boundedScoreSchema,
  relevance: boundedScoreSchema,
  robustness: boundedScoreSchema,
  hallucination_risk: boundedScoreSchema,
  overall: boundedScoreSchema
});

export const judgeScorePairSchema = z.object({
  A: judgeSideScoreSchema,
  B: judgeSideScoreSchema
});

export const judgeOutputSchema = z.object({
  modelRole: z.literal("judge"),
  initial_scores: judgeScorePairSchema,
  scores: judgeScorePairSchema,
  winner: z.enum(["A", "B", "tie"]),
  reasoning: z.string().min(1)
});

export const synthesizerOutputSchema = z.object({
  modelRole: z.literal("synthesizer"),
  final_answer: z.string().min(1),
  why_this_answer: z.string().min(1),
  based_on_winner: z.enum(["A", "B", "tie"]),
  improvements_added: z.array(z.string()).max(12)
});

export const localStudentRoundOutputSchema = z.object({
  modelRole: z.literal("local_student"),
  student_answer: z.string().min(1),
  student_summary: z.string().min(1),
  learning_notes: z.array(z.string()).max(12)
});

export const executionAttemptSchema = z.object({
  provider: activeProviderSchema,
  model: z.string().min(1),
  mode: attemptModeSchema.default("primary")
});

export const executionTraceSchema = z.object({
  requestedProvider: activeProviderSchema,
  requestedModel: z.string().min(1),
  attempts: z.array(executionAttemptSchema).max(6),
  finalProvider: traceProviderSchema,
  finalModel: z.string().min(1),
  usedRetry: z.boolean().default(false),
  usedFallback: z.boolean(),
  validationFailures: z.number().int().nonnegative().max(6).default(0),
  outcome: traceOutcomeSchema,
  note: z.string().min(1).max(1000)
});

export const arenaTraceSchema = z.object({
  respondentA: executionTraceSchema,
  respondentB: executionTraceSchema,
  redTeam: executionTraceSchema,
  refineA: executionTraceSchema,
  refineB: executionTraceSchema,
  judge: executionTraceSchema,
  synthesizer: executionTraceSchema,
  localStudent: executionTraceSchema
});

export const arenaTimingsSchema = z.object({
  respondentA: z.number().int().nonnegative(),
  respondentB: z.number().int().nonnegative(),
  redTeam: z.number().int().nonnegative(),
  refineA: z.number().int().nonnegative(),
  refineB: z.number().int().nonnegative(),
  judge: z.number().int().nonnegative(),
  synthesizer: z.number().int().nonnegative(),
  localStudent: z.number().int().nonnegative()
});

export const refineImpactVerdictSchema = z.enum([
  "useful",
  "minor",
  "neutral",
  "degrading",
  "fallback_preserved"
]);

export const refineImpactDetailSchema = z.object({
  overallDelta: signedScoreDeltaSchema,
  clarityDelta: signedScoreDeltaSchema,
  relevanceDelta: signedScoreDeltaSchema,
  robustnessDelta: signedScoreDeltaSchema,
  hallucinationRiskReduction: signedScoreDeltaSchema,
  critiqueCoveragePct: boundedScoreSchema,
  fixesCount: z.number().int().nonnegative().max(12)
});

export const scoreExplanationDetailSchema = z.object({
  improvements: z.array(z.string()).max(8),
  regressions: z.array(z.string()).max(8),
  main_driver: z.string().min(1).max(160)
});

export const routerCategoryBenchmarkInsightSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  averageGain: z.number(),
  worthItRate: boundedScoreSchema,
  fallbackRate: boundedScoreSchema,
  noOpRate: boundedScoreSchema.default(0),
  staticFallbackRate: boundedScoreSchema.default(0),
  positiveResearchImpactRate: boundedScoreSchema.default(0),
  routingRecommendation: routingRecommendationSchema
});

export const routerSideSignalSchema = z.object({
  riskScore: boundedScoreSchema,
  qualityScore: boundedScoreSchema,
  answerWordCount: z.number().int().nonnegative().max(4000),
  directCritiques: z.number().int().nonnegative().max(20),
  structuralRiskCount: z.number().int().nonnegative().max(40)
});

export const refineRouterDecisionSchema = z.object({
  category: questionCategorySchema,
  shouldRefineA: z.boolean(),
  shouldRefineB: z.boolean(),
  globalStrategy: refineRouterStrategySchema,
  reasoning: z.array(z.string()).min(1).max(12),
  estimatedValue: z.object({
    A: routerEstimatedValueSchema,
    B: routerEstimatedValueSchema
  }),
  benchmarkInsight: routerCategoryBenchmarkInsightSchema,
  sideSignals: z.object({
    A: routerSideSignalSchema,
    B: routerSideSignalSchema
  })
});

export const refineProfileSchema = z.object({
  A: questionCategorySchema,
  B: questionCategorySchema
});

export const orchestrationPolicySchema = z.object({
  category: questionCategorySchema,
  focus: orchestrationFocusSchema,
  refinePolicy: orchestrationRefinePolicySchema,
  researchPolicy: orchestrationResearchPolicySchema,
  costPolicy: orchestrationCostPolicySchema,
  refineBias: z.number().int().min(-20).max(20),
  researchBias: z.number().int().min(-20).max(20),
  targetOutcomes: z.array(z.string()).max(8),
  prioritySignals: z.array(z.string()).max(10),
  reasoning: z.array(z.string()).min(1).max(12)
});

export const researchSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string().min(1),
  excerpt: z.string().min(1)
});

export const researchVerificationSchema = z.object({
  sourceCount: z.number().int().nonnegative(),
  extractedSourceCount: z.number().int().nonnegative(),
  corroboratedSignals: z.array(z.string()).max(8)
});

export const researchTruthSchema = z.object({
  verified_facts: z.array(z.string()).max(8).default([]),
  uncertain_claims: z.array(z.string()).max(8).default([]),
  conflicting_info: z.array(z.string()).max(6).default([]),
  confidence_score: z.number().min(0).max(1).default(0),
  no_reliable_source: z.boolean().default(false)
});

export const researchDecisionDetailsSchema = z.object({
  shouldUse: z.boolean(),
  mode: researchDecisionModeSchema,
  expectedValue: researchExpectedValueSchema,
  expectedCostMs: z.number().int().nonnegative(),
  triggerSignals: z.array(z.string()).max(12),
  targetClaims: z.array(z.string()).max(8),
  reasoning: z.string().min(1).max(400)
});

export const researchQueryPlanSchema = z.object({
  intent: researchIntentSchema,
  queries: z.array(z.string()).max(3),
  selectedQuery: z.string().nullable(),
  requiredTerms: z.array(z.string()).max(8),
  preferredDomains: z.array(z.string()).max(8),
  factFocusTerms: z.array(z.string()).max(8)
});

export const researchImpactSchema = z.object({
  refineChangedBecauseOfTool: z.boolean(),
  addedFactsCount: z.number().int().nonnegative().max(20),
  correctedClaimsCount: z.number().int().nonnegative().max(12),
  sourceBackedClaimsCount: z.number().int().nonnegative().max(12),
  costSharePct: boundedScoreSchema,
  netImpact: researchNetImpactSchema
});

export const researchToolLogSchema = z.object({
  considered: z.boolean(),
  used: z.boolean(),
  route: researchRouteSchema,
  decision: researchDecisionDetailsSchema,
  queryPlan: researchQueryPlanSchema,
  query: z.string().nullable(),
  reasons: z.array(z.string()).max(12),
  summary: z.array(z.string()).max(8),
  sources: z.array(researchSourceSchema).max(5),
  verification: researchVerificationSchema,
  truth: researchTruthSchema.default({
    verified_facts: [],
    uncertain_claims: [],
    conflicting_info: [],
    confidence_score: 0,
    no_reliable_source: false
  }),
  appliedTo: z.object({
    A: z.boolean(),
    B: z.boolean()
  }),
  impact: researchImpactSchema,
  impactNotes: z.array(z.string()).max(12),
  durationMs: z.number().int().nonnegative()
});

export const arenaMetricsSchema = z.object({
  initialScores: judgeScorePairSchema,
  refinedScores: judgeScorePairSchema,
  refineImpact: z.object({
    A: refineImpactDetailSchema,
    B: refineImpactDetailSchema
  }),
  refineGain: z.object({
    A: signedScoreDeltaSchema,
    B: signedScoreDeltaSchema,
    global: signedScoreDeltaSchema
  }),
  gainClassification: z.object({
    A: gainClassificationSchema,
    B: gainClassificationSchema,
    global: gainClassificationSchema
  }),
  scoreExplanation: z.object({
    A: scoreExplanationDetailSchema,
    B: scoreExplanationDetailSchema
  }),
  scoreAverages: z.object({
    initial: boundedScoreSchema,
    refined: boundedScoreSchema
  }),
  latencyBreakdown: z.object({
    totalMs: z.number().int().nonnegative(),
    refineMs: z.number().int().nonnegative(),
    refineSharePct: boundedScoreSchema
  }),
  routing: z.object({
    refineExecutedCount: z.number().int().min(0).max(2),
    refineSkippedCount: z.number().int().min(0).max(2),
    refineExecutionRate: boundedScoreSchema,
    refineSkipRate: boundedScoreSchema,
    averageGainWhenRefined: z.number().min(-20).max(20),
    averageGainWhenSkipped: z.number().min(-20).max(20)
  }),
  topValueStep: z.enum(["refineA", "refineB", "tie"])
});

export const arenaVerdictsSchema = z.object({
  refineA: refineImpactVerdictSchema,
  refineB: refineImpactVerdictSchema
});

export const refineDecisionSchema = z.object({
  A: refineDecisionValueSchema,
  B: refineDecisionValueSchema,
  global: refineDecisionValueSchema
});

export const arenaRoundSchema = z.object({
  roundId: z.string().uuid(),
  question: z.string(),
  category: questionCategorySchema,
  models: modelSelectionSchema,
  outputs: z.object({
    respondentA: respondentOutputSchema,
    respondentB: respondentOutputSchema,
    redTeam: redTeamOutputSchema,
    refineA: refinerOutputSchema,
    refineB: refinerOutputSchema,
    judge: judgeOutputSchema,
    synthesizer: synthesizerOutputSchema,
    localStudent: localStudentRoundOutputSchema
  }),
  trace: arenaTraceSchema,
  orchestration: orchestrationPolicySchema,
  router: refineRouterDecisionSchema,
  research: researchToolLogSchema,
  refineProfile: refineProfileSchema,
  timings: arenaTimingsSchema,
  metrics: arenaMetricsSchema,
  verdicts: arenaVerdictsSchema,
  refineDecision: refineDecisionSchema,
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
});

export const historyFileSchema = z.object({
  rounds: z.array(arenaRoundSchema)
});

export type ArenaRunRequest = z.infer<typeof arenaRunRequestSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type QuestionCategory = z.infer<typeof questionCategorySchema>;
export type RespondentOutput = z.infer<typeof respondentOutputSchema>;
export type RedTeamOutput = z.infer<typeof redTeamOutputSchema>;
export type RefinerOutput = z.infer<typeof refinerOutputSchema>;
export type JudgeScorePair = z.infer<typeof judgeScorePairSchema>;
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;
export type SynthesizerOutput = z.infer<typeof synthesizerOutputSchema>;
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;
export type ExecutionTrace = z.infer<typeof executionTraceSchema>;
export type ArenaTrace = z.infer<typeof arenaTraceSchema>;
export type ArenaTimings = z.infer<typeof arenaTimingsSchema>;
export type RefineImpactVerdict = z.infer<typeof refineImpactVerdictSchema>;
export type RefineImpactDetail = z.infer<typeof refineImpactDetailSchema>;
export type GainClassification = z.infer<typeof gainClassificationSchema>;
export type ScoreExplanationDetail = z.infer<typeof scoreExplanationDetailSchema>;
export type RoutingRecommendation = z.infer<typeof routingRecommendationSchema>;
export type RouterEstimatedValue = z.infer<typeof routerEstimatedValueSchema>;
export type RefineRouterStrategy = z.infer<typeof refineRouterStrategySchema>;
export type OrchestrationFocus = z.infer<typeof orchestrationFocusSchema>;
export type OrchestrationRefinePolicy = z.infer<typeof orchestrationRefinePolicySchema>;
export type OrchestrationResearchPolicy = z.infer<typeof orchestrationResearchPolicySchema>;
export type OrchestrationCostPolicy = z.infer<typeof orchestrationCostPolicySchema>;
export type ResearchDecisionMode = z.infer<typeof researchDecisionModeSchema>;
export type ResearchIntent = z.infer<typeof researchIntentSchema>;
export type ResearchExpectedValue = z.infer<typeof researchExpectedValueSchema>;
export type ResearchNetImpact = z.infer<typeof researchNetImpactSchema>;
export type RouterCategoryBenchmarkInsight = z.infer<
  typeof routerCategoryBenchmarkInsightSchema
>;
export type RouterSideSignal = z.infer<typeof routerSideSignalSchema>;
export type RefineRouterDecisionDetails = z.infer<typeof refineRouterDecisionSchema>;
export type RefineProfile = z.infer<typeof refineProfileSchema>;
export type OrchestrationPolicyDetails = z.infer<typeof orchestrationPolicySchema>;
export type ResearchSource = z.infer<typeof researchSourceSchema>;
export type ResearchVerification = z.infer<typeof researchVerificationSchema>;
export type ResearchTruth = z.infer<typeof researchTruthSchema>;
export type ResearchDecisionDetails = z.infer<typeof researchDecisionDetailsSchema>;
export type ResearchQueryPlan = z.infer<typeof researchQueryPlanSchema>;
export type ResearchImpact = z.infer<typeof researchImpactSchema>;
export type ResearchToolLog = z.infer<typeof researchToolLogSchema>;
export type ArenaMetrics = z.infer<typeof arenaMetricsSchema>;
export type ArenaVerdicts = z.infer<typeof arenaVerdictsSchema>;
export type RefineDecision = z.infer<typeof refineDecisionSchema>;
export type ArenaRound = z.infer<typeof arenaRoundSchema>;

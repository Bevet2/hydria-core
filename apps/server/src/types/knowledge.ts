import { z } from "zod";
import {
  questionCategorySchema,
  routingRecommendationSchema
} from "./arena.js";

const boundedPctSchema = z.number().min(0).max(100);

export const knowledgePatternSchema = z.object({
  text: z.string().min(1).max(200),
  count: z.number().int().nonnegative(),
  exampleRoundIds: z.array(z.string().uuid()).max(5)
});

export const knowledgeRoutingSignalThresholdSchema = z.object({
  minRiskScore: z.number().int().min(0).max(100).nullable(),
  minDirectCritiques: z.number().int().min(0).max(20).nullable(),
  minStructuralRiskCount: z.number().int().min(0).max(40).nullable(),
  maxQualityScore: z.number().int().min(0).max(100).nullable()
});

export const knowledgeRoutingSkipThresholdSchema = z.object({
  maxRiskScore: z.number().int().min(0).max(100).nullable(),
  minQualityScore: z.number().int().min(0).max(100).nullable(),
  maxDirectCritiques: z.number().int().min(0).max(20).nullable(),
  maxStructuralRiskCount: z.number().int().min(0).max(40).nullable()
});

export const knowledgeToolRecommendationSchema = z.enum([
  "avoid",
  "verify_only",
  "prefer_grounded",
  "conditional"
]);

export const knowledgeMemoryDomainSchema = z.enum([
  "routing",
  "refine",
  "reasoning",
  "tool_usage"
]);

export const knowledgeMemoryConditionSignalSchema = z
  .string()
  .min(1)
  .max(64);

export const knowledgeMemoryInfluenceSchema = z.object({
  routingBias: z.number().int().min(-15).max(15),
  refineBias: z.number().int().min(-15).max(15),
  researchBias: z.number().int().min(-15).max(15)
});

export const knowledgeMemoryRuleSchema = z.object({
  ruleId: z.string().min(1).max(120),
  category: questionCategorySchema,
  domain: knowledgeMemoryDomainSchema,
  conditions: z.array(z.string().min(1).max(160)).min(1).max(6),
  conditionSignals: z.array(knowledgeMemoryConditionSignalSchema).min(1).max(8),
  lesson: z.string().min(1).max(240),
  recommendedStrategy: z.string().min(1).max(240),
  confidence: z.number().min(0).max(1),
  evidence: z.object({
    benchmarkSignals: z.array(z.string().min(1).max(180)).max(6),
    roundCount: z.number().int().nonnegative(),
    studentSessionCount: z.number().int().nonnegative(),
    repeatedLessonCount: z.number().int().nonnegative()
  }),
  influence: knowledgeMemoryInfluenceSchema
});

export const knowledgeMemoryCategorySchema = z.object({
  category: questionCategorySchema,
  summary: z.string().min(1).max(400),
  rules: z.array(knowledgeMemoryRuleSchema).max(12)
});

export const knowledgeCategoryStrategySchema = z.object({
  routingRecommendation: routingRecommendationSchema,
  routerBias: z.number().int().min(-30).max(30),
  toolRecommendation: knowledgeToolRecommendationSchema,
  refineWhen: knowledgeRoutingSignalThresholdSchema,
  skipWhen: knowledgeRoutingSkipThresholdSchema,
  highValueSignals: z.array(z.string().min(1).max(140)).max(8),
  lowValueSignals: z.array(z.string().min(1).max(140)).max(8),
  note: z.string().min(1).max(400)
});

export const knowledgeCategoryBenchmarkSnapshotSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  averageGain: z.number(),
  medianGain: z.number(),
  worthItRate: boundedPctSchema,
  degradingRate: boundedPctSchema,
  refineExecutionRate: boundedPctSchema,
  noOpRate: boundedPctSchema,
  staticFallbackRate: boundedPctSchema,
  researchUsageRate: boundedPctSchema,
  positiveResearchImpactRate: boundedPctSchema,
  respondentPrimarySuccessRate: boundedPctSchema
});

export const knowledgeRoundReferenceSchema = z.object({
  roundId: z.string().uuid(),
  prompt: z.string().min(1).max(8000),
  gain: z.number(),
  note: z.string().min(1).max(240)
});

export const knowledgeCategoryInsightSchema = z.object({
  category: questionCategorySchema,
  benchmark: knowledgeCategoryBenchmarkSnapshotSchema,
  winningPatterns: z.array(knowledgePatternSchema).max(10),
  losingPatterns: z.array(knowledgePatternSchema).max(10),
  bestRounds: z.array(knowledgeRoundReferenceSchema).max(3),
  worstRounds: z.array(knowledgeRoundReferenceSchema).max(3),
  strategy: knowledgeCategoryStrategySchema
});

export const knowledgeInjectionReferenceSchema = z.object({
  roundId: z.string().uuid(),
  gain: z.number(),
  note: z.string().min(1).max(240)
});

export const knowledgeInjectionSchema = z.object({
  category: questionCategorySchema,
  routingRecommendation: routingRecommendationSchema,
  toolRecommendation: knowledgeToolRecommendationSchema,
  strategyNote: z.string().min(1).max(400),
  winningPatterns: z.array(z.string().min(1).max(200)).max(5),
  antiPatterns: z.array(z.string().min(1).max(200)).max(5),
  highValueSignals: z.array(z.string().min(1).max(140)).max(5),
  lowValueSignals: z.array(z.string().min(1).max(140)).max(5),
  coachingHints: z.array(z.string().min(1).max(240)).max(8),
  bestRoundReferences: z.array(knowledgeInjectionReferenceSchema).max(3),
  memorySummary: z.string().min(1).max(400),
  memoryRules: z.array(
    z.object({
      domain: knowledgeMemoryDomainSchema,
      lesson: z.string().min(1).max(240),
      recommendedStrategy: z.string().min(1).max(240),
      confidence: z.number().min(0).max(1)
    })
  ).max(6),
  studentMemorySummary: z.string().min(1).max(400),
  studentMemoryRules: z.array(
    z.object({
      ruleId: z.string().min(1).max(160),
      failureType: z.string().min(1).max(64),
      rule: z.string().min(1).max(240),
      confidence: z.number().min(0).max(1),
      activationConfidence: z.number().min(0).max(1),
      activationMode: z.enum(["contextual", "overall", "fallback"]).default("fallback"),
      activationReason: z.string().min(1).max(240).default("Lesson-confidence fallback."),
      evidenceCount: z.number().int().min(1).max(50),
      conditions: z.array(z.string().min(1).max(160)).max(4)
    })
  ).max(6)
});

export const studentCuratedExampleSchema = z.object({
  datasetVersion: z.literal("hydria-student-curated-v1"),
  roundId: z.string().uuid(),
  createdAt: z.string().datetime(),
  category: questionCategorySchema,
  prompt: z.string().min(1),
  targetAnswer: z.string().min(1),
  targetSource: z.enum(["synthesizer", "winner_refined"]),
  preferredWinner: z.enum(["A", "B", "tie"]),
  globalGain: z.number(),
  refinedAverageScore: boundedPctSchema,
  researchUsed: z.boolean(),
  selectionScore: boundedPctSchema,
  selectionTier: z.enum(["gold", "silver", "bronze"]),
  coachingNotes: z.array(z.string().min(1).max(240)).min(1).max(12),
  winningPatterns: z.array(z.string().min(1).max(140)).max(6),
  antiPatterns: z.array(z.string().min(1).max(140)).max(6),
  strategyNote: z.string().min(1).max(400)
});

export const studentContrastiveExampleSchema = z.object({
  datasetVersion: z.literal("hydria-student-contrast-v1"),
  roundId: z.string().uuid(),
  createdAt: z.string().datetime(),
  category: questionCategorySchema,
  prompt: z.string().min(1),
  sourceAnswer: z.string().min(1),
  sourceSource: z.enum(["initial_A", "initial_B"]),
  targetAnswer: z.string().min(1),
  targetSource: z.enum(["synthesizer", "winner_refined"]),
  preferredWinner: z.enum(["A", "B", "tie"]),
  globalGain: z.number(),
  improvedDelta: z.number(),
  researchUsed: z.boolean(),
  selectionScore: boundedPctSchema,
  selectionTier: z.enum(["gold", "silver", "bronze"]),
  transformationNotes: z.array(z.string().min(1).max(240)).min(1).max(14),
  antiPatterns: z.array(z.string().min(1).max(140)).max(6),
  strategyNote: z.string().min(1).max(400)
});

export const knowledgeGlobalSummarySchema = z.object({
  officialBaselineRunId: z.string().uuid(),
  averageCoreGain: z.number(),
  medianCoreGain: z.number(),
  strongestCategories: z.array(questionCategorySchema).max(3),
  weakestCategories: z.array(questionCategorySchema).max(3),
  note: z.string().min(1).max(400)
});

export const knowledgeLayerSchema = z.object({
  version: z.literal("hydria-knowledge-v1"),
  builtAt: z.string().datetime(),
  sourceStats: z.object({
    benchmarkRunsAnalyzed: z.number().int().nonnegative(),
    benchmarkPromptResultsAnalyzed: z.number().int().nonnegative(),
    roundDatasetEntriesAnalyzed: z.number().int().nonnegative(),
    curatedStudentExamples: z.number().int().nonnegative()
  }),
  globalSummary: knowledgeGlobalSummarySchema,
  categories: z.array(knowledgeCategoryInsightSchema).length(8)
});

export const knowledgeMemorySchema = z.object({
  version: z.literal("hydria-memory-v1"),
  builtAt: z.string().datetime(),
  sourceStats: z.object({
    benchmarkRunsAnalyzed: z.number().int().nonnegative(),
    roundDatasetEntriesAnalyzed: z.number().int().nonnegative(),
    studentSessionsAnalyzed: z.number().int().nonnegative(),
    lessonsLearnedAnalyzed: z.number().int().nonnegative()
  }),
  categories: z.array(knowledgeMemoryCategorySchema).length(8)
});

export type KnowledgePattern = z.infer<typeof knowledgePatternSchema>;
export type KnowledgeCategoryStrategy = z.infer<typeof knowledgeCategoryStrategySchema>;
export type KnowledgeCategoryInsight = z.infer<typeof knowledgeCategoryInsightSchema>;
export type KnowledgeInjection = z.infer<typeof knowledgeInjectionSchema>;
export type KnowledgeMemoryRule = z.infer<typeof knowledgeMemoryRuleSchema>;
export type KnowledgeMemoryCategory = z.infer<typeof knowledgeMemoryCategorySchema>;
export type StudentCuratedExample = z.infer<typeof studentCuratedExampleSchema>;
export type StudentContrastiveExample = z.infer<typeof studentContrastiveExampleSchema>;
export type KnowledgeLayer = z.infer<typeof knowledgeLayerSchema>;
export type KnowledgeMemory = z.infer<typeof knowledgeMemorySchema>;

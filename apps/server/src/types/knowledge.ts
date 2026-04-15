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
  researchUsageRate: boundedPctSchema,
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

export const studentCuratedExampleSchema = z.object({
  datasetVersion: z.literal("hydria-student-curated-v1"),
  roundId: z.string().uuid(),
  createdAt: z.string().datetime(),
  category: questionCategorySchema,
  prompt: z.string().min(1),
  targetAnswer: z.string().min(1),
  preferredWinner: z.enum(["A", "B", "tie"]),
  globalGain: z.number(),
  refinedAverageScore: boundedPctSchema,
  researchUsed: z.boolean(),
  coachingNotes: z.array(z.string().min(1).max(240)).min(1).max(12),
  winningPatterns: z.array(z.string().min(1).max(140)).max(6)
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

export type KnowledgePattern = z.infer<typeof knowledgePatternSchema>;
export type KnowledgeCategoryStrategy = z.infer<typeof knowledgeCategoryStrategySchema>;
export type KnowledgeCategoryInsight = z.infer<typeof knowledgeCategoryInsightSchema>;
export type StudentCuratedExample = z.infer<typeof studentCuratedExampleSchema>;
export type KnowledgeLayer = z.infer<typeof knowledgeLayerSchema>;

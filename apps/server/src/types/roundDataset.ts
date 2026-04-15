import { z } from "zod";
import {
  arenaMetricsSchema,
  arenaVerdictsSchema,
  executionTraceSchema,
  judgeOutputSchema,
  localStudentRoundOutputSchema,
  modelSelectionSchema,
  questionCategorySchema,
  researchToolLogSchema,
  redTeamOutputSchema,
  refineDecisionSchema,
  refineProfileSchema,
  refineRouterDecisionSchema,
  refinerOutputSchema,
  respondentOutputSchema,
  synthesizerOutputSchema
} from "./arena.js";

export const roundDatasetEntrySchema = z.object({
  datasetVersion: z.literal("hydria-round-v1"),
  roundId: z.string().uuid(),
  createdAt: z.string().datetime(),
  question: z.string().min(1),
  category: questionCategorySchema,
  models: modelSelectionSchema,
  router: refineRouterDecisionSchema,
  research: researchToolLogSchema,
  refineProfile: refineProfileSchema,
  traces: z.object({
    respondentA: executionTraceSchema,
    respondentB: executionTraceSchema,
    redTeam: executionTraceSchema,
    refineA: executionTraceSchema,
    refineB: executionTraceSchema,
    judge: executionTraceSchema,
    synthesizer: executionTraceSchema,
    localStudent: executionTraceSchema
  }),
  steps: z.object({
    initial: z.object({
      A: respondentOutputSchema,
      B: respondentOutputSchema
    }),
    redTeam: redTeamOutputSchema,
    refined: z.object({
      A: refinerOutputSchema,
      B: refinerOutputSchema
    }),
    judge: judgeOutputSchema,
    synthesizer: synthesizerOutputSchema,
    localStudent: localStudentRoundOutputSchema
  }),
  metrics: arenaMetricsSchema,
  verdicts: arenaVerdictsSchema,
  refineDecision: refineDecisionSchema,
  studentSignals: z.object({
    preferredWinner: z.enum(["A", "B", "tie"]),
    preferredAnswer: z.string().min(1),
    learningNotes: z.array(z.string()).max(12),
    roundUsefulForTraining: z.boolean()
  })
});

export type RoundDatasetEntry = z.infer<typeof roundDatasetEntrySchema>;

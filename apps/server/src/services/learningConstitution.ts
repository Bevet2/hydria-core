import { learningConstitutionSchema, type LearningConstitution } from "../types/learning.js";

export const HYDRIA_LEARNING_CONSTITUTION: LearningConstitution = learningConstitutionSchema.parse({
  version: "hydria-learning-constitution-v1",
  defaultScope: "local_first",
  learnableTargets: [
    "student_rule",
    "student_strategy",
    "tool_policy",
    "research_policy",
    "local_student_policy",
    "memory_rule"
  ],
  protectedBehaviors: [
    "Do not promote global behavior changes without replay or benchmark validation.",
    "Do not activate opaque or non-traceable rules.",
    "Do not generalize a category-local signal into a global rule by default.",
    "Do not keep policies active when they create sustained regressions or excessive cost."
  ],
  promotionCriteria: {
    minObservations: 3,
    minConfidence: 0.7,
    minStability: 0.55,
    requireValidationForGlobalPromotion: true,
    allowedValidationModes: ["temporal_replay"]
  },
  demotionCriteria: {
    maxNoReliableSourceRate: 45,
    minAverageJudgeDelta: 0.5,
    maxNoOpRate: 45,
    regressionTriggerDelta: 3
  },
  lifecycle: {
    rawToAnalyzed: "Promote only after repeated observations have been condensed into an interpretable hotspot or policy hypothesis.",
    analyzedToActive: "Activate only when the signal is local, validated, and measurably better than the current baseline.",
    activeToRisky: "Move to risky/watchlist as soon as regressions, cost spikes, or reliability drops exceed guardrails.",
    riskyToArchived: "Archive or disable when the policy keeps underperforming or is superseded by a more stable alternative."
  },
  guardrails: [
    "Prefer local scope before global scope.",
    "Keep every active policy reversible and explicitly justified.",
    "Separate raw memory from active memory.",
    "Validation must be observable, replayable, and measurable.",
    "If the gain is unclear, keep the policy in validating or guarded state."
  ]
});

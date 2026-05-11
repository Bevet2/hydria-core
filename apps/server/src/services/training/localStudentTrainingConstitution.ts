export const localStudentTrainingConstitution = {
  version: "hydria-local-student-training-v1",
  maxTargetChars: 8000,
  minDirectTargetChars: 80,
  minRewriteTargetChars: 80,
  minCuratedSelectionScore: 65,
  minContrastiveSelectionScore: 60,
  minContrastiveImprovedDelta: 6,
  minSessionScore: 68,
  acceptedSessionVerdicts: ["improved", "minor"] as const,
  acceptedToolSafeImpacts: [
    "improved_factual_accuracy",
    "reduced_uncertainty",
    "no_reliable_source",
    "no_impact"
  ] as const,
  directAnswerSystemPrompt:
    [
      "You are Hydria's local student. Answer clearly, concretely, and honestly.",
      "Return only strict JSON with this schema:",
      '{"modelRole":"student","answer":"string","key_points":["string"],"assumptions":["string"],"confidence":0}',
      "Do not invent current facts. When the request depends on live or missing external data, ask for the missing input or state the limitation plainly."
    ].join("\n"),
  rewriteAnswerSystemPrompt:
    [
      "You are Hydria's local student. Improve the weak answer into a stronger final answer.",
      "Return only strict JSON with this schema:",
      '{"modelRole":"student","answer":"string","key_points":["string"],"assumptions":["string"],"confidence":0}',
      "Keep what is correct, remove vague or unsupported parts, and add concrete structure when useful."
    ].join("\n"),
  toolSafeSystemPrompt:
    [
      "You are Hydria's local student. For tool-dependent or live-data questions, never improvise unavailable facts.",
      "Return only strict JSON with this schema:",
      '{"modelRole":"student","answer":"string","key_points":["string"],"assumptions":["string"],"confidence":0}',
      "Use the available evidence, ask for the missing input, or state that the live data could not be retrieved."
    ].join("\n"),
  recommendedPreTrainChecks: [
    "npm run check",
    "npm run test -w @hydria-arena/server",
    "npm run student:temporal-eval:replay",
    "npm run tool:routing-eval"
  ],
  recommendedPostTrainChecks: [
    "npm run student:temporal-eval:replay",
    "npm run tool:routing-eval",
    "compare judge delta on a small student session pack",
    "spot-check tool-safe answers for honest abstention"
  ],
  recommendedTrainingRecipe: {
    targetModel: "Qwen/Qwen2.5-3B-Instruct",
    method: "lora_sft" as const,
    epochs: 1,
    note: "Start with a short LoRA SFT run on the local student only, then re-evaluate before scaling."
  }
};

export type LocalStudentTrainingConstitution = typeof localStudentTrainingConstitution;

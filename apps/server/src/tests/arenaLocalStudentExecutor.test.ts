import test from "node:test";
import assert from "node:assert/strict";
import { ArenaLocalStudentExecutor } from "../services/arena/arenaLocalStudentExecutor.js";
import type { LocalStudentOutput } from "../types/localModel.js";
import { env } from "../utils/env.js";

test("arena local student executor marks degraded local parsing as fallback_success", async () => {
  const previousObserverEnabled = env.LOCAL_MODEL_OBSERVER_ENABLED;
  env.LOCAL_MODEL_OBSERVER_ENABLED = true;

  const output: LocalStudentOutput = {
    modelRole: "local_student",
    student_answer: "Prefer phased rollout with rollback checkpoints.",
    student_summary: "The round favors incremental delivery with rollback safety.",
    learning_notes: ["Keep rollback checkpoints."]
  };

  const executor = new ArenaLocalStudentExecutor(
    {} as never,
    {
      observeRoundDetailed: async () => ({
        output,
        durationMs: 42,
        raw: "malformed response repaired locally",
        parseMode: "fallback" as const,
        degraded: true,
        validationIssues: ["Unexpected token T in JSON at position 0"]
      })
    } as never
  );

  try {
    const result = await executor.runLocalStudentObservation({
      roundId: "test-round",
      question: "Design a migration plan.",
      respondentA: {
        modelRole: "respondent",
        answer: "Start with clear boundaries.",
        key_points: ["Clear boundaries."],
        assumptions: [],
        confidence: 70
      },
      respondentB: {
        modelRole: "respondent",
        answer: "Migrate incrementally.",
        key_points: ["Incremental migration."],
        assumptions: [],
        confidence: 72
      },
      redTeam: {
        modelRole: "redteam",
        attacks_on_a: [],
        attacks_on_b: [],
        shared_risks: [],
        failure_scenarios: [],
        hidden_assumptions: [],
        potentially_false_claims: [],
        factual_risk_level: 20,
        reasoning_risk_level: 20,
        winner_so_far: "tie"
      },
      refineA: {
        modelRole: "refiner",
        improved_answer: "Start with clear boundaries and rollback points.",
        fixes_applied: [],
        remaining_uncertainties: [],
        confidence: 7,
        routerSkipped: false
      },
      refineB: {
        modelRole: "refiner",
        improved_answer: "Migrate incrementally with checkpoints.",
        fixes_applied: [],
        remaining_uncertainties: [],
        confidence: 7,
        routerSkipped: false
      },
      judge: {
        modelRole: "judge",
        initial_scores: {
          A: { clarity: 80, relevance: 80, robustness: 80, hallucination_risk: 20, overall: 80 },
          B: { clarity: 80, relevance: 80, robustness: 80, hallucination_risk: 20, overall: 80 }
        },
        scores: {
          A: { clarity: 82, relevance: 82, robustness: 82, hallucination_risk: 18, overall: 82 },
          B: { clarity: 81, relevance: 81, robustness: 81, hallucination_risk: 19, overall: 81 }
        },
        winner: "A",
        reasoning: "A is slightly stronger."
      },
      synthesizer: {
        modelRole: "synthesizer",
        final_answer: "Use phased rollout with rollback checkpoints.",
        why_this_answer: "It is safer and clearer.",
        based_on_winner: "A",
        improvements_added: ["Added rollback checkpoints."]
      },
      fallbackModels: []
    });

    assert.equal(result.trace.finalProvider, "ollama");
    assert.equal(result.trace.usedFallback, true);
    assert.equal(result.trace.outcome, "fallback_success");
    assert.ok(result.trace.note.includes("degraded output"));
    assert.equal(result.trace.validationFailures, 1);
  } finally {
    env.LOCAL_MODEL_OBSERVER_ENABLED = previousObserverEnabled;
  }
});

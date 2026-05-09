import test from "node:test";
import assert from "node:assert/strict";
import { ArenaRespondentExecutor } from "../services/arena/arenaRespondentExecutor.js";

test("arena respondent executor salvages one-sided structured-output failures with static fallback", async () => {
  const validResponse = JSON.stringify({
    modelRole: "respondent",
    answer:
      "Use a phased rollout with explicit rollback checkpoints, shadow traffic, and interface freeze points so each extraction step stays reversible.",
    key_points: [
      "Phase the rollout behind stable interfaces.",
      "Keep rollback checkpoints at every extraction step.",
      "Validate each cut with shadow traffic and explicit exit criteria."
    ],
    assumptions: ["Migration can be staged without a hard organizational freeze."],
    confidence: 82
  });

  const executor = new ArenaRespondentExecutor({
    async complete(args: { model: string }) {
      return {
        content:
          args.model === "model-a"
            ? validResponse
            : "Use a modular extraction plan with rollback checkpoints, but this draft is not valid JSON.",
        latencyMs: 12
      };
    }
  } as never);

  const result = await executor.runRespondents({
    question: "Design a pragmatic migration plan from a monolith to modular services.",
    models: {
      respondentA: "model-a",
      respondentB: "model-b",
      redTeam: "red",
      judge: "judge",
      synthesizer: "synth"
    },
    category: "architecture_design"
  });

  assert.equal(result.respondentAResult.trace.outcome, "success");
  assert.equal(result.respondentBResult.trace.outcome, "static_fallback");
  assert.match(result.respondentBResult.trace.note, /Failure class=structured_output/i);
  assert.equal(
    result.respondentBResult.parsed.answer.includes("rollback checkpoints"),
    true
  );
  assert.equal(result.respondentBResult.parsed.confidence <= 34, true);
});

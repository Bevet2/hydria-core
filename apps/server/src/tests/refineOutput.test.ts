import test from "node:test";
import assert from "node:assert/strict";
import { parseRefinerOutput } from "../utils/refineOutput.js";

test("refiner parser accepts detailed operational checklists", () => {
  const sections = Array.from({ length: 12 }, (_, index) =>
    [
      `${index + 1}. Step ${index + 1}`,
      "Define the owner, precondition, validation gate, rollback trigger, data reconciliation check, affected jobs, queue behavior, and post-rollback verification before widening traffic."
    ].join("\n")
  );
  const improvedAnswer = [
    "Rollback-safe migration checklist for splitting a monolith into services:",
    ...sections,
    "Finish by verifying the rollback path in a controlled test before removing the monolith fallback."
  ].join("\n\n");

  assert.ok(improvedAnswer.length > 2200);
  assert.ok(improvedAnswer.length < 3200);

  const parsed = parseRefinerOutput({
    raw: JSON.stringify({
      modelRole: "refiner",
      improved_answer: improvedAnswer,
      fixes_applied: [
        "Expanded the summary into an operational checklist.",
        "Added rollback gates and validation checks."
      ],
      remaining_uncertainties: ["Exact thresholds depend on the production system."],
      confidence: 8
    }),
    label: "Teacher",
    category: "operational_writing"
  });

  assert.equal(parsed.modelRole, "refiner");
  assert.match(parsed.improved_answer, /rollback path/i);
});

test("product strategy refiner accepts concrete wedge language as an objective", () => {
  const originalResponse = {
    modelRole: "respondent" as const,
    answer:
      "Choose a use case for the customer success assistant, build a pilot, and track adoption before expanding.",
    key_points: ["Choose a use case", "Build a pilot"],
    assumptions: [],
    confidence: 65
  };

  const parsed = parseRefinerOutput({
    raw: JSON.stringify({
      modelRole: "refiner",
      improved_answer:
        "Launch the assistant around one narrow wedge: helping Customer Success Managers prepare renewal-risk summaries and next-best actions. Phase 1: connect CRM, support tickets, and success notes for internal account briefs only. Phase 2: pilot with one representative CS segment and measure time saved per CSM, weekly active usage, recommendation acceptance, and fewer renewal-risk surprises. Phase 3: expand only if source-grounded outputs are trusted and adopted without heavy manual cleanup. Defer broad automation and customer-facing advice until the core workflow works. Major risks are poor CRM hygiene, access-control gaps, hallucinated recommendations, and low trust from noisy data.",
      fixes_applied: [
        "Chose one concrete wedge instead of listing generic CS use cases.",
        "Added phased sequencing and explicit deferrals.",
        "Added pilot metrics and a rollout gate.",
        "Named key data and trust risks."
      ],
      remaining_uncertainties: [
        "Exact thresholds should be set from pilot baselines.",
        "The best wedge may differ by CS segment."
      ],
      confidence: 9
    }),
    label: "Teacher",
    category: "product_strategy",
    originalResponse
  });

  assert.match(parsed.improved_answer, /one narrow wedge/i);
  assert.equal(parsed.confidence, 9);
});

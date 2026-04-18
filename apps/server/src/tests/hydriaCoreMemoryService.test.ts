import test from "node:test";
import assert from "node:assert/strict";
import { HydriaCoreMemoryService } from "../services/core/hydriaCoreMemoryService.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";
import type { ResearchToolLog } from "../types/arena.js";

function buildResearchLog(overrides: Partial<ResearchToolLog> = {}): ResearchToolLog {
  return {
    considered: true,
    used: true,
    route: "used",
    decision: {
      shouldUse: true,
      mode: "targeted_verify",
      expectedValue: "high",
      expectedCostMs: 500,
      triggerSignals: ["temporal"],
      targetClaims: ["current leadership"],
      reasoning: "Temporal claim needs verification."
    },
    queryPlan: {
      intent: "current_status",
      queries: ["openai current ceo official"],
      selectedQuery: "openai current ceo official",
      requiredTerms: ["OpenAI"],
      preferredDomains: ["openai.com"],
      factFocusTerms: ["CEO"],
      entityTerms: ["OpenAI"],
      temporalProfile: {
        ...buildDefaultTemporalProfile(),
        isTemporal: true,
        focus: "current",
        queryType: "current_status"
      }
    },
    query: "openai current ceo official",
    reasons: [],
    summary: ["Leadership page confirms the current chief executive."],
    sources: [],
    verification: {
      sourceCount: 1,
      extractedSourceCount: 1,
      corroboratedSignals: ["leadership"],
      freshnessSatisfied: true,
      freshnessWindow: "current",
      mostRecentSourceDate: "2026-04-18",
      oldestAcceptedSourceDate: "2026-04-18",
      staleSourcesRejectedCount: 0
    },
    truth: {
      verified_facts: ["Leadership page supports the current CEO claim."],
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: 0.9,
      no_reliable_source: false
    },
    appliedTo: {
      A: true,
      B: false
    },
    impact: {
      refineChangedBecauseOfTool: true,
      addedFactsCount: 1,
      correctedClaimsCount: 0,
      sourceBackedClaimsCount: 1,
      costSharePct: 40,
      netImpact: "positive"
    },
    impactNotes: [],
    durationMs: 90,
    ...overrides
  };
}

test("hydria core memory service builds a student snapshot with temporal retrieval metadata", () => {
  const service = new HydriaCoreMemoryService();
  const snapshot = service.buildStudentSnapshot({
    question: "Who is the current CEO of OpenAI?",
    category: "mixed_reasoning",
    knowledge: {
      strategyNote: "Verify current-state claims before answering.",
      routingRecommendation: "prefer_verify",
      toolRecommendation: "use_truth_engine",
      memorySummary: "Use factual verification for current leadership questions.",
      coachingHints: ["State the answer with the verification source."],
      memoryRules: [
        {
          domain: "factual",
          lesson: "Check leadership pages for current executives.",
          recommendedStrategy: "factual_verify_first"
        }
      ],
      studentMemorySummary: "Student memory emphasizes verification-first behavior.",
      studentMemoryRules: [
        {
          ruleId: "rule-current-status",
          failureType: "stale_fact",
          rule: "Verify current-status claims with a current official source.",
          activationConfidence: 0.9,
          evidenceCount: 3,
          conditions: ["current_status"],
          metrics: {
            judgeOverallDelta: 0,
            gainGlobal: 0,
            lengthDeltaWords: 0,
            keyPointsDelta: 0,
            assumptionsDelta: 0,
            structureDelta: 0,
            success: true
          }
        }
      ],
      winningPatterns: ["Name the source and the date context."],
      bestRoundReferences: [
        {
          roundId: "33333333-3333-4333-8333-333333333333",
          note: "Leadership page answer stayed stable under critique."
        }
      ]
    } as never,
    strategy: {
      strategyId: "factual_verify_first"
    } as never,
    research: buildResearchLog(),
    extraEpisodicItems: ["Avoid answering from stale internal memory."]
  });

  assert.equal(snapshot.category, "mixed_reasoning");
  assert.equal(snapshot.retrieval.strategyId, "factual_verify_first");
  assert.equal(snapshot.retrieval.researchIntent, "current_status");
  assert.equal(snapshot.retrieval.temporalQueryType, "current_status");
  assert.ok(snapshot.core.length >= 3);
  assert.ok(snapshot.semantic.length >= 1);
  assert.ok(snapshot.episodic.some((item) => /avoid answering from stale internal memory/i.test(item.content)));
});

test("hydria core memory service builds an arena snapshot without knowledge injection", () => {
  const service = new HydriaCoreMemoryService();
  const snapshot = service.buildArenaSnapshot({
    question: "Design a migration plan.",
    category: "architecture_design",
    knowledge: null,
    orchestration: {
      focus: "tradeoffs",
      refinePolicy: "dual",
      researchPolicy: "targeted",
      targetOutcomes: ["Pragmatic rollout", "Rollback safety"],
      prioritySignals: ["risk", "sequencing"],
      reasoning: ["The question needs tradeoff-aware orchestration."]
    } as never,
    router: {
      globalStrategy: "dual_refine",
      reasoning: ["Refine both sides because both have useful partial strengths."],
      estimatedValue: {
        A: 0.7,
        B: 0.6
      }
    } as never,
    research: buildResearchLog({
      queryPlan: {
        ...buildResearchLog().queryPlan,
        intent: "constraint_check",
        temporalProfile: buildDefaultTemporalProfile()
      },
      decision: {
        ...buildResearchLog().decision,
        shouldUse: false,
        mode: "off"
      },
      route: "not_needed",
      used: false
    }),
    redTeam: {
      shared_risks: ["Rollback plan is underspecified."],
      failure_scenarios: ["Migration pauses halfway through cutover."],
      hidden_assumptions: ["Assumes stable schema."],
      winner_so_far: "A"
    } as never,
    judge: {
      winner: "A",
      reasoning: "A handled sequencing and rollback better."
    } as never,
    synthesizer: {
      why_this_answer: "It combined sequencing, rollback, and checkpoint discipline.",
      improvements_added: ["Added rollback checkpoints."],
      based_on_winner: "A"
    } as never,
    localStudent: {
      student_summary: "Prefer phased rollout with rollback safety.",
      learning_notes: ["Carry rollback checkpoints into future migration answers."]
    } as never,
    extraEpisodicItems: ["Prefer phased rollout checkpoints."]
  });

  assert.equal(snapshot.category, "architecture_design");
  assert.equal(snapshot.retrieval.strategyId, "arena:dual_refine");
  assert.equal(snapshot.retrieval.researchIntent, null);
  assert.ok(snapshot.core.some((item) => /arena round outcome/i.test(item.title)));
  assert.ok(snapshot.core.some((item) => /local learning summary/i.test(item.title)));
  assert.ok(snapshot.core.some((item) => /arena orchestration/i.test(item.title)));
  assert.ok(snapshot.semantic.some((item) => /rollback checkpoints/i.test(item.content)));
  assert.ok(snapshot.episodic.some((item) => /phased rollout checkpoints/i.test(item.content)));
  assert.ok(snapshot.summary.includes("winner A"));
  assert.ok(snapshot.summary.includes("dual_refine"));
});

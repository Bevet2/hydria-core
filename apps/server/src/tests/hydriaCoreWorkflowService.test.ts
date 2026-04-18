import test from "node:test";
import assert from "node:assert/strict";
import { HydriaCoreWorkflowService } from "../services/core/hydriaCoreWorkflowService.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";
import type { ExecutionTrace, ResearchToolLog } from "../types/arena.js";

function buildResearchLog(overrides: Partial<ResearchToolLog> = {}): ResearchToolLog {
  return {
    considered: true,
    used: true,
    route: "used",
    decision: {
      shouldUse: true,
      mode: "targeted_verify",
      expectedValue: "high",
      expectedCostMs: 700,
      triggerSignals: ["temporal"],
      targetClaims: ["current leadership"],
      reasoning: "Current-state claim needs live grounding."
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
    summary: ["OpenAI leadership page confirms the current chief executive."],
    sources: [{ title: "Leadership", url: "https://openai.com/leadership" } as never],
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
      costSharePct: 35,
      netImpact: "positive"
    },
    impactNotes: [],
    durationMs: 120,
    ...overrides
  };
}

function buildTrace(note: string): ExecutionTrace {
  return {
    requestedProvider: "ollama",
    requestedModel: "qwen2.5:7b",
    attempts: [],
    finalProvider: "ollama",
    finalModel: "qwen2.5:7b",
    usedRetry: false,
    usedFallback: false,
    validationFailures: 0,
    outcome: "success",
    note
  };
}

test("hydria core workflow service builds a student preview workflow with research messages", () => {
  const service = new HydriaCoreWorkflowService();
  const run = service.buildStudentPreviewRun({
    previewId: "11111111-1111-4111-8111-111111111111",
    question: "Who is the current CEO of OpenAI?",
    category: "mixed_reasoning",
    startedAt: "2026-04-18T10:00:00.000Z",
    durationMs: 800,
    knowledge: null,
    strategy: {
      strategyId: "factual_verify_first",
      impactReason: "Temporal queries should verify first."
    } as never,
    research: buildResearchLog(),
    rawDraft: {
      answer: "Raw answer"
    } as never,
    previewDraft: {
      answer: "Grounded answer"
    } as never,
    toolApplied: true,
    trace: buildTrace("Preview draft trace")
  });

  assert.equal(run.scope, "student_preview");
  assert.equal(run.status, "completed");
  assert.equal(run.degradationReasons.length, 0);
  assert.equal(run.tasks.length, 4);
  assert.ok(run.messages.some((message) => message.role === "research_planner"));
  assert.ok(run.handoffs.some((handoff) => handoff.to === "research_planner"));
});

test("hydria core workflow service builds an arena round workflow with synthesis and persistence", () => {
  const service = new HydriaCoreWorkflowService();
  const run = service.buildArenaRoundRun({
    roundId: "22222222-2222-4222-8222-222222222222",
    question: "Design a pragmatic migration plan.",
    category: "architecture_design",
    createdAt: "2026-04-18T10:05:00.000Z",
    durationMs: 1800,
    models: {
      respondentA: "qwen/qwen3.6-plus",
      respondentB: "anthropic/claude-sonnet-4.6",
      redTeam: "openai/gpt-5.4-mini",
      judge: "openai/gpt-5.4-mini",
      synthesizer: "qwen/qwen3.6-plus"
    },
    knowledge: null,
    orchestration: {
      focus: "tradeoffs",
      refinePolicy: "dual",
      researchPolicy: "targeted"
    } as never,
    router: {
      globalStrategy: "dual_refine",
      shouldRefineA: true,
      shouldRefineB: true
    } as never,
    research: buildResearchLog({
      queryPlan: {
        ...buildResearchLog().queryPlan,
        intent: "constraint_check"
      }
    }),
    respondentA: { answer: "Answer A" } as never,
    respondentB: { answer: "Answer B" } as never,
    respondentATrace: buildTrace("Respondent A trace"),
    respondentBTrace: buildTrace("Respondent B trace"),
    redTeam: {
      attacks_on_a: ["Weak rollback plan."],
      attacks_on_b: ["Migration order unclear."],
      shared_risks: ["Data consistency risk."],
      hidden_assumptions: ["Assumes stable schema."],
      potentially_false_claims: ["Claims zero downtime without proof."],
      winner_so_far: "A",
      factual_risk_level: 70,
      reasoning_risk_level: 55
    } as never,
    redTeamTrace: buildTrace("Red team trace"),
    refineA: {
      improved_answer: "Improved A",
      fixes_applied: ["Added rollback sequence."]
    } as never,
    refineATrace: buildTrace("Refine A trace"),
    refineB: {
      improved_answer: "Improved B",
      fixes_applied: ["Clarified migration phases."]
    } as never,
    refineBTrace: buildTrace("Refine B trace"),
    judge: {
      initial_scores: {
        A: { overall: 70 },
        B: { overall: 68 }
      },
      scores: {
        A: { overall: 82 },
        B: { overall: 76 }
      },
      winner: "A",
      reasoning: "A is more pragmatic."
    } as never,
    judgeTrace: buildTrace("Judge trace"),
    synthesizer: {
      final_answer: "Synthesized final answer",
      why_this_answer: "It keeps the pragmatic sequencing while preserving rollback safety.",
      improvements_added: ["Combined sequencing with rollback plan."],
      based_on_winner: "A"
    } as never,
    synthesizerTrace: buildTrace("Synthesizer trace"),
    localStudent: {
      student_answer: "Prefer phased migration with rollback checkpoints.",
      student_summary: "The round favored a pragmatic migration path with safety rails.",
      learning_notes: ["Prefer phased cutovers with explicit rollback points."]
    } as never,
    localStudentTrace: buildTrace("Local student trace")
  });

  assert.equal(run.scope, "arena_round");
  assert.equal(run.status, "completed");
  assert.equal(run.degradationReasons.length, 0);
  assert.ok(run.messages.some((message) => message.role === "research_retriever"));
  assert.ok(run.messages.some((message) => message.role === "local_student" && message.kind === "answer"));
  assert.ok(run.messages.some((message) => message.role === "synthesizer"));
  assert.ok(run.tasks.some((task) => task.kind === "synthesize_answer"));
  assert.ok(run.tasks.some((task) => task.kind === "refine_answer" && task.notes.some((note) => /A:/.test(note))));
  assert.ok(run.handoffs.some((handoff) => handoff.to === "research_retriever"));
  assert.ok(run.handoffs.some((handoff) => handoff.to === "history_store"));
});

test("hydria core workflow service marks arena rounds partial only when a critical role falls back or research fails", () => {
  const service = new HydriaCoreWorkflowService();
  const run = service.buildArenaRoundRun({
    roundId: "33333333-3333-4333-8333-333333333333",
    question: "Design a migration plan with rollback safety.",
    category: "architecture_design",
    createdAt: "2026-04-18T10:06:00.000Z",
    durationMs: 2000,
    models: {
      respondentA: "qwen/qwen3.6-plus",
      respondentB: "anthropic/claude-sonnet-4.6",
      redTeam: "openai/gpt-5.4-mini",
      judge: "openai/gpt-5.4-mini",
      synthesizer: "qwen/qwen3.6-plus"
    },
    knowledge: null,
    orchestration: {
      focus: "tradeoffs",
      refinePolicy: "dual",
      researchPolicy: "targeted",
      reasoning: ["The round should compare two rollout plans."]
    } as never,
    router: {
      globalStrategy: "dual_refine",
      shouldRefineA: true,
      shouldRefineB: true,
      estimatedValue: {
        A: "high",
        B: "medium"
      },
      reasoning: ["Both sides still have improvement headroom."]
    } as never,
    research: buildResearchLog({
      route: "failed"
    }),
    respondentA: { answer: "Answer A" } as never,
    respondentB: { answer: "Answer B" } as never,
    respondentATrace: buildTrace("Respondent A trace"),
    respondentBTrace: buildTrace("Respondent B trace"),
    redTeam: {
      attacks_on_a: ["Rollback too vague."],
      attacks_on_b: ["Sequence is unsafe."],
      shared_risks: ["Data consistency risk."],
      hidden_assumptions: ["Assumes traffic can pause."],
      potentially_false_claims: [],
      winner_so_far: "tie",
      factual_risk_level: 40,
      reasoning_risk_level: 65
    } as never,
    redTeamTrace: buildTrace("Red team trace"),
    refineA: {
      improved_answer: "Improved A",
      fixes_applied: ["Added rollback gates."]
    } as never,
    refineATrace: {
      ...buildTrace("Refine A fallback trace"),
      outcome: "fallback_success"
    },
    refineB: {
      improved_answer: "Improved B",
      fixes_applied: ["Clarified sequencing."]
    } as never,
    refineBTrace: buildTrace("Refine B trace"),
    judge: {
      initial_scores: {
        A: { overall: 70 },
        B: { overall: 68 }
      },
      scores: {
        A: { overall: 79 },
        B: { overall: 75 }
      },
      winner: "A",
      reasoning: "A is still more pragmatic."
    } as never,
    judgeTrace: buildTrace("Judge trace"),
    synthesizer: {
      final_answer: "Synthesized final answer",
      why_this_answer: "It preserved the safer rollback path.",
      improvements_added: ["Rollback gates."],
      based_on_winner: "A"
    } as never,
    synthesizerTrace: buildTrace("Synthesizer trace"),
    localStudent: {
      student_answer: "Prefer explicit rollback gates.",
      student_summary: "The round kept the safer path despite degraded refinement.",
      learning_notes: ["Keep rollback gates explicit."]
    } as never,
    localStudentTrace: buildTrace("Local student trace")
  });

  assert.equal(run.status, "partial");
  assert.ok(run.degradationReasons.some((reason) => reason.code === "research_failed"));
  assert.ok(
    run.degradationReasons.some(
      (reason) => reason.code === "critical_role_fallback" && reason.role === "teacher"
    )
  );
});

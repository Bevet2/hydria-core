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
      hidden_assumptions: ["Assumes stable schema."]
    } as never,
    refineA: {
      improved_answer: "Improved A",
      fixes_applied: ["Added rollback sequence."]
    } as never,
    refineB: {
      improved_answer: "Improved B",
      fixes_applied: ["Clarified migration phases."]
    } as never,
    judge: {
      winner: "A",
      reasoning: "A is more pragmatic."
    } as never,
    synthesizer: {
      final_answer: "Synthesized final answer",
      improvements_added: ["Combined sequencing with rollback plan."],
      based_on_winner: "A"
    } as never,
    localStudent: {
      learning_notes: ["Prefer phased cutovers with explicit rollback points."]
    } as never,
    localStudentTrace: buildTrace("Local student trace")
  });

  assert.equal(run.scope, "arena_round");
  assert.equal(run.status, "completed");
  assert.ok(run.messages.some((message) => message.role === "synthesizer"));
  assert.ok(run.tasks.some((task) => task.kind === "synthesize_answer"));
  assert.ok(run.handoffs.some((handoff) => handoff.to === "history_store"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { StudentPreparationService } from "../services/student/studentPreparationService.js";
import type { ExecutionTrace, ResearchToolLog, RedTeamOutput } from "../types/arena.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import { defaultAgentRoutingDecision } from "../types/agents.js";
import { defaultSkillRoutingDecision } from "../types/skills.js";
import type { StudentAnswer, StudentResponseStrategy } from "../types/student.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";

function buildAnswer(answer: string): StudentAnswer {
  return {
    modelRole: "student",
    answer,
    key_points: ["One key point"],
    assumptions: [],
    confidence: 70
  };
}

function buildStrategy(): StudentResponseStrategy {
  return {
    strategyId: "factual_verify_first",
    context: {
      questionType: "factual",
      promptLength: "short",
      promptWordCount: 6,
      signals: ["claims"]
    },
    impactStatus: "active",
    activationMode: "contextual",
    impactConfidence: 0.8,
    impactReason: "test",
    targetLengthWords: {
      min: 45,
      max: 95
    },
    directives: ["Use evidence first."],
    avoidances: ["Do not speculate."],
    influencedBy: {
      signals: ["claims"],
      studentRuleIds: [],
      memoryDomains: [],
      winningPatterns: []
    },
    reasoning: ["Test strategy", "Keep factual grounding explicit."]
  };
}

function buildResearchLog(overrides: Partial<ResearchToolLog> = {}): ResearchToolLog {
  return {
    considered: true,
    used: false,
    route: "not_needed",
    toolRouting: defaultToolRoutingDecision,
    skillRouting: defaultSkillRoutingDecision,
    skillUsed: false,
    skillConfidence: null,
    skillOutcome: "not_found",
    agentRouting: defaultAgentRoutingDecision,
    agentOutcome: "not_found",
    fallbackUsed: false,
    agentRecommendation: null,
    toolGapDetected: false,
    toolCandidateCreated: false,
    toolCandidateId: null,
    missingCapabilityReason: null,
    decision: {
      shouldUse: false,
      mode: "off",
      expectedValue: "low",
      expectedCostMs: 0,
      triggerSignals: [],
      targetClaims: [],
      reasoning: "No research needed."
    },
    queryPlan: {
      intent: "fact_check",
      queries: [],
      selectedQuery: null,
      requiredTerms: [],
      preferredDomains: [],
      factFocusTerms: [],
      entityTerms: [],
      temporalProfile: buildDefaultTemporalProfile()
    },
    query: null,
    reasons: [],
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: [],
      freshnessSatisfied: true,
      freshnessWindow: "none",
      mostRecentSourceDate: null,
      oldestAcceptedSourceDate: null,
      staleSourcesRejectedCount: 0
    },
    truth: {
      verified_facts: [],
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: 0,
      no_reliable_source: false
    },
    appliedTo: {
      A: false,
      B: false
    },
    impact: {
      refineChangedBecauseOfTool: false,
      addedFactsCount: 0,
      correctedClaimsCount: 0,
      sourceBackedClaimsCount: 0,
      costSharePct: 0,
      netImpact: "unknown"
    },
    impactNotes: [],
    durationMs: 0,
    ...overrides
  };
}

function buildRedTeam(): RedTeamOutput {
  return {
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
  };
}

test("student preparation reuses existing orchestration and research without recomputing", async () => {
  let redTeamCalls = 0;
  let planCalls = 0;
  let researchCalls = 0;
  let localCalls = 0;

  const service = new StudentPreparationService(
    {
      async answerQuestionDetailed() {
        localCalls += 1;
        throw new Error("should not run");
      }
    },
    {
      async planRound() {
        planCalls += 1;
        throw new Error("should not run");
      }
    },
    {
      async maybeCollect() {
        researchCalls += 1;
        throw new Error("should not run");
      }
    },
    {
      async buildForCategory() {
        throw new Error("should not run");
      }
    },
    {
      async select() {
        throw new Error("should not run");
      }
    },
    {
      async runStudentRedTeam() {
        redTeamCalls += 1;
        throw new Error("should not run");
      }
    }
  );

  const draft = buildAnswer("Existing preview answer");
  const trace: ExecutionTrace = {
    requestedProvider: "ollama",
    requestedModel: "qwen2.5:7b",
    attempts: [],
    finalProvider: "ollama",
    finalModel: "qwen2.5:7b",
    usedRetry: false,
    usedFallback: false,
    validationFailures: 0,
    skillRouting: defaultSkillRoutingDecision,
    skillUsed: false,
    skillConfidence: null,
    skillOutcome: "not_found",
    agentRouting: defaultAgentRoutingDecision,
    agentOutcome: "not_found",
    fallbackUsed: false,
    outcome: "success",
    note: "Existing preview"
  };
  const orchestration = { stage: "existing" } as never;
  const research = buildResearchLog();

  const result = await service.ensureAnalysisPreparation({
    question: "Explain eventual consistency.",
    category: "technical_explanation",
    rawDraft: buildAnswer("Raw answer"),
    draft,
    trace,
    knowledge: null,
    strategy: buildStrategy(),
    orchestration,
    research,
    toolApplied: false
  });

  assert.equal(result.finalStudentAnswer.answer, draft.answer);
  assert.equal(result.finalStudentTrace.note, trace.note);
  assert.equal(result.orchestration, orchestration);
  assert.equal(result.research, research);
  assert.equal(result.toolApplied, false);
  assert.equal(result.finalStudentRespondent.answer, draft.answer);
  assert.equal(redTeamCalls, 0);
  assert.equal(planCalls, 0);
  assert.equal(researchCalls, 0);
  assert.equal(localCalls, 0);
});

test("student preparation grounds the preview when research should be applied", async () => {
  let localCalls = 0;

  const service = new StudentPreparationService(
    {
      async answerQuestionDetailed() {
        localCalls += 1;
        if (localCalls === 1) {
          return {
            output: buildAnswer("Raw answer"),
            durationMs: 1,
            raw: "{\"answer\":\"Raw answer\"}",
            usedRetry: false,
            parseMode: "strict",
            degraded: false,
            validationIssues: []
          };
        }

        return {
          output: buildAnswer("Grounded answer"),
          durationMs: 1,
          raw: "{\"answer\":\"Grounded answer\"}",
          usedRetry: false,
          parseMode: "strict",
          degraded: false,
          validationIssues: []
        };
      }
    },
    {
      async planRound() {
        return { stage: "planned" } as never;
      }
    },
    {
      async maybeCollect() {
        return buildResearchLog({
          decision: {
            shouldUse: true,
            mode: "targeted_verify",
            expectedValue: "high",
            expectedCostMs: 600,
            triggerSignals: ["temporal"],
            targetClaims: ["current leadership"],
            reasoning: "Current-state question requires live verification."
          },
          truth: {
            verified_facts: ["OpenAI current leadership sourced"],
            uncertain_claims: [],
            conflicting_info: [],
            confidence_score: 0.9,
            no_reliable_source: false
          }
        });
      }
    },
    {
      async buildForCategory() {
        return null;
      }
    },
    {
      async select() {
        return buildStrategy();
      }
    },
    {
      async runStudentRedTeam() {
        return {
          output: buildRedTeam(),
          trace: {} as never,
          durationMs: 1
        };
      }
    }
  );

  const result = await service.preparePreview("Who is the current CEO of OpenAI?");

  assert.equal(result.baselineDraft, null);
  assert.equal(result.rawDraft.answer, "Raw answer");
  assert.equal(result.previewDraft.answer, "Grounded answer");
  assert.equal(result.toolApplied, true);
  assert.match(result.previewTrace.note, /tool-guided factual grounding/i);
  assert.equal(localCalls, 2);
});

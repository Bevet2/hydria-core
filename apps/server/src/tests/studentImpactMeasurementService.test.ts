import test from "node:test";
import assert from "node:assert/strict";
import { StudentImpactMeasurementService } from "../services/student/studentImpactMeasurementService.js";
import type {
  ResearchToolLog,
  RespondentOutput
} from "../types/arena.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import { defaultAgentRoutingDecision } from "../types/agents.js";
import { defaultSkillRoutingDecision } from "../types/skills.js";
import type {
  StudentAnswer,
  StudentSession
} from "../types/student.js";
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

function toRespondentOutput(answer: StudentAnswer): RespondentOutput {
  return {
    modelRole: "respondent",
    answer: answer.answer,
    key_points: answer.key_points,
    assumptions: answer.assumptions,
    confidence: answer.confidence
  };
}

function buildResearchLog(overrides: Partial<ResearchToolLog> = {}): ResearchToolLog {
  return {
    considered: false,
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

function buildStrategy(): StudentSession["strategy"] {
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
    reasoning: ["Test strategy"]
  };
}

test("student impact measurement returns no comparison when the tool was not used", async () => {
  const service = new StudentImpactMeasurementService(
    { async answerQuestionDetailed() { throw new Error("should not run"); } },
    {
      async runStudentRedTeam() { throw new Error("should not run"); },
      async runStudentJudge() { throw new Error("should not run"); }
    },
    { async select() { throw new Error("should not run"); } },
    toRespondentOutput
  );

  const result = await service.measureToolImpact({
    question: "Explain eventual consistency.",
    category: "technical_explanation",
    baselineDraft: buildAnswer("Baseline"),
    baselineRespondent: toRespondentOutput(buildAnswer("Baseline")),
    finalDraft: buildAnswer("Final"),
    research: buildResearchLog()
  });

  assert.equal(result.toolUsed, false);
  assert.equal(result.compared, false);
  assert.equal(result.toolImpact, "no_impact");
});

test("student impact measurement compares a non-base strategy against the inferred baseline", async () => {
  const service = new StudentImpactMeasurementService(
    {
      async answerQuestionDetailed() {
        return {
          output: buildAnswer("Baseline answer"),
          durationMs: 1,
          raw: "{\"answer\":\"Baseline answer\"}",
          usedRetry: false,
          parseMode: "strict",
          degraded: false,
          validationIssues: []
        };
      }
    },
    {
      async runStudentRedTeam() {
        return {
          output: {
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
          trace: {} as never,
          durationMs: 1
        };
      },
      async runStudentJudge() {
        return {
          output: {
            modelRole: "student_judge",
            initial_score: {
              clarity: 60,
              relevance: 60,
              robustness: 60,
              hallucination_risk: 40,
              overall: 60
            },
            improved_score: {
              clarity: 72,
              relevance: 74,
              robustness: 70,
              hallucination_risk: 30,
              overall: 74
            },
            verdict: "improved",
            worthIt: "YES",
            reasoning: "Candidate strategy is stronger.",
            weak_points: [],
            strong_points: ["Better evidence use"]
          },
          trace: {} as never,
          durationMs: 1
        };
      }
    },
    {
      async select() {
        return {
          ...buildStrategy(),
          strategyId: "factual_short",
          activationMode: "fallback",
          impactStatus: "cautious",
          impactConfidence: 0.5
        };
      }
    },
    toRespondentOutput
  );

  const result = await service.measureStrategyImpact({
    question: "Who is the current CEO of OpenAI?",
    category: "mixed_reasoning",
    strategy: buildStrategy(),
    selectedDraft: buildAnswer("Selected answer with better evidence"),
    knowledge: null
  });

  assert.equal(result.compared, true);
  assert.equal(result.baselineAvailable, true);
  assert.equal(result.judge?.verdict, "improved");
  assert.equal(result.metrics.judgeOverallDelta, 14);
});

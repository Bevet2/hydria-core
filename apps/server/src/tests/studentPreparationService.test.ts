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

test("student preparation separates contextual answer prompt from routing and research question", async () => {
  const contextualQuestion =
    "Prior turns:\nUser: qui est louis 9\nAssistant: reponse precedente incorrecte\nCurrent user message:\ntu voulais dire saint louis";
  const routingQuestion = "qui est saint louis";
  const seen = {
    localQuestions: [] as string[],
    knowledgeQuestion: "",
    strategyQuestions: [] as string[],
    redTeamQuestion: "",
    researchQuestion: ""
  };

  const service = new StudentPreparationService(
    {
      async answerQuestionDetailed(args) {
        seen.localQuestions.push(args.question);
        return {
          output: buildAnswer("Contextual answer"),
          durationMs: 1,
          raw: "{\"answer\":\"Contextual answer\"}",
          usedRetry: false,
          parseMode: "strict",
          degraded: false,
          validationIssues: []
        };
      }
    },
    {
      async planRound() {
        return {
          focus: "factual_grounding",
          researchPolicy: "targeted",
          costPolicy: "balanced",
          researchBias: 0
        } as never;
      }
    },
    {
      async maybeCollect(args) {
        seen.researchQuestion = args.question;
        return buildResearchLog();
      }
    },
    {
      async buildForCategory(_category, args = {}) {
        seen.knowledgeQuestion = args.question ?? "";
        return null;
      }
    },
    {
      async select(args) {
        seen.strategyQuestions.push(args.question);
        return buildStrategy();
      }
    },
    {
      async runStudentRedTeam(question) {
        seen.redTeamQuestion = question;
        return {
          output: buildRedTeam(),
          trace: {} as never,
          durationMs: 1
        };
      }
    }
  );

  await service.preparePreview(contextualQuestion, {
    routingQuestion,
    researchQuestion: routingQuestion
  });

  assert.deepEqual(seen.localQuestions, [contextualQuestion]);
  assert.equal(seen.knowledgeQuestion, routingQuestion);
  assert.deepEqual(seen.strategyQuestions, [routingQuestion, routingQuestion]);
  assert.equal(seen.redTeamQuestion, routingQuestion);
  assert.equal(seen.researchQuestion, routingQuestion);
});

test("student preparation can skip knowledge and research for direct chat turns", async () => {
  let localCalls = 0;
  let knowledgeCalls = 0;
  let planCalls = 0;
  let researchCalls = 0;
  let redTeamCalls = 0;

  const service = new StudentPreparationService(
    {
      async answerQuestionDetailed() {
        localCalls += 1;
        return {
          output: buildAnswer("Tu t'appelles Marc."),
          durationMs: 1,
          raw: "{\"answer\":\"Tu t'appelles Marc.\"}",
          usedRetry: false,
          parseMode: "strict",
          degraded: false,
          validationIssues: []
        };
      }
    },
    {
      async planRound() {
        planCalls += 1;
        throw new Error("should not plan");
      }
    },
    {
      async maybeCollect() {
        researchCalls += 1;
        throw new Error("should not research");
      }
    },
    {
      async buildForCategory() {
        knowledgeCalls += 1;
        throw new Error("should not load knowledge");
      }
    },
    {
      async select() {
        return buildStrategy();
      }
    },
    {
      async runStudentRedTeam() {
        redTeamCalls += 1;
        throw new Error("should not red-team");
      }
    }
  );

  const result = await service.preparePreview("Comment je m'appelle ?", {
    routingQuestion: "Comment je m'appelle ?",
    researchQuestion: "Comment je m'appelle ?",
    knowledgeMode: "skip",
    researchMode: "skip"
  });

  assert.equal(result.knowledge, null);
  assert.equal(result.rawDraft.answer, "Tu t'appelles Marc.");
  assert.equal(result.previewDraft.answer, "Tu t'appelles Marc.");
  assert.equal(result.toolApplied, false);
  assert.equal(result.research.used, false);
  assert.equal(result.research.decision.mode, "off");
  assert.equal(result.orchestration.researchPolicy, "off");
  assert.equal(localCalls, 1);
  assert.equal(knowledgeCalls, 0);
  assert.equal(planCalls, 0);
  assert.equal(researchCalls, 0);
  assert.equal(redTeamCalls, 0);
});

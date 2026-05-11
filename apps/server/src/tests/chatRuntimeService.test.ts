import test from "node:test";
import assert from "node:assert/strict";
import { ChatRuntimeService } from "../services/chatRuntimeService.js";
import type { QuestionCategory, ResearchToolLog } from "../types/arena.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import { defaultAgentRoutingDecision } from "../types/agents.js";
import { defaultSkillRoutingDecision } from "../types/skills.js";
import type { StudentAnswer, StudentAnswerPreview } from "../types/student.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";

function buildAnswer(answer: string): StudentAnswer {
  return {
    modelRole: "student",
    answer,
    key_points: ["Reponse corrigee", "Contexte utilise"],
    assumptions: [],
    confidence: 82
  };
}

function buildResearchLog(): ResearchToolLog {
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
    durationMs: 0
  };
}

function buildPreview(args: {
  question: string;
  category: QuestionCategory;
  answer: string;
  usedRetry?: boolean;
}): StudentAnswerPreview {
  const draft = buildAnswer(args.answer);
  return {
    previewId: "00000000-0000-4000-8000-000000000000",
    question: args.question,
    category: args.category,
    knowledge: null,
    memory: {} as never,
    orchestration: {} as never,
    research: buildResearchLog(),
    strategy: {} as never,
    workflow: {} as never,
    student: {
      rawDraft: draft,
      draft,
      baselineDraft: null,
      toolApplied: false
    },
    trace: {
      student: {
        requestedProvider: "ollama",
        requestedModel: "test",
        attempts: [],
        finalProvider: "ollama",
        finalModel: "test",
        usedRetry: args.usedRetry ?? false,
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
        note: "test"
      }
    },
    durationMs: 1
  };
}

test("chat runtime keeps follow-up context but routes research through a standalone question", async () => {
  const calls: Array<{
    question: string;
    routingQuestion?: string;
    researchQuestion?: string;
    knowledgeMode?: string;
    researchMode?: string;
  }> = [];
  const service = new ChatRuntimeService({
    async answerOnly(question, options) {
      calls.push({
        question,
        routingQuestion: options?.routingQuestion,
        researchQuestion: options?.researchQuestion,
        knowledgeMode: options?.knowledgeMode,
        researchMode: options?.researchMode
      });
      return buildPreview({
        question,
        category: "other",
        answer:
          calls.length === 1
            ? "Louis IX est une figure historique, mais la reponse initiale reste incomplete."
            : "Tu as raison, il fallait comprendre Louis IX, aussi appele Saint Louis. C'est le roi de France capetien qui a regne de 1226 a 1270 et qui a ete canonise ensuite.",
        usedRetry: false
      });
    }
  });

  const first = await service.sendMessage({ message: "qui est louis 9" });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "tu ne connais pas louis 9 ou dit plutot saint louis"
  });

  assert.equal(calls[0]?.routingQuestion, "qui est louis 9");
  assert.equal(calls[0]?.knowledgeMode, "skip");
  assert.equal(calls[0]?.researchMode, "auto");
  assert.equal(calls[1]?.routingQuestion, "qui est louis ix");
  assert.equal(calls[1]?.researchQuestion, "qui est louis ix");
  assert.equal(calls[1]?.knowledgeMode, "skip");
  assert.equal(calls[1]?.researchMode, "auto");
  assert.match(calls[1]?.question ?? "", /Prior turns:/);
  assert.match(calls[1]?.question ?? "", /ActiveConstraintCapsule:/);
  assert.equal(second.runtimeMode, "conversation");
  assert.match(second.answer.answer, /Louis IX/i);
  assert.match(second.answer.answer, /Saint Louis/i);
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime recalls user-provided facts without triggering research", async () => {
  const calls: Array<{
    question: string;
    routingQuestion?: string;
    researchMode?: string;
    knowledgeMode?: string;
  }> = [];
  const service = new ChatRuntimeService({
    async answerOnly(question, options) {
      calls.push({
        question,
        routingQuestion: options?.routingQuestion,
        researchMode: options?.researchMode,
        knowledgeMode: options?.knowledgeMode
      });
      return buildPreview({
        question,
        category: "other",
        answer:
          calls.length === 1
            ? "C'est note : tu t'appelles Marc et tu travailles sur Hydria."
            : "Je ne peux pas verifier cette information actuelle depuis le prompt.",
        usedRetry: false
      });
    }
  });

  const first = await service.sendMessage({ message: "Je m'appelle Marc et je travaille sur Hydria." });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Comment je m'appelle ?"
  });

  assert.equal(calls[0]?.knowledgeMode, "skip");
  assert.equal(calls[0]?.researchMode, "skip");
  assert.equal(calls[1]?.knowledgeMode, "skip");
  assert.equal(calls[1]?.researchMode, "skip");
  assert.match(calls[1]?.question ?? "", /Prior turns:/);
  assert.equal(second.runtimeMode, "conversation");
  assert.match(second.assistantMessage.content, /Marc/);
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime resolves possessive biography follow-ups to the prior subject", async () => {
  const calls: Array<{
    question: string;
    routingQuestion?: string;
    researchQuestion?: string;
    researchMode?: string;
    knowledgeMode?: string;
  }> = [];
  const answers = [
    "Charlemagne est un roi des Francs et empereur carolingien.",
    "Charlemagne a consolide un vaste empire en Europe occidentale et a soutenu des reformes administratives et religieuses.",
    "Sa biographie est marquee par l'expansion du royaume franc, les reformes de l'administration et son role dans la renaissance carolingienne."
  ];
  const service = new ChatRuntimeService({
    async answerOnly(question, options) {
      calls.push({
        question,
        routingQuestion: options?.routingQuestion,
        researchQuestion: options?.researchQuestion,
        researchMode: options?.researchMode,
        knowledgeMode: options?.knowledgeMode
      });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? answers[answers.length - 1]!;
      return buildPreview({
        question,
        category: "other",
        answer,
        usedRetry: false
      });
    }
  });

  const first = await service.sendMessage({ message: "qui est charlemagne" });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "tu peux m'en dire plus"
  });
  const third = await service.sendMessage({
    sessionId: second.sessionId,
    message: "donne moi sa biographie"
  });

  assert.equal(calls[0]?.routingQuestion, "qui est charlemagne");
  assert.equal(calls[0]?.researchMode, "auto");
  assert.equal(calls[1]?.routingQuestion, "qui est charlemagne biographie contexte");
  assert.equal(calls[1]?.researchMode, "auto");
  assert.equal(calls[2]?.routingQuestion, "biographie de charlemagne");
  assert.equal(calls[2]?.researchQuestion, "biographie de charlemagne");
  assert.equal(calls[2]?.knowledgeMode, "skip");
  assert.equal(calls[2]?.researchMode, "auto");
  assert.equal(third.runtimeMode, "conversation");
  assert.match(calls[2]?.question ?? "", /Prior turns:/);
  assert.match(calls[2]?.question ?? "", /ActiveConstraintCapsule:/);
  assert.match(calls[2]?.question ?? "", /Resolved current task:\s*biographie de charlemagne/i);
  assert.match(calls[2]?.question ?? "", /Biography answer shape:/);
  assert.match(third.answer.answer, /Charlemagne/i);
  assert.match(third.answer.answer, /^La biographie de Charlemagne/i);
  assert.doesNotMatch(third.answer.answer, /cannot verify|tool-dependent|reliable source/i);
  assert.equal(third.conversationQuality.passed, true);
});

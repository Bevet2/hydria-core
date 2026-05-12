import test from "node:test";
import assert from "node:assert/strict";
import { ChatRuntimeService } from "../services/chatRuntimeService.js";
import type { StudentChatAdapterInput, StudentChatAdapterResult } from "../services/studentChatAdapter.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import type { StudentAnswer } from "../types/student.js";

function buildAnswer(answer: string): StudentAnswer {
  return {
    modelRole: "student",
    answer,
    key_points: ["Reponse corrigee", "Contexte utilise"],
    assumptions: [],
    confidence: 82
  };
}

function buildAdapterResult(answer: string, usedRetry = false): StudentChatAdapterResult {
  return {
    answer: buildAnswer(answer),
    usedRetry,
    provider: "ollama",
    model: "test",
    specialist: {
      capabilityId: "mistral-mixtral-business",
      role: "writing_business",
      displayName: "Mistral/Mixtral",
      routingReason: "test route",
      pipeline: ["fast_router:phi3:mini", "writing_business:test"]
    },
    raw: "{}",
    validationIssues: []
  };
}

test("chat runtime keeps follow-up context in the direct student chat adapter", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService({
    async answer(input) {
      calls.push(input);
      return buildAdapterResult(
        calls.length === 1
          ? "Louis IX est une figure historique, mais la reponse initiale reste incomplete."
          : "Tu as raison, il fallait comprendre Louis IX, aussi appele Saint Louis. C'est le roi de France capetien qui a regne de 1226 a 1270 et qui a ete canonise ensuite."
      );
    }
  });

  const first = await service.sendMessage({ message: "qui est louis 9" });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "tu ne connais pas louis 9 ou dit plutot saint louis"
  });

  assert.equal(calls[0]?.routingQuestion, "qui est louis 9");
  assert.equal(calls[0]?.requiresExternalGrounding, true);
  assert.equal(calls[0]?.runtimeMode, "direct");
  assert.equal(calls[1]?.routingQuestion, "qui est saint louis");
  assert.equal(calls[1]?.requiresExternalGrounding, true);
  assert.equal(calls[1]?.runtimeMode, "conversation");
  assert.match(calls[1]?.question ?? "", /Prior turns:/);
  assert.match(calls[1]?.question ?? "", /ActiveConstraintCapsule:/);
  assert.match(calls[1]?.question ?? "", /Correction handling:/);
  assert.match(calls[1]?.question ?? "", /Resolved current task to answer/i);
  assert.equal(second.runtimeMode, "conversation");
  assert.match(second.answer.answer, /Louis IX/i);
  assert.match(second.answer.answer, /Saint Louis/i);
  assert.equal(second.conversationQuality.passed, true);
  assert.equal(second.orchestrationTrace.version, "chat_orchestration_trace_v1");
  assert.equal(second.orchestrationTrace.disclosure, "runtime_trace_no_private_chain_of_thought");
  assert.equal(
    second.orchestrationTrace.steps.some((step) => step.id === "model_selection"),
    true
  );
  assert.equal(
    second.orchestrationTrace.steps.some((step) => String(step.summary).includes("private")),
    false
  );
});

test("chat runtime recalls user-provided facts without triggering research", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService({
    async answer(input) {
      calls.push(input);
      return buildAdapterResult(
        calls.length === 1
          ? "C'est note : tu t'appelles Marc et tu travailles sur Hydria."
          : "Je ne peux pas verifier cette information actuelle depuis le prompt."
      );
    }
  });

  const first = await service.sendMessage({ message: "Je m'appelle Marc et je travaille sur Hydria." });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Comment je m'appelle ?"
  });

  assert.equal(calls[0]?.requiresExternalGrounding, false);
  assert.equal(calls[1]?.requiresExternalGrounding, false);
  assert.equal(calls[1]?.answerPolicy.shouldUseContext, true);
  assert.match(calls[1]?.question ?? "", /Prior turns:/);
  assert.equal(second.runtimeMode, "conversation");
  assert.match(second.assistantMessage.content, /Marc/);
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime retries corrected identity turns on the resolved task", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService({
    async answer(input) {
      calls.push(input);
      if (calls.length === 1) {
        return buildAdapterResult("Louis IX est une figure historique francaise.");
      }
      if (calls.length === 2) {
        return buildAdapterResult(
          "Non, je n'ai pas precisement dit que Louis IX etait egalement connu sous le nom de Saint Louis."
        );
      }
      return buildAdapterResult(
        "Saint Louis, ou Louis IX, est un roi de France capetien qui a regne de 1226 a 1270."
      );
    }
  });

  const first = await service.sendMessage({ message: "qui est louis 9" });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "tu ne connais pas louis 9 ou dit plutot saint louis"
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.routingQuestion, "qui est saint louis");
  assert.equal(calls[2]?.userMessage, "qui est saint louis");
  assert.equal(calls[2]?.routingQuestion, "qui est saint louis");
  assert.equal(second.usedRetry, true);
  assert.match(second.answer.answer, /Saint Louis/i);
  assert.match(second.answer.answer, /France/i);
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime recalls user-provided project names", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService({
    async answer(input) {
      calls.push(input);
      return buildAdapterResult(
        calls.length === 1
          ? "Noted: your project is called Hydria Core."
          : "I cannot verify the project name from live data."
      );
    }
  });

  const first = await service.sendMessage({ message: "My project is called Hydria Core." });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "What is my project called?"
  });

  assert.equal(calls[1]?.answerPolicy.shouldUseContext, true);
  assert.equal(second.runtimeMode, "conversation");
  assert.match(second.assistantMessage.content, /Hydria Core/);
  assert.equal(second.generation.provider, "ollama");
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime resolves possessive biography follow-ups to the prior subject", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const answers = [
    "Charlemagne est un roi des Francs et empereur carolingien.",
    "Charlemagne a consolide un vaste empire en Europe occidentale et a soutenu des reformes administratives et religieuses.",
    "Sa biographie est marquee par l'expansion du royaume franc, les reformes de l'administration et son role dans la renaissance carolingienne."
  ];
  const service = new ChatRuntimeService({
    async answer(input) {
      calls.push(input);
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? answers[answers.length - 1]!;
      return buildAdapterResult(answer);
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
  assert.equal(calls[0]?.requiresExternalGrounding, true);
  assert.equal(calls[1]?.routingQuestion, "qui est charlemagne biographie contexte");
  assert.equal(calls[1]?.requiresExternalGrounding, true);
  assert.equal(calls[2]?.routingQuestion, "biographie de charlemagne");
  assert.equal(calls[2]?.requiresExternalGrounding, true);
  assert.equal(third.runtimeMode, "conversation");
  assert.match(calls[2]?.question ?? "", /Prior turns:/);
  assert.match(calls[2]?.question ?? "", /ActiveConstraintCapsule:/);
  assert.match(calls[2]?.question ?? "", /Resolved current task to answer[\s\S]*biographie de charlemagne/i);
  assert.match(calls[2]?.question ?? "", /Biography answer shape:/);
  assert.match(third.answer.answer, /Charlemagne/i);
  assert.match(third.answer.answer, /^La biographie de Charlemagne/i);
  assert.doesNotMatch(third.answer.answer, /cannot verify|tool-dependent|reliable source/i);
  assert.equal(third.conversationQuality.passed, true);
});

test("chat runtime executes required local tools and injects verified facts into the adapter", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: true,
    toolType: "time" as const,
    intent: "current_time",
    confidence: 0.96,
    fallbackAllowed: false,
    reason: "Current time requires a time-aware tool path.",
    extractedArgs: {
      location: "Paris",
      language: "fr"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer(input) {
        calls.push(input);
        return buildAdapterResult("Il est 10:30 a Paris selon le contexte verifie.");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute(receivedRouting) {
        assert.equal(receivedRouting.intent, "current_time");
        return {
          toolType: "time",
          intent: "current_time",
          summary: ["Time tool result: Paris -> 10:30"],
          verifiedFacts: ["Current time in Paris: 10:30."],
          confidenceScore: 1,
          resultLabel: "Paris -> 10:30"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Quelle heure est-il a Paris ?" });

  assert.equal(calls[0]?.tooling.used, true);
  assert.equal(calls[0]?.tooling.routing.toolResultUsed, true);
  assert.equal(calls[0]?.requiresExternalGrounding, true);
  assert.deepEqual(calls[0]?.tooling.verifiedFacts, ["Current time in Paris: 10:30."]);
  assert.equal(response.tooling.used, true);
  assert.equal(response.tooling.routing.toolType, "time");
  assert.equal(response.tooling.routing.toolResultUsed, true);
  assert.equal(
    response.orchestrationTrace.steps.find((step) => step.id === "tool_routing")?.summary,
    "Used time/current_time."
  );
});

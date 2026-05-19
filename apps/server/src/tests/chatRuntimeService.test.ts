import test from "node:test";
import assert from "node:assert/strict";
import { ChatRuntimeService } from "../services/chatRuntimeService.js";
import type { StudentChatAdapterInput, StudentChatAdapterResult } from "../services/studentChatAdapter.js";
import { defaultToolRoutingDecision, type ToolRoutingDecision } from "../types/arena.js";
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

function buildFactCheckToolResult(fact: string) {
  return {
    async tryExecute(routing: ToolRoutingDecision) {
      if (routing.toolType !== "research" || routing.intent !== "fact_check") {
        return null;
      }
      return {
        toolType: "research" as const,
        intent: "fact_check",
        summary: ["Source-backed factual context for the requested subject."],
        verifiedFacts: [fact],
        confidenceScore: 0.88,
        resultLabel: "fact_check"
      };
    }
  };
}

test("chat runtime keeps follow-up context in the direct student chat adapter", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService(
    {
      async answer(input) {
        calls.push(input);
        return buildAdapterResult(
          calls.length === 1
            ? "Louis IX est une figure historique, mais la reponse initiale reste incomplete."
            : "Tu as raison, il fallait comprendre Louis IX, aussi appele Saint Louis. C'est le roi de France capetien qui a regne de 1226 a 1270 et qui a ete canonise ensuite."
        );
      }
    },
    undefined,
    buildFactCheckToolResult("Louis IX, aussi appele Saint Louis, est un roi de France capetien.")
  );

  const first = await service.sendMessage({ message: "qui est louis 9" });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "tu ne connais pas louis 9 ou dit plutot saint louis"
  });

  assert.equal(calls[0]?.routingQuestion, "qui est louis 9");
  assert.equal(calls[0]?.requiresExternalGrounding, true);
  assert.equal(calls[0]?.tooling.used, true);
  assert.equal(calls[0]?.tooling.routing.toolType, "research");
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

test("chat runtime repairs thin source-backed factual answers with verified facts", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult("Marie Curie etait une physicienne et chimiste polonaise et francaise.");
      }
    },
    undefined,
    buildFactCheckToolResult(
      "Marie Curie: Marie Curie est une physicienne et chimiste franco-polonaise, pionniere des recherches sur la radioactivite, laureate de deux prix Nobel."
    )
  );

  const response = await service.sendMessage({ message: "Qui est Marie Curie ?" });

  assert.match(response.answer.answer, /radioactivite/i);
  assert.match(response.answer.answer, /Nobel/i);
  assert.equal(response.tooling.routing.toolType, "research");
  assert.equal(response.tooling.used, true);
  assert.equal(response.usedRetry, true);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime synthesizes from source-backed facts when the local model falls back", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return {
          ...buildAdapterResult(
            "Je n'ai pas reussi a generer une reponse fiable pour ce tour. Reformule la question ou donne un peu plus de contexte."
          ),
          provider: "fallback" as const,
          model: "qwen2.5:3b",
          validationIssues: ["student_chat_generation_failed", "qwen2.5:3b: timeout"]
        };
      }
    },
    undefined,
    buildFactCheckToolResult(
      "Charlemagne: Charlemagne est un roi des Francs et empereur carolingien couronne a Rome en 800."
    )
  );

  const response = await service.sendMessage({ message: "Qui est Charlemagne ?" });

  assert.match(response.answer.answer, /Charlemagne/i);
  assert.match(response.answer.answer, /roi des Francs/i);
  assert.match(response.answer.answer, /empereur/i);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "research_fact_check");
  assert.equal(response.generation.usedStaticFallback, false);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime recalls user-provided facts without triggering research", async () => {
  let adapterCalled = false;
  const service = new ChatRuntimeService({
    async answer() {
      adapterCalled = true;
      return buildAdapterResult("Model answer that should not be needed.");
    }
  });

  const first = await service.sendMessage({ message: "Je m'appelle Marc et je travaille sur Hydria." });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Comment je m'appelle ?"
  });

  assert.equal(adapterCalled, false);
  assert.equal(first.generation.model, "conversation_fact_ack");
  assert.equal(second.generation.model, "conversation_memory");
  assert.equal(second.runtimeMode, "conversation");
  assert.match(second.assistantMessage.content, /Marc/);
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime retries corrected identity turns on the resolved task", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService(
    {
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
    },
    undefined,
    buildFactCheckToolResult("Saint Louis, ou Louis IX, est un roi de France capetien.")
  );

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
  let adapterCalled = false;
  const service = new ChatRuntimeService({
    async answer() {
      adapterCalled = true;
      return buildAdapterResult("Model answer that should not be needed.");
    }
  });

  const first = await service.sendMessage({ message: "My project is called Hydria Core." });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "What is my project called?"
  });

  assert.equal(adapterCalled, false);
  assert.equal(first.generation.model, "conversation_fact_ack");
  assert.equal(second.generation.model, "conversation_memory");
  assert.equal(second.runtimeMode, "conversation");
  assert.match(second.assistantMessage.content, /Hydria Core/);
  assert.equal(second.generation.provider, "tool");
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime skips vault retrieval for strategic context unless sources are requested", async () => {
  let retrievalCalls = 0;
  const service = new ChatRuntimeService(
    {
      async answer(input) {
        assert.equal(input.knowledgeRetrieval.route, "skipped_tool_route");
        return buildAdapterResult(
          "I recommend narrowing the beta because no additional budget dominates broad-launch ambition. Defer platform complexity, keep the mid-market slice reversible, and expand only if the signal proves value and recurring budget is funded."
        );
      }
    },
    undefined,
    undefined,
    null,
    null,
    {
      async retrieve() {
        retrievalCalls += 1;
        throw new Error("retrieval should not run for strategic context");
      }
    }
  );

  const response = await service.sendMessage({
    message: "We have weak signal from mid-market only and no budget for a broad launch."
  });

  assert.equal(retrievalCalls, 0);
  assert.equal(response.knowledgeRetrieval.route, "skipped_tool_route");
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime resolves possessive biography follow-ups to the prior subject", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const answers = [
    "Charlemagne est un roi des Francs et empereur carolingien.",
    "Charlemagne a consolide un vaste empire en Europe occidentale et a soutenu des reformes administratives et religieuses.",
    "Sa biographie est marquee par l'expansion du royaume franc, les reformes de l'administration et son role dans la renaissance carolingienne."
  ];
  const service = new ChatRuntimeService(
    {
      async answer(input) {
        calls.push(input);
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)] ?? answers[answers.length - 1]!;
        return buildAdapterResult(answer);
      }
    },
    undefined,
    buildFactCheckToolResult("Charlemagne est un roi des Francs et empereur carolingien.")
  );

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

test("chat runtime answers weather tool facts deterministically without a model call", async () => {
  let adapterCalled = false;
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: true,
    toolType: "weather" as const,
    intent: "current_weather",
    confidence: 0.96,
    fallbackAllowed: false,
    reason: "Current weather requires a weather-aware tool path.",
    extractedArgs: {
      location: "Paris",
      language: "fr"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer() {
        adapterCalled = true;
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
        assert.equal(receivedRouting.intent, "current_weather");
        return {
          toolType: "weather",
          intent: "current_weather",
          summary: ["Weather tool result: Paris -> clear, 18 deg C."],
          verifiedFacts: ["Current weather in Paris: clear, temperature 18 deg C."],
          confidenceScore: 1,
          resultLabel: "Paris -> clear, 18 deg C"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Quelle est la meteo a Paris ?" });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "weather");
  assert.match(response.answer.answer, /Paris/);
  assert.equal(response.tooling.used, true);
  assert.equal(response.tooling.routing.toolType, "weather");
  assert.equal(response.tooling.routing.toolResultUsed, true);
  assert.equal(
    response.orchestrationTrace.steps.find((step) => step.id === "tool_routing")?.summary,
    "Used weather/current_weather."
  );
});

test("chat runtime answers current time deterministically from verified tool results", async () => {
  let adapterCalled = false;
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
      async answer() {
        adapterCalled = true;
        return buildAdapterResult("Il est 10:30 a Paris selon le contexte verifie.");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute() {
        return {
          toolType: "time",
          intent: "current_time",
          summary: ["Time tool result: May 12, 2026 at 10:30:00 PM (Paris)"],
          verifiedFacts: ["Current time: May 12, 2026 at 10:30:00 PM (Paris)."],
          confidenceScore: 1,
          resultLabel: "May 12, 2026 at 10:30:00 PM (Paris)"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Quelle heure est-il a Paris ?" });

  assert.equal(adapterCalled, false);
  assert.equal(response.tooling.used, true);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "time");
  assert.equal(response.conversationQuality.passed, true);
  assert.match(response.answer.answer, /L'heure actuelle est May 12, 2026 at 10:30:00 PM \(Paris\)\./);
});

test("chat runtime accepts concise calculator answers from verified tool results", async () => {
  let adapterCalled = false;
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: true,
    toolType: "calculator" as const,
    intent: "arithmetic",
    confidence: 0.98,
    fallbackAllowed: false,
    reason: "Arithmetic expression should use calculator.",
    extractedArgs: {
      expression: "12 * 37",
      language: "fr"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer() {
        adapterCalled = true;
        return buildAdapterResult("Le resultat de 12 multiplie par 37 est 444.");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute() {
        return {
          toolType: "calculator",
          intent: "arithmetic",
          summary: ["12 * 37 = 444"],
          verifiedFacts: ["12 * 37 = 444"],
          confidenceScore: 1,
          resultLabel: "444"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Calcule 12 * 37." });

  assert.equal(response.tooling.used, true);
  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "calculator");
  assert.equal(response.conversationQuality.passed, true);
  assert.equal(response.conversationQuality.issues.includes("off_topic_direct_answer"), false);
  assert.equal(
    response.orchestrationTrace.steps.find((step) => step.id === "tool_routing")?.summary,
    "Used calculator/arithmetic."
  );
});

test("chat runtime keeps deterministic calculator answers in the tool routing language", async () => {
  let adapterCalled = false;
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: true,
    toolType: "calculator" as const,
    intent: "arithmetic",
    confidence: 0.98,
    fallbackAllowed: false,
    reason: "Arithmetic expression should use calculator.",
    extractedArgs: {
      expression: "144 / 12",
      language: "en"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer() {
        adapterCalled = true;
        return buildAdapterResult("Le resultat est 12.");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute() {
        return {
          toolType: "calculator",
          intent: "arithmetic",
          summary: ["Calculator result: 144 / 12 = 12"],
          verifiedFacts: ["Computed result: 144 / 12 = 12."],
          confidenceScore: 1,
          resultLabel: "12"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Calculate 144 / 12." });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "calculator");
  assert.match(response.answer.answer, /^The result of 144 \/ 12 is 12\./);
  assert.equal(response.conversationQuality.issues.includes("wrong_language_expected_en"), false);
});

test("chat runtime answers finance tool facts deterministically without a model call", async () => {
  let adapterCalled = false;
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: true,
    toolType: "finance" as const,
    intent: "current_price",
    confidence: 0.95,
    fallbackAllowed: false,
    reason: "Current crypto price requires finance tooling.",
    extractedArgs: {
      asset: "BTC",
      quoteCurrency: "USD",
      language: "en"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer() {
        adapterCalled = true;
        return buildAdapterResult("$81,259");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute() {
        return {
          toolType: "finance",
          intent: "current_price",
          summary: ["Finance tool result: Bitcoin (BTC) -> $81,259."],
          verifiedFacts: ["Current Bitcoin (BTC) price: $81,259 according to CoinGecko, checked at 2026-05-13T10:00:00.000Z."],
          confidenceScore: 0.96,
          resultLabel: "Bitcoin (BTC) $81,259"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "What is the current Bitcoin price?" });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "finance");
  assert.match(response.answer.answer, /Bitcoin/);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime answers web current-status facts deterministically without a model call", async () => {
  let adapterCalled = false;
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: true,
    toolType: "web" as const,
    intent: "current_status",
    confidence: 0.93,
    fallbackAllowed: false,
    reason: "Current executive lookup requires web tooling.",
    extractedArgs: {
      subject: "OpenAI",
      role: "CEO",
      language: "en"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer() {
        adapterCalled = true;
        return buildAdapterResult("Sam Altman");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute() {
        return {
          toolType: "web",
          intent: "current_status",
          summary: ["Web tool result: Sam Altman confirmed by an official source."],
          verifiedFacts: ["As of the live OpenAI source check, Sam Altman is the CEO of OpenAI."],
          confidenceScore: 0.93,
          resultLabel: "Sam Altman"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Who is the current CEO of OpenAI?" });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "web");
  assert.match(response.answer.answer, /OpenAI/);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime answers recent AI updates from verified research tool facts without a model call", async () => {
  let adapterCalled = false;
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: false,
    toolType: "research" as const,
    intent: "recent_updates",
    confidence: 0.92,
    fallbackAllowed: false,
    reason: "Recent AI updates require source retrieval.",
    extractedArgs: {
      subject: "nouveautes IA cette semaine",
      temporalFocus: "this_week",
      language: "fr"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer() {
        adapterCalled = true;
        return buildAdapterResult("Model answer that should not be needed.");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute() {
        return {
          toolType: "research",
          intent: "recent_updates",
          summary: ["Recherche IA recente: 2 entrees datees trouvees."],
          verifiedFacts: [
            "OpenAI News a publie \"Agents update\" le 2026-05-18.",
            "Hugging Face Blog a publie \"New model leaderboard\" le 2026-05-17."
          ],
          confidenceScore: 0.84,
          resultLabel: "2 recent AI updates",
          sources: []
        };
      }
    }
  );

  const response = await service.sendMessage({
    message: "Fais-moi un recap de toutes les nouveautes IA sorties cette semaine."
  });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "research_recent_updates");
  assert.equal(response.tooling.used, true);
  assert.match(response.answer.answer, /recap IA source/i);
  assert.match(response.answer.answer, /OpenAI News/);
  assert.equal(response.conversationQuality.passed, true);
  assert.equal(response.conversationQuality.issues.includes("tool_required_but_not_used"), false);
});

test("chat runtime source-safe abstains when required research tool is unavailable", async () => {
  let adapterCalled = false;
  const routing = {
    ...defaultToolRoutingDecision,
    toolRequired: true,
    toolRecommended: false,
    toolType: "research" as const,
    intent: "recent_updates",
    confidence: 0.92,
    fallbackAllowed: false,
    reason: "Recent AI updates require source retrieval.",
    extractedArgs: {
      subject: "nouveautes IA cette semaine",
      temporalFocus: "this_week",
      language: "fr"
    }
  };
  const service = new ChatRuntimeService(
    {
      async answer() {
        adapterCalled = true;
        return buildAdapterResult("Model answer that should not be needed.");
      }
    },
    {
      route() {
        return routing;
      }
    },
    {
      async tryExecute() {
        return null;
      }
    }
  );

  const response = await service.sendMessage({
    message: "Fais-moi un recap de toutes les nouveautes IA sorties cette semaine."
  });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "required_tool_unavailable");
  assert.equal(response.tooling.route, "unsupported");
  assert.match(response.answer.answer, /recap de nouveautes recentes cette semaine/i);
  assert.match(response.answer.answer, /source exploitable/i);
  assert.equal(response.conversationQuality.issues.includes("tool_required_but_not_used"), false);
});

test("chat runtime acknowledges pure context setup without a model call", async () => {
  let adapterCalled = false;
  const service = new ChatRuntimeService({
    async answer() {
      adapterCalled = true;
      return buildAdapterResult("Fallback answer that should not be used.");
    }
  });

  const response = await service.sendMessage({ message: "On parle de bases de donnees." });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "context_ack");
  assert.match(response.answer.answer, /bases de donnees/i);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime accepts English context setup acknowledgements as quality-passed", async () => {
  let adapterCalled = false;
  const service = new ChatRuntimeService({
    async answer() {
      adapterCalled = true;
      return buildAdapterResult("Fallback answer that should not be used.");
    }
  });

  const response = await service.sendMessage({ message: "We are talking about incident response." });

  assert.equal(adapterCalled, false);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "context_ack");
  assert.match(response.answer.answer, /incident response/i);
  assert.equal(response.conversationQuality.passed, true);
  assert.deepEqual(response.conversationQuality.issues, []);
});

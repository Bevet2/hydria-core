import test from "node:test";
import assert from "node:assert/strict";
import { ChatRuntimeService } from "../services/chatRuntimeService.js";
import type { StudentChatAdapterInput, StudentChatAdapterResult } from "../services/studentChatAdapter.js";
import { defaultToolRoutingDecision, type ToolRoutingDecision } from "../types/arena.js";
import type { ChatKnowledgeRetrievalMetadata } from "../types/knowledgeRetrieval.js";
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

test("chat runtime sends narrative French factual questions to research in French", async () => {
  const routedLanguages: Array<unknown> = [];
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult("Charlemagne was King of the Franks and Emperor.");
      }
    },
    undefined,
    {
      async tryExecute(routing: ToolRoutingDecision) {
        routedLanguages.push(routing.extractedArgs?.language);
        if (routing.toolType !== "research" || routing.intent !== "fact_check") {
          return null;
        }
        return {
          toolType: "research" as const,
          intent: "fact_check",
          summary: ["Contexte factuel source sur Charlemagne."],
          verifiedFacts: [
            "Charlemagne: Charlemagne est roi des Francs, roi des Lombards, puis empereur couronne a Rome en 800."
          ],
          confidenceScore: 0.88,
          resultLabel: "fact_check"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Raconte l'histoire de Charlemagne." });

  assert.deepEqual(routedLanguages, ["fr"]);
  assert.match(response.answer.answer, /Charlemagne/i);
  assert.doesNotMatch(response.answer.answer, /\bwas King\b/i);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime corrects routed research language from French user message before execution", async () => {
  const routedLanguages: Array<unknown> = [];
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult("Cleopatre VII est la derniere reine de l'Egypte ptolemaique.");
      }
    },
    {
      route() {
        return {
          ...defaultToolRoutingDecision,
          considered: true,
          toolRequired: true,
          toolRecommended: false,
          toolType: "research",
          intent: "fact_check",
          confidence: 0.83,
          fallbackAllowed: false,
          reason: "test routing with stale language",
          extractedArgs: {
            subject: "Cleopatra VII",
            query: "Qui etait Cleopatre ?",
            language: "en"
          },
          toolResultUsed: false
        };
      }
    },
    {
      async tryExecute(routing: ToolRoutingDecision) {
        routedLanguages.push(routing.extractedArgs.language);
        if (routing.toolType !== "research" || routing.intent !== "fact_check") {
          return null;
        }
        return {
          toolType: "research" as const,
          intent: "fact_check",
          summary: ["Contexte factuel source sur Cleopatre VII."],
          verifiedFacts: [
            "Cleopatre VII: derniere reine de l'Egypte ptolemaique, figure centrale des guerres civiles romaines."
          ],
          confidenceScore: 0.88,
          resultLabel: "fact_check"
        };
      }
    }
  );

  const response = await service.sendMessage({ message: "Qui etait Cleopatre ?" });

  assert.deepEqual(routedLanguages, ["fr"]);
  assert.equal(response.tooling.routing.extractedArgs.language, "fr");
  assert.match(response.answer.answer, /Cleopatre|Cl[eé]op[aâ]tre/i);
  assert.doesNotMatch(response.answer.answer, /\bwas Queen\b/i);
});

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

test("chat runtime resolves bare entity corrections after biography requests", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService(
    {
      async answer(input) {
        calls.push(input);
        return buildAdapterResult(
          calls.length === 1
            ? "Je n'ai pas assez d'information verifiee."
            : "Louis IX, aussi appele Saint Louis, est un roi de France capetien qui a regne de 1226 a 1270."
        );
      }
    },
    undefined,
    buildFactCheckToolResult("Louis IX, aussi appele Saint Louis, est un roi de France capetien.")
  );

  const first = await service.sendMessage({
    message: "fait moi une biographie complete pour une presentation de Louis 9"
  });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "le roi louis 9 de france"
  });

  assert.equal(calls[0]?.routingQuestion, "fait moi une biographie complete pour une presentation de Louis 9");
  assert.equal(calls[0]?.requiresExternalGrounding, true);
  const secondTurnCall = calls.find((call) => call.userMessage === "le roi louis 9 de france");
  assert.equal(secondTurnCall?.routingQuestion.toLowerCase(), "biographie de louis ix de france");
  assert.equal(secondTurnCall?.requiresExternalGrounding, true);
  assert.equal(secondTurnCall?.runtimeMode, "conversation");
  assert.match(secondTurnCall?.question ?? "", /Resolved current task to answer[\s\S]*biographie de louis ix de france/i);
  assert.match(second.answer.answer, /Louis IX/i);
  assert.match(second.answer.answer, /Saint Louis/i);
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

test("chat runtime repairs truncated source-backed factual answers with verified facts", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult("Louis IX de France, dit Saint Louis, etait roi de France de 1226 a");
      }
    },
    undefined,
    buildFactCheckToolResult(
      "Louis IX: Louis IX, roi de France, ne le 25 avril 1214 et mort le 25 aout 1270. Il est canonise par l'Eglise catholique en 1297."
    )
  );

  const response = await service.sendMessage({ message: "Le roi Louis neuf de France, c'est qui ?" });

  assert.match(response.answer.answer, /Louis IX/i);
  assert.match(response.answer.answer, /1270/i);
  assert.match(response.answer.answer, /canonise/i);
  assert.doesNotMatch(response.answer.answer.trim(), /\ba$/i);
  assert.doesNotMatch(response.answer.answer, /\ba\s+Il\b/i);
  assert.equal(response.usedRetry, true);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime repairs ellipsis-truncated source-backed factual answers", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult(
          "Napoléon Ier, né le 15 août 1769 à Ajaccio et mort le 5 mai 1821 à Sainte-Hélène, était un militaire..."
        );
      }
    },
    undefined,
    buildFactCheckToolResult(
      "Napoleon Bonaparte: Napoléon Bonaparte, aussi appelé Napoléon Ier, est un militaire et homme d'Etat français, premier empereur des Français."
    )
  );

  const response = await service.sendMessage({ message: "Biographie courte de Napoleon Bonaparte." });

  assert.match(response.answer.answer, /Napol[eé]on/i);
  assert.doesNotMatch(response.answer.answer.trim(), /\.{3}$/);
  assert.equal(response.usedRetry, true);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime repairs BCE abbreviation truncation in source-backed biographies", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult("Cleopatre VII Philopator, nee vers 69 av. J.");
      }
    },
    undefined,
    buildFactCheckToolResult(
      "Cleopatra VII: Cleopatre VII Philopator, nee vers 69 av. J.-C. et morte le 10 aout 30 av. J.-C., est la derniere reine d'Egypte de la dynastie lagide."
    )
  );

  const response = await service.sendMessage({ message: "Qui etait Cleopatre ?" });

  assert.match(response.answer.answer, /J\.-C\./);
  assert.match(response.answer.answer, /derniere reine/i);
  assert.doesNotMatch(response.answer.answer.trim(), /\bav\. J\.?$/i);
  assert.equal(response.usedRetry, true);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime repairs unsupported proper nouns in source-backed factual answers", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult(
          "Louis IX, roi de France, est ne a Poissy et mort en 1270 a Cartouche."
        );
      }
    },
    undefined,
    buildFactCheckToolResult(
      "Louis IX: Louis IX, roi de France, est ne a Poissy et mort en 1270 a Carthage, pres de Tunis."
    )
  );

  const response = await service.sendMessage({ message: "Fais-moi une biographie de Louis 9." });

  assert.match(response.answer.answer, /Carthage/i);
  assert.doesNotMatch(response.answer.answer, /Cartouche/i);
  assert.equal(response.usedRetry, true);
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

test("chat runtime prioritizes verified multi-source research over unrelated memory on model fallback", async () => {
  let retrievalCalls = 0;
  const service = new ChatRuntimeService(
    {
      async answer() {
        return {
          ...buildAdapterResult(
            "Je n'ai pas reussi a generer une reponse fiable pour ce tour. Reformule la question."
          ),
          provider: "fallback" as const,
          model: "qwen2.5:14b",
          validationIssues: ["student_chat_generation_failed", "qwen2.5:14b: timeout"]
        };
      }
    },
    undefined,
    {
      async tryExecute(routing: ToolRoutingDecision) {
        if (routing.toolType !== "research" || routing.intent !== "fact_check") {
          return null;
        }
        return {
          toolType: "research" as const,
          intent: "fact_check",
          summary: ["Comparaison sourcee PostgreSQL et MySQL."],
          verifiedFacts: [
            "PostgreSQL: moteur relationnel extensible, adapte aux requetes complexes et aux contraintes avancees.",
            "MySQL: moteur relationnel largement deploye, avec un ecosysteme mature pour les applications web."
          ],
          sources: [
            {
              title: "PostgreSQL documentation",
              url: "https://www.postgresql.org/docs/",
              snippet: "Official PostgreSQL documentation.",
              excerpt: "PostgreSQL is an object-relational database system.",
              publishedAt: null,
              modifiedAt: null,
              effectiveDate: null,
              dateSource: null,
              retrievalChannel: "live" as const,
              retrievalOrigin: "known_endpoint" as const,
              retrievalEngine: "known_endpoint" as const
            },
            {
              title: "MySQL documentation",
              url: "https://dev.mysql.com/doc/",
              snippet: "Official MySQL documentation.",
              excerpt: "MySQL documentation and reference manuals.",
              publishedAt: null,
              modifiedAt: null,
              effectiveDate: null,
              dateSource: null,
              retrievalChannel: "live" as const,
              retrievalOrigin: "known_endpoint" as const,
              retrievalEngine: "known_endpoint" as const
            }
          ],
          confidenceScore: 0.9,
          resultLabel: "PostgreSQL vs MySQL"
        };
      }
    },
    null,
    null,
    {
      async retrieve(): Promise<ChatKnowledgeRetrievalMetadata> {
        retrievalCalls += 1;
        return {
          route: "used",
          used: true,
          query: "PostgreSQL vs MySQL",
          category: "technical_explanation",
          hitCount: 1,
          hits: [
            {
              objectId: "unrelated-watcher",
              title: "Code and runtime release source pack",
              summary: "Creates acquisition tasks for Node.js, Docker, PostgreSQL, and Kubernetes.",
              content: "Watcher acquisition task.",
              state: "active",
              knowledgeClass: "stable",
              domain: "watchers",
              category: "technical_explanation",
              confidence: 0.9,
              riskLevel: "low",
              score: 0.8,
              matchedTerms: ["postgresql"],
              sourceUris: ["storage/learning/hydria-watchers-v1.json"],
              sourceLabels: ["watcher"]
            }
          ],
          guidance: [],
          issues: []
        };
      }
    }
  );

  const response = await service.sendMessage({
    message: "Compare PostgreSQL et MySQL avec plusieurs sources fiables."
  });

  assert.equal(retrievalCalls, 0);
  assert.equal(response.knowledgeRetrieval.route, "skipped_tool_route");
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "research_multi_source_fallback");
  assert.match(response.answer.answer, /PostgreSQL/i);
  assert.match(response.answer.answer, /MySQL/i);
  assert.match(response.answer.answer, /postgresql\.org\/docs/i);
  assert.match(response.answer.answer, /dev\.mysql\.com\/doc/i);
  assert.doesNotMatch(response.answer.answer, /release source pack|watcher acquisition/i);
});

test("chat runtime replaces an ungrounded long-form synthesis with verified research evidence", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult(
          "PostgreSQL est robuste. Michael Stonebraker a lance Ingres. En termes de concurrence, PostgreSQL affronte MySQL sur le marche. La reprise apres incident est fiable."
        );
      }
    },
    undefined,
    {
      async tryExecute(routing: ToolRoutingDecision) {
        if (routing.toolType !== "research" || routing.intent !== "fact_check") {
          return null;
        }
        return {
          toolType: "research" as const,
          intent: "fact_check",
          summary: ["Documentation technique PostgreSQL."],
          verifiedFacts: [
            "PostgreSQL: le WAL journalise les changements avant leur ecriture dans les fichiers de donnees.",
            "PostgreSQL: MVCC coordonne les lectures et ecritures concurrentes avec des instantanes transactionnels.",
            "PostgreSQL: les checkpoints et le rejeu du WAL contribuent a la reprise apres incident."
          ],
          sources: [
            {
              title: "PostgreSQL WAL documentation",
              url: "https://www.postgresql.org/docs/current/wal-intro.html",
              snippet: "Write-ahead logging documentation.",
              excerpt: "WAL records changes before data files are written.",
              publishedAt: null,
              modifiedAt: null,
              effectiveDate: null,
              dateSource: null,
              retrievalChannel: "live" as const,
              retrievalOrigin: "known_endpoint" as const,
              retrievalEngine: "known_endpoint" as const
            },
            {
              title: "PostgreSQL MVCC documentation",
              url: "https://www.postgresql.org/docs/current/mvcc-intro.html",
              snippet: "MVCC documentation.",
              excerpt: "MVCC provides transactional snapshots for concurrent access.",
              publishedAt: null,
              modifiedAt: null,
              effectiveDate: null,
              dateSource: null,
              retrievalChannel: "live" as const,
              retrievalOrigin: "known_endpoint" as const,
              retrievalEngine: "known_endpoint" as const
            }
          ],
          confidenceScore: 0.9,
          resultLabel: "PostgreSQL durability and concurrency"
        };
      }
    }
  );

  const response = await service.sendMessage({
    message:
      "Explique en profondeur comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident. Cite plusieurs sources."
  });

  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "research_multi_source_fallback");
  assert.match(response.answer.answer, /WAL/i);
  assert.match(response.answer.answer, /MVCC/i);
  assert.match(response.answer.answer, /postgresql\.org\/docs/i);
  assert.doesNotMatch(response.answer.answer, /Michael Stonebraker|affronte MySQL|rend ce choix prioritaire/i);
});

test("chat runtime repairs wrong-language source-backed concept answers from verified facts", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return buildAdapterResult(
          "En pratique, la coherence eventuelle signifie que les donnees finissent par converger plus tard."
        );
      }
    },
    undefined,
    buildFactCheckToolResult(
      "Eventual consistency: Eventual consistency means replicas can temporarily diverge but converge after propagation, such as a multi-region shopping cart that synchronizes after a short delay."
    )
  );

  const response = await service.sendMessage({
    message: "Explain eventual consistency with a practical example."
  });

  assert.match(response.answer.answer, /Eventual consistency/i);
  assert.match(response.answer.answer, /replicas|shopping cart/i);
  assert.doesNotMatch(response.answer.answer, /En pratique/i);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime repairs source-backed factual fallbacks inside a conversation", async () => {
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
    buildFactCheckToolResult("Saint Louis, ou Louis IX, est un roi de France capetien.")
  );

  const first = await service.sendMessage({ message: "qui est louis 9" });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "tu ne connais pas louis 9 ou dit plutot saint louis"
  });

  assert.match(second.answer.answer, /Saint Louis|Louis IX/i);
  assert.match(second.answer.answer, /roi de France/i);
  assert.equal(second.generation.provider, "tool");
  assert.equal(second.generation.model, "research_fact_check");
  assert.equal(second.conversationQuality.passed, true);
});

test("chat runtime provides a bounded code diagnostic when the code specialist falls back", async () => {
  const service = new ChatRuntimeService({
    async answer() {
      return {
        ...buildAdapterResult(
          "I could not generate a reliable answer for this turn. Rephrase the question or add a little more context."
        ),
        provider: "fallback" as const,
        model: "qwen2.5-coder:7b",
        validationIssues: ["student_chat_generation_failed", "qwen2.5-coder:7b: timeout"]
      };
    }
  });

  const response = await service.sendMessage({
    message: "Debug a Docker build error where npm install fails."
  });

  assert.match(response.answer.answer, /Docker/i);
  assert.match(response.answer.answer, /npm install/i);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "runtime_code_diagnostic");
  assert.equal(response.generation.usedStaticFallback, false);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime preserves decisive payment terms in incident rollback decisions", async () => {
  const service = new ChatRuntimeService({
    async answer(input) {
      if (/decision/i.test(input.userMessage)) {
        return buildAdapterResult(
          "Je recommande de faire un retour arriere vers la version precedente immediatement pour minimiser le risque client. Le risque croissant l'emporte sur l'attente; on reconsidere apres verification."
        );
      }
      if (/direction/i.test(input.userMessage)) {
        return buildAdapterResult("Contexte mis a jour: le risque client augmente malgre l'attente demandee.");
      }
      if (/incident/i.test(input.userMessage)) {
        return buildAdapterResult("Contexte note: incident prod avec impact paiement.");
      }
      return buildAdapterResult("Contexte conserve.");
    }
  });

  const first = await service.sendMessage({
    message: "Incident prod: erreurs 500 apres deploy, impact paiement."
  });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "La direction veut attendre mais le risque client augmente."
  });
  const third = await service.sendMessage({
    sessionId: second.sessionId,
    message: "Decision maintenant ?"
  });

  assert.equal(first.conversationQuality.passed, true);
  assert.equal(second.conversationQuality.passed, true);
  assert.match(third.answer.answer, /paiement client/i);
  assert.doesNotMatch(third.answer.answer, /customer payment/i);
  assert.equal(third.conversationQuality.passed, true);
});

test("chat runtime repairs on-prem budget decisions with explicit constraint use", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService({
    async answer(input) {
      calls.push(input);
      return buildAdapterResult("Je recommande AWS pour garder de la flexibilite.");
    }
  });

  const first = await service.sendMessage({
    message: "On doit choisir une architecture. Au depart je pensais AWS."
  });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Finalement contrainte stricte: on-prem uniquement, budget bloque, deadline demain."
  });
  const third = await service.sendMessage({
    sessionId: second.sessionId,
    message: "Tu recommandes quoi ?"
  });

  assert.equal(calls.length, 2);
  assert.equal(first.generation.model, "strategic_context_ack");
  assert.equal(second.generation.model, "strategic_context_ack");
  assert.equal(third.generation.provider, "ollama");
  assert.match(third.answer.answer, /on-prem/i);
  assert.match(third.answer.answer, /budget bloque/i);
  assert.match(third.answer.answer, /deadline de demain/i);
  assert.doesNotMatch(third.answer.answer, /microservices/i);
  assert.equal(third.conversationQuality.passed, true);
});

test("chat runtime repairs single-turn on-prem budget decisions even when category is broad", async () => {
  const service = new ChatRuntimeService({
    async answer() {
      return buildAdapterResult(
        "Je recommande une option on-prem : faire un rollback pour revenir a la derniere version fonctionnelle."
      );
    }
  });

  const response = await service.sendMessage({
    message: "Budget bloque, deadline demain, on-prem uniquement. Tu recommandes quoi ?"
  });

  assert.match(response.answer.answer, /on-prem/i);
  assert.match(response.answer.answer, /minimale|reversible/i);
  assert.match(response.answer.answer, /reconsidere|reconsider/i);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime preserves mid-market as a decisive product strategy term", async () => {
  const service = new ChatRuntimeService({
    async answer() {
      return buildAdapterResult(
        "Given the weak market signals and lack of budget, I recommend narrowing the beta launch before expanding."
      );
    }
  });

  const response = await service.sendMessage({
    message: "No budget for a broad launch, weak mid-market signal only. Should we launch broadly or narrow the beta?"
  });

  assert.match(response.answer.answer, /mid-market/i);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime converts strategic fallback repairs into governed runtime decisions", async () => {
  const service = new ChatRuntimeService({
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
  });

  const first = await service.sendMessage({
    message: "On doit choisir une architecture. Au depart je pensais AWS."
  });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Finalement contrainte stricte: on-prem uniquement, budget bloque, deadline demain."
  });
  const third = await service.sendMessage({
    sessionId: second.sessionId,
    message: "Tu recommandes quoi ?"
  });

  assert.equal(third.generation.provider, "tool");
  assert.equal(third.generation.model, "runtime_strategic_decision_repair");
  assert.equal(third.generation.usedStaticFallback, false);
  assert.match(third.answer.answer, /Je recommande/i);
  assert.match(third.answer.answer, /on-prem/i);
  assert.equal(third.conversationQuality.passed, true);
});

test("chat runtime answers Hydria Core self-knowledge without waiting for model fallback", async () => {
  let adapterCalled = false;
  const service = new ChatRuntimeService({
    async answer() {
      adapterCalled = true;
      return {
        ...buildAdapterResult(
          "Je n'ai pas reussi a generer une reponse fiable pour ce tour. Reformule la question ou donne un peu plus de contexte."
        ),
        provider: "fallback" as const,
        model: "qwen2.5:3b",
        validationIssues: ["student_chat_generation_failed", "qwen2.5:3b: timeout"]
      };
    }
  });

  const response = await service.sendMessage({
    message: "Reponds en une phrase courte : quel est le role de Hydria Core ?"
  });

  assert.equal(adapterCalled, false);
  assert.match(response.answer.answer, /Hydria Core/i);
  assert.match(response.answer.answer, /runtime cognitif|cognitive runtime/i);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "runtime_product_knowledge");
  assert.equal(response.generation.usedStaticFallback, false);
  assert.equal(response.conversationQuality.passed, true);
});

test("chat runtime answers Hydria watcher self-knowledge with watcher-specific facts", async () => {
  let adapterCalled = false;
  const service = new ChatRuntimeService({
    async answer() {
      adapterCalled = true;
      return buildAdapterResult("Model answer that should not be needed.");
    }
  });

  const response = await service.sendMessage({
    message: "Explique le role des watchers dans Hydria Core."
  });

  assert.equal(adapterCalled, false);
  assert.match(response.answer.answer, /watchers/i);
  assert.match(response.answer.answer, /connaissance|knowledge/i);
  assert.equal(response.generation.provider, "tool");
  assert.equal(response.generation.model, "runtime_product_knowledge");
  assert.equal(response.evidenceCapsule.answerabilityMode, "knowledge_augmented");
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
  assert.equal(calls[1]?.routingQuestion, "biographie de charlemagne");
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

test("chat runtime does not treat generic brevity constraints as strategic context", async () => {
  const calls: StudentChatAdapterInput[] = [];
  const service = new ChatRuntimeService(
    {
      async answer(input) {
        calls.push(input);
        return buildAdapterResult("PostgreSQL est une base relationnelle SQL robuste.");
      }
    },
    undefined,
    buildFactCheckToolResult("PostgreSQL est un systeme de gestion de base de donnees relationnelle open source.")
  );

  const first = await service.sendMessage({ message: "On parle de bases de donnees." });
  const second = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Pour la suite, reponds en moins de 12 mots."
  });
  const third = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Explique PostgreSQL en respectant ma contrainte."
  });

  assert.equal(calls.length, 1);
  assert.notEqual(third.generation.model, "strategic_context_ack");
  assert.equal(third.generation.provider, "ollama");
  assert.match(third.answer.answer, /PostgreSQL/i);
  assert.equal(third.conversationQuality.passed, true);
  assert.equal(second.generation.model, "context_ack");
});

test("chat runtime repairs concise stable concept timeouts instead of returning a generic fallback", async () => {
  const service = new ChatRuntimeService(
    {
      async answer() {
        return {
          answer: {
            modelRole: "student",
            answer: "Je n'ai pas reussi a generer une reponse fiable pour ce tour.",
            key_points: ["Generation indisponible"],
            assumptions: ["student_chat_generation_failed"],
            confidence: 30
          },
          usedRetry: true,
          provider: "fallback",
          model: "qwen2.5:3b",
          specialist: {
            capabilityId: "qwen-3b-router",
            role: "fast_router",
            displayName: "Qwen 3B",
            routingReason: "test timeout",
            pipeline: ["fast_router:phi3:mini", "concise_answer:qwen2.5:3b"]
          },
          raw: "Je n'ai pas reussi a generer une reponse fiable pour ce tour.",
          validationIssues: ["student_chat_generation_failed", "qwen2.5:3b: timeout"],
          runtimeBudget: {
            profile: "concise_chat",
            label: "Concise fast chat",
            reason: "test timeout",
            timeoutMs: 45000,
            maxLatencyMs: 45000,
            maxOutputTokens: 96,
            maxConcurrent: 1,
            fallbackDepth: 1,
            concurrencyKey: "fast_local_chat"
          }
        };
      }
    },
    undefined,
    buildFactCheckToolResult("PostgreSQL est un systeme de gestion de base de donnees relationnelle open source.")
  );

  const first = await service.sendMessage({ message: "On parle de bases de donnees." });
  await service.sendMessage({
    sessionId: first.sessionId,
    message: "Pour la suite, reponds en moins de 12 mots."
  });
  const third = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Explique PostgreSQL en respectant ma contrainte."
  });

  assert.equal(third.generation.provider, "tool");
  assert.equal(third.generation.model, "research_fact_check");
  assert.equal(third.evidenceCapsule.answerabilityMode, "source_backed");
  assert.ok(third.evidenceCapsule.usedEvidence.includes("tool:research/fact_check"));
  assert.ok(third.orchestrationTrace.steps.some((step) => step.id === "answerability"));
  assert.match(third.answer.answer, /PostgreSQL/i);
  assert.doesNotMatch(third.answer.answer, /pas reussi|reformule/i);
  assert.equal(third.conversationQuality.passed, true);
});

test("chat runtime recalls structured project state without calling external research", async () => {
  const adapterMessages: string[] = [];
  let toolCalls = 0;
  const service = new ChatRuntimeService(
    {
      async answer(input) {
        adapterMessages.push(input.userMessage);
        return buildAdapterResult(
          "Je recommande de reduire le perimetre au lancement essentiel parce que le budget et le delai ont baisse."
        );
      }
    },
    undefined,
    {
      async tryExecute() {
        toolCalls += 1;
        return null;
      }
    }
  );

  const first = await service.sendMessage({
    message:
      "Je prepare le lancement du projet Atlas. Budget 30000 euros, equipe de 3 personnes, date limite au 30 septembre. Garde ces informations."
  });
  await service.sendMessage({
    sessionId: first.sessionId,
    message: "Le budget tombe finalement a 12000 euros et la date avance au 31 juillet. Que dois-je changer ?"
  });
  const adapterCallsBeforeRecall = adapterMessages.length;
  const recall = await service.sendMessage({
    sessionId: first.sessionId,
    message: "Rappelle-moi le nom du projet, le budget actuel, l'ancien budget, l'equipe et la date actuelle."
  });

  assert.equal(recall.generation.model, "conversation_memory");
  assert.match(recall.answer.answer, /Atlas/);
  assert.match(recall.answer.answer, /12000 euros/);
  assert.match(recall.answer.answer, /30000 euros/);
  assert.match(recall.answer.answer, /3 personnes/);
  assert.match(recall.answer.answer, /31 juillet/);
  assert.equal(toolCalls, 0);
  assert.equal(adapterMessages.length, adapterCallsBeforeRecall);
  assert.equal(adapterMessages.some((message) => /Rappelle-moi/i.test(message)), false);
});

test("chat runtime retries an answer that ignores an explicit minimum word count", async () => {
  let calls = 0;
  const developedAnswer = [
    "Une migration du monolithe vers des modules doit commencer par une cartographie claire des responsabilites et des dependances.",
    "Il faut ensuite definir des frontieres fonctionnelles stables autour des capacites metier qui changent a des rythmes differents.",
    "Le premier module extrait doit rester reversible afin de limiter le risque et de verifier les contrats techniques en production.",
    "Les appels internes peuvent d'abord rester dans le meme processus avant toute separation en services reseau.",
    "Chaque etape doit ajouter des tests de contrat, des mesures de latence et une procedure de retour arriere.",
    "Les donnees partagees doivent etre traitees explicitement pour eviter les doubles ecritures et les incoherences silencieuses.",
    "Une equipe responsable par module simplifie aussi les decisions, les revues et le suivi des incidents.",
    "Le deploiement progressif permet de comparer le comportement du module avec celui du monolithe existant.",
    "La migration avance seulement lorsque les indicateurs de fiabilite et de maintenance montrent un gain reel.",
    "Cette approche produit une architecture modulaire utile sans imposer trop tot la complexite operationnelle des microservices."
  ].join(" ");
  const service = new ChatRuntimeService({
    async answer() {
      calls += 1;
      return buildAdapterResult(
        calls === 1
          ? "La migration doit etre progressive."
          : developedAnswer
      );
    }
  });

  const response = await service.sendMessage({
    message:
      "Redige une analyse detaillee d'au moins 80 mots sur une migration pragmatique d'un monolithe vers des modules."
  });

  assert.equal(calls, 2);
  assert.ok(response.answer.answer.split(/\s+/).length >= 80);
  assert.equal(response.conversationQuality.passed, true);
  assert.equal(response.conversationQuality.issues.includes("insufficient_requested_length"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { HydriaPublicApiV1Service } from "../services/publicApi/hydriaPublicApiV1Service.js";
import { publicApiAskRequestSchema } from "../types/publicApi.js";

const sessionId = "11111111-1111-4111-8111-111111111111";

function chatResponse(overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    createdAt: "2026-05-27T12:00:00.000Z",
    runtimeMode: "conversation",
    category: "technical_explanation",
    assistantMessage: {
      content: "NVIDIA est une entreprise technologique qui concoit des GPU et des plateformes d'IA."
    },
    answer: {
      confidence: 86
    },
    conversationState: {
      language: "fr",
      userGoal: "Qu'est-ce que NVIDIA ?",
      knownFacts: ["On parle de NVIDIA."]
    },
    activeConstraintCapsule: {
      topConstraints: ["reponse concise"]
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check"
      },
      sources: [
        {
          title: "Wikipedia: Nvidia",
          url: "https://fr.wikipedia.org/wiki/Nvidia",
          snippet: "Nvidia Corporation est une societe de technologie.",
          excerpt: "Nvidia Corporation est une societe americaine de technologie."
        }
      ]
    },
    generation: {
      provider: "tool",
      model: "research_fact_check",
      specialist: {
        role: "source_research"
      },
      attempts: [
        {
          model: "qwen2.5:3b"
        }
      ]
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    evidenceCapsule: {
      answerabilityMode: "source_backed"
    },
    agenticPlan: {
      mode: "evidence_first"
    },
    knowledgeRetrieval: {
      used: false
    },
    orchestrationTrace: {
      version: "chat_orchestration_trace_v1",
      disclosure: "runtime_trace_no_private_chain_of_thought",
      steps: []
    },
    usedRetry: false,
    durationMs: 1234,
    ...overrides
  } as any;
}

test("public API ask schema accepts input alias and defaults output options", () => {
  const parsed = publicApiAskRequestSchema.parse({
    input: "Qu'est-ce que NVIDIA ?"
  });

  assert.equal(parsed.input, "Qu'est-ce que NVIDIA ?");
  assert.equal(parsed.options.includeSources, true);
  assert.equal(parsed.options.includeTrace, false);
  assert.throws(() => publicApiAskRequestSchema.parse({}), /Either input or question is required/);
});

test("public API v1 maps chat runtime output into a stable integration envelope", async () => {
  let received: unknown = null;
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage(input: unknown) {
        received = input;
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: "Qu'est-ce que NVIDIA ?",
      sessionId
    })
  );

  assert.deepEqual(received, {
    message: "Qu'est-ce que NVIDIA ?",
    sessionId
  });
  assert.equal(response.object, "hydria.answer");
  assert.equal(response.sessionId, sessionId);
  assert.match(response.answer, /NVIDIA/);
  assert.equal(response.sources[0]?.url, "https://fr.wikipedia.org/wiki/Nvidia");
  assert.equal(response.tools.used, true);
  assert.equal(response.models.provider, "tool");
  assert.equal(response.memory.contextTracked, true);
  assert.equal("trace" in response, false);
});

test("public API v1 can include trace and diagnostics without exposing private chain-of-thought", async () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      question: "Qu'est-ce que NVIDIA ?",
      options: {
        includeTrace: true,
        includeDiagnostics: true
      }
    })
  );

  assert.equal((response.trace as any).disclosure, "runtime_trace_no_private_chain_of_thought");
  assert.equal((response.diagnostics as any).agenticPlan.mode, "evidence_first");
});

test("public API v1 creates and resets sessions", () => {
  let resetId = "";
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession(id: string) {
        resetId = id;
      }
    } as any
  });

  const session = service.createSession();
  assert.equal(session.object, "hydria.session");
  assert.match(session.id, /^[0-9a-f-]{36}$/);

  const reset = service.resetSession(sessionId);
  assert.equal(reset.object, "hydria.session_reset");
  assert.equal(reset.reset, true);
  assert.equal(resetId, sessionId);
});

test("public API v1 exposes integration capabilities", () => {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: {
      async sendMessage() {
        return chatResponse();
      },
      resetSession() {}
    } as any
  });

  const capabilities = service.capabilities();
  assert.equal(capabilities.version, "v1");
  assert.ok(capabilities.endpoints.includes("POST /api/v1/ask"));
  assert.ok(capabilities.runtime.orchestration.includes("agentic mission plan"));
  assert.equal(capabilities.runtime.chainOfThought, "not_exposed");
});

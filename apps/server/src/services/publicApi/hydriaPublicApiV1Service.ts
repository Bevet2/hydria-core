import { randomUUID } from "node:crypto";
import type { ChatRuntimeService } from "../chatRuntimeService.js";
import {
  publicApiAskResponseSchema,
  publicApiCapabilitiesResponseSchema,
  publicApiSessionResetResponseSchema,
  publicApiSessionResponseSchema,
  type PublicApiAskRequest,
  type PublicApiAskResponse,
  type PublicApiCapabilitiesResponse,
  type PublicApiSessionResetResponse,
  type PublicApiSessionResponse
} from "../../types/publicApi.js";
import { env } from "../../utils/env.js";

type HydriaPublicApiV1ServiceDeps = {
  chatRuntimeService: Pick<ChatRuntimeService, "sendMessage" | "resetSession">;
};

function resolveQuestion(request: PublicApiAskRequest) {
  return (request.input ?? request.question ?? "").trim();
}

function compact(value: string | null | undefined, maxChars = 500) {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function sourceList(result: Awaited<ReturnType<ChatRuntimeService["sendMessage"]>>) {
  return result.tooling.sources.slice(0, 8).map((source) => ({
    title: source.title || source.url || "source",
    url: source.url || null,
    snippet: compact(source.snippet, 360),
    excerpt: compact(source.excerpt, 700)
  }));
}

function attemptModels(result: Awaited<ReturnType<ChatRuntimeService["sendMessage"]>>) {
  const attempts = result.generation.attempts?.map((attempt) => attempt.model).filter(Boolean) ?? [];
  return [...new Set(attempts.length > 0 ? attempts : [result.generation.model])];
}

export class HydriaPublicApiV1Service {
  constructor(private readonly deps: HydriaPublicApiV1ServiceDeps) {}

  async ask(request: PublicApiAskRequest): Promise<PublicApiAskResponse> {
    const result = await this.deps.chatRuntimeService.sendMessage({
      message: resolveQuestion(request),
      ...(request.sessionId ? { sessionId: request.sessionId } : {})
    });
    const includeSources = request.options.includeSources;
    const includeTrace = request.options.includeTrace;
    const includeDiagnostics = request.options.includeDiagnostics;

    return publicApiAskResponseSchema.parse({
      id: randomUUID(),
      object: "hydria.answer",
      createdAt: result.createdAt,
      sessionId: result.sessionId,
      answer: result.assistantMessage.content,
      language: result.conversationState.language,
      category: result.category,
      confidence: Number.isFinite(result.answer.confidence) ? result.answer.confidence : null,
      sources: includeSources ? sourceList(result) : [],
      tools: {
        used: result.tooling.used,
        route: result.tooling.route,
        type: result.tooling.routing.toolType,
        intent: result.tooling.routing.intent,
        sourceCount: result.tooling.sources.length
      },
      models: {
        provider: result.generation.provider,
        model: result.generation.model,
        specialistRole: result.generation.specialist?.role ?? null,
        attempts: attemptModels(result)
      },
      memory: {
        sessionId: result.sessionId,
        userGoal: result.conversationState.userGoal,
        activeConstraints: result.activeConstraintCapsule.topConstraints,
        contextTracked: result.runtimeMode === "conversation" || result.conversationState.knownFacts.length > 0
      },
      quality: {
        passed: result.conversationQuality.passed,
        issues: result.conversationQuality.issues.slice(0, 12),
        retryUsed: result.usedRetry,
        durationMs: result.durationMs
      },
      ...(includeTrace ? { trace: result.orchestrationTrace } : {}),
      ...(includeDiagnostics
        ? {
            diagnostics: {
              runtimeMode: result.runtimeMode,
              answerability: result.evidenceCapsule,
              agenticPlan: result.agenticPlan,
              qualityGate: result.conversationQuality,
              generation: result.generation,
              tooling: result.tooling,
              knowledgeRetrieval: result.knowledgeRetrieval
            }
          }
        : {})
    });
  }

  createSession(): PublicApiSessionResponse {
    return publicApiSessionResponseSchema.parse({
      id: randomUUID(),
      object: "hydria.session",
      createdAt: new Date().toISOString()
    });
  }

  resetSession(sessionId: string): PublicApiSessionResetResponse {
    this.deps.chatRuntimeService.resetSession(sessionId);
    return publicApiSessionResetResponseSchema.parse({
      id: sessionId,
      object: "hydria.session_reset",
      reset: true
    });
  }

  capabilities(): PublicApiCapabilitiesResponse {
    return publicApiCapabilitiesResponseSchema.parse({
      object: "hydria.capabilities",
      version: "v1",
      endpoints: [
        "POST /api/v1/ask",
        "POST /api/v1/sessions",
        "POST /api/v1/sessions/:sessionId/reset",
        "DELETE /api/v1/sessions/:sessionId",
        "GET /api/v1/capabilities"
      ],
      auth: {
        type: "api_key",
        headers: ["Authorization: Bearer <key>", "x-hydria-api-key: <key>", "x-api-key: <key>"]
      },
      runtime: {
        orchestration: [
          "intent routing",
          "tool routing",
          "source-backed answerability",
          "governed memory retrieval",
          "agentic mission plan",
          "post-answer verification"
        ],
        memory: [
          "session continuity via sessionId",
          "interaction audit persistence",
          "governed learning queue capture"
        ],
        chainOfThought: "not_exposed"
      },
      tools: [
        "calculator",
        "weather",
        "finance",
        "time",
        "release/status lookup",
        "repo facts",
        "source-backed research"
      ],
      modelRoles: [
        { role: "fast_router", model: "phi3:mini", provider: "ollama" },
        { role: "concise_standard", model: "qwen2.5:3b", provider: "ollama" },
        { role: "primary_reasoning", model: "qwen2.5:14b", provider: "ollama" },
        { role: "code_debug", model: "qwen2.5-coder:7b", provider: "ollama" },
        { role: "deep_reasoning", model: "deepseek-r1:14b", provider: "ollama" },
        { role: "writing_business", model: "mistral:7b", provider: "ollama" },
        { role: "default_chat_runtime", model: env.STUDENT_CHAT_LOCAL_MODEL_NAME, provider: "ollama" },
        { role: "retrieval", model: "bge-m3 + bge-reranker", provider: "local_services" }
      ]
    });
  }
}

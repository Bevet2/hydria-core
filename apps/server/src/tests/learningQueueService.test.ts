import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatRuntimeService } from "../services/chatRuntimeService.js";
import { LearningQueueService } from "../services/learningQueueService.js";
import type { StudentChatAdapterResult } from "../services/studentChatAdapter.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import type { ChatMessageResponse } from "../types/chat.js";
import type { StudentAnswer } from "../types/student.js";

function answer(text: string): StudentAnswer {
  return {
    modelRole: "student",
    answer: text,
    key_points: ["runtime signal"],
    assumptions: [],
    confidence: 42
  };
}

function adapterResult(text: string, provider: "ollama" | "fallback" = "fallback"): StudentChatAdapterResult {
  return {
    answer: answer(text),
    usedRetry: provider === "fallback",
    provider,
    model: "qwen2.5:3b",
    specialist: {
      capabilityId: "qwen-3b-standard-light",
      role: "primary_brain",
      displayName: "Qwen 2.5 3B",
      routingReason: "test",
      pipeline: ["test"]
    },
    raw: "{}",
    validationIssues: provider === "fallback" ? ["local_timeout"] : []
  };
}

function response(overrides: Partial<ChatMessageResponse> = {}): ChatMessageResponse {
  return {
    sessionId: "session-1",
    createdAt: "2026-05-19T10:00:00.000Z",
    runtimeMode: "direct",
    category: "technical_explanation",
    userMessage: {
      id: "user-1",
      role: "user",
      content: "Reponds en francais: explain eventual consistency.",
      createdAt: "2026-05-19T10:00:00.000Z"
    },
    assistantMessage: {
      id: "assistant-1",
      role: "assistant",
      content: "Eventual consistency means replicas converge later.",
      createdAt: "2026-05-19T10:00:01.000Z"
    },
    answer: answer("Eventual consistency means replicas converge later."),
    conversationState: {} as ChatMessageResponse["conversationState"],
    activeConstraintCapsule: {} as ChatMessageResponse["activeConstraintCapsule"],
    answerPolicy: {} as ChatMessageResponse["answerPolicy"],
    evidenceCapsule: {
      answerabilityMode: "direct_model",
      requiredEvidence: [],
      preferredEvidence: [],
      usedEvidence: [],
      missingEvidence: [],
      sourceBound: false,
      abstainIfMissing: false,
      reliabilityLevel: "model_knowledge",
      synthesisStrategy: "specialist_direct_answer",
      riskFlags: [],
      reasons: ["test fixture"],
      promptGuidance: "Stable test fixture."
    },
    agenticPlan: {
      version: "agentic_orchestration_plan_v1",
      mode: "specialist_direct",
      subject: null,
      domain: "general",
      intent: "answer",
      missions: [],
      criticalChecks: ["answer_language_matches_user_language"],
      finalSynthesisGuidance: "Stable test fixture.",
      blocked: false,
      issues: []
    },
    conversationQuality: {
      passed: false,
      issues: ["wrong_language_expected_fr"],
      penalties: ["answer language does not match"],
      recommendedAction: "retry_with_context"
    },
    generation: {
      provider: "fallback",
      model: "qwen2.5:3b",
      specialist: {
        capabilityId: "qwen-3b-standard-light",
        role: "primary_brain",
        displayName: "Qwen 2.5 3B",
        routingReason: "test",
        pipeline: ["test"]
      },
      usedStaticFallback: true,
      validationIssues: ["local_timeout"]
    },
    tooling: {
      route: "not_needed",
      used: false,
      routing: {
        ...defaultToolRoutingDecision,
        toolRequired: false,
        toolRecommended: false,
        toolType: "none",
        intent: "none",
        confidence: 0
      },
      summary: [],
      verifiedFacts: [],
      sources: [],
      failureReason: null
    },
    knowledgeRetrieval: {
      route: "no_match",
      used: false,
      query: "eventual consistency",
      category: "technical_explanation",
      hitCount: 0,
      hits: [],
      guidance: [],
      issues: []
    },
    orchestrationTrace: {
      version: "chat_orchestration_trace_v1",
      disclosure: "runtime_trace_no_private_chain_of_thought",
      steps: []
    },
    usedRetry: true,
    durationMs: 1000,
    ...overrides
  };
}

test("learning queue captures governed chat failure candidates and validates without training", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-learning-queue-"));
  try {
    const service = new LearningQueueService({
      queueFile: join(tempRoot, "queue.json"),
      gateReportFile: join(tempRoot, "gate.json")
    });

    await service.captureChatResponse({
      response: response(),
      interactionRecord: {
        id: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-05-19T10:00:00.000Z",
        scope: "chat_turn",
        source: "chat",
        mode: "chat",
        status: "completed",
        sessionId: "session-1",
        artifactId: "assistant-1",
        question: "Reponds en francais: explain eventual consistency.",
        answer: "Eventual consistency means replicas converge later.",
        summary: "summary",
        routing: {
          orchestrator: "chat_runtime",
          provider: "fallback",
          model: "qwen2.5:3b",
          category: "technical_explanation",
          toolUsed: false
        },
        quality: {
          passed: false,
          score: null,
          issues: ["wrong_language_expected_fr"]
        },
        durationMs: 1000,
        payload: null
      }
    });

    const queue = await service.loadQueue();
    const report = await service.validateAndPersist();

    assert.equal(queue.sourceStats.candidateCount, 3);
    assert.ok(queue.candidates.some((candidate) => candidate.kind === "model_fallback"));
    assert.ok(queue.candidates.some((candidate) => candidate.kind === "language_mismatch"));
    assert.ok(queue.candidates.some((candidate) => candidate.kind === "retrieval_gap"));
    assert.equal(report.gate.passed, true);
    assert.equal(report.trainingAuthorization.studentSftAllowed, false);
    assert.ok(report.sourceStats.studentSftCandidateCount >= 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("chat runtime writes model fallback signals to the learning queue", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-chat-learning-queue-"));
  try {
    const learningQueueService = new LearningQueueService({
      queueFile: join(tempRoot, "queue.json"),
      gateReportFile: join(tempRoot, "gate.json")
    });
    const service = new ChatRuntimeService(
      {
        async answer() {
          return adapterResult("Local generation failed.", "fallback");
        }
      },
      undefined,
      undefined,
      null,
      null,
      null,
      learningQueueService
    );

    const result = await service.sendMessage({
      message: "Redige une phrase courte sur la patience."
    });
    const queue = await learningQueueService.loadQueue();

    assert.equal(result.generation.provider, "fallback");
    assert.ok(queue.candidates.some((candidate) => candidate.kind === "model_fallback"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

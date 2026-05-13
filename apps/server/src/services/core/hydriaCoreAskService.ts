import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ArenaRunner } from "../arenaRunner.js";
import type { BenchmarkService } from "../benchmarkService.js";
import type { ChatRuntimeService } from "../chatRuntimeService.js";
import type { LocalModelService } from "../localModel.js";
import type { StudentService } from "../studentService.js";
import type { InteractionLogStore } from "../interactionLogStore.js";
import {
  hydriaCoreAskResponseSchema,
  type HydriaCoreAskRequest,
  type HydriaCoreAskResponse
} from "../../types/core.js";
import { defaultArenaModels } from "../../utils/env.js";

type HydriaCoreAskServiceDeps = {
  chatRuntimeService: ChatRuntimeService;
  studentService: StudentService;
  arenaRunner: ArenaRunner;
  benchmarkService: BenchmarkService;
  localModelService: LocalModelService;
  interactionLogStore?: Pick<InteractionLogStore, "safeAppend"> | null;
};

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function modelList(models: Record<string, string>) {
  return [...new Set(Object.values(models).map((model) => model.trim()).filter(Boolean))];
}

export class HydriaCoreAskService {
  constructor(private readonly deps: HydriaCoreAskServiceDeps) {}

  async ask(request: HydriaCoreAskRequest): Promise<HydriaCoreAskResponse> {
    const startedAt = performance.now();
    const requestId = randomUUID();
    const finish = (response: Omit<HydriaCoreAskResponse, "requestId" | "durationMs">) =>
      hydriaCoreAskResponseSchema.parse({
        requestId,
        durationMs: Math.round(performance.now() - startedAt),
        ...response
      });

    if (request.mode === "chat") {
      const result = await this.deps.chatRuntimeService.sendMessage({
        message: request.question,
        ...(request.sessionId ? { sessionId: request.sessionId } : {})
      });

      return finish({
        mode: request.mode,
        status: "completed",
        answer: result.assistantMessage.content,
        display: {
          title: "Chat response",
          summary: compact(result.assistantMessage.content),
          primaryText: result.assistantMessage.content,
          actionLabel: null
        },
        routing: {
          orchestrator: "chat_runtime",
          provider: result.generation.provider,
          model: result.generation.model,
          models: result.generation.attempts?.map((attempt) => attempt.model) ?? [result.generation.model],
          toolUsed: result.tooling.used,
          benchmarkId: null
        },
        artifacts: [
          {
            kind: "chat_session",
            id: result.sessionId,
            label: "Chat session"
          }
        ],
        data: result
      });
    }

    if (request.mode === "student_preview") {
      const preview = await this.deps.studentService.answerOnly(request.question, {
        researchMode: "skip"
      });

      return finish({
        mode: request.mode,
        status: "completed",
        answer: preview.student.draft.answer,
        display: {
          title: "Student draft",
          summary: compact(preview.student.draft.answer),
          primaryText: preview.student.draft.answer,
          actionLabel: "Analyze with teacher"
        },
        routing: {
          orchestrator: "student_preview",
          provider: preview.trace.student.finalProvider,
          model: preview.trace.student.finalModel,
          models: [preview.trace.student.finalModel],
          toolUsed: preview.student.toolApplied,
          benchmarkId: null
        },
        artifacts: [
          {
            kind: "student_preview",
            id: preview.previewId,
            label: "Student preview"
          }
        ],
        data: preview
      });
    }

    if (request.mode === "student_session") {
      const session = await this.deps.studentService.runSession(request.question);

      return finish({
        mode: request.mode,
        status: "completed",
        answer: session.student.final.answer,
        display: {
          title: "Student learning session",
          summary: compact(session.student.final.answer),
          primaryText: session.student.final.answer,
          actionLabel: null
        },
        routing: {
          orchestrator: "student_learning",
          provider: session.traces.student.finalProvider,
          model: session.traces.student.finalModel,
          models: Object.values(session.models),
          toolUsed: session.student.toolApplied,
          benchmarkId: null
        },
        artifacts: [
          {
            kind: "student_session",
            id: session.sessionId,
            label: "Student session"
          }
        ],
        data: session
      });
    }

    if (request.mode === "playground") {
      const models = {
        ...defaultArenaModels,
        ...(request.models ?? {})
      };
      const round = await this.deps.arenaRunner.runRound({
        question: request.question,
        models
      });

      return finish({
        mode: request.mode,
        status: "completed",
        answer: round.outputs.synthesizer.final_answer,
        display: {
          title: "Playground arena response",
          summary: compact(round.outputs.synthesizer.final_answer),
          primaryText: round.outputs.synthesizer.final_answer,
          actionLabel: null
        },
        routing: {
          orchestrator: "arena_runner",
          provider: "openrouter",
          model: round.models.synthesizer,
          models: modelList(round.models),
          toolUsed: round.research.used,
          benchmarkId: null
        },
        artifacts: [
          {
            kind: "arena_round",
            id: round.roundId,
            label: "Arena round"
          }
        ],
        data: round
      });
    }

    if (request.mode === "benchmark") {
      const run = await this.deps.benchmarkService.startRun({
        benchmarkId: request.benchmarkId,
        limit: request.limit,
        promptIds: request.promptIds,
        models: request.models
      });

      return finish({
        mode: request.mode,
        status: "accepted",
        answer: `Benchmark ${run.benchmarkName} started with ${run.totalPrompts} prompt(s).`,
        display: {
          title: "Benchmark started",
          summary: `Run ${run.id} is running ${run.totalPrompts} prompt(s).`,
          primaryText: `Benchmark ${run.benchmarkName} started.`,
          actionLabel: "View benchmark summary"
        },
        routing: {
          orchestrator: "benchmark_runner",
          provider: "openrouter",
          model: null,
          models: modelList(run.models),
          toolUsed: false,
          benchmarkId: run.benchmarkId
        },
        artifacts: [
          {
            kind: "benchmark_run",
            id: run.id,
            label: run.benchmarkName
          }
        ],
        data: run
      });
    }

    const local = await this.deps.localModelService.testPrompt(request.question, request.system);

    const response = finish({
      mode: request.mode,
      status: "completed",
      answer: local.response,
      display: {
        title: "Local model response",
        summary: compact(local.response),
        primaryText: local.response,
        actionLabel: null
      },
      routing: {
        orchestrator: "local_model_direct",
        provider: local.provider,
        model: local.model,
        models: [local.model],
        toolUsed: false,
        benchmarkId: null
      },
      artifacts: [],
      data: local
    });
    await this.deps.interactionLogStore?.safeAppend({
      scope: "local_model_test",
      source: "local_model",
      mode: request.mode,
      status: response.status,
      sessionId: null,
      artifactId: response.requestId,
      question: request.question,
      answer: response.answer,
      summary: response.display.summary,
      routing: {
        orchestrator: response.routing.orchestrator,
        provider: response.routing.provider,
        model: response.routing.model,
        category: null,
        toolUsed: response.routing.toolUsed
      },
      quality: {
        passed: true,
        score: null,
        issues: []
      },
      durationMs: response.durationMs,
      payload: {
        request,
        response
      }
    });
    return response;
  }
}

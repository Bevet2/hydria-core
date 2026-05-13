import test from "node:test";
import assert from "node:assert/strict";
import { HydriaCoreAskService } from "../services/core/hydriaCoreAskService.js";

function createService(overrides: Partial<ConstructorParameters<typeof HydriaCoreAskService>[0]> = {}) {
  const fail = async () => {
    throw new Error("unexpected orchestrator call");
  };

  return new HydriaCoreAskService({
    chatRuntimeService: { sendMessage: fail } as any,
    studentService: { answerOnly: fail, runSession: fail } as any,
    arenaRunner: { runRound: fail } as any,
    benchmarkService: { startRun: fail } as any,
    localModelService: { testPrompt: fail } as any,
    ...overrides
  } as any);
}

test("core ask routes chat questions through chat runtime and returns a coherent display response", async () => {
  let receivedMessage = "";
  const service = createService({
    chatRuntimeService: {
      async sendMessage(input: { message: string }) {
        receivedMessage = input.message;
        return {
          sessionId: "5f45d5b6-301a-4c98-a809-5c4d797d1a99",
          assistantMessage: {
            content: "Hydria repond depuis le runtime chat."
          },
          generation: {
            provider: "ollama",
            model: "qwen2.5:14b",
            attempts: [{ model: "qwen2.5:14b" }]
          },
          tooling: { used: false }
        };
      }
    } as any
  });

  const response = await service.ask({
    mode: "chat",
    question: "Explique Hydria."
  });

  assert.equal(receivedMessage, "Explique Hydria.");
  assert.equal(response.status, "completed");
  assert.equal(response.answer, "Hydria repond depuis le runtime chat.");
  assert.equal(response.routing.orchestrator, "chat_runtime");
  assert.equal(response.routing.model, "qwen2.5:14b");
  assert.equal(response.artifacts[0]?.kind, "chat_session");
});

test("core ask routes student preview through the student draft path", async () => {
  let skippedResearch = false;
  const service = createService({
    studentService: {
      async answerOnly(_question: string, options: { researchMode?: string }) {
        skippedResearch = options.researchMode === "skip";
        return {
          previewId: "5ef4b03e-7b88-4e7f-9639-a90279ed9991",
          student: {
            draft: {
              answer: "Draft local student.",
              confidence: 76
            },
            toolApplied: false
          },
          trace: {
            student: {
              finalProvider: "ollama",
              finalModel: "qwen2.5:3b"
            }
          }
        };
      }
    } as any
  });

  const response = await service.ask({
    mode: "student_preview",
    question: "Donne un brouillon."
  });

  assert.equal(skippedResearch, true);
  assert.equal(response.answer, "Draft local student.");
  assert.equal(response.routing.orchestrator, "student_preview");
  assert.equal(response.routing.provider, "ollama");
  assert.equal(response.artifacts[0]?.kind, "student_preview");
});

test("core ask starts benchmark runs as accepted async work", async () => {
  const service = createService({
    benchmarkService: {
      async startRun(input: { benchmarkId?: string; limit?: number }) {
        return {
          id: "bench-run-1",
          benchmarkId: input.benchmarkId ?? "core-benchmark-v2",
          benchmarkName: "Core Benchmark",
          totalPrompts: input.limit ?? 3,
          models: {
            respondentA: "a",
            respondentB: "b",
            redTeam: "r",
            judge: "j",
            synthesizer: "s"
          }
        };
      }
    } as any
  });

  const response = await service.ask({
    mode: "benchmark",
    question: "Lance le benchmark.",
    benchmarkId: "tool-benchmark-v1",
    limit: 2
  });

  assert.equal(response.status, "accepted");
  assert.equal(response.routing.orchestrator, "benchmark_runner");
  assert.equal(response.routing.benchmarkId, "tool-benchmark-v1");
  assert.equal(response.artifacts[0]?.kind, "benchmark_run");
});

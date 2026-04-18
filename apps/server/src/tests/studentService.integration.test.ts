import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudentPreviewNotFoundError, StudentService } from "../services/studentService.js";
import { StudentSessionStore } from "../services/studentSessionStore.js";
import {
  buildExecutionTrace,
  buildMemorySnapshot,
  buildOrchestration,
  buildRedTeamOutput,
  buildResearchLog,
  buildRuleImpact,
  buildStudentAnswer,
  buildStudentJudgeOutput,
  buildStudentStrategy,
  buildStrategyImpact,
  buildToolImpact,
  buildWorkflowRun
} from "./testFixtures.js";

test("student service persists answer -> analyze -> history with preview lifecycle", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-student-flow-"));
  let store: StudentSessionStore | null = null;
  try {
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    store = new StudentSessionStore(
      join(tempRoot, "student-history.json"),
      join(tempRoot, "student-cycles.jsonl"),
      databaseFile
    );

    (store as any).knowledgeMemoryService = { buildAndPersist: async () => undefined };
    (store as any).studentRuleImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentStrategyImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentToolImpactTrackerService = { buildAndPersist: async () => undefined };

    const question = "Explain eventual consistency with one practical example.";
    const rawDraft = buildStudentAnswer("Eventual consistency means replicas converge later.");
    const previewDraft = buildStudentAnswer(
      "Eventual consistency means replicas converge later, like a shopping cart syncing across regions."
    );
    const orchestration = buildOrchestration("technical_explanation");
    const research = buildResearchLog();
    const strategy = buildStudentStrategy();

    const service = new StudentService(
      {} as never,
      {} as never,
      {} as never,
      {
        finalizeImpact: ({ log }: { log: typeof research }) => log,
        finalizeRoundAccounting: (log: typeof research, durationMs: number) => ({
          ...log,
          durationMs
        })
      } as never,
      store
    );

    (service as any).preparationService = {
      async preparePreview() {
        return {
          startedAtIso: "2026-04-18T10:00:00.000Z",
          durationMs: 140,
          category: "technical_explanation",
          knowledge: null,
          strategy,
          baselineDraft: null,
          rawDraft,
          previewDraft,
          previewTrace: buildExecutionTrace("Preview trace"),
          orchestration,
          research,
          toolApplied: true
        };
      },
      async ensureAnalysisPreparation() {
        return {
          orchestration,
          research,
          toolApplied: true,
          finalStudentAnswer: previewDraft,
          finalStudentTrace: buildExecutionTrace("Analyze trace"),
          finalStudentRespondent: {
            modelRole: "respondent",
            answer: previewDraft.answer,
            key_points: previewDraft.key_points,
            assumptions: previewDraft.assumptions,
            confidence: previewDraft.confidence
          }
        };
      }
    };

    (service as any).studentStepExecutor = {
      async runStudentRedTeam() {
        return {
          output: buildRedTeamOutput(),
          trace: buildExecutionTrace("Red team trace"),
          durationMs: 25
        };
      },
      async runTeacher() {
        return {
          output: {
            modelRole: "refiner",
            improved_answer:
              "Use a shopping cart replicated across regions: updates may appear at different times, but replicas converge.",
            fixes_applied: ["Added a concrete cart replication example."],
            remaining_uncertainties: [],
            confidence: 8,
            routerSkipped: false
          },
          trace: buildExecutionTrace("Teacher trace"),
          durationMs: 35
        };
      },
      async runStudentJudge() {
        return {
          output: buildStudentJudgeOutput(),
          trace: buildExecutionTrace("Judge trace"),
          durationMs: 28
        };
      }
    };

    (service as any).impactMeasurementService = {
      async measureRuleImpact() {
        return buildRuleImpact();
      },
      async measureToolImpact() {
        return buildToolImpact();
      },
      async measureStrategyImpact() {
        return buildStrategyImpact();
      }
    };

    (service as any).hydriaCoreMemoryService = {
      buildStudentSnapshot({ question: snapshotQuestion, category }: { question: string; category: typeof orchestration.category }) {
        return buildMemorySnapshot(snapshotQuestion, category, strategy.strategyId);
      }
    };
    (service as any).hydriaCoreWorkflowService = {
      buildStudentPreviewRun() {
        return buildWorkflowRun("student_preview", question, "technical_explanation");
      },
      buildStudentSessionRun() {
        return buildWorkflowRun("student_session", question, "technical_explanation");
      }
    };
    (service as any).knowledgeInjectionService = {
      invalidateStudentLearningCaches() {}
    };

    const preview = await service.answerOnly(question);
    assert.equal(preview.question, question);
    assert.equal(preview.student.draft.answer, previewDraft.answer);
    assert.equal(preview.student.toolApplied, true);
    assert.equal(preview.workflow.scope, "student_preview");

    const session = await service.analyzePreview(preview.previewId);
    assert.equal(session.question, question);
    assert.equal(session.student.final.answer, previewDraft.answer);
    assert.equal(session.workflow.scope, "student_session");
    assert.equal(session.tooling.toolUsed, true);

    const storedSession = await store.getSession(session.sessionId);
    assert.ok(storedSession);
    assert.equal(storedSession?.sessionId, session.sessionId);

    const sessions = await store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.sessionId, session.sessionId);

    const summary = await store.getSummary();
    assert.equal(summary.totalSessions, 1);
    assert.equal(summary.latestSessionScore, session.progression.sessionScore);

    await assert.rejects(
      () => service.analyzePreview(preview.previewId),
      (error: unknown) => error instanceof StudentPreviewNotFoundError
    );
  } finally {
    await store?.close?.();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

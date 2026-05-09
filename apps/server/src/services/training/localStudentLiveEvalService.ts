import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LOCAL_STUDENT_LIVE_EVAL_PACK, type LocalStudentLiveEvalPrompt } from "../../data/localStudentLiveEvalPack.js";
import {
  localStudentLiveEvalSummarySchema,
  type LocalStudentLiveEvalItem,
  type LocalStudentLiveEvalSummary
} from "../../types/training.js";
import { OpenRouterService } from "../openrouter.js";
import { OrchestrationPolicyService } from "../orchestrationPolicy.js";
import { ResearchToolService } from "../researchToolService.js";
import { StudentService } from "../studentService.js";
import { StudentSessionStore } from "../studentSessionStore.js";
import { classifyQuestion } from "../questionClassifier.js";
import { LocalModelService } from "../localModel.js";

type RunLocalStudentLiveEvalArgs = {
  prompts?: LocalStudentLiveEvalPrompt[];
  limit?: number;
};

function percentage(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 1000) / 10;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function isPositiveToolImpact(value: LocalStudentLiveEvalItem["toolImpact"]) {
  return value === "improved_factual_accuracy" || value === "reduced_uncertainty";
}

export class LocalStudentLiveEvalService {
  private readonly openRouterService = new OpenRouterService();
  private readonly orchestrationPolicyService = new OrchestrationPolicyService();

  constructor(private readonly localModelService: LocalModelService) {}

  async run(args: RunLocalStudentLiveEvalArgs = {}): Promise<LocalStudentLiveEvalSummary> {
    const prompts = (args.prompts ?? LOCAL_STUDENT_LIVE_EVAL_PACK).slice(
      0,
      args.limit ?? LOCAL_STUDENT_LIVE_EVAL_PACK.length
    );
    const tempRoot = await mkdtemp(join(tmpdir(), "hydria-local-live-eval-"));
    const store = new StudentSessionStore(
      join(tempRoot, "student-sessions.json"),
      join(tempRoot, "student-cycles.jsonl"),
      join(tempRoot, "hydria-state.sqlite")
    );
    (store as any).knowledgeMemoryService = { buildAndPersist: async () => undefined };
    (store as any).studentRuleImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentStrategyImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentToolImpactTrackerService = { buildAndPersist: async () => undefined };

    const studentService = new StudentService(
      this.localModelService,
      this.openRouterService,
      this.orchestrationPolicyService,
      new ResearchToolService(),
      store
    );

    const items: LocalStudentLiveEvalItem[] = [];

    try {
      await studentService.ensureReady();

      for (const entry of prompts) {
        const category = classifyQuestion(entry.question);

        try {
          const session = await studentService.runSession(entry.question);
          items.push({
            id: entry.id,
            question: entry.question,
            category,
            verdict: session.judge.verdict,
            worthIt: session.judge.worthIt,
            sessionScore: session.progression.sessionScore,
            deltaOverall: session.progression.deltaOverall,
            toolUsed: session.tooling.toolUsed,
            toolImpact: session.tooling.toolImpact,
            durationMs: session.durationMs,
            error: null
          });
        } catch (error) {
          items.push({
            id: entry.id,
            question: entry.question,
            category,
            verdict: null,
            worthIt: null,
            sessionScore: null,
            deltaOverall: null,
            toolUsed: false,
            toolImpact: null,
            durationMs: 0,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } finally {
      await store.close();
      await rm(tempRoot, { recursive: true, force: true });
    }

    const completed = items.filter((item) => item.error === null);
    const toolUsedItems = completed.filter((item) => item.toolUsed);

    return localStudentLiveEvalSummarySchema.parse({
      total: items.length,
      completed: completed.length,
      failed: items.length - completed.length,
      averageSessionScore: average(
        completed.map((item) => item.sessionScore ?? 0)
      ),
      averageDeltaOverall: average(
        completed.map((item) => item.deltaOverall ?? 0)
      ),
      improvedRate: percentage(
        completed.filter((item) => item.verdict === "improved" || item.verdict === "minor").length,
        completed.length
      ),
      worthItRate: percentage(
        completed.filter((item) => item.worthIt === "YES").length,
        completed.length
      ),
      toolUsedRate: percentage(toolUsedItems.length, completed.length),
      positiveToolImpactRate: percentage(
        toolUsedItems.filter((item) => isPositiveToolImpact(item.toolImpact)).length,
        toolUsedItems.length
      ),
      averageDurationMs: average(completed.map((item) => item.durationMs)),
      items
    });
  }
}

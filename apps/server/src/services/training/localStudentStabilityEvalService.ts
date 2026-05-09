import { classifyQuestion } from "../questionClassifier.js";
import { KnowledgeInjectionService } from "../knowledgeInjectionService.js";
import { LocalModelService } from "../localModel.js";
import { StudentStrategySelectorService } from "../studentStrategySelector.js";
import {
  localStudentStabilitySummarySchema,
  type LocalStudentStabilityEvalItem,
  type LocalStudentStabilitySummary
} from "../../types/training.js";
import {
  LOCAL_STUDENT_LIVE_EVAL_PACK,
  type LocalStudentLiveEvalPrompt
} from "../../data/localStudentLiveEvalPack.js";
import { ToolRoutingService } from "../tools/toolRoutingService.js";

type RunLocalStudentStabilityArgs = {
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

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export class LocalStudentStabilityEvalService {
  private readonly knowledgeInjectionService = new KnowledgeInjectionService();
  private readonly studentStrategySelectorService = new StudentStrategySelectorService();
  private readonly toolRoutingService = new ToolRoutingService();

  constructor(private readonly localModelService: LocalModelService) {}

  async run(args: RunLocalStudentStabilityArgs = {}): Promise<LocalStudentStabilitySummary> {
    const prompts = (args.prompts ?? LOCAL_STUDENT_LIVE_EVAL_PACK).slice(
      0,
      args.limit ?? LOCAL_STUDENT_LIVE_EVAL_PACK.length
    );
    const items: LocalStudentStabilityEvalItem[] = [];

    for (const entry of prompts) {
      const category = classifyQuestion(entry.question);

      try {
        const knowledge = await this.knowledgeInjectionService.buildForCategory(category, {
          question: entry.question
        });
        const strategy = await this.studentStrategySelectorService.select({
          question: entry.question,
          category,
          knowledge
        });
        const toolRouting = this.toolRoutingService.route({
          question: entry.question,
          category
        });
        const result = await this.localModelService.answerQuestionDetailed({
          question: entry.question,
          category,
          strategy,
          knowledge,
          toolRouting
        });

        items.push({
          id: entry.id,
          question: entry.question,
          category,
          parseMode: result.parseMode,
          usedRetry: result.usedRetry,
          degraded: result.degraded,
          durationMs: result.durationMs,
          answerWordCount: countWords(result.output.answer),
          error: null
        });
      } catch (error) {
        items.push({
          id: entry.id,
          question: entry.question,
          category,
          parseMode: "error",
          usedRetry: false,
          degraded: true,
          durationMs: 0,
          answerWordCount: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const strictCount = items.filter((item) => item.parseMode === "strict").length;
    const repairedCount = items.filter((item) => item.parseMode === "repaired").length;
    const fallbackCount = items.filter((item) => item.parseMode === "fallback").length;
    const errorCount = items.filter((item) => item.parseMode === "error").length;

    return localStudentStabilitySummarySchema.parse({
      total: items.length,
      strictCount,
      repairedCount,
      fallbackCount,
      errorCount,
      strictRate: percentage(strictCount, items.length),
      repairedRate: percentage(repairedCount, items.length),
      fallbackRate: percentage(fallbackCount, items.length),
      retryRate: percentage(
        items.filter((item) => item.usedRetry).length,
        items.length
      ),
      averageDurationMs: average(items.map((item) => item.durationMs)),
      items
    });
  }
}

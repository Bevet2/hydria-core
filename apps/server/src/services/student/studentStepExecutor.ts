import {
  buildStudentJudgeSystemPrompt,
  buildStudentJudgeUserPrompt
} from "../../prompts/judge.js";
import {
  buildRefineRepairUserPrompt,
  buildRefineSystemPrompt,
  buildRefineUserPrompt
} from "../../prompts/refine.js";
import {
  buildStudentRedTeamUserPrompt,
  buildRedTeamSystemPrompt
} from "../../prompts/redteam.js";
import type {
  ExecutionTrace,
  QuestionCategory,
  RedTeamOutput,
  RefinerOutput,
  ResearchToolLog,
  RespondentOutput
} from "../../types/arena.js";
import { redTeamOutputSchema } from "../../types/arena.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import {
  studentJudgeOutputSchema,
  type StudentJudgeOutput
} from "../../types/student.js";
import { logger } from "../../utils/logger.js";
import { env, defaultArenaModels } from "../../utils/env.js";
import { parseStructuredOutput } from "../../utils/jsonRepair.js";
import { parseRefinerOutput } from "../../utils/refineOutput.js";
import { executeOpenRouterStructuredStep } from "../arena/openRouterStructuredStep.js";
import { OpenRouterService } from "../openrouter.js";

export type StudentStepResult<T> = {
  output: T;
  trace: ExecutionTrace;
  durationMs: number;
};

function buildOpenRouterTrace(model: string, note: string): ExecutionTrace {
  return {
    requestedProvider: "openrouter",
    requestedModel: model,
    attempts: [
      {
        provider: "openrouter",
        model,
        mode: "primary"
      }
    ],
    finalProvider: "openrouter",
    finalModel: model,
    usedRetry: false,
    usedFallback: false,
    validationFailures: 0,
    outcome: "success",
    note
  };
}

function buildTeacherFallback(
  respondent: RespondentOutput,
  category: QuestionCategory,
  error?: unknown
): RefinerOutput {
  return {
    modelRole: "refiner",
    improved_answer: respondent.answer,
    fixes_applied: [],
    remaining_uncertainties: [
      `Teacher refinement failed for ${category}, so the student answer was preserved.`,
      ...(error ? [`Last teacher error: ${String(error)}`] : []),
      ...respondent.assumptions.slice(0, 2)
    ],
    confidence: Math.max(0, Math.min(10, Math.round(respondent.confidence / 10))),
    routerSkipped: false
  };
}

export class StudentStepExecutor {
  constructor(private readonly openRouterService: OpenRouterService) {}

  async runStudentRedTeam(
    question: string,
    category: QuestionCategory,
    studentAnswer: RespondentOutput
  ): Promise<StudentStepResult<RedTeamOutput>> {
    const result = await this.openRouterService.completeJson({
      model: defaultArenaModels.redTeam,
      systemPrompt: buildRedTeamSystemPrompt(category),
      userPrompt: buildStudentRedTeamUserPrompt({
        category,
        question,
        studentAnswer
      }),
      schema: redTeamOutputSchema,
      label: "Student Red Team",
      maxTokens: 700,
      temperature: 0.1
    });

    return {
      output: result.parsed,
      trace: buildOpenRouterTrace(
        defaultArenaModels.redTeam,
        "Primary OpenRouter student red-team analysis produced validated JSON."
      ),
      durationMs: result.latencyMs
    };
  }

  async runTeacher(args: {
    question: string;
    category: QuestionCategory;
    student: RespondentOutput;
    redTeam: RedTeamOutput;
    research: ResearchToolLog;
    knowledge: KnowledgeInjection | null;
  }): Promise<StudentStepResult<RefinerOutput>> {
    const result = await executeOpenRouterStructuredStep({
      openRouterService: this.openRouterService,
      primaryModel: defaultArenaModels.respondentA,
      fallbackModels: this.filterFallbackModels([
        env.ARENA_REFINE_FALLBACK_MODEL,
        defaultArenaModels.judge,
        defaultArenaModels.redTeam
      ], [defaultArenaModels.respondentA]),
      systemPrompt: buildRefineSystemPrompt(args.category),
      buildPrimaryUserPrompt: () =>
        buildRefineUserPrompt({
          question: args.question,
          slot: "A",
          category: args.category,
          originalResponse: args.student,
          redTeam: args.redTeam,
          research: args.research,
          knowledge: args.knowledge
        }),
      buildRepairUserPrompt: ({ previousResponse, validationIssues }) =>
        buildRefineRepairUserPrompt({
          question: args.question,
          slot: "A",
          category: args.category,
          originalResponse: args.student,
          redTeam: args.redTeam,
          previousResponse,
          validationIssues,
          research: args.research,
          knowledge: args.knowledge
        }),
      parse: (raw) =>
        parseRefinerOutput({
          raw,
          label: "Teacher",
          category: args.category,
          originalResponse: args.student
        }),
      maxTokens: args.category === "product_strategy" ? 560 : 900,
      primaryTemperature: 0.15,
      countValidationFailure: () => true,
      getValidationIssues: (error) => [error instanceof Error ? error.message : String(error)],
      onAttemptFailure: ({ model, primaryModel, nextModel, attempt, error, isLastAttempt, index }) =>
        logger.warn(
          isLastAttempt
            ? "Teacher attempt failed with no more models available"
            : index === 0
              ? "Teacher attempt failed; retrying with repair prompt"
              : "Teacher attempt failed; retrying with fallback model",
          {
            model,
            primaryModel,
            nextModel,
            attempt,
            error: String(error)
          }
        ),
      onRetryFailure: ({ model, nextModel, error }) =>
        logger.warn("Teacher repair retry failed", {
          model,
          nextModel,
          error: String(error)
        }),
      onFallbackSuccess: ({ model, primaryModel, attempt }) =>
        logger.info("Teacher fallback succeeded", {
          fallbackModel: model,
          primaryModel,
          attempt
        })
    });

    if (result.status === "failure") {
      return {
        output: buildTeacherFallback(args.student, args.category, result.lastError),
        trace: {
          requestedProvider: "openrouter",
          requestedModel: defaultArenaModels.respondentA,
          attempts: result.attempts,
          finalProvider: "fallback",
          finalModel: "student-answer-preserved",
          usedRetry: result.usedRetry,
          usedFallback: true,
          validationFailures: result.validationFailures,
          outcome: "static_fallback",
          note: `Teacher failed to refine the student answer for ${args.category}; the original student answer was preserved.`
        },
        durationMs: result.durationMs
      };
    }

    return {
      output: result.output,
      trace: {
        requestedProvider: "openrouter",
        requestedModel: defaultArenaModels.respondentA,
        attempts: result.attempts,
        finalProvider: "openrouter",
        finalModel: result.finalModel,
        usedRetry: result.usedRetry,
        usedFallback: result.usedFallback,
        validationFailures: result.validationFailures,
        outcome: result.usedFallback ? "fallback_success" : result.usedRetry ? "retry_success" : "success",
        note: result.usedFallback
          ? `Teacher fallback model produced the corrected answer for ${args.category}.`
          : result.usedRetry
            ? `Teacher repair retry produced the corrected answer for ${args.category}.`
            : `Primary teacher refinement produced the corrected answer for ${args.category}.`
      },
      durationMs: result.durationMs
    };
  }

  async runStudentJudge(args: {
    question: string;
    category: QuestionCategory;
    student: RespondentOutput;
    teacher: RefinerOutput;
    redTeam: RedTeamOutput;
  }): Promise<StudentStepResult<StudentJudgeOutput>> {
    const result = await this.openRouterService.complete({
      model: defaultArenaModels.judge,
      systemPrompt: buildStudentJudgeSystemPrompt(args.category),
      userPrompt: buildStudentJudgeUserPrompt({
        category: args.category,
        question: args.question,
        studentAnswer: args.student,
        teacherAnswer: args.teacher,
        redTeam: args.redTeam
      }),
      maxTokens: 700,
      temperature: 0.1
    });
    const parsed = parseStructuredOutput(
      result.content,
      studentJudgeOutputSchema,
      "Student judge"
    ) as StudentJudgeOutput;

    return {
      output: parsed,
      trace: buildOpenRouterTrace(
        defaultArenaModels.judge,
        "Primary OpenRouter student-judge analysis produced validated JSON."
      ),
      durationMs: result.latencyMs
    };
  }

  private filterFallbackModels(candidates: string[], exclude: string[] = []) {
    const excluded = new Set(exclude);
    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        !excluded.has(candidate) &&
        list.indexOf(candidate) === index
    );
  }
}

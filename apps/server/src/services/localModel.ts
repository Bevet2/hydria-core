import { buildLocalStudentPrompt, localStudentSystemPrompt } from "../prompts/localStudent.js";
import {
  buildStudentAnswerPrompt,
  buildStudentAnswerRepairPrompt,
  studentDirectSystemPrompt
} from "../prompts/localStudent.js";
import type {
  JudgeOutput,
  QuestionCategory,
  RefinerOutput,
  ResearchToolLog,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../types/arena.js";
import type { KnowledgeInjection } from "../types/knowledge.js";
import {
  localModelHealthSchema,
  localModelTestResponseSchema,
  localStudentOutputSchema,
  type LocalModelHealth,
  type LocalModelTestResponse,
  type LocalStudentOutput
} from "../types/localModel.js";
import { parseStructuredOutput } from "../utils/jsonRepair.js";
import {
  studentAnswerSchema,
  type StudentAnswer,
  type StudentResponseStrategy
} from "../types/student.js";
import { env } from "../utils/env.js";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
  }>;
};

type OllamaGenerateResponse = {
  response?: string;
};

type LocalObservationArgs = {
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
  refineA: RefinerOutput;
  refineB: RefinerOutput;
  judge: JudgeOutput;
  synthesizer: SynthesizerOutput;
};

export class LocalModelService {
  async healthcheck(): Promise<LocalModelHealth> {
    const checkedAt = new Date().toISOString();

    try {
      const response = await fetch(`${env.LOCAL_MODEL_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(Math.min(env.LOCAL_MODEL_TIMEOUT_MS, 8000))
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const payload = (await response.json()) as OllamaTagsResponse;
      const availableModels = (payload.models ?? [])
        .map((model) => model.name)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => left.localeCompare(right));

      return localModelHealthSchema.parse({
        provider: "ollama",
        baseUrl: env.LOCAL_MODEL_BASE_URL,
        model: env.LOCAL_MODEL_NAME,
        reachable: true,
        installed: availableModels.includes(env.LOCAL_MODEL_NAME),
        availableModels,
        checkedAt,
        message: availableModels.includes(env.LOCAL_MODEL_NAME)
          ? "Dedicated project Ollama endpoint reachable and model installed."
          : "Dedicated project Ollama endpoint reachable but the selected model is not installed yet."
      });
    } catch (error) {
      return localModelHealthSchema.parse({
        provider: "ollama",
        baseUrl: env.LOCAL_MODEL_BASE_URL,
        model: env.LOCAL_MODEL_NAME,
        reachable: false,
        installed: false,
        availableModels: [],
        checkedAt,
        message: `Local model endpoint unavailable: ${String(error)}`
      });
    }
  }

  async testPrompt(prompt: string, system?: string): Promise<LocalModelTestResponse> {
    const startedAt = Date.now();
    const response = await fetch(`${env.LOCAL_MODEL_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.LOCAL_MODEL_NAME,
        system,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 320
        }
      }),
      signal: AbortSignal.timeout(env.LOCAL_MODEL_TIMEOUT_MS)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local model returned ${response.status}: ${errorText}`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    return localModelTestResponseSchema.parse({
      model: env.LOCAL_MODEL_NAME,
      provider: "ollama",
      response: payload.response?.trim() || "",
      durationMs: Date.now() - startedAt
    });
  }

  async observeRoundDetailed(args: LocalObservationArgs) {
    const prompt = buildLocalStudentPrompt(args);
    const response = await this.testPrompt(prompt, localStudentSystemPrompt);
    return {
      output: parseStructuredOutput(
        response.response,
        localStudentOutputSchema,
        "Local student model"
      ),
      durationMs: response.durationMs,
      raw: response.response
    };
  }

  async observeRound(args: LocalObservationArgs): Promise<LocalStudentOutput> {
    const result = await this.observeRoundDetailed(args);
    return result.output;
  }

  async answerQuestionDetailed(args: {
    question: string;
    category: QuestionCategory;
    strategy: StudentResponseStrategy;
    knowledge?: KnowledgeInjection | null;
    research?: ResearchToolLog | null;
  }) {
    let previousResponse = "";
    let lastError: unknown = null;

    try {
      const primary = await this.testPrompt(
        buildStudentAnswerPrompt(args),
        studentDirectSystemPrompt
      );
      previousResponse = primary.response;
      return {
        output: parseStructuredOutput(
          primary.response,
          studentAnswerSchema,
          "Local student direct answer"
        ),
        durationMs: primary.durationMs,
        raw: primary.response,
        usedRetry: false
      };
    } catch (error) {
      lastError = error;
    }

    const repair = await this.testPrompt(
      buildStudentAnswerRepairPrompt({
        question: args.question,
        category: args.category,
        strategy: args.strategy,
        previousResponse: previousResponse || "(empty response)",
        validationIssues: this.getValidationIssues(lastError),
        knowledge: args.knowledge,
        research: args.research
      }),
      studentDirectSystemPrompt
    );
    previousResponse = repair.response;

    return {
      output: parseStructuredOutput(
        repair.response,
        studentAnswerSchema,
        "Local student direct answer"
      ),
      durationMs: repair.durationMs,
      raw: repair.response,
      usedRetry: true
    };
  }

  async answerQuestion(args: {
    question: string;
    category: QuestionCategory;
    strategy: StudentResponseStrategy;
    knowledge?: KnowledgeInjection | null;
    research?: ResearchToolLog | null;
  }): Promise<StudentAnswer> {
    const result = await this.answerQuestionDetailed(args);
    return result.output;
  }

  private getValidationIssues(error: unknown) {
    if (error instanceof Error) {
      return [error.message];
    }

    return [String(error)];
  }
}

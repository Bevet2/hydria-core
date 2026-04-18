import type {
  ArenaRunRequest,
  JudgeOutput,
  QuestionCategory,
  RefinerOutput,
  ResearchToolLog,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../../types/arena.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import { LocalModelService } from "../localModel.js";
import { OpenRouterService } from "../openrouter.js";
import { ArenaLocalStudentExecutor } from "./arenaLocalStudentExecutor.js";
import { ArenaRespondentExecutor } from "./arenaRespondentExecutor.js";
import { ArenaStructuredStepExecutor } from "./arenaStructuredStepExecutor.js";

export class ArenaStepExecutor {
  private readonly respondentExecutor: ArenaRespondentExecutor;
  private readonly structuredStepExecutor: ArenaStructuredStepExecutor;
  private readonly localStudentExecutor: ArenaLocalStudentExecutor;

  constructor(
    openRouterService: OpenRouterService,
    localModelService: LocalModelService
  ) {
    this.respondentExecutor = new ArenaRespondentExecutor(openRouterService);
    this.structuredStepExecutor = new ArenaStructuredStepExecutor(openRouterService);
    this.localStudentExecutor = new ArenaLocalStudentExecutor(openRouterService, localModelService);
  }

  runRespondents(args: {
    question: string;
    models: ArenaRunRequest["models"];
    category: QuestionCategory;
  }) {
    return this.respondentExecutor.runRespondents(args);
  }

  runJudgeStep(args: {
    question: string;
    category: QuestionCategory;
    primaryModel: string;
    fallbackModels: string[];
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    redTeam: RedTeamOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
  }) {
    return this.structuredStepExecutor.runJudgeStep(args);
  }

  runSynthesizerStep(args: {
    question: string;
    primaryModel: string;
    fallbackModels: string[];
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
    redTeam: RedTeamOutput;
    judge: JudgeOutput;
  }) {
    return this.structuredStepExecutor.runSynthesizerStep(args);
  }

  runRefinement(args: {
    slot: "A" | "B";
    question: string;
    category: QuestionCategory;
    primaryModel: string;
    fallbackModels: string[];
    respondent: RespondentOutput;
    redTeam: RedTeamOutput;
    research?: ResearchToolLog | null;
    knowledge?: KnowledgeInjection | null;
  }) {
    return this.structuredStepExecutor.runRefinement(args);
  }

  buildSkippedRefinement(
    respondent: RespondentOutput,
    slot: "A" | "B",
    category: QuestionCategory,
    requestedModel: string,
    reason: string
  ) {
    return this.structuredStepExecutor.buildSkippedRefinement(
      respondent,
      slot,
      category,
      requestedModel,
      reason
    );
  }

  applyRouterSkippedJudgeScores(
    judgeOutput: JudgeOutput,
    router: Awaited<ReturnType<import("../refineRouter.js").RefineRouterService["decide"]>>
  ) {
    return this.structuredStepExecutor.applyRouterSkippedJudgeScores(judgeOutput, router);
  }

  resolveRefinementFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    return this.structuredStepExecutor.resolveRefinementFallbackModels(primaryModel, models);
  }

  resolveJudgeFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    return this.structuredStepExecutor.resolveJudgeFallbackModels(primaryModel, models);
  }

  resolveSynthesizerFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    return this.structuredStepExecutor.resolveSynthesizerFallbackModels(primaryModel, models);
  }

  runLocalStudentObservation(args: {
    roundId: string;
    question: string;
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    redTeam: RedTeamOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
    judge: JudgeOutput;
    synthesizer: SynthesizerOutput;
    fallbackModels: string[];
  }) {
    return this.localStudentExecutor.runLocalStudentObservation(args);
  }

  resolveLocalStudentFallbackModels(models: ArenaRunRequest["models"]) {
    return this.localStudentExecutor.resolveLocalStudentFallbackModels(models);
  }
}

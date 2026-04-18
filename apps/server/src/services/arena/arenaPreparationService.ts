import { buildRedTeamSystemPrompt, buildRedTeamUserPrompt } from "../../prompts/redteam.js";
import {
  redTeamOutputSchema,
  type ArenaRunRequest,
  type ExecutionTrace,
  type QuestionCategory,
  type RedTeamOutput
} from "../../types/arena.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type { OpenRouterService } from "../openrouter.js";
import type { OrchestrationPolicyService } from "../orchestrationPolicy.js";
import type { RefineRouterService } from "../refineRouter.js";
import type { KnowledgeInjectionService } from "../knowledgeInjectionService.js";
import type { ResearchToolService } from "../researchToolService.js";
import { buildOpenRouterTrace, type RespondentExecutionResult } from "./arenaExecutionTypes.js";

export type ArenaPreparationResult = {
  redTeamOutput: RedTeamOutput;
  redTeamTrace: ExecutionTrace;
  redTeamDurationMs: number;
  orchestration: Awaited<ReturnType<OrchestrationPolicyService["planRound"]>>;
  router: Awaited<ReturnType<RefineRouterService["decide"]>>;
  knowledgeInjection: KnowledgeInjection | null;
  researchBeforeRefine: Awaited<ReturnType<ResearchToolService["maybeCollect"]>>;
};

export class ArenaPreparationService {
  constructor(
    private readonly openRouterService: Pick<OpenRouterService, "completeJson">,
    private readonly orchestrationPolicyService: Pick<OrchestrationPolicyService, "planRound">,
    private readonly refineRouterService: Pick<RefineRouterService, "decide">,
    private readonly knowledgeInjectionService: Pick<KnowledgeInjectionService, "buildForCategory">,
    private readonly researchToolService: Pick<ResearchToolService, "maybeCollect">
  ) {}

  async prepareRound(args: {
    question: string;
    models: ArenaRunRequest["models"];
    category: QuestionCategory;
    respondentAResult: RespondentExecutionResult;
    respondentBResult: RespondentExecutionResult;
  }): Promise<ArenaPreparationResult> {
    const redTeamResult = await this.openRouterService.completeJson({
      model: args.models.redTeam,
      systemPrompt: buildRedTeamSystemPrompt(args.category),
      userPrompt: buildRedTeamUserPrompt({
        category: args.category,
        question: args.question,
        respondentA: args.respondentAResult.parsed,
        respondentB: args.respondentBResult.parsed
      }),
      schema: redTeamOutputSchema,
      label: "Red Team",
      maxTokens: 800,
      temperature: 0.1
    });
    const redTeamTrace = buildOpenRouterTrace(
      args.models.redTeam,
      "Primary OpenRouter red-team step produced validated JSON."
    );
    const orchestration = await this.orchestrationPolicyService.planRound({
      question: args.question,
      category: args.category,
      respondentA: args.respondentAResult.parsed,
      respondentB: args.respondentBResult.parsed,
      redTeam: redTeamResult.parsed
    });
    const router = await this.refineRouterService.decide(
      {
        question: args.question,
        respondentA: args.respondentAResult.parsed,
        respondentB: args.respondentBResult.parsed,
        redTeam: redTeamResult.parsed
      },
      orchestration
    );
    const knowledgeInjection = await this.knowledgeInjectionService.buildForCategory(router.category, {
      question: args.question
    });
    const researchBeforeRefine = await this.researchToolService.maybeCollect({
      question: args.question,
      category: router.category,
      respondentA: args.respondentAResult.parsed,
      respondentB: args.respondentBResult.parsed,
      redTeam: redTeamResult.parsed,
      shouldRefineA: router.shouldRefineA,
      shouldRefineB: router.shouldRefineB,
      orchestration
    });

    return {
      redTeamOutput: redTeamResult.parsed,
      redTeamTrace,
      redTeamDurationMs: redTeamResult.latencyMs,
      orchestration,
      router,
      knowledgeInjection,
      researchBeforeRefine
    };
  }
}

import {
  getModelCapabilityManifestById,
  type ModelCapabilityId,
  type ModelCapabilityManifest,
  type ModelCapabilityRole,
  type ModelProviderKind
} from "../../data/modelCapabilityManifest.js";
import {
  modelRoutingEconomicsEvalPack,
  type ChatRoutingFixture,
  type ModelRoutingEconomicsEvalCase
} from "../../data/modelRoutingEconomicsEvalPack.js";
import {
  buildActiveConstraintCapsule,
  createInitialState,
  type ActiveConstraintCapsule,
  type ConversationLanguage,
  type ConversationState
} from "../context/contextStateTracker.js";
import { decideMultiTurnAnswerPolicy } from "../context/multiTurnAnswerPolicy.js";
import { ModelBudgetPolicyService, modelCostRank } from "./modelBudgetPolicy.js";
import { ModelCapabilityService } from "./modelCapabilityService.js";
import {
  selectStudentChatModelRoute,
  type StudentChatModelRoute
} from "../studentChatModelRouter.js";
import type { ModelExecutionPlanInput } from "./modelProviderService.js";

export type ModelRoutingGovernanceStatus = "passed" | "failed";

export type ModelRoutingGovernanceResult = {
  id: string;
  surface: ModelRoutingEconomicsEvalCase["surface"];
  priority: ModelRoutingEconomicsEvalCase["priority"];
  description: string;
  selectedCapabilityId: ModelCapabilityId;
  selectedRole: ModelCapabilityRole;
  selectedModelId: string;
  provider: ModelProviderKind;
  estimatedCostUnits: number;
  pipelineCapabilityIds: ModelCapabilityId[];
  status: ModelRoutingGovernanceStatus;
  issues: string[];
  tags: string[];
};

export type ModelRoutingEconomicsGateReport = {
  version: "hydria-model-routing-economics-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    totalCases: number;
    passed: number;
    failed: number;
    criticalFailures: number;
    averageEstimatedCostUnits: number;
    maxEstimatedCostUnits: number;
    highCostRoutes: number;
    unnecessaryEscalations: number;
    localOnlyViolations: number;
    roleBreakdown: Record<ModelCapabilityRole, number>;
  };
  results: ModelRoutingGovernanceResult[];
  recommendations: string[];
};

const providerCostMultiplier: Record<ModelProviderKind, number> = {
  ollama: 0.2,
  embedding_runtime: 0.2,
  vllm: 1,
  openai_compatible: 3,
  openrouter: 4
};

const localProviderPreference: ModelProviderKind[] = ["embedding_runtime", "ollama", "vllm"];

function isLocalProvider(provider: ModelProviderKind) {
  return provider === "ollama" || provider === "vllm" || provider === "embedding_runtime";
}

function providerForModel(model: ModelCapabilityManifest, preferredProvider?: ModelProviderKind | null) {
  if (preferredProvider && model.providerKinds.includes(preferredProvider)) {
    return preferredProvider;
  }
  return (
    localProviderPreference.find((provider) => model.providerKinds.includes(provider)) ??
    model.providerKinds[0] ??
    "ollama"
  );
}

function modelIdForProvider(model: ModelCapabilityManifest, provider: ModelProviderKind) {
  return model.providerModelIds[provider] ?? model.id;
}

function estimateCostUnits(model: ModelCapabilityManifest, provider: ModelProviderKind, maxTokens = 512) {
  const tokenFactor = Math.max(1, Math.ceil(maxTokens / 512));
  return Number((modelCostRank[model.costTier] * providerCostMultiplier[provider] * tokenFactor).toFixed(2));
}

function roleFromChatRoute(route: StudentChatModelRoute): ModelCapabilityRole {
  return route.specialistRole;
}

function normalizeLanguage(language: ChatRoutingFixture["language"]): ConversationLanguage {
  return language ?? "unknown";
}

function stateFromChatFixture(fixture: ChatRoutingFixture): ConversationState {
  return {
    ...createInitialState(),
    userGoal: fixture.userGoal ?? null,
    constraints: fixture.topConstraints ?? [],
    changedContext: fixture.changedConstraints ?? [],
    contradictions: fixture.discardedAssumptions ?? [],
    openQuestions: fixture.decisionNeeded ? ["decision needed"] : [],
    language: normalizeLanguage(fixture.language)
  };
}

function capsuleFromFixture(fixture: ChatRoutingFixture) {
  const state = stateFromChatFixture(fixture);
  const userMessage = fixture.userMessage ?? fixture.routingQuestion;
  const base = buildActiveConstraintCapsule(state, userMessage);
  return {
    ...base,
    topConstraints: fixture.topConstraints ?? base.topConstraints,
    blockingConstraints: fixture.topConstraints ?? base.blockingConstraints,
    changedConstraints: fixture.changedConstraints ?? base.changedConstraints,
    discardedAssumptions: fixture.discardedAssumptions ?? base.discardedAssumptions,
    decisionNeeded: fixture.decisionNeeded ?? base.decisionNeeded,
    recommendedDirection: fixture.recommendedDirection ?? base.recommendedDirection,
    language: normalizeLanguage(fixture.language)
  } satisfies ActiveConstraintCapsule;
}

function chatPipelineCapabilityIds(route: StudentChatModelRoute) {
  const ids: ModelCapabilityId[] = ["phi-mini-router", route.capabilityId];
  if (route.capabilityId === "deepseek-r1-distill-qwen-reasoner") {
    ids.push("qwen-14b-instruct-main");
  }
  return [...new Set(ids)];
}

function buildChatRoute(caseDef: ModelRoutingEconomicsEvalCase) {
  if (!caseDef.chat) {
    throw new Error(`Gate case ${caseDef.id} is missing chat input.`);
  }
  const fixture = caseDef.chat;
  const state = stateFromChatFixture(fixture);
  const capsule = capsuleFromFixture(fixture);
  const userMessage = fixture.userMessage ?? fixture.routingQuestion;
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: userMessage,
    category: fixture.category,
    toolRouting: null,
    lastAssistantAnswer: ""
  });
  const route = selectStudentChatModelRoute({
    routingQuestion: fixture.routingQuestion,
    userMessage,
    runtimeMode: fixture.runtimeMode ?? "direct",
    category: fixture.category,
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    requiresExternalGrounding: fixture.requiresExternalGrounding ?? false
  });
  const manifest = getModelCapabilityManifestById(route.capabilityId);
  if (!manifest) {
    throw new Error(`Unknown chat capability ${route.capabilityId}.`);
  }
  const provider: ModelProviderKind = "ollama";
  return {
    selectedCapabilityId: route.capabilityId,
    selectedRole: roleFromChatRoute(route),
    selectedModelId: route.modelName,
    provider,
    estimatedCostUnits: estimateCostUnits(manifest, provider),
    pipelineCapabilityIds: chatPipelineCapabilityIds(route)
  };
}

function selectProviderPlanModel(
  input: ModelExecutionPlanInput,
  capabilityService: ModelCapabilityService,
  budgetPolicyService: ModelBudgetPolicyService
) {
  const selection = capabilityService.selectModel(input);
  const budget = budgetPolicyService.evaluate({
    purpose: selection.inferredPurpose,
    selected: selection.selected,
    fallbacks: selection.fallbacks,
    budget: {
      ...input.budget,
      requestedMaxTokens: input.maxTokens ?? input.budget?.requestedMaxTokens ?? null,
      preferredProvider: input.preferredProvider ?? input.budget?.preferredProvider ?? null
    }
  });
  const selected =
    budget.selectedModel ??
    selection.selected;
  const provider = providerForModel(selected, input.preferredProvider);
  const maxTokens =
    input.maxTokens ??
    input.budget?.requestedMaxTokens ??
    input.budget?.maxOutputTokens ??
    512;

  return {
    selectedCapabilityId: selected.id,
    selectedRole: selected.role,
    selectedModelId: modelIdForProvider(selected, provider),
    provider,
    estimatedCostUnits: estimateCostUnits(selected, provider, maxTokens),
    pipelineCapabilityIds: selection.pipeline.map((model) => model.id)
  };
}

function buildIssues(
  caseDef: ModelRoutingEconomicsEvalCase,
  result: Omit<ModelRoutingGovernanceResult, "id" | "surface" | "priority" | "description" | "status" | "issues" | "tags">
) {
  const issues: string[] = [];
  const expected = caseDef.expected;
  const selectedManifest = getModelCapabilityManifestById(result.selectedCapabilityId);

  if (result.selectedCapabilityId !== expected.capabilityId) {
    issues.push(`unexpected_capability:${result.selectedCapabilityId}`);
  }
  if (result.selectedRole !== expected.role) {
    issues.push(`unexpected_role:${result.selectedRole}`);
  }
  if (expected.forbiddenCapabilityIds?.includes(result.selectedCapabilityId)) {
    issues.push(`forbidden_capability_selected:${result.selectedCapabilityId}`);
  }
  if (expected.mustIncludeCapabilityIds) {
    for (const required of expected.mustIncludeCapabilityIds) {
      if (!result.pipelineCapabilityIds.includes(required)) {
        issues.push(`missing_pipeline_capability:${required}`);
      }
    }
  }
  if (expected.localOnly && !isLocalProvider(result.provider)) {
    issues.push(`local_only_violation:${result.provider}`);
  }
  if (expected.allowDeepReasoning === false && result.selectedRole === "deep_reasoner") {
    issues.push("unnecessary_deep_reasoning_escalation");
  }
  if (
    expected.maxCostTier &&
    selectedManifest &&
    modelCostRank[selectedManifest.costTier] > modelCostRank[expected.maxCostTier]
  ) {
    issues.push(`cost_tier_exceeded:${selectedManifest.costTier}`);
  }
  if (
    typeof expected.maxEstimatedCostUnits === "number" &&
    result.estimatedCostUnits > expected.maxEstimatedCostUnits
  ) {
    issues.push(`estimated_cost_exceeded:${result.estimatedCostUnits}`);
  }

  return issues;
}

export class ModelRoutingGovernanceService {
  private readonly capabilityService: ModelCapabilityService;
  private readonly budgetPolicyService: ModelBudgetPolicyService;

  constructor(options: {
    capabilityService?: ModelCapabilityService;
    budgetPolicyService?: ModelBudgetPolicyService;
  } = {}) {
    this.capabilityService = options.capabilityService ?? new ModelCapabilityService();
    this.budgetPolicyService =
      options.budgetPolicyService ??
      new ModelBudgetPolicyService({
        executionEnabled: true,
        allowCloud: false,
        maxCostTier: "high"
      });
  }

  evaluateCase(caseDef: ModelRoutingEconomicsEvalCase): ModelRoutingGovernanceResult {
    const route =
      caseDef.surface === "chat_route"
        ? buildChatRoute(caseDef)
        : selectProviderPlanModel(
            caseDef.providerPlan ?? {},
            this.capabilityService,
            this.budgetPolicyService
          );
    const issues = buildIssues(caseDef, route);

    return {
      id: caseDef.id,
      surface: caseDef.surface,
      priority: caseDef.priority,
      description: caseDef.description,
      ...route,
      status: issues.length > 0 ? "failed" : "passed",
      issues,
      tags: caseDef.tags
    };
  }

  buildReport(cases: readonly ModelRoutingEconomicsEvalCase[] = modelRoutingEconomicsEvalPack): ModelRoutingEconomicsGateReport {
    const results = cases.map((caseDef) => this.evaluateCase(caseDef));
    const failed = results.filter((result) => result.status === "failed");
    const totalCost = results.reduce((sum, result) => sum + result.estimatedCostUnits, 0);
    const roleBreakdown = results.reduce<Record<ModelCapabilityRole, number>>((breakdown, result) => {
      breakdown[result.selectedRole] = (breakdown[result.selectedRole] ?? 0) + 1;
      return breakdown;
    }, {} as Record<ModelCapabilityRole, number>);

    return {
      version: "hydria-model-routing-economics-gate-v1",
      generatedAt: new Date().toISOString(),
      passed: failed.length === 0,
      summary: {
        totalCases: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        criticalFailures: failed.filter((result) => result.priority === "critical").length,
        averageEstimatedCostUnits: Number((totalCost / Math.max(1, results.length)).toFixed(2)),
        maxEstimatedCostUnits: Math.max(...results.map((result) => result.estimatedCostUnits)),
        highCostRoutes: results.filter((result) => result.selectedRole === "deep_reasoner").length,
        unnecessaryEscalations: results.filter((result) =>
          result.issues.includes("unnecessary_deep_reasoning_escalation")
        ).length,
        localOnlyViolations: results.filter((result) =>
          result.issues.some((issue) => issue.startsWith("local_only_violation"))
        ).length,
        roleBreakdown
      },
      results,
      recommendations: this.buildRecommendations(results)
    };
  }

  private buildRecommendations(results: readonly ModelRoutingGovernanceResult[]) {
    const failed = results.filter((result) => result.status === "failed");
    if (failed.length === 0) {
      return [
        "Keep OpenRouter reserved for training/evaluation; public chat routes remain local-first.",
        "Use this gate before watcher expansion or role-specific training.",
        "Add new cases whenever production traces show unnecessary escalation or wrong specialist selection."
      ];
    }
    const recommendations = [
      "Fix model routing governance before expanding watchers or starting specialist training."
    ];
    if (failed.some((result) => result.issues.includes("unnecessary_deep_reasoning_escalation"))) {
      recommendations.push("Tighten deep reasoning triggers so simple explanations stay on Qwen 14B.");
    }
    if (failed.some((result) => result.issues.some((issue) => issue.startsWith("forbidden_capability_selected")))) {
      recommendations.push("Review specialist keyword routing; a forbidden role was selected for at least one case.");
    }
    if (failed.some((result) => result.issues.some((issue) => issue.startsWith("estimated_cost_exceeded")))) {
      recommendations.push("Lower token budgets or downgrade model tier for over-budget routes.");
    }
    return recommendations;
  }
}

export function buildModelRoutingEconomicsGateReport(
  cases: readonly ModelRoutingEconomicsEvalCase[] = modelRoutingEconomicsEvalPack
) {
  return new ModelRoutingGovernanceService().buildReport(cases);
}

import type {
  ModelCapabilityId,
  ModelCapabilityRole,
  ModelCostTier
} from "./modelCapabilityManifest.js";
import type { QuestionCategory } from "../types/arena.js";
import type { ChatRuntimeMode } from "../types/chat.js";
import type { ModelExecutionPlanInput } from "../services/models/modelProviderService.js";

export type ModelRoutingEconomicsSurface = "chat_route" | "provider_plan";
export type ModelRoutingEconomicsPriority = "critical" | "high" | "normal";

export type ChatRoutingFixture = {
  routingQuestion: string;
  userMessage?: string;
  runtimeMode?: ChatRuntimeMode;
  category: QuestionCategory;
  language?: "fr" | "en" | "unknown";
  requiresExternalGrounding?: boolean;
  userGoal?: string | null;
  topConstraints?: string[];
  changedConstraints?: string[];
  discardedAssumptions?: string[];
  decisionNeeded?: boolean;
  recommendedDirection?: string | null;
};

export type ModelRoutingEconomicsExpectation = {
  capabilityId: ModelCapabilityId;
  role: ModelCapabilityRole;
  maxCostTier?: ModelCostTier;
  maxEstimatedCostUnits?: number;
  localOnly?: boolean;
  allowDeepReasoning?: boolean;
  mustIncludeCapabilityIds?: ModelCapabilityId[];
  forbiddenCapabilityIds?: ModelCapabilityId[];
};

export type ModelRoutingEconomicsEvalCase = {
  id: string;
  surface: ModelRoutingEconomicsSurface;
  priority: ModelRoutingEconomicsPriority;
  description: string;
  tags: string[];
  chat?: ChatRoutingFixture;
  providerPlan?: ModelExecutionPlanInput;
  expected: ModelRoutingEconomicsExpectation;
};

export const modelRoutingEconomicsEvalPack: ModelRoutingEconomicsEvalCase[] = [
  {
    id: "chat_stable_biography_primary_brain",
    surface: "chat_route",
    priority: "critical",
    description: "Simple stable historical/biography questions should use the CPU-aware standard-light brain, not tools or deep reasoning.",
    tags: ["chat", "stable_knowledge", "cost_control", "standard_light"],
    chat: {
      routingQuestion: "qui est charlemagne ?",
      category: "other",
      language: "fr",
      runtimeMode: "direct",
      requiresExternalGrounding: false
    },
    expected: {
      capabilityId: "qwen-3b-standard-light",
      role: "primary_brain",
      maxCostTier: "low",
      maxEstimatedCostUnits: 1,
      localOnly: true,
      allowDeepReasoning: false,
      forbiddenCapabilityIds: ["deepseek-r1-distill-qwen-reasoner", "qwen-coder-code"]
    }
  },
  {
    id: "chat_api_definition_primary_brain",
    surface: "chat_route",
    priority: "critical",
    description: "A short conceptual API definition is technical explanation, not code implementation work or a 14B route.",
    tags: ["chat", "technical_explanation", "anti_overroute_code", "standard_light"],
    chat: {
      routingQuestion: "Explique simplement ce qu'est une API.",
      category: "technical_explanation",
      language: "fr",
      runtimeMode: "direct",
      requiresExternalGrounding: false
    },
    expected: {
      capabilityId: "qwen-3b-standard-light",
      role: "primary_brain",
      maxCostTier: "low",
      maxEstimatedCostUnits: 1,
      localOnly: true,
      allowDeepReasoning: false,
      forbiddenCapabilityIds: ["qwen-coder-code", "deepseek-r1-distill-qwen-reasoner"]
    }
  },
  {
    id: "chat_simple_rollback_explanation_primary_brain",
    surface: "chat_route",
    priority: "critical",
    description: "A simple rollback explanation must not trigger deep reasoning escalation.",
    tags: ["chat", "technical_explanation", "anti_overroute_deep"],
    chat: {
      routingQuestion: "Explique ce qu'est un rollback en production.",
      category: "technical_explanation",
      language: "fr",
      runtimeMode: "direct",
      requiresExternalGrounding: false
    },
    expected: {
      capabilityId: "qwen-14b-instruct-main",
      role: "primary_brain",
      maxCostTier: "medium",
      maxEstimatedCostUnits: 1,
      localOnly: true,
      allowDeepReasoning: false,
      forbiddenCapabilityIds: ["deepseek-r1-distill-qwen-reasoner"]
    }
  },
  {
    id: "chat_code_debug_qwen_coder",
    surface: "chat_route",
    priority: "critical",
    description: "Real debugging and repository questions should route to the code specialist.",
    tags: ["chat", "code", "debug"],
    chat: {
      routingQuestion: "Debug this TypeScript API error from the failing repository test.",
      category: "debug_diagnostic",
      language: "en",
      runtimeMode: "conversation",
      requiresExternalGrounding: false
    },
    expected: {
      capabilityId: "qwen-coder-code",
      role: "code_specialist",
      maxCostTier: "medium",
      maxEstimatedCostUnits: 1,
      localOnly: true,
      forbiddenCapabilityIds: ["mistral-mixtral-business"]
    }
  },
  {
    id: "chat_strategic_conflict_deep_reasoner",
    surface: "chat_route",
    priority: "critical",
    description: "Strategic conflict with explicit decision pressure should route to DeepSeek R1.",
    tags: ["chat", "deep_reasoning", "strategic_conflict"],
    chat: {
      routingQuestion: "On-prem obligatoire, deadline demain, budget bloque. Tu recommandes quoi ?",
      category: "architecture_design",
      language: "fr",
      runtimeMode: "conversation",
      requiresExternalGrounding: false,
      userGoal: "Choisir une architecture de deploiement",
      topConstraints: [
        "environment: on-prem",
        "deadline: demain",
        "budget: no additional budget"
      ],
      decisionNeeded: true,
      recommendedDirection: "Choisir une option on-prem minimale et reversible."
    },
    expected: {
      capabilityId: "deepseek-r1-distill-qwen-reasoner",
      role: "deep_reasoner",
      maxCostTier: "high",
      maxEstimatedCostUnits: 2,
      localOnly: true,
      allowDeepReasoning: true
    }
  },
  {
    id: "chat_business_writing_mistral",
    surface: "chat_route",
    priority: "high",
    description: "Stakeholder-facing writing should use the writing/business specialist.",
    tags: ["chat", "writing_business"],
    chat: {
      routingQuestion: "Redige un mail court pour annoncer un retard de livraison a un client enterprise.",
      category: "operational_writing",
      language: "fr",
      runtimeMode: "direct",
      requiresExternalGrounding: false
    },
    expected: {
      capabilityId: "mistral-mixtral-business",
      role: "writing_business",
      maxCostTier: "medium",
      maxEstimatedCostUnits: 1,
      localOnly: true,
      allowDeepReasoning: false,
      forbiddenCapabilityIds: ["deepseek-r1-distill-qwen-reasoner", "qwen-coder-code"]
    }
  },
  {
    id: "provider_fast_router_phi",
    surface: "provider_plan",
    priority: "critical",
    description: "Cheap routing/extraction must stay on Phi mini with a low budget profile.",
    tags: ["provider", "fast_router", "cost_control"],
    providerPlan: {
      purpose: "fast_routing",
      category: "mixed_reasoning",
      latencyPreference: "low",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        maxCostTier: "low",
        costPolicy: "minimize",
        fallbackDepth: 1,
        maxEstimatedCostUnits: 1
      }
    },
    expected: {
      capabilityId: "phi-mini-router",
      role: "fast_router",
      maxCostTier: "low",
      maxEstimatedCostUnits: 1,
      localOnly: true,
      allowDeepReasoning: false
    }
  },
  {
    id: "provider_embedding_bge_m3",
    surface: "provider_plan",
    priority: "high",
    description: "Dense memory lookup should select BGE-M3 embeddings, not a generative model.",
    tags: ["provider", "retrieval", "embedding"],
    providerPlan: {
      purpose: "embedding",
      category: "mixed_reasoning",
      requiresRetrieval: true,
      latencyPreference: "low",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        maxCostTier: "low",
        costPolicy: "minimize",
        fallbackDepth: 1,
        maxEstimatedCostUnits: 1
      }
    },
    expected: {
      capabilityId: "bge-m3-embedding",
      role: "embedding",
      maxCostTier: "low",
      maxEstimatedCostUnits: 1,
      localOnly: true
    }
  },
  {
    id: "provider_reranker_bge",
    surface: "provider_plan",
    priority: "high",
    description: "Knowledge candidate reranking should select the BGE reranker role.",
    tags: ["provider", "retrieval", "reranking"],
    providerPlan: {
      purpose: "reranking",
      category: "mixed_reasoning",
      requiresReranking: true,
      latencyPreference: "low",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        maxCostTier: "low",
        costPolicy: "minimize",
        fallbackDepth: 1,
        maxEstimatedCostUnits: 1
      }
    },
    expected: {
      capabilityId: "bge-reranker-retrieval",
      role: "reranker",
      maxCostTier: "low",
      maxEstimatedCostUnits: 1,
      localOnly: true
    }
  },
  {
    id: "provider_deep_reasoner_budget_guard",
    surface: "provider_plan",
    priority: "critical",
    description: "Deep reasoning should only be selected when the request explicitly allows the high-cost tier.",
    tags: ["provider", "deep_reasoning", "budget_guard"],
    providerPlan: {
      purpose: "deep_reasoning",
      category: "mixed_reasoning",
      requiresDeepReasoning: true,
      latencyPreference: "balanced",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        allowDeepReasoning: true,
        maxCostTier: "high",
        costPolicy: "quality",
        fallbackDepth: 2,
        maxEstimatedCostUnits: 4
      }
    },
    expected: {
      capabilityId: "deepseek-r1-distill-qwen-reasoner",
      role: "deep_reasoner",
      maxCostTier: "high",
      maxEstimatedCostUnits: 4,
      localOnly: true,
      allowDeepReasoning: true,
      mustIncludeCapabilityIds: ["qwen-14b-instruct-main"]
    }
  },
  {
    id: "provider_deep_reasoner_downgrade_when_forbidden",
    surface: "provider_plan",
    priority: "critical",
    description: "If deep reasoning is disabled by policy, the selected executable model must downgrade to Qwen 14B.",
    tags: ["provider", "deep_reasoning", "downgrade", "cost_control"],
    providerPlan: {
      purpose: "deep_reasoning",
      category: "mixed_reasoning",
      requiresDeepReasoning: true,
      latencyPreference: "balanced",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        allowDeepReasoning: false,
        maxCostTier: "medium",
        costPolicy: "balanced",
        fallbackDepth: 2,
        maxEstimatedCostUnits: 2
      }
    },
    expected: {
      capabilityId: "qwen-14b-instruct-main",
      role: "primary_brain",
      maxCostTier: "medium",
      maxEstimatedCostUnits: 2,
      localOnly: true,
      allowDeepReasoning: false,
      forbiddenCapabilityIds: ["deepseek-r1-distill-qwen-reasoner"]
    }
  }
];

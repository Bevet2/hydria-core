import type { QuestionCategory } from "../types/arena.js";

export const MODEL_CAPABILITY_MANIFEST_VERSION = "hydria-model-capability-manifest-v2";

export const modelSelectionPurposes = [
  "main_reasoning",
  "code",
  "deep_reasoning",
  "writing_business",
  "embedding",
  "reranking",
  "fast_routing"
] as const;

export type ModelSelectionPurpose = (typeof modelSelectionPurposes)[number];

export const modelProviderKinds = [
  "ollama",
  "vllm",
  "openrouter",
  "openai_compatible",
  "embedding_runtime"
] as const;

export type ModelCapabilityId =
  | "qwen-14b-instruct-main"
  | "qwen-32b-instruct-main"
  | "deepseek-coder-v2-code"
  | "qwen-coder-code"
  | "deepseek-r1-distill-qwen-reasoner"
  | "mistral-mixtral-business"
  | "bge-m3-embedding"
  | "bge-reranker-retrieval"
  | "gemma-e4b-router"
  | "gemma-e4b-standard-light";

export type ModelCapabilityRole =
  | "primary_brain"
  | "code_specialist"
  | "deep_reasoner"
  | "writing_business"
  | "embedding"
  | "reranker"
  | "fast_router";

export type ModelProviderKind = (typeof modelProviderKinds)[number];

export type ModelRuntimeStatus = "candidate" | "planned" | "available" | "active";
export type ModelLatencyTier = "fast" | "balanced" | "slow";
export type ModelCostTier = "low" | "medium" | "high";
export type ModelQualityTier = "routing" | "standard" | "strong" | "deep";
export type ModelPrivacyTier = "local_first" | "cloud_allowed" | "local_only";

export type ProviderModelIds = Partial<Record<ModelProviderKind, string>>;

export type ModelCapabilityManifest = {
  id: ModelCapabilityId;
  displayName: string;
  family: string;
  role: ModelCapabilityRole;
  purposes: readonly ModelSelectionPurpose[];
  categories: readonly QuestionCategory[];
  providerKinds: readonly ModelProviderKind[];
  providerModelIds: ProviderModelIds;
  runtimeStatus: ModelRuntimeStatus;
  priority: number;
  latencyTier: ModelLatencyTier;
  costTier: ModelCostTier;
  qualityTier: ModelQualityTier;
  privacyTier: ModelPrivacyTier;
  maxContextTokensHint: number;
  strengths: readonly string[];
  avoidFor: readonly string[];
};

const allReasoningCategories: readonly QuestionCategory[] = [
  "architecture_design",
  "debug_diagnostic",
  "incident_response",
  "mixed_reasoning",
  "product_strategy",
  "technical_explanation",
  "other"
];

export const modelCapabilityManifest = [
  {
    id: "qwen-14b-instruct-main",
    displayName: "Qwen 14B Instruct",
    family: "Qwen",
    role: "primary_brain",
    purposes: ["main_reasoning"],
    categories: allReasoningCategories,
    providerKinds: ["ollama", "vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      ollama: "qwen2.5:14b",
      vllm: "Qwen/Qwen2.5-14B-Instruct",
      openrouter: "qwen/qwen-2.5-14b-instruct"
    },
    runtimeStatus: "candidate",
    priority: 10,
    latencyTier: "balanced",
    costTier: "medium",
    qualityTier: "strong",
    privacyTier: "local_first",
    maxContextTokensHint: 32768,
    strengths: [
      "Default multi-turn reasoning brain",
      "Architecture and diagnostic synthesis",
      "Good quality/latency balance for production routing"
    ],
    avoidFor: [
      "Very cheap high-throughput routing",
      "Pure embedding or reranking tasks"
    ]
  },
  {
    id: "qwen-32b-instruct-main",
    displayName: "Qwen 32B Instruct",
    family: "Qwen",
    role: "primary_brain",
    purposes: ["main_reasoning"],
    categories: allReasoningCategories,
    providerKinds: ["vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      vllm: "Qwen/Qwen2.5-32B-Instruct",
      openrouter: "qwen/qwen-2.5-32b-instruct"
    },
    runtimeStatus: "candidate",
    priority: 8,
    latencyTier: "slow",
    costTier: "high",
    qualityTier: "deep",
    privacyTier: "cloud_allowed",
    maxContextTokensHint: 32768,
    strengths: [
      "Higher quality strategic reasoning",
      "Complex conflict arbitration",
      "Fallback when Qwen 14B confidence is not enough"
    ],
    avoidFor: [
      "Low-latency routing",
      "Routine short answers",
      "Embedding or reranking"
    ]
  },
  {
    id: "deepseek-coder-v2-code",
    displayName: "DeepSeek-Coder-V2",
    family: "DeepSeek",
    role: "code_specialist",
    purposes: ["code"],
    categories: ["debug_diagnostic", "architecture_design", "technical_explanation"],
    providerKinds: ["vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      vllm: "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
      openrouter: "deepseek/deepseek-coder"
    },
    runtimeStatus: "candidate",
    priority: 10,
    latencyTier: "balanced",
    costTier: "medium",
    qualityTier: "strong",
    privacyTier: "local_first",
    maxContextTokensHint: 32768,
    strengths: [
      "Code generation and repo diagnostics",
      "Debugging",
      "Implementation planning"
    ],
    avoidFor: [
      "Business writing",
      "Pure routing",
      "Embedding or reranking"
    ]
  },
  {
    id: "qwen-coder-code",
    displayName: "Qwen-Coder",
    family: "Qwen",
    role: "code_specialist",
    purposes: ["code"],
    categories: ["debug_diagnostic", "architecture_design", "technical_explanation"],
    providerKinds: ["ollama", "vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      ollama: "qwen2.5-coder:7b",
      vllm: "Qwen/Qwen2.5-Coder-14B-Instruct",
      openrouter: "qwen/qwen-2.5-coder-14b-instruct"
    },
    runtimeStatus: "candidate",
    priority: 11,
    latencyTier: "balanced",
    costTier: "medium",
    qualityTier: "strong",
    privacyTier: "local_first",
    maxContextTokensHint: 32768,
    strengths: [
      "Default OVH local code route",
      "Code-focused fallback",
      "TypeScript and implementation tasks",
      "Structured code explanations"
    ],
    avoidFor: [
      "High-level business copy",
      "Pure retrieval",
      "Tiny routing decisions"
    ]
  },
  {
    id: "deepseek-r1-distill-qwen-reasoner",
    displayName: "DeepSeek-R1-Distill-Qwen",
    family: "DeepSeek",
    role: "deep_reasoner",
    purposes: ["deep_reasoning"],
    categories: ["architecture_design", "incident_response", "mixed_reasoning", "product_strategy"],
    providerKinds: ["ollama", "vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      ollama: "deepseek-r1:14b",
      vllm: "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
      openrouter: "deepseek/deepseek-r1-distill-qwen-14b"
    },
    runtimeStatus: "candidate",
    priority: 10,
    latencyTier: "slow",
    costTier: "high",
    qualityTier: "deep",
    privacyTier: "local_first",
    maxContextTokensHint: 32768,
    strengths: [
      "Deep reasoning escalation",
      "Constraint conflict analysis",
      "Hard decision tradeoff evaluation"
    ],
    avoidFor: [
      "Final answer prose without a synthesis pass",
      "Low-latency routing",
      "Simple factual questions"
    ]
  },
  {
    id: "mistral-mixtral-business",
    displayName: "Mistral/Mixtral",
    family: "Mistral",
    role: "writing_business",
    purposes: ["writing_business"],
    categories: ["operational_writing", "product_strategy", "technical_explanation", "other"],
    providerKinds: ["ollama", "vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      ollama: "mistral:7b",
      vllm: "mistralai/Mixtral-8x7B-Instruct-v0.1",
      openrouter: "mistralai/mixtral-8x7b-instruct"
    },
    runtimeStatus: "candidate",
    priority: 10,
    latencyTier: "balanced",
    costTier: "medium",
    qualityTier: "strong",
    privacyTier: "cloud_allowed",
    maxContextTokensHint: 32768,
    strengths: [
      "Business writing",
      "Operational summaries",
      "Clear stakeholder-facing prose"
    ],
    avoidFor: [
      "Hard code generation",
      "Embedding or reranking",
      "Ultra-low-latency routing"
    ]
  },
  {
    id: "bge-m3-embedding",
    displayName: "BGE-M3",
    family: "BGE",
    role: "embedding",
    purposes: ["embedding"],
    categories: ["technical_explanation", "debug_diagnostic", "mixed_reasoning", "other"],
    providerKinds: ["embedding_runtime", "ollama", "vllm", "openai_compatible"],
    providerModelIds: {
      embedding_runtime: "BAAI/bge-m3",
      ollama: "bge-m3"
    },
    runtimeStatus: "candidate",
    priority: 10,
    latencyTier: "fast",
    costTier: "low",
    qualityTier: "standard",
    privacyTier: "local_first",
    maxContextTokensHint: 8192,
    strengths: [
      "Dense retrieval embeddings",
      "Memory lookup",
      "Multilingual retrieval"
    ],
    avoidFor: [
      "Generating final answers",
      "Reasoning",
      "Reranking final candidate lists"
    ]
  },
  {
    id: "bge-reranker-retrieval",
    displayName: "BGE Reranker",
    family: "BGE",
    role: "reranker",
    purposes: ["reranking"],
    categories: ["technical_explanation", "debug_diagnostic", "mixed_reasoning", "other"],
    providerKinds: ["embedding_runtime", "vllm", "openai_compatible"],
    providerModelIds: {
      embedding_runtime: "BAAI/bge-reranker-v2-m3"
    },
    runtimeStatus: "candidate",
    priority: 10,
    latencyTier: "fast",
    costTier: "low",
    qualityTier: "standard",
    privacyTier: "local_first",
    maxContextTokensHint: 8192,
    strengths: [
      "Reranking retrieved memory",
      "Filtering noisy knowledge candidates",
      "Improving retrieval precision"
    ],
    avoidFor: [
      "Generating final answers",
      "General reasoning",
      "Code generation"
    ]
  },
  {
    id: "gemma-e4b-router",
    displayName: "Gemma 3n E4B Router",
    family: "Gemma",
    role: "fast_router",
    purposes: ["fast_routing"],
    categories: allReasoningCategories,
    providerKinds: ["ollama", "vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      ollama: "gemma3n:e4b",
      vllm: "google/gemma-3n-e4b-it",
      openrouter: "google/gemma-3n-e4b-it"
    },
    runtimeStatus: "candidate",
    priority: 10,
    latencyTier: "fast",
    costTier: "low",
    qualityTier: "routing",
    privacyTier: "local_first",
    maxContextTokensHint: 32768,
    strengths: [
      "Fast classification",
      "Cheap routing decisions",
      "Low-latency extraction",
      "Simple classification with more context than the previous Phi mini route"
    ],
    avoidFor: [
      "Final complex answers",
      "Deep reasoning",
      "Large context synthesis"
    ]
  },
  {
    id: "gemma-e4b-standard-light",
    displayName: "Gemma 3n E4B Standard Light",
    family: "Gemma",
    role: "primary_brain",
    purposes: ["fast_routing"],
    categories: allReasoningCategories,
    providerKinds: ["ollama", "vllm", "openrouter", "openai_compatible"],
    providerModelIds: {
      ollama: "gemma3n:e4b",
      vllm: "google/gemma-3n-e4b-it",
      openrouter: "google/gemma-3n-e4b-it"
    },
    runtimeStatus: "candidate",
    priority: 7,
    latencyTier: "fast",
    costTier: "low",
    qualityTier: "standard",
    privacyTier: "local_first",
    maxContextTokensHint: 32768,
    strengths: [
      "CPU-aware stable knowledge answers",
      "Short definitions and simple concepts",
      "Low-cost public chat default for simple questions"
    ],
    avoidFor: [
      "High-stakes strategy decisions",
      "Deep reasoning",
      "Code-heavy answers",
      "Complex multi-constraint synthesis"
    ]
  }
] as const satisfies readonly ModelCapabilityManifest[];

export function getModelCapabilityManifestById(id: ModelCapabilityId) {
  return modelCapabilityManifest.find((model) => model.id === id) ?? null;
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ModelCapabilityId,
  ModelCapabilityRole,
  ModelSelectionPurpose
} from "../data/modelCapabilityManifest.js";
import type { QuestionCategory } from "../types/arena.js";
import {
  ModelProviderService,
  type ModelExecutionPlanInput
} from "../services/models/modelProviderService.js";
import { ModelBudgetPolicyService } from "../services/models/modelBudgetPolicy.js";
import { env } from "../utils/env.js";

type RoleGateStatus = "passed" | "warning" | "blocked";

type RoleGateCase = {
  id: string;
  role: ModelCapabilityRole;
  purpose: ModelSelectionPurpose;
  category: QuestionCategory;
  description: string;
  input: ModelExecutionPlanInput;
  expected: {
    selectedId: ModelCapabilityId;
    role: ModelCapabilityRole;
    localTargetRequired: boolean;
  };
};

type RoleGateResult = {
  id: string;
  role: ModelCapabilityRole;
  status: RoleGateStatus;
  description: string;
  selectedId: string;
  selectedRole: string;
  provider: string | null;
  modelId: string | null;
  estimatedCostUnits: number | null;
  executable: boolean;
  issues: string[];
  recommendation: string;
};

type RoleGateReport = {
  version: "hydria-model-role-pretraining-gate-v1";
  generatedAt: string;
  purpose: "pre_training_role_readiness";
  passed: boolean;
  summary: {
    totalRoles: number;
    passed: number;
    warnings: number;
    blocked: number;
    trainingAllowed: boolean;
  };
  results: RoleGateResult[];
  recommendations: string[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "model-role-pretraining-gate-v1.json");

function isUrlConfigured(value: string) {
  if (!value.trim()) {
    return false;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function dryRunLocalTarget(args: {
  selected: ReturnType<ModelProviderService["planExecution"]>["selection"]["selected"];
  estimatedCostUnits: number | null;
}) {
  const selected = args.selected;
  const embeddingEndpoint = isUrlConfigured(env.MODEL_ROUTER_EMBEDDING_BASE_URL)
    ? env.MODEL_ROUTER_EMBEDDING_BASE_URL
    : null;
  const vllmEndpoint = isUrlConfigured(env.MODEL_ROUTER_VLLM_BASE_URL)
    ? env.MODEL_ROUTER_VLLM_BASE_URL
    : null;
  const ollamaEndpoint = isUrlConfigured(env.LOCAL_MODEL_BASE_URL)
    ? env.LOCAL_MODEL_BASE_URL
    : null;

  if (selected.providerModelIds.embedding_runtime && embeddingEndpoint) {
    return {
      provider: "embedding_runtime",
      modelId: selected.providerModelIds.embedding_runtime,
      estimatedCostUnits: args.estimatedCostUnits ?? 0.2
    };
  }
  if (selected.providerModelIds.ollama && ollamaEndpoint) {
    return {
      provider: "ollama",
      modelId: selected.providerModelIds.ollama,
      estimatedCostUnits: args.estimatedCostUnits ?? 0.2
    };
  }
  if (selected.providerModelIds.vllm && vllmEndpoint) {
    return {
      provider: "vllm",
      modelId: selected.providerModelIds.vllm,
      estimatedCostUnits: args.estimatedCostUnits ?? 1
    };
  }
  return null;
}

export const modelRolePreTrainingGateCases: RoleGateCase[] = [
  {
    id: "fast_router_phi",
    role: "fast_router",
    purpose: "fast_routing",
    category: "mixed_reasoning",
    description: "Cheap first-pass routing and extraction must stay on Phi mini.",
    input: {
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
      selectedId: "phi-mini-router",
      role: "fast_router",
      localTargetRequired: true
    }
  },
  {
    id: "primary_brain_qwen",
    role: "primary_brain",
    purpose: "main_reasoning",
    category: "architecture_design",
    description: "Default strategy and architecture reasoning must route to Qwen 14B local first.",
    input: {
      purpose: "main_reasoning",
      category: "architecture_design",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        maxCostTier: "medium",
        costPolicy: "balanced",
        fallbackDepth: 2,
        maxEstimatedCostUnits: 8
      }
    },
    expected: {
      selectedId: "qwen-14b-instruct-main",
      role: "primary_brain",
      localTargetRequired: true
    }
  },
  {
    id: "code_qwen_coder",
    role: "code_specialist",
    purpose: "code",
    category: "debug_diagnostic",
    description: "Code and debug work must route to the local Qwen-Coder specialist.",
    input: {
      purpose: "code",
      category: "debug_diagnostic",
      requiresCode: true,
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        maxCostTier: "medium",
        costPolicy: "balanced",
        fallbackDepth: 2,
        maxEstimatedCostUnits: 8
      }
    },
    expected: {
      selectedId: "qwen-coder-code",
      role: "code_specialist",
      localTargetRequired: true
    }
  },
  {
    id: "deep_reasoner_deepseek",
    role: "deep_reasoner",
    purpose: "deep_reasoning",
    category: "mixed_reasoning",
    description: "Hard tradeoff and conflict cases must be allowed to escalate to DeepSeek R1.",
    input: {
      purpose: "deep_reasoning",
      category: "mixed_reasoning",
      requiresDeepReasoning: true,
      latencyPreference: "quality",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        allowDeepReasoning: true,
        maxCostTier: "high",
        costPolicy: "quality",
        fallbackDepth: 2,
        maxEstimatedCostUnits: 24
      }
    },
    expected: {
      selectedId: "deepseek-r1-distill-qwen-reasoner",
      role: "deep_reasoner",
      localTargetRequired: true
    }
  },
  {
    id: "writing_business_mistral",
    role: "writing_business",
    purpose: "writing_business",
    category: "operational_writing",
    description: "Operational writing and business prose must route to the writing specialist.",
    input: {
      purpose: "writing_business",
      category: "operational_writing",
      privacyMode: "local_required",
      budget: {
        executionEnabled: true,
        allowCloud: false,
        maxCostTier: "medium",
        costPolicy: "balanced",
        fallbackDepth: 2,
        maxEstimatedCostUnits: 8
      }
    },
    expected: {
      selectedId: "mistral-mixtral-business",
      role: "writing_business",
      localTargetRequired: true
    }
  },
  {
    id: "embedding_bge_m3",
    role: "embedding",
    purpose: "embedding",
    category: "mixed_reasoning",
    description: "Memory and retrieval embedding work must route to BGE-M3.",
    input: {
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
      selectedId: "bge-m3-embedding",
      role: "embedding",
      localTargetRequired: true
    }
  },
  {
    id: "reranker_bge",
    role: "reranker",
    purpose: "reranking",
    category: "mixed_reasoning",
    description: "Retrieval reranking must have an explicit runtime before any reranker-specific training.",
    input: {
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
      selectedId: "bge-reranker-retrieval",
      role: "reranker",
      localTargetRequired: true
    }
  }
];

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function recommendationFor(status: RoleGateStatus, issues: string[], role: ModelCapabilityRole) {
  if (status === "passed") {
    return "Role gate is ready for evaluation-pack extraction. Do not train until role-specific failures are confirmed.";
  }
  if (
    status === "warning" &&
    issues.every((issue) => issue.startsWith("warning:"))
  ) {
    return "Role is route-ready; keep it under evaluation gates before any training run.";
  }
  if (issues.includes("runtime_target_missing")) {
    return `Configure a local runtime target for ${role} before building a training pack.`;
  }
  return "Fix routing or budget policy before training this role.";
}

function evaluateCase(service: ModelProviderService, gateCase: RoleGateCase): RoleGateResult {
  const plan = service.planExecution(gateCase.input);
  const plannedTarget = plan.target;
  const dryTarget = plan.target ?? dryRunLocalTarget({
    selected: plan.selection.selected,
    estimatedCostUnits: plannedTarget ? plannedTarget.estimatedCostUnits : null
  });
  const issues: string[] = [];

  if (plan.selection.selected.id !== gateCase.expected.selectedId) {
    issues.push("unexpected_selected_model");
  }
  if (plan.selection.selected.role !== gateCase.expected.role) {
    issues.push("unexpected_selected_role");
  }
  if (gateCase.expected.localTargetRequired && !dryTarget) {
    issues.push("local_target_missing");
  }
  if (!dryTarget) {
    issues.push("runtime_target_missing");
  }
  if (
    dryTarget &&
    plan.budget.maxEstimatedCostUnits !== null &&
    dryTarget.estimatedCostUnits > plan.budget.maxEstimatedCostUnits
  ) {
    issues.push("cost_budget_exceeded");
  }

  const hardIssues = new Set([
    "unexpected_selected_model",
    "unexpected_selected_role",
    "local_target_missing",
    "runtime_target_missing",
    "cost_budget_exceeded",
    "cloud_target_selected_while_cloud_disabled"
  ]);
  const status: RoleGateStatus = issues.some((issue) => hardIssues.has(issue))
    ? "blocked"
    : plan.warnings.length > 0
      ? "warning"
      : "passed";

  return {
    id: gateCase.id,
    role: gateCase.role,
    status,
    description: gateCase.description,
    selectedId: plan.selection.selected.id,
    selectedRole: plan.selection.selected.role,
    provider: dryTarget?.provider ?? null,
    modelId: dryTarget?.modelId ?? null,
    estimatedCostUnits: dryTarget?.estimatedCostUnits ?? null,
    executable: Boolean(dryTarget),
    issues: [...issues, ...plan.warnings.map((warning) => `warning:${warning}`)],
    recommendation: recommendationFor(status, issues, gateCase.role)
  };
}

export function buildModelRolePreTrainingGateReport(
  service = new ModelProviderService({
    budgetPolicyService: new ModelBudgetPolicyService({
      executionEnabled: true,
      allowCloud: false,
      maxCostTier: "high"
    })
  })
): RoleGateReport {
  const results = modelRolePreTrainingGateCases.map((gateCase) => evaluateCase(service, gateCase));
  const blocked = results.filter((result) => result.status === "blocked").length;
  const warnings = results.filter((result) => result.status === "warning").length;
  const passed = results.filter((result) => result.status === "passed").length;
  const recommendations = [
    blocked > 0
      ? "Do not start multi-model training yet; at least one specialist role is blocked."
      : "Routing/runtime gates are ready for role-specific eval extraction.",
    "Create or refresh failure packs per role before any LoRA/QLoRA run.",
    "Promote a trained role only after A/B against the current production specialist."
  ];

  return {
    version: "hydria-model-role-pretraining-gate-v1",
    generatedAt: new Date().toISOString(),
    purpose: "pre_training_role_readiness",
    passed: blocked === 0,
    summary: {
      totalRoles: results.length,
      passed,
      warnings,
      blocked,
      trainingAllowed: blocked === 0
    },
    results,
    recommendations
  };
}

export async function runModelRolePreTrainingGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const allowBlockers = hasFlag(argv, "--allow-blockers");
  const report = buildModelRolePreTrainingGateReport();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        blockedRoles: report.results
          .filter((result) => result.status === "blocked")
          .map((result) => result.id),
        output
      },
      null,
      2
    )
  );

  if (!report.passed && !allowBlockers) {
    process.exitCode = 1;
  }
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runModelRolePreTrainingGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

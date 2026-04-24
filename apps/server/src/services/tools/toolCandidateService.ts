import { createHash } from "node:crypto";
import type { ToolCandidate, ToolGapSignal, ToolManifest, ToolRiskLevel } from "../../types/tools.js";
import {
  toolActivationPolicySchema,
  toolCandidateSchema,
  toolContractSchema,
  toolManifestSchema
} from "../../types/tools.js";

function stableId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function startCase(value: string) {
  return value
    .split(/[_:\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function toCamelName(intent: string) {
  return `${startCase(intent).replace(/\s+/g, "")}Tool`;
}

function buildInputSchema(toolType: string): ToolManifest["inputSchema"] {
  const common = [
    {
      name: "question",
      type: "string" as const,
      required: true,
      description: "Original request that triggered the missing capability."
    }
  ];

  if (toolType === "weather") {
    return [
      ...common,
      {
        name: "location",
        type: "string" as const,
        required: true,
        description: "Resolved location for current weather lookup."
      }
    ];
  }

  if (toolType === "finance") {
    return [
      ...common,
      {
        name: "asset",
        type: "string" as const,
        required: true,
        description: "Ticker, symbol, or asset name to resolve."
      }
    ];
  }

  if (toolType === "repo" || toolType === "file") {
    return [
      ...common,
      {
        name: "target",
        type: "string" as const,
        required: true,
        description: "Repository path, file path, or repository identifier."
      }
    ];
  }

  return common;
}

function buildOutputSchema(): ToolManifest["outputSchema"] {
  return [
    {
      name: "result",
      type: "string",
      required: true,
      description: "Structured result returned by the governed tool."
    },
    {
      name: "metadata",
      type: "object",
      required: false,
      description: "Execution metadata, freshness details, or failure cause."
    }
  ];
}

function inferPermissions(toolType: string) {
  if (toolType === "repo" || toolType === "file") {
    return ["workspace_read"];
  }

  if (toolType === "research" || toolType === "web" || toolType === "weather" || toolType === "finance" || toolType === "sports") {
    return ["network_http"];
  }

  return ["structured_compute"];
}

function inferRiskLevel(toolType: string, gap: ToolGapSignal): ToolRiskLevel {
  if (toolType === "repo" || toolType === "file") {
    return "medium";
  }

  if (gap.gapType === "repeated_failure") {
    return "medium";
  }

  return gap.riskLevel;
}

function inferExecutionContext(toolType: string) {
  if (toolType === "repo" || toolType === "file") {
    return "os" as const;
  }

  if (toolType === "research" || toolType === "web" || toolType === "weather" || toolType === "finance" || toolType === "sports") {
    return "external" as const;
  }

  return "sandbox" as const;
}

function buildBenchmarkCases(gap: ToolGapSignal) {
  return [
    {
      prompt: `Handle a representative ${gap.suggestedIntent} request safely.`,
      expectedIntent: gap.suggestedIntent,
      expectedBehavior: "Return a structured tool result or a clear tool failure."
    },
    {
      prompt: `Repeat a common ${gap.suggestedIntent} request with a different entity.`,
      expectedIntent: gap.suggestedIntent,
      expectedBehavior: "Generalize without overfitting to a single entity."
    }
  ];
}

function buildExamples(gap: ToolGapSignal) {
  return gap.evidence.slice(0, 4).map((entry) => entry.replace(/^[^:]+:\s*/, ""));
}

export class ToolCandidateService {
  buildCandidate(gap: ToolGapSignal): ToolCandidate | null {
    if (!gap.detected || gap.frequency < 2) {
      return null;
    }

    const createdAt = gap.createdAt;
    const candidateId = `tool-candidate::${gap.suggestedIntent}::${stableId(gap.signalId)}`;
    const manifestId = `tool-manifest::${gap.suggestedIntent}`;
    const name = toCamelName(gap.suggestedIntent);
    const riskLevel = inferRiskLevel(gap.toolType, gap);
    const inputSchema = buildInputSchema(gap.toolType);
    const outputSchema = buildOutputSchema();
    const requiredPermissions = inferPermissions(gap.toolType);
    const benchmarkCases = buildBenchmarkCases(gap);
    const activationPolicy = toolActivationPolicySchema.parse({
      minFrequency: 2,
      minUsefulnessScore: 65,
      minReliabilityScore: 65,
      minSafetyScore: riskLevel === "high" ? 85 : 60,
      minAdoptionScore: 40,
      maxRegressionRiskScore: riskLevel === "high" ? 25 : 45,
      requiresHumanReview: riskLevel === "high",
      maxActiveToolsPerIntent: 1
    });
    const contract = toolContractSchema.parse({
      contractId: `tool-contract::${gap.suggestedIntent}`,
      toolCandidateId: candidateId,
      manifestId,
      inputSchema,
      outputSchema,
      requiredPermissions,
      successCriteria: [
        "Return structured output matching the manifest contract.",
        "Fail safely with an explicit reason when the external dependency is unavailable.",
        "Avoid asking the user to do the missing lookup manually when the tool should exist."
      ],
      fallbackBehavior:
        "Return a structured tool failure so Hydria Core can abstain safely instead of improvising.",
      proposedTests: [
        `Benchmark repeated ${gap.suggestedIntent} prompts against the manifest contract.`,
        "Verify failure handling when the dependency is unavailable.",
        "Verify no stale or fabricated live data leaks into the final answer."
      ],
      benchmarkCases,
      version: "hydria-tool-contract-v1"
    });
    const manifest = toolManifestSchema.parse({
      id: manifestId,
      candidateId,
      name,
      intent: gap.suggestedIntent,
      description: `Governed tool manifest proposed to close the ${gap.gapType} gap for ${gap.suggestedIntent}.`,
      inputSchema,
      outputSchema,
      requiredPermissions,
      riskLevel,
      allowedExecutionContext: inferExecutionContext(gap.toolType),
      examples: buildExamples(gap),
      failureModes: [
        "External dependency unavailable.",
        "Returned payload does not satisfy the output contract.",
        "Result is stale or lacks enough grounding."
      ],
      safetyConstraints: [
        "Hydria Core must never execute this capability directly.",
        "Executor must return structured outputs matching the declared schema.",
        "If the tool fails, Hydria must state the failure explicitly."
      ],
      benchmarkCases,
      version: "hydria-tool-manifest-v1",
      state: "proposed",
      confidenceScore: Math.min(0.95, 0.45 + gap.frequency * 0.1),
      createdAt,
      updatedAt: createdAt,
      toolContract: contract,
      activationPolicy,
      validation: null
    });

    return toolCandidateSchema.parse({
      candidateId,
      gapSignal: gap,
      manifest,
      contract,
      activationPolicy,
      confidenceScore: manifest.confidenceScore,
      createdAt,
      state: "proposed"
    });
  }

  buildCandidates(gaps: ToolGapSignal[]) {
    return gaps
      .map((gap) => this.buildCandidate(gap))
      .filter((candidate): candidate is ToolCandidate => candidate !== null);
  }
}

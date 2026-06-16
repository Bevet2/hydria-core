import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hydriaOsOfficeWorkspaceActionPack } from "../data/hydriaOsOfficeWorkspaceActionPack.js";
import { HydriaPublicApiV1Service } from "../services/publicApi/hydriaPublicApiV1Service.js";
import { OfficeWorkspaceRawQwenActionAdapter } from "../services/publicApi/officeWorkspaceRawQwenActionAdapter.js";
import { publicApiAskRequestSchema, type PublicApiProposedAction } from "../types/publicApi.js";
import { env } from "../utils/env.js";

type GateCase = typeof hydriaOsOfficeWorkspaceActionPack[number];

type Evaluation = {
  passed: boolean;
  issues: string[];
  actionType: string | null;
  proposedAction: Omit<PublicApiProposedAction, "id" | "provenance"> | null;
};

type ABGateResult = {
  id: string;
  workspaceFamily: GateCase["workspaceFamily"];
  expectedActionType: PublicApiProposedAction["type"];
  baseline: Evaluation & {
    provider: string;
    model: string;
    attempts: string[];
    fastPath: boolean;
  };
  candidate: Evaluation & {
    provider: "ollama";
    model: string;
    promptTemplate: "qwen_raw_chat";
    durationMs: number;
    adapterIssues: string[];
    rawPreview: string;
  };
  verdict: "candidate_equal" | "candidate_better" | "candidate_worse";
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "hydria-os-office-workspace-ab-gate-v1.json");
const defaultModel = "student-local-1p5b-toolbench-lora-v11-office-workspace-light:latest";

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    model: readOption(argv, "--model") ?? defaultModel,
    baseUrl: readOption(argv, "--base-url") ?? env.LOCAL_MODEL_BASE_URL,
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? 120000),
    limit: Number(readOption(argv, "--limit") ?? hydriaOsOfficeWorkspaceActionPack.length)
  };
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compactAction(action: PublicApiProposedAction): Omit<PublicApiProposedAction, "id" | "provenance"> {
  return {
    type: action.type,
    title: action.title,
    target: action.target,
    payload: action.payload,
    riskLevel: action.riskLevel,
    requiresConfirmation: action.requiresConfirmation,
    dryRun: action.dryRun,
    rationale: action.rationale
  };
}

function findPrimaryAction(actions: PublicApiProposedAction[], expectedType: PublicApiProposedAction["type"]) {
  return actions.find((action) => action.type === expectedType) ?? actions[0] ?? null;
}

function includesExpectedValues(actual: unknown, expected: string[] | undefined) {
  if (!expected?.length) {
    return true;
  }
  const actualValues = Array.isArray(actual) ? actual : [];
  const actualText = actualValues.map(normalize).join(" | ");
  return expected.every((entry) => actualText.includes(normalize(entry)));
}

function evaluateActions(caseItem: GateCase, actions: PublicApiProposedAction[]): Evaluation {
  const issues: string[] = [];
  const action = findPrimaryAction(actions, caseItem.expected.actionType);

  if (!action) {
    issues.push(`missing_action:${caseItem.expected.actionType}`);
  } else {
    if (action.type !== caseItem.expected.actionType) {
      issues.push(`actionType:${action.type}!=${caseItem.expected.actionType}`);
    }
    if (caseItem.expected.targetWorkObjectId && action.target.workObjectId !== caseItem.expected.targetWorkObjectId) {
      issues.push(`target:${action.target.workObjectId}!=${caseItem.expected.targetWorkObjectId}`);
    }
    if (caseItem.expected.entryPath && action.target.entryPath !== caseItem.expected.entryPath) {
      issues.push(`entryPath:${action.target.entryPath}!=${caseItem.expected.entryPath}`);
    }
    if (caseItem.expected.format && action.payload.format !== caseItem.expected.format) {
      issues.push(`format:${String(action.payload.format)}!=${caseItem.expected.format}`);
    }
    if (caseItem.expected.kind && action.payload.kind !== caseItem.expected.kind) {
      issues.push(`kind:${String(action.payload.kind)}!=${caseItem.expected.kind}`);
    }
    if (caseItem.expected.mode && action.payload.mode !== caseItem.expected.mode) {
      issues.push(`mode:${String(action.payload.mode)}!=${caseItem.expected.mode}`);
    }
    if (!includesExpectedValues(action.payload.columns, caseItem.expected.columns)) {
      issues.push("missing_expected_columns");
    }
    if (!includesExpectedValues(action.payload.sections, caseItem.expected.sections)) {
      issues.push("missing_expected_sections");
    }
    if (!action.dryRun) {
      issues.push("action_not_dry_run");
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    actionType: action?.type ?? null,
    proposedAction: action ? compactAction(action) : null
  };
}

function buildChatRuntimeStub(caseItem: GateCase) {
  return {
    async sendMessage() {
      return {
        sessionId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-05-29T08:00:00.000Z",
        runtimeMode: "conversation",
        category: "workspace_action",
        assistantMessage: {
          content:
            caseItem.expected.actionType === "reply"
              ? "Voici une reponse conceptuelle sans action workspace."
              : "Je prepare une action workspace apres analyse runtime."
        },
        answer: {
          confidence: 88
        },
        conversationState: {
          language: "fr",
          userGoal: caseItem.input,
          knownFacts: []
        },
        activeConstraintCapsule: {
          topConstraints: ["proposer une action OS en dry-run uniquement"]
        },
        tooling: {
          used: !caseItem.expected.fastPath && caseItem.expected.actionType !== "reply",
          route: !caseItem.expected.fastPath && caseItem.expected.actionType !== "reply" ? "used" : "not_needed",
          routing: {
            toolType: !caseItem.expected.fastPath && caseItem.expected.actionType !== "reply" ? "research" : "none",
            intent: caseItem.expected.actionType === "reply" ? "conceptual_answer" : "workspace_action_plan"
          },
          sources:
            !caseItem.expected.fastPath && caseItem.expected.actionType !== "reply"
              ? [
                  {
                    title: "Runtime evidence fixture",
                    url: "https://app.hydria.click/runtime-fixture",
                    snippet: "Fixture source used by the office workspace A/B gate.",
                    excerpt: "The normal runtime was allowed to run before the OS action was proposed."
                  }
                ]
              : []
        },
        generation: {
          provider: "ollama",
          model: "gemma3n:e4b",
          specialist: {
            role: "workspace_runtime"
          },
          attempts: [{ model: "gemma3n:e4b" }]
        },
        conversationQuality: {
          passed: true,
          issues: []
        },
        evidenceCapsule: {
          answerabilityMode: caseItem.expected.fastPath ? "direct_stable" : "source_backed_or_model_runtime"
        },
        agenticPlan: {
          mode: "workspace_action"
        },
        knowledgeRetrieval: {
          used: false
        },
        orchestrationTrace: {
          version: "chat_orchestration_trace_v1",
          disclosure: "runtime_trace_no_private_chain_of_thought",
          steps: []
        },
        usedRetry: false,
        durationMs: 12
      } as any;
    },
    resetSession() {}
  };
}

async function runBaseline(caseItem: GateCase) {
  const service = new HydriaPublicApiV1Service({
    chatRuntimeService: buildChatRuntimeStub(caseItem) as any
  });
  const response = await service.ask(
    publicApiAskRequestSchema.parse({
      input: caseItem.input,
      workspaceContext: caseItem.workspaceContext,
      metadata: {
        workspaceFamilyId: caseItem.workspaceFamily
      },
      options: {
        includeSources: true,
        includeTrace: true,
        includeDiagnostics: true,
        includeProposedActions: true
      }
    })
  );
  const evaluation = evaluateActions(caseItem, response.proposedActions);
  const fastPath = response.models.provider === "policy" && response.models.model === "workspace_action_planner_v1";
  if (fastPath !== caseItem.expected.fastPath) {
    evaluation.issues.push(`fastPath:${fastPath}!=${caseItem.expected.fastPath}`);
    evaluation.passed = false;
  }

  return {
    response,
    evaluation: {
      ...evaluation,
      provider: response.models.provider,
      model: response.models.model,
      attempts: response.models.attempts,
      fastPath
    }
  };
}

function verdict(baselinePassed: boolean, candidatePassed: boolean): ABGateResult["verdict"] {
  if (baselinePassed && !candidatePassed) {
    return "candidate_worse";
  }
  if (!baselinePassed && candidatePassed) {
    return "candidate_better";
  }
  return "candidate_equal";
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runHydriaOsOfficeWorkspaceABGate(args = parseArgs()) {
  const adapter = new OfficeWorkspaceRawQwenActionAdapter({
    baseUrl: args.baseUrl,
    model: args.model,
    timeoutMs: args.timeoutMs
  });
  const cases = hydriaOsOfficeWorkspaceActionPack.slice(0, Math.max(0, args.limit));
  const results: ABGateResult[] = [];

  for (const caseItem of cases) {
    const baseline = await runBaseline(caseItem);
    const request = publicApiAskRequestSchema.parse({
      input: caseItem.input,
      workspaceContext: caseItem.workspaceContext,
      metadata: {
        workspaceFamilyId: caseItem.workspaceFamily
      },
      options: {
        includeSources: true,
        includeTrace: true,
        includeDiagnostics: true,
        includeProposedActions: true
      }
    });
    const candidatePlan = await adapter.plan({
      request,
      runtimeAnswer: baseline.response.answer,
      sourceCount: baseline.response.sources.length
    });
    const candidateEvaluation = evaluateActions(caseItem, candidatePlan.proposedActions);
    const candidatePassed = candidatePlan.issues.length === 0 && candidateEvaluation.passed;

    results.push({
      id: caseItem.id,
      workspaceFamily: caseItem.workspaceFamily,
      expectedActionType: caseItem.expected.actionType,
      baseline: baseline.evaluation,
      candidate: {
        ...candidateEvaluation,
        passed: candidatePassed,
        issues: [...candidatePlan.issues, ...candidateEvaluation.issues],
        provider: candidatePlan.provider,
        model: candidatePlan.model,
        promptTemplate: candidatePlan.promptTemplate,
        durationMs: candidatePlan.durationMs,
        adapterIssues: candidatePlan.issues,
        rawPreview: candidatePlan.rawResponse.slice(0, 420)
      },
      verdict: verdict(baseline.evaluation.passed, candidatePassed)
    });
  }

  const candidateWorse = results.filter((result) => result.verdict === "candidate_worse");
  const candidateJsonFailures = results.filter((result) =>
    result.candidate.adapterIssues.some((issue) => issue.startsWith("json_parse_failed"))
  );
  const candidateDryRunFailures = results.filter((result) =>
    result.candidate.issues.some((issue) => issue.includes("not_dry_run") || issue.includes("action_not_dry_run"))
  );
  const report = {
    version: "hydria-os-office-workspace-ab-gate-v1",
    generatedAt: new Date().toISOString(),
    model: args.model,
    baseline: "v10_light_current_public_api_workspace_planner",
    candidate: "v11_office_workspace_light_raw_qwen_adapter",
    passed: candidateWorse.length === 0 && candidateJsonFailures.length === 0 && candidateDryRunFailures.length === 0,
    promotion: {
      recommended: false,
      reason:
        "This gate validates the raw Qwen adapter as a candidate only. v10-light remains active until an explicit promotion step."
    },
    summary: {
      caseCount: results.length,
      baselinePassedCount: results.filter((result) => result.baseline.passed).length,
      candidatePassedCount: results.filter((result) => result.candidate.passed).length,
      candidateBetterCount: results.filter((result) => result.verdict === "candidate_better").length,
      candidateEqualCount: results.filter((result) => result.verdict === "candidate_equal").length,
      candidateWorseCount: candidateWorse.length,
      candidateJsonFailureCount: candidateJsonFailures.length,
      candidateDryRunFailureCount: candidateDryRunFailures.length
    },
    results
  };

  await writeJson(args.output, report);
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        model: report.model,
        promotion: report.promotion,
        summary: report.summary,
        failedCases: report.results
          .filter((result) => !result.candidate.passed || result.verdict === "candidate_worse")
          .map((result) => ({
            id: result.id,
            verdict: result.verdict,
            candidateIssues: result.candidate.issues,
            rawPreview: result.candidate.rawPreview
          })),
        output: args.output
      },
      null,
      2
    )
  );

  if (!report.passed) {
    process.exitCode = 1;
  }

  return report;
}

if (resolve(process.argv[1] ?? "") === currentFilePath) {
  runHydriaOsOfficeWorkspaceABGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

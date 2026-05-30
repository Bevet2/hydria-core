import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hydriaOsOfficeWorkspaceActionPack } from "../data/hydriaOsOfficeWorkspaceActionPack.js";
import { HydriaPublicApiV1Service } from "../services/publicApi/hydriaPublicApiV1Service.js";
import { publicApiAskRequestSchema, type PublicApiProposedAction } from "../types/publicApi.js";

type GateCase = typeof hydriaOsOfficeWorkspaceActionPack[number];

type GateResult = {
  id: string;
  workspaceFamily: GateCase["workspaceFamily"];
  passed: boolean;
  issues: string[];
  modelProvider: string;
  modelAttempts: string[];
  actionType: string | null;
  proposedAction: Omit<PublicApiProposedAction, "id" | "provenance"> | null;
};

type GateReport = {
  version: "hydria-os-office-workspace-action-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    caseCount: number;
    passedCount: number;
    failedCount: number;
    fastPathCount: number;
    modelRuntimeCount: number;
    spreadsheetCases: number;
    documentCases: number;
    trainingSeedCount: number;
  };
  results: GateResult[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "hydria-os-office-workspace-action-gate-v1.json");
const defaultTrainingOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-os-office-workspace-action-sft-seed-v1.jsonl"
);

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
    trainingOutput: resolve(projectRoot, readOption(argv, "--training-output") ?? defaultTrainingOutput)
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
                    snippet: "Fixture source used by the office workspace gate.",
                    excerpt: "The normal runtime was allowed to run before the OS action was proposed."
                  }
                ]
              : []
        },
        generation: {
          provider: "ollama",
          model: "qwen2.5:3b",
          specialist: {
            role: "workspace_runtime"
          },
          attempts: [{ model: "qwen2.5:3b" }]
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

async function evaluateCase(caseItem: GateCase): Promise<GateResult> {
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
  const action = findPrimaryAction(response.proposedActions, caseItem.expected.actionType);
  const issues: string[] = [];
  const usedFastPath = response.models.provider === "policy" && response.models.model === "workspace_action_planner_v1";

  if (usedFastPath !== caseItem.expected.fastPath) {
    issues.push(`fastPath:${usedFastPath}!=${caseItem.expected.fastPath}`);
  }
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
    id: caseItem.id,
    workspaceFamily: caseItem.workspaceFamily,
    passed: issues.length === 0,
    issues,
    modelProvider: response.models.provider,
    modelAttempts: response.models.attempts,
    actionType: action?.type ?? null,
    proposedAction: action ? compactAction(action) : null
  };
}

function buildTrainingSeedLine(caseItem: GateCase, result: GateResult) {
  if (!result.proposedAction || result.proposedAction.type === "reply") {
    return null;
  }

  const targetAnswer = JSON.stringify(
    {
      proposedActions: [result.proposedAction]
    }
  );

  return {
    version: "hydria-os-office-workspace-action-sft-seed-v1",
    exampleId: caseItem.id,
    source: "hydria_os_office_workspace_action_pack",
    workspaceFamily: caseItem.workspaceFamily,
    task: "workspace_action_planning",
    weight: caseItem.expected.fastPath ? 1.4 : 1.15,
    keepReason: caseItem.trainingNote,
    messages: [
      {
        role: "system",
        content:
          "You are Hydria Core. Return only safe dry-run Hydria OS proposedActions. Never execute actions. Preserve active workObjectId and entryPath."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            input: caseItem.input,
            workspaceContext: caseItem.workspaceContext
          }
        )
      },
      {
        role: "assistant",
        content: targetAnswer
      }
    ],
    targetAnswer,
    target: {
      proposedActions: [result.proposedAction]
    }
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runHydriaOsOfficeWorkspaceActionGate(args = parseArgs()) {
  const results: GateResult[] = [];
  for (const caseItem of hydriaOsOfficeWorkspaceActionPack) {
    results.push(await evaluateCase(caseItem));
  }
  const seedLines = hydriaOsOfficeWorkspaceActionPack
    .map((caseItem, index) => {
      const result = results[index];
      return result ? buildTrainingSeedLine(caseItem, result) : null;
    })
    .filter(Boolean);
  const report: GateReport = {
    version: "hydria-os-office-workspace-action-gate-v1",
    generatedAt: new Date().toISOString(),
    passed: results.every((result) => result.passed),
    summary: {
      caseCount: results.length,
      passedCount: results.filter((result) => result.passed).length,
      failedCount: results.filter((result) => !result.passed).length,
      fastPathCount: results.filter((result) => result.modelProvider === "policy").length,
      modelRuntimeCount: results.filter((result) => result.modelProvider !== "policy").length,
      spreadsheetCases: results.filter((result) => result.workspaceFamily === "data_spreadsheet").length,
      documentCases: results.filter((result) => result.workspaceFamily === "document_knowledge").length,
      trainingSeedCount: seedLines.length
    },
    results
  };

  await writeJson(args.output, report);
  await mkdir(dirname(args.trainingOutput), { recursive: true });
  await writeFile(args.trainingOutput, `${seedLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        failedCases: report.results
          .filter((result) => !result.passed)
          .map((result) => ({ id: result.id, issues: result.issues })),
        output: args.output,
        trainingOutput: args.trainingOutput
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
  runHydriaOsOfficeWorkspaceActionGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

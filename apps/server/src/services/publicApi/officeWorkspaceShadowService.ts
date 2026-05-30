import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { PublicApiAskRequest, PublicApiAskResponse, PublicApiProposedAction } from "../../types/publicApi.js";
import { env } from "../../utils/env.js";
import { OfficeWorkspaceRawQwenActionAdapter } from "./officeWorkspaceRawQwenActionAdapter.js";

type OfficeWorkspaceShadowAdapter = Pick<OfficeWorkspaceRawQwenActionAdapter, "plan">;

export type OfficeWorkspaceShadowVerdict = "match" | "candidate_diff" | "candidate_failed";

export type OfficeWorkspaceShadowEvent = {
  version: "hydria-os-office-workspace-shadow-v1";
  eventId: string;
  generatedAt: string;
  requestId: string;
  sessionId: string;
  workspaceFamily: "data_spreadsheet" | "document_knowledge" | "unknown";
  inputPreview: string;
  official: {
    provider: string;
    model: string;
    actionCount: number;
    actions: Array<Omit<PublicApiProposedAction, "id" | "provenance">>;
  };
  candidate: {
    provider: "ollama";
    model: string;
    promptTemplate: "qwen_raw_chat";
    durationMs: number;
    actionCount: number;
    actions: Array<Omit<PublicApiProposedAction, "id" | "provenance">>;
    adapterIssues: string[];
    rawPreview: string;
  } | null;
  comparison: {
    verdict: OfficeWorkspaceShadowVerdict;
    issues: string[];
    dryRunSafe: boolean;
    candidateMatchesOfficial: boolean;
  };
  promotion: {
    eligibleForAutoPromotion: false;
    reason: string;
  };
};

export type OfficeWorkspaceShadowRunArgs = {
  request: PublicApiAskRequest;
  official: PublicApiAskResponse;
};

type OfficeWorkspaceShadowServiceOptions = {
  adapter?: OfficeWorkspaceShadowAdapter;
  logFile?: string;
  now?: () => Date;
  eventId?: () => string;
};

const defaultModel = "student-local-1p5b-toolbench-lora-v11-office-workspace-light:latest";

function compact(value: unknown, maxChars = 900) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trim()}...`;
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

function inferWorkspaceFamily(request: PublicApiAskRequest): OfficeWorkspaceShadowEvent["workspaceFamily"] {
  const metadataFamily = String(request.metadata?.workspaceFamilyId ?? request.metadata?.workspaceFamily ?? "").toLowerCase();
  const active = request.workspaceContext?.activeWorkObject;
  const kind = normalize(active?.kind);
  const entryPath = normalize(active?.entryPath);
  const input = normalize(request.input ?? request.question ?? "");

  if (
    metadataFamily === "data_spreadsheet" ||
    kind === "dataset" ||
    /\.(csv|xlsx|xls)\b/.test(entryPath) ||
    /\b(excel|xlsx|xls|csv|tableur|spreadsheet|sheet|feuille|classeur)\b/.test(input)
  ) {
    return "data_spreadsheet";
  }
  if (
    metadataFamily === "document_knowledge" ||
    kind === "document" ||
    /\.(md|txt|docx|html|pdf)\b/.test(entryPath) ||
    /\b(word|docx|document|rapport|brief|note|wiki|sop|memo|texte)\b/.test(input)
  ) {
    return "document_knowledge";
  }
  return "unknown";
}

export function shouldRunOfficeWorkspaceShadow(request: PublicApiAskRequest) {
  return Boolean(request.workspaceContext && inferWorkspaceFamily(request) !== "unknown");
}

function valuesInclude(actual: unknown, expected: unknown) {
  if (!Array.isArray(expected) || expected.length === 0) {
    return true;
  }
  if (!Array.isArray(actual)) {
    return false;
  }
  const actualText = actual.map(normalize).join(" | ");
  return expected.every((entry) => actualText.includes(normalize(entry)));
}

function compareActions(official: PublicApiProposedAction[], candidate: PublicApiProposedAction[]) {
  const issues: string[] = [];
  const dryRunSafe = candidate.every((action) => action.dryRun === true);

  if (official.length !== candidate.length) {
    issues.push(`action_count:${candidate.length}!=${official.length}`);
  }

  official.forEach((expected, index) => {
    const actual = candidate[index];
    if (!actual) {
      issues.push(`action_${index}_missing`);
      return;
    }
    if (actual.type !== expected.type) {
      issues.push(`action_${index}_type:${actual.type}!=${expected.type}`);
    }
    if (actual.target.workObjectId !== expected.target.workObjectId) {
      issues.push(`action_${index}_target:${actual.target.workObjectId}!=${expected.target.workObjectId}`);
    }
    if (actual.target.entryPath !== expected.target.entryPath) {
      issues.push(`action_${index}_entry_path:${actual.target.entryPath}!=${expected.target.entryPath}`);
    }
    for (const key of ["format", "kind", "mode"] as const) {
      if (expected.payload[key] !== undefined && actual.payload[key] !== expected.payload[key]) {
        issues.push(`action_${index}_${key}:${String(actual.payload[key])}!=${String(expected.payload[key])}`);
      }
    }
    for (const key of ["columns", "sections"] as const) {
      if (!valuesInclude(actual.payload[key], expected.payload[key])) {
        issues.push(`action_${index}_missing_${key}`);
      }
    }
    if (!actual.dryRun) {
      issues.push(`action_${index}_not_dry_run`);
    }
  });

  return {
    issues,
    dryRunSafe,
    matches: issues.length === 0
  };
}

export class OfficeWorkspaceShadowService {
  private readonly adapter: OfficeWorkspaceShadowAdapter;
  private readonly logFile: string;
  private readonly now: () => Date;
  private readonly eventId: () => string;

  constructor(options: OfficeWorkspaceShadowServiceOptions = {}) {
    this.adapter =
      options.adapter ??
      new OfficeWorkspaceRawQwenActionAdapter({
        baseUrl: env.HYDRIA_OS_OFFICE_V11_SHADOW_BASE_URL.trim() || env.LOCAL_MODEL_BASE_URL,
        model: env.HYDRIA_OS_OFFICE_V11_SHADOW_MODEL || defaultModel,
        timeoutMs: env.HYDRIA_OS_OFFICE_V11_SHADOW_TIMEOUT_MS
      });
    this.logFile = options.logFile ?? env.HYDRIA_OS_OFFICE_V11_SHADOW_FILE;
    this.now = options.now ?? (() => new Date());
    this.eventId = options.eventId ?? randomUUID;
  }

  async run(args: OfficeWorkspaceShadowRunArgs) {
    const generatedAt = this.now().toISOString();
    const officialActions = args.official.proposedActions;
    const workspaceFamily = inferWorkspaceFamily(args.request);

    try {
      const candidate = await this.adapter.plan({
        request: args.request,
        requestId: args.official.id,
        createdAt: generatedAt,
        runtimeAnswer: args.official.answer,
        sourceCount: args.official.sources.length
      });
      const comparison = compareActions(officialActions, candidate.proposedActions);
      const allIssues = [...candidate.issues, ...comparison.issues];
      const event: OfficeWorkspaceShadowEvent = {
        version: "hydria-os-office-workspace-shadow-v1",
        eventId: this.eventId(),
        generatedAt,
        requestId: args.official.id,
        sessionId: args.official.sessionId,
        workspaceFamily,
        inputPreview: compact(args.request.input ?? args.request.question ?? "", 1200),
        official: {
          provider: args.official.models.provider,
          model: args.official.models.model,
          actionCount: officialActions.length,
          actions: officialActions.map(compactAction)
        },
        candidate: {
          provider: candidate.provider,
          model: candidate.model,
          promptTemplate: candidate.promptTemplate,
          durationMs: candidate.durationMs,
          actionCount: candidate.proposedActions.length,
          actions: candidate.proposedActions.map(compactAction),
          adapterIssues: candidate.issues,
          rawPreview: compact(candidate.rawResponse, 1200)
        },
        comparison: {
          verdict: allIssues.length === 0 ? "match" : "candidate_diff",
          issues: allIssues,
          dryRunSafe: candidate.issues.every((issue) => !issue.includes("not_dry_run")) && comparison.dryRunSafe,
          candidateMatchesOfficial: allIssues.length === 0
        },
        promotion: {
          eligibleForAutoPromotion: false,
          reason: "Shadow events are observational only. Promotion requires a separate reviewed gate."
        }
      };
      await this.append(event);
      return event;
    } catch (error) {
      const event: OfficeWorkspaceShadowEvent = {
        version: "hydria-os-office-workspace-shadow-v1",
        eventId: this.eventId(),
        generatedAt,
        requestId: args.official.id,
        sessionId: args.official.sessionId,
        workspaceFamily,
        inputPreview: compact(args.request.input ?? args.request.question ?? "", 1200),
        official: {
          provider: args.official.models.provider,
          model: args.official.models.model,
          actionCount: officialActions.length,
          actions: officialActions.map(compactAction)
        },
        candidate: null,
        comparison: {
          verdict: "candidate_failed",
          issues: [`candidate_failed:${String(error)}`],
          dryRunSafe: false,
          candidateMatchesOfficial: false
        },
        promotion: {
          eligibleForAutoPromotion: false,
          reason: "Shadow candidate failed. v10 official runtime remains active."
        }
      };
      await this.append(event);
      return event;
    }
  }

  async append(event: OfficeWorkspaceShadowEvent) {
    await mkdir(dirname(this.logFile), { recursive: true });
    await appendFile(this.logFile, `${JSON.stringify(event)}\n`, "utf8");
  }

  async loadEvents() {
    try {
      const raw = await readFile(this.logFile, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OfficeWorkspaceShadowEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async writeReport(outputFile: string) {
    const events = await this.loadEvents();
    const matched = events.filter((event) => event.comparison.verdict === "match").length;
    const candidateDiff = events.filter((event) => event.comparison.verdict === "candidate_diff").length;
    const candidateFailed = events.filter((event) => event.comparison.verdict === "candidate_failed").length;
    const dryRunUnsafe = events.filter((event) => !event.comparison.dryRunSafe).length;
    const report = {
      version: "hydria-os-office-workspace-shadow-report-v1",
      generatedAt: this.now().toISOString(),
      input: this.logFile,
      promotion: {
        recommended: false,
        reason:
          events.length >= 50 && candidateDiff === 0 && candidateFailed === 0 && dryRunUnsafe === 0
            ? "Shadow sample is clean, but promotion still requires an explicit reviewed runtime switch."
            : "Keep v10 active until enough clean shadow samples exist."
      },
      summary: {
        eventCount: events.length,
        matched,
        candidateDiff,
        candidateFailed,
        dryRunUnsafe,
        matchRate: events.length > 0 ? Number(((matched / events.length) * 100).toFixed(1)) : 0
      },
      recentIssues: events
        .filter((event) => event.comparison.verdict !== "match")
        .slice(-20)
        .map((event) => ({
          eventId: event.eventId,
          generatedAt: event.generatedAt,
          workspaceFamily: event.workspaceFamily,
          inputPreview: event.inputPreview,
          verdict: event.comparison.verdict,
          issues: event.comparison.issues
        }))
    };

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }
}

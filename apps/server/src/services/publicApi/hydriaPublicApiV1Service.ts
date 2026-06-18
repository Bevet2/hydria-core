import { randomUUID } from "node:crypto";
import type { ChatRuntimeService } from "../chatRuntimeService.js";
import {
  isLongFormRequest,
  LongFormGenerationService,
  buildSourcesBlock
} from "./longFormGenerationService.js";
import { WorkspaceSessionMemoryService } from "./workspaceSessionMemoryService.js";
import { WorkspaceKnowledgeExtractorService } from "./workspaceKnowledgeExtractorService.js";
import {
  publicApiAskResponseSchema,
  publicApiCapabilitiesResponseSchema,
  publicApiSessionResetResponseSchema,
  publicApiSessionResponseSchema,
  type PublicApiAskRequest,
  type PublicApiAskResponse,
  type PublicApiCapabilitiesResponse,
  type PublicApiSessionResetResponse,
  type PublicApiSessionResponse
} from "../../types/publicApi.js";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import {
  planPublicApiProposedActions,
  shouldUsePublicApiWorkspaceActionFastPath
} from "./osActionPlanner.js";
import {
  shouldRunOfficeWorkspaceShadow,
  type OfficeWorkspaceShadowService
} from "./officeWorkspaceShadowService.js";
import { verifyPublicApiProposedActions } from "./workspaceActionVerifier.js";
import type {
  ExecuteWorkObjectActionArgs,
  ListWorkObjectsOptions,
  UpdateWorkObjectContentArgs,
  WorkObjectExecutionService
} from "../workObjects/workObjectExecutionService.js";
import type {
  WorkObject,
  WorkObjectArtifact,
  WorkObjectExecutionResult
} from "../../types/workObjects.js";
import type { InteractionLogStore } from "../interactionLogStore.js";

type HydriaPublicApiV1ServiceDeps = {
  chatRuntimeService: Pick<ChatRuntimeService, "sendMessage" | "resetSession">;
  interactionLogStore?: Pick<InteractionLogStore, "safeAppend"> & Partial<Pick<InteractionLogStore, "listRecent">>;
  officeWorkspaceShadowService?: Pick<OfficeWorkspaceShadowService, "run">;
  officeWorkspaceShadowEnabled?: boolean;
  workObjectExecutionService?: Pick<
    WorkObjectExecutionService,
    | "executeAction"
    | "listWorkObjects"
    | "listArtifacts"
    | "getWorkObject"
    | "readArtifactContent"
    | "readContent"
    | "updateContent"
  >;
};

type ParsedSheetPreview = {
  columns: string[];
  rows: string[][];
};

type NumericSheetEntry = {
  rowIndex: number;
  label: string;
  value: number;
};

function resolveQuestion(request: PublicApiAskRequest) {
  return (request.input ?? request.question ?? "").trim();
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown, maxChars = 500) {
  if (!value) {
    return null;
  }
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function shouldInjectWorkspaceContext(request: PublicApiAskRequest) {
  const active = request.workspaceContext?.activeWorkObject;
  if (!active?.contentPreview) {
    return false;
  }

  // Always inject when the active object is a data-bearing type — the user
  // almost certainly needs the content regardless of the exact phrasing.
  const kind = normalizeText(active.kind ?? "");
  const family = normalizeText(active.workspaceFamilyId ?? "");
  if (
    kind === "dataset" ||
    kind === "spreadsheet" ||
    family === "data_spreadsheet" ||
    family === "crm_sales"
  ) {
    return true;
  }

  const question = normalizeText(resolveQuestion(request));
  return /\b(comment|commente|commenter|analyse|analyser|explique|explain|resume|synthese|insight|tendance|chiffres?|numbers?|donnees|tableau|sheet|excel)\b/.test(question) ||
    // Report / summary vocabulary (with or without accents, already stripped by normalizeText)
    /\b(compte.?rendu|bilan|rapport|performance[s]?|recapitulatif|recap|synthese|panorama|etat.?des.?lieux|revue|reporting|apercu|dashboard|briefing)\b/.test(question) ||
    // Action verbs that imply reading the active content
    /\b(lis|lire|consulte|consulter|parcours|parcourir|verifie|verifier|compare|comparer|detaille|detailler|presente|presenter|decris|decrire|donne.?moi|dis.?moi)\b/.test(question);
}

function parseNumber(value: unknown) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === ".") {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function parseSheetPreview(value: unknown): ParsedSheetPreview | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const sheet = Array.isArray(parsed?.sheets)
      ? parsed.sheets.find((candidate: any) => candidate?.id === parsed.activeSheetId) ?? parsed.sheets[0]
      : null;
    if (sheet && Array.isArray(sheet.columns) && Array.isArray(sheet.rows)) {
      return {
        columns: sheet.columns.map((column: unknown) => String(column ?? "")),
        rows: sheet.rows.map((row: unknown) => Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [])
      };
    }
  } catch {
    // Fall through to CSV parsing below.
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return null;
  }
  const separator = (lines[0]?.match(/;/g)?.length ?? 0) > (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const columns = (lines[0] ?? "").split(separator).map((cell) => cell.trim());
  const rows = lines.slice(1, 25).map((line) => line.split(separator).map((cell) => cell.trim()));
  return { columns, rows };
}

function isWorkspaceDataReadRequest(request: PublicApiAskRequest) {
  const question = normalizeText(resolveQuestion(request));
  return Boolean(request.workspaceContext?.activeWorkObject?.contentPreview) &&
    /\b(comment|commente|commenter|analyse|analyser|insight|tendance|chiffres?|numbers?|donnees|data|resume|resumer|synthese|explain)\b/.test(question);
}

function buildWorkspaceDataAnswer(request: PublicApiAskRequest) {
  if (!isWorkspaceDataReadRequest(request)) {
    return null;
  }

  const active = request.workspaceContext?.activeWorkObject;
  const sheet = parseSheetPreview(active?.contentPreview);
  if (!sheet || sheet.rows.length === 0) {
    return null;
  }

  const question = resolveQuestion(request);
  const language = /\b(commente|analyse|chiffres?|donnees|data)\b/i.test(normalizeText(question))
    ? "fr"
    : inferLanguage(question);
  const numericColumns = sheet.columns
    .map((column, columnIndex) => ({
      column,
      columnIndex,
      values: sheet.rows
        .map((row, rowIndex) => ({
          rowIndex,
          label: row[0] || `ligne ${rowIndex + 2}`,
          value: parseNumber(row[columnIndex])
        }))
        .filter((entry): entry is NumericSheetEntry => entry.value !== null)
    }))
    .filter((candidate) => candidate.values.length > 0)
    .sort((left, right) => right.values.length - left.values.length);

  if (numericColumns.length === 0) {
    const columns = sheet.columns.filter(Boolean).slice(0, 6).join(", ");
    return language === "fr"
      ? `Le tableau contient ${sheet.rows.length} ligne(s) et les colonnes principales sont : ${columns || "non nommees"}.`
      : `The table contains ${sheet.rows.length} row(s); the main columns are: ${columns || "unnamed"}.`;
  }

  const selected = numericColumns[0]!;
  const values = selected.values;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const max = values.reduce((best, entry) => entry.value > best.value ? entry : best, first);
  const min = values.reduce((best, entry) => entry.value < best.value ? entry : best, first);
  const total = values.reduce((sum, entry) => sum + entry.value, 0);
  const direction = last.value > first.value ? "up" : last.value < first.value ? "down" : "flat";
  const columnName = selected.column || "valeur";

  if (values.length === 1) {
    return language === "fr"
      ? `${columnName} vaut ${formatNumber(first.value)} pour ${first.label}.`
      : `${columnName} is ${formatNumber(first.value)} for ${first.label}.`;
  }

  if (language === "fr") {
    const trend = direction === "up"
      ? "progresse"
      : direction === "down"
        ? "recule"
        : "reste stable";
    return `${columnName} ${trend} de ${first.label} (${formatNumber(first.value)}) a ${last.label} (${formatNumber(last.value)}); pic a ${max.label} (${formatNumber(max.value)}), minimum a ${min.label} (${formatNumber(min.value)}), total ${formatNumber(total)}.`;
  }

  const trend = direction === "up" ? "increases" : direction === "down" ? "decreases" : "stays flat";
  return `${columnName} ${trend} from ${first.label} (${formatNumber(first.value)}) to ${last.label} (${formatNumber(last.value)}); peak at ${max.label} (${formatNumber(max.value)}), low at ${min.label} (${formatNumber(min.value)}), total ${formatNumber(total)}.`;
}

// Detects when a workspace question needs external knowledge in addition to local data
function shouldUseHybridMode(request: PublicApiAskRequest): boolean {
  const active = request.workspaceContext?.activeWorkObject;
  if (!active?.contentPreview) return false;
  const q = normalizeText(resolveQuestion(request));
  return /\b(pourquoi|comment.?(ameliorer|optimiser)|benchmark|meilleures?.?pratiques?|best.?practice|contextualise|comparer.*(secteur|march[eé]|industrie)|tendances?|optimis|strategi|recommandation|explication|qu[' ]?est.?ce.?que.?cela.?signifie?|que.?veut.?dire)\b/.test(q);
}

// Returns response-format instruction calibrated to the workspace object type
function buildResponseCalibration(request: PublicApiAskRequest, hasAdditional: boolean): string {
  const kind = normalizeText(request.workspaceContext?.activeWorkObject?.kind ?? "");
  const family = normalizeText(request.workspaceContext?.activeWorkObject?.workspaceFamilyId ?? "");
  const isData = kind === "dataset" || kind === "spreadsheet" || family === "data_spreadsheet" || family === "crm_sales";
  if (hasAdditional) {
    return "Format: structure ta reponse avec des titres par source, puis une synthese. Bullet points pour les differences cles.";
  }
  if (isData) {
    return "Format: reponse concise et structuree. Bullet points pour plusieurs elements. Maximum 3-4 paragraphes.";
  }
  return "Format: adapte la longueur a la complexite de la question. Garde la reponse actionnable.";
}

function buildRuntimeQuestion(
  request: PublicApiAskRequest,
  sessionMemoryBlock?: string | null,
  priorActionsBlock?: string | null
) {
  const question = resolveQuestion(request);
  const hasWorkspaceContext = shouldInjectWorkspaceContext(request);
  const hybrid = shouldUseHybridMode(request);

  if (!hasWorkspaceContext && !sessionMemoryBlock && !priorActionsBlock) {
    return question;
  }

  const active = request.workspaceContext?.activeWorkObject;
  const additionalSources = request.workspaceContext?.additionalSources ?? [];

  const parts: string[] = ["Question utilisateur:", question, ""];

  if (sessionMemoryBlock) {
    parts.push(sessionMemoryBlock, "");
  }

  if (priorActionsBlock) {
    parts.push(priorActionsBlock, "");
  }

  if (hasWorkspaceContext && active) {
    parts.push(
      "Contexte workspace actif a utiliser pour repondre:",
      `- titre: ${active.title || active.id || "objet actif"}`,
      `- type: ${active.kind || "unknown"}`,
      `- fichier: ${active.entryPath || "unknown"}`,
      "- contenu/aperçu:",
      compact(active.contentPreview, 4000) ?? "",
      ""
    );
  }

  if (additionalSources.length > 0) {
    parts.push("Sources additionnelles a croiser:");
    for (const src of additionalSources.slice(0, 4)) {
      if (src.contentPreview) {
        parts.push(`\n[${src.title || src.kind || src.id}]:`);
        parts.push(compact(src.contentPreview, 2000) ?? "");
      }
    }
    parts.push("");
  }

  const calibration = buildResponseCalibration(request, additionalSources.length > 0);

  let instruction: string;
  if (hybrid) {
    instruction = `Instruction hybride: reponds en combinant les donnees du workspace ci-dessus ET tes connaissances generales / une recherche externe sur le sujet. Commence par contextualiser avec des references generales, puis applique au cas specifique de l'utilisateur. ${calibration} Garde la langue de l'utilisateur.`;
  } else if (additionalSources.length > 0) {
    instruction = `Instruction: reponds en croisant toutes les sources disponibles. Ne pretends pas que les donnees manquent si elles sont dans les aperçus. Identifie les convergences et differences entre sources. ${calibration} Garde la langue de l'utilisateur.`;
  } else {
    instruction = `Instruction: reponds a la question utilisateur en utilisant les donnees du workspace actif. Ne pretends pas que les donnees manquent si elles sont dans l'aperçu. ${calibration} Garde la langue de l'utilisateur.`;
  }

  parts.push(instruction);
  // Keep empty strings (blank-line separators between sections) — only strip null/undefined
  return parts.filter((line): line is string => line !== null && line !== undefined).join("\n");
}

function sourceList(result: Awaited<ReturnType<ChatRuntimeService["sendMessage"]>>) {
  return result.tooling.sources.slice(0, 8).map((source) => ({
    title: source.title || source.url || "source",
    url: source.url || null,
    snippet: compact(source.snippet, 360),
    excerpt: compact(source.excerpt, 700)
  }));
}

function attemptModels(result: Awaited<ReturnType<ChatRuntimeService["sendMessage"]>>) {
  const attempts = result.generation.attempts?.map((attempt) => attempt.model).filter(Boolean) ?? [];
  return [...new Set(attempts.length > 0 ? attempts : [result.generation.model])];
}

function inferLanguage(value: string) {
  return /\b(le|la|les|une|un|des|dans|avec|pour|ajoute|cree|crée|tableur|colonne)\b/i.test(value)
    ? "fr"
    : "en";
}

function buildWorkspaceActionAnswer(actionCount: number, language: "fr" | "en") {
  if (language === "fr") {
    return actionCount > 1
      ? `${actionCount} actions OS sont proposees en dry-run.`
      : "Une action OS est proposee en dry-run.";
  }

  return actionCount > 1
    ? `${actionCount} OS actions are proposed as dry-run.`
    : "One OS action is proposed as dry-run.";
}

function summarizeAction(action: PublicApiAskResponse["proposedActions"][number]) {
  return {
    id: action.id,
    type: action.type,
    title: compact(action.title, 180),
    target: action.target,
    toolName: compact(action.payload.toolName, 120) || null,
    operationTypes: Array.isArray(action.payload.operations)
      ? action.payload.operations
          .map((operation) =>
            typeof operation === "object" && operation !== null
              ? compact((operation as Record<string, unknown>).type, 120)
              : ""
          )
          .filter(Boolean)
          .slice(0, 20)
      : [],
    riskLevel: action.riskLevel,
    requiresConfirmation: action.requiresConfirmation,
    dryRun: action.dryRun
  };
}

function summarizeWorkspaceContext(request: PublicApiAskRequest) {
  const active = request.workspaceContext?.activeWorkObject;
  return active
    ? {
        activeWorkObject: {
          id: active.id,
          title: compact(active.title, 180),
          kind: compact(active.kind, 80),
          workspaceFamilyId: compact(active.workspaceFamilyId, 120),
          entryPath: compact(active.entryPath, 260),
          contentPreview: compact(active.contentPreview, 1200),
          editable: active.editable ?? null
        },
        capabilityActions: request.workspaceContext?.capabilities?.actions ?? [],
        workspaceTools: request.workspaceContext?.capabilities?.workspaceTools ?? [],
        executionPolicy: request.workspaceContext?.executionPolicy ?? null
      }
    : null;
}

// In-memory session action tracker (bounded to 120 sessions, FIFO eviction)
const SESSION_ACTION_STORE = new Map<string, string[]>();
const SESSION_ACTION_LIMIT = 120;

function recordSessionAction(sessionId: string, summary: string) {
  if (!SESSION_ACTION_STORE.has(sessionId)) {
    if (SESSION_ACTION_STORE.size >= SESSION_ACTION_LIMIT) {
      const oldest = SESSION_ACTION_STORE.keys().next().value;
      if (oldest) SESSION_ACTION_STORE.delete(oldest);
    }
    SESSION_ACTION_STORE.set(sessionId, []);
  }
  const actions = SESSION_ACTION_STORE.get(sessionId)!;
  actions.push(summary);
  if (actions.length > 12) actions.shift();
}

function buildPriorActionsBlock(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  const actions = SESSION_ACTION_STORE.get(sessionId);
  if (!actions || actions.length === 0) return null;
  return `Actions déjà effectuées dans cette session (ne pas reproduire):\n${actions.map((a) => `- ${a}`).join("\n")}`;
}

export class HydriaPublicApiV1Service {
  constructor(private readonly deps: HydriaPublicApiV1ServiceDeps) {}

  private shouldExecuteConfirmedWorkspaceActions(request: PublicApiAskRequest) {
    const policy = request.workspaceContext?.executionPolicy;
    return policy?.mode === "execute_after_confirmation" && policy.requireConfirmation === false;
  }

  private async attachExecutedWorkspaceActions(
    request: PublicApiAskRequest,
    response: PublicApiAskResponse
  ): Promise<PublicApiAskResponse> {
    if (!this.deps.workObjectExecutionService || !this.shouldExecuteConfirmedWorkspaceActions(request)) {
      return response;
    }

    const results: WorkObjectExecutionResult[] = [];
    for (const action of response.proposedActions.filter((candidate) => candidate.type !== "reply")) {
      results.push(
        await this.executeAndAuditAction({
          action,
          confirmed: true,
          sessionId: response.sessionId,
          userId: request.userId ?? null,
          projectId: request.projectId ?? null
        })
      );
    }

    if (results.length === 0) {
      return response;
    }

    const workObjects = results
      .map((result) => result.workObject)
      .filter((workObject): workObject is WorkObject => Boolean(workObject));
    const artifacts = results
      .map((result) => result.artifact)
      .filter((artifact): artifact is WorkObjectArtifact => Boolean(artifact));
    const activeWorkObject = workObjects.at(-1) ?? response.activeWorkObject ?? null;
    const executedCount = results.filter((result) => result.status === "executed").length;
    const answer =
      executedCount > 0
        ? response.language === "fr"
          ? `${executedCount} action OS executee. Objet de travail pret et trace.`
          : `${executedCount} OS action executed. Work object is ready and traceable.`
        : response.answer;

    return publicApiAskResponseSchema.parse({
      ...response,
      answer,
      proposedActions: response.proposedActions.map((action) => ({
        ...action,
        dryRun: !results.some((result) => result.actionId === action.id && result.status === "executed")
      })),
      executedActions: results,
      activeWorkObject,
      workObjects,
      artifacts
    });
  }

  private triggerOfficeWorkspaceShadow(request: PublicApiAskRequest, official: PublicApiAskResponse) {
    if (!this.deps.officeWorkspaceShadowEnabled || !this.deps.officeWorkspaceShadowService) {
      return;
    }
    if (!shouldRunOfficeWorkspaceShadow(request)) {
      return;
    }

    void this.deps.officeWorkspaceShadowService.run({ request, official }).catch((error) => {
      logger.warn("Hydria OS Office v11 shadow comparison failed", {
        error: String(error),
        requestId: official.id
      });
    });
  }

  private async executeAndAuditAction(args: ExecuteWorkObjectActionArgs) {
    if (!this.deps.workObjectExecutionService) {
      throw new Error("Hydria OS work object execution is not configured.");
    }
    const result = await this.deps.workObjectExecutionService.executeAction(args);
    await this.persistWorkspaceActionAudit(args, result);
    return result;
  }

  private async persistWorkspaceActionAudit(args: ExecuteWorkObjectActionArgs, result: WorkObjectExecutionResult) {
    const instruction = compact(args.action.payload.instruction, 12000) || args.action.title;
    await this.deps.interactionLogStore?.safeAppend({
      scope: "workspace_action",
      source: "public_api",
      mode: "chat",
      status:
        result.status === "executed"
          ? "completed"
          : result.status === "failed"
            ? "failed"
            : "accepted",
      sessionId: args.sessionId ?? null,
      artifactId: result.workObject?.id ?? result.artifact?.id ?? args.action.id,
      question: instruction,
      answer: result.summary,
      summary: result.summary,
      routing: {
        orchestrator: "hydria_public_api_v1",
        provider: "workspace",
        model: compact(args.action.payload.toolName, 120) || args.action.type,
        category: "workspace_action",
        toolUsed: args.action.type === "workspace_tool_call"
      },
      quality: {
        passed: result.status === "executed" && result.issues.length === 0,
        score: result.status === "executed" && result.issues.length === 0 ? 1 : 0,
        issues: result.issues.slice(0, 24)
      },
      durationMs: null,
      payload: {
        action: summarizeAction(args.action as PublicApiAskResponse["proposedActions"][number]),
        execution: {
          id: result.id,
          status: result.status,
          confirmed: result.confirmed,
          dryRun: result.dryRun,
          workObjectId: result.workObject?.id ?? null,
          artifactId: result.artifact?.id ?? null
        }
      }
    });
  }

  private async persistAskAudit(request: PublicApiAskRequest, response: PublicApiAskResponse) {
    await this.deps.interactionLogStore?.safeAppend({
      scope: "public_api_ask",
      source: "public_api",
      mode: "chat",
      status: response.quality.passed === false ? "failed" : "completed",
      sessionId: response.sessionId,
      artifactId: response.activeWorkObject?.id ?? request.workspaceContext?.activeWorkObject?.id ?? null,
      question: resolveQuestion(request),
      answer: response.answer,
      summary: compact(response.answer, 900),
      routing: {
        orchestrator: "hydria_public_api_v1",
        provider: response.models.provider,
        model: response.models.model,
        category: response.category,
        toolUsed: response.tools.used || response.proposedActions.some((action) => action.type === "workspace_tool_call")
      },
      quality: {
        passed: response.quality.passed,
        score: response.confidence === null ? null : response.confidence / 100,
        issues: response.quality.issues.slice(0, 24)
      },
      durationMs: response.quality.durationMs,
      payload: {
        language: response.language,
        tools: response.tools,
        models: response.models,
        sources: response.sources.slice(0, 8),
        proposedActions: response.proposedActions.map(summarizeAction),
        executedActions: response.executedActions.map((result) => ({
          id: result.id,
          actionId: result.actionId,
          actionType: result.actionType,
          status: result.status,
          workObjectId: result.workObject?.id ?? null,
          artifactId: result.artifact?.id ?? null,
          issues: result.issues
        })),
        workspaceContext: summarizeWorkspaceContext(request)
      }
    });
  }

  async ask(request: PublicApiAskRequest): Promise<PublicApiAskResponse> {
    const requestId = randomUUID();
    const fastPathCreatedAt = new Date().toISOString();

    if (shouldUsePublicApiWorkspaceActionFastPath(request)) {
      const proposedActions = verifyPublicApiProposedActions({
        request,
        actions: planPublicApiProposedActions({
          requestId,
          createdAt: fastPathCreatedAt,
          request,
          answer: ""
        })
      });
      const actionable = proposedActions.filter((action) => action.type !== "reply");

      if (actionable.length > 0) {
        const language = inferLanguage(resolveQuestion(request));
        const sessionId = request.sessionId ?? randomUUID();
        const response = publicApiAskResponseSchema.parse({
          id: requestId,
          object: "hydria.answer",
          createdAt: fastPathCreatedAt,
          sessionId,
          answer: buildWorkspaceActionAnswer(actionable.length, language),
          language,
          category: "workspace_action",
          confidence: 92,
          sources: [],
          tools: {
            used: false,
            route: "not_needed",
            type: "none",
            intent: "workspace_action_plan",
            sourceCount: 0
          },
          models: {
            provider: "policy",
            model: "workspace_action_planner_v1",
            specialistRole: "os_action_contract",
            attempts: ["workspace_action_planner_v1"]
          },
          memory: {
            sessionId,
            userGoal: resolveQuestion(request),
            activeConstraints: [],
            contextTracked: Boolean(request.workspaceContext?.activeWorkObject)
          },
          quality: {
            passed: true,
            issues: [],
            retryUsed: false,
            durationMs: 0
          },
          proposedActions: actionable,
          ...(request.options.includeTrace
            ? {
                trace: {
                  version: "public_api_workspace_action_trace_v1",
                  disclosure: "runtime_trace_no_private_chain_of_thought",
                  steps: ["workspace_context_received", "deterministic_action_plan"]
                }
              }
            : {}),
          ...(request.options.includeDiagnostics
            ? {
                diagnostics: {
                  runtimeMode: "workspace_action_fast_path",
                  actionPlanner: {
                    proposed: actionable.length,
                    skippedModelGeneration: true
                  }
                }
              }
            : {})
        });
        this.triggerOfficeWorkspaceShadow(request, response);
        const finalResponse = await this.attachExecutedWorkspaceActions(request, response);
        await this.persistAskAudit(request, finalResponse);
        return finalResponse;
      }
    }

    const workspaceDataAnswer = buildWorkspaceDataAnswer(request);
    if (workspaceDataAnswer) {
      const question = resolveQuestion(request);
      const language = /\b(commente|analyse|chiffres?|donnees|data)\b/i.test(normalizeText(question))
        ? "fr"
        : inferLanguage(question);
      const sessionId = request.sessionId ?? randomUUID();
      const proposedActions = verifyPublicApiProposedActions({
        request,
        actions: planPublicApiProposedActions({
          requestId,
          createdAt: fastPathCreatedAt,
          request,
          answer: workspaceDataAnswer
        })
      });
      const response = publicApiAskResponseSchema.parse({
        id: requestId,
        object: "hydria.answer",
        createdAt: fastPathCreatedAt,
        sessionId,
        answer: workspaceDataAnswer,
        language,
        category: "workspace_context_analysis",
        confidence: 88,
        sources: [],
        tools: {
          used: true,
          route: "workspace_context",
          type: "workspace_context",
          intent: "active_work_object_read",
          sourceCount: 0
        },
        models: {
          provider: "policy",
          model: "workspace_context_answer_v1",
          specialistRole: "workspace_data_reader",
          attempts: ["workspace_context_answer_v1"]
        },
        memory: {
          sessionId,
          userGoal: question,
          activeConstraints: [],
          contextTracked: true
        },
        quality: {
          passed: true,
          issues: [],
          retryUsed: false,
          durationMs: 0
        },
        proposedActions,
        ...(request.options.includeTrace
          ? {
              trace: {
                version: "public_api_workspace_context_answer_trace_v1",
                disclosure: "runtime_trace_no_private_chain_of_thought",
                steps: ["workspace_context_received", "active_work_object_read", "deterministic_data_summary"]
              }
            }
          : {}),
        ...(request.options.includeDiagnostics
          ? {
              diagnostics: {
                runtimeMode: "workspace_context_answer",
                skippedModelGeneration: true,
                activeWorkObject: summarizeWorkspaceContext(request)
              }
            }
          : {})
      });
      await this.persistAskAudit(request, response);
      return response;
    }

    const question = resolveQuestion(request);
    const hasAdditionalSources = (request.workspaceContext?.additionalSources ?? []).length > 0;
    const sourcesBlock = buildSourcesBlock(request);
    // Long-form: trigger on explicit additional sources OR a sufficiently specific topic in the question.
    // Do NOT rely on the active workspace's sourcesBlock — an irrelevant active slide/sheet would be
    // injected as a source for an unrelated document (e.g. Napoleon biography using "New Slides" content).
    const longForm =
      isLongFormRequest(question) && (hasAdditionalSources || question.length > 55);

    // Pre-load workspace session memory for this user (fire-and-forget safe, returns null on error)
    const wsMemory = new WorkspaceSessionMemoryService();
    const sessionMemoryBlock = request.userId
      ? await wsMemory.buildContextBlock(request.userId).catch(() => null)
      : null;
    const priorActionsBlock = buildPriorActionsBlock(request.sessionId);

    if (longForm) {
      const lfService = new LongFormGenerationService(this.deps.chatRuntimeService);
      const lfResult = await lfService.generate(request);
      const lfCreatedAt = new Date().toISOString();
      const lfSessionId = lfResult.sessionId ?? request.sessionId ?? randomUUID();
      const language = inferLanguage(question);
      const proposedActions = verifyPublicApiProposedActions({
        request,
        actions: planPublicApiProposedActions({
          requestId,
          createdAt: lfCreatedAt,
          request,
          answer: lfResult.content
        })
      });
      const lfResponse = publicApiAskResponseSchema.parse({
        id: requestId,
        object: "hydria.answer",
        createdAt: lfCreatedAt,
        sessionId: lfSessionId,
        answer: lfResult.content,
        language,
        category: "long_form_generation",
        confidence: lfResult.sectionCount > 0 ? 80 : 60,
        sources: [],
        tools: {
          used: true,
          route: "long_form",
          type: "long_form_generation",
          intent: "sectioned_document_generation",
          sourceCount: (request.workspaceContext?.additionalSources ?? []).length
        },
        models: {
          provider: "local",
          model: "long_form_sectioned_v1",
          specialistRole: "document_writer",
          attempts: ["long_form_plan", ...Array.from({ length: lfResult.sectionCount }, (_, i) => `section_${i + 1}`)]
        },
        memory: {
          sessionId: lfSessionId,
          userGoal: question,
          activeConstraints: [],
          contextTracked: sourcesBlock.length > 0
        },
        quality: {
          passed: true,
          issues: [],
          retryUsed: false,
          durationMs: 0
        },
        proposedActions,
        payload: {
          runtimeMode: "long_form_generation",
          documentType: lfResult.documentType,
          sectionCount: lfResult.sectionCount,
          planParsed: lfResult.plan !== null,
          hasAdditionalSources: hasAdditionalSources,
          sourceCount: sourcesBlock.length > 0 ? (request.workspaceContext?.additionalSources?.length ?? 0) + (request.workspaceContext?.activeWorkObject?.contentPreview ? 1 : 0) : 0,
          workspaceContext: summarizeWorkspaceContext(request)
        },
        ...(request.options.includeDiagnostics
          ? {
              diagnostics: {
                runtimeMode: "long_form_generation",
                documentType: lfResult.documentType,
                sectionCount: lfResult.sectionCount,
                planParsed: lfResult.plan !== null
              }
            }
          : {})
      });
      this.triggerOfficeWorkspaceShadow(request, lfResponse);
      const finalLfResponse = await this.attachExecutedWorkspaceActions(request, lfResponse);
      if (finalLfResponse.sessionId) {
        for (const action of finalLfResponse.executedActions ?? []) {
          if (action.status === "executed") {
            const summary = `${action.actionType ?? action.actionId} sur ${action.workObject?.id ?? action.artifact?.id ?? "objet"}`;
            recordSessionAction(finalLfResponse.sessionId, summary);
          }
        }
        for (const action of finalLfResponse.proposedActions ?? []) {
          if (action.type !== "reply") {
            recordSessionAction(finalLfResponse.sessionId, `proposé: ${action.type} — ${compact(action.title, 80) ?? action.id}`);
          }
        }
      }
      await this.persistAskAudit(request, finalLfResponse);
      return finalLfResponse;
    }

    const result = await this.deps.chatRuntimeService.sendMessage({
      message: buildRuntimeQuestion(request, sessionMemoryBlock, priorActionsBlock),
      ...(request.sessionId ? { sessionId: request.sessionId } : {})
    });
    const includeSources = request.options.includeSources;
    const includeTrace = request.options.includeTrace;
    const includeDiagnostics = request.options.includeDiagnostics;
    const proposedActions = verifyPublicApiProposedActions({
      request,
      actions: planPublicApiProposedActions({
        requestId,
        createdAt: result.createdAt,
        request,
        answer: result.assistantMessage.content
      })
    });

    const response = publicApiAskResponseSchema.parse({
      id: requestId,
      object: "hydria.answer",
      createdAt: result.createdAt,
      sessionId: result.sessionId,
      answer: result.assistantMessage.content,
      language: result.conversationState.language,
      category: result.category,
      confidence: Number.isFinite(result.answer.confidence) ? result.answer.confidence : null,
      sources: includeSources ? sourceList(result) : [],
      tools: {
        used: result.tooling.used,
        route: result.tooling.route,
        type: result.tooling.routing.toolType,
        intent: result.tooling.routing.intent,
        sourceCount: result.tooling.sources.length
      },
      models: {
        provider: result.generation.provider,
        model: result.generation.model,
        specialistRole: result.generation.specialist?.role ?? null,
        attempts: attemptModels(result)
      },
      memory: {
        sessionId: result.sessionId,
        userGoal: result.conversationState.userGoal,
        activeConstraints: result.activeConstraintCapsule.topConstraints,
        contextTracked: result.runtimeMode === "conversation" || result.conversationState.knownFacts.length > 0
      },
      quality: {
        passed: result.conversationQuality.passed,
        issues: result.conversationQuality.issues.slice(0, 12),
        retryUsed: result.usedRetry,
        durationMs: result.durationMs
      },
      proposedActions,
      ...(includeTrace ? { trace: result.orchestrationTrace } : {}),
      ...(includeDiagnostics
        ? {
            diagnostics: {
              runtimeMode: result.runtimeMode,
              answerability: result.evidenceCapsule,
              agenticPlan: result.agenticPlan,
              qualityGate: result.conversationQuality,
              generation: result.generation,
              tooling: result.tooling,
              knowledgeRetrieval: result.knowledgeRetrieval
            }
          }
        : {})
    });
    this.triggerOfficeWorkspaceShadow(request, response);
    const finalResponse = await this.attachExecutedWorkspaceActions(request, response);
    // Track executed actions for multi-turn coherence
    if (finalResponse.sessionId) {
      for (const action of finalResponse.executedActions ?? []) {
        if (action.status === "executed") {
          const summary = `${action.actionType ?? action.actionId} sur ${action.workObject?.id ?? action.artifact?.id ?? "objet"}`;
          recordSessionAction(finalResponse.sessionId, summary);
        }
      }
      // Record ALL non-reply proposed actions — all plans default to dryRun:true, so
      // the !dryRun guard would silence this block entirely and the coherence feature
      // would never fire. Track what was proposed regardless of dry-run state.
      for (const action of finalResponse.proposedActions ?? []) {
        if (action.type !== "reply") {
          recordSessionAction(finalResponse.sessionId, `proposé: ${action.type} — ${compact(action.title, 80) ?? action.id}`);
        }
      }
    }
    await this.persistAskAudit(request, finalResponse);
    // Save workspace session memory + extract KOs (fire-and-forget)
    if (request.userId && request.workspaceContext?.activeWorkObject) {
      const active = request.workspaceContext.activeWorkObject;
      void wsMemory.save({
        userId: request.userId,
        workObjectId: active.id,
        workObjectTitle: active.title ?? null,
        workObjectKind: active.kind ?? null,
        workspaceFamilyId: active.workspaceFamilyId ?? null,
        userGoal: question.slice(0, 400)
      }).catch(() => undefined);

      if (active.contentPreview) {
        void new WorkspaceKnowledgeExtractorService().extract({
          workObjectId: active.id,
          workObjectTitle: active.title ?? active.id,
          workObjectKind: active.kind ?? "",
          workspaceFamilyId: active.workspaceFamilyId ?? "",
          contentPreview: active.contentPreview
        }).catch(() => undefined);
      }
    }
    return finalResponse;
  }

  executeAction(args: ExecuteWorkObjectActionArgs) {
    return this.executeAndAuditAction(args);
  }

  listWorkObjects(options: ListWorkObjectsOptions = {}) {
    if (!this.deps.workObjectExecutionService) {
      return Promise.resolve([]);
    }
    return this.deps.workObjectExecutionService.listWorkObjects(options);
  }

  listArtifacts(options: ListWorkObjectsOptions = {}) {
    if (!this.deps.workObjectExecutionService) {
      return Promise.resolve([]);
    }
    return this.deps.workObjectExecutionService.listArtifacts(options);
  }

  async listInteractions(options: { limit?: number; sessionId?: string | null; scope?: string | null } = {}) {
    if (!this.deps.interactionLogStore?.listRecent) {
      return [];
    }
    const limit = Math.max(1, Math.min(500, Math.round(options.limit ?? 100)));
    // Fetch more records than limit when filtering by sessionId/scope — otherwise most
    // fetched records get discarded and the caller receives far fewer than requested.
    const fetchCount = options.sessionId || options.scope ? Math.min(limit * 10, 2000) : limit;
    const records = await this.deps.interactionLogStore.listRecent(fetchCount);
    return records
      .filter((record) => !options.sessionId || record.sessionId === options.sessionId)
      .filter((record) => !options.scope || record.scope === options.scope)
      .slice(0, limit);
  }

  getWorkObject(workObjectId: string) {
    if (!this.deps.workObjectExecutionService) {
      return Promise.resolve(null);
    }
    return this.deps.workObjectExecutionService.getWorkObject(workObjectId);
  }

  readWorkObjectContent(workObjectId: string, entryPath: string) {
    if (!this.deps.workObjectExecutionService) {
      return Promise.resolve(null);
    }
    return this.deps.workObjectExecutionService.readContent(workObjectId, entryPath);
  }

  readArtifactContent(artifactId: string) {
    if (!this.deps.workObjectExecutionService) {
      return Promise.resolve(null);
    }
    return this.deps.workObjectExecutionService.readArtifactContent(artifactId);
  }

  updateWorkObjectContent(args: UpdateWorkObjectContentArgs) {
    if (!this.deps.workObjectExecutionService) {
      throw new Error("Hydria OS work object execution is not configured.");
    }
    return this.deps.workObjectExecutionService.updateContent(args);
  }

  createSession(): PublicApiSessionResponse {
    return publicApiSessionResponseSchema.parse({
      id: randomUUID(),
      object: "hydria.session",
      createdAt: new Date().toISOString()
    });
  }

  resetSession(sessionId: string): PublicApiSessionResetResponse {
    this.deps.chatRuntimeService.resetSession(sessionId);
    return publicApiSessionResetResponseSchema.parse({
      id: sessionId,
      object: "hydria.session_reset",
      reset: true
    });
  }

  capabilities(): PublicApiCapabilitiesResponse {
    return publicApiCapabilitiesResponseSchema.parse({
      object: "hydria.capabilities",
      version: "v1",
      endpoints: [
        "POST /api/v1/ask",
        "POST /api/v1/actions/execute",
        "GET /api/v1/work-objects",
        "GET /api/v1/work-objects/:workObjectId",
        "GET /api/v1/work-objects/:workObjectId/content",
        "PATCH /api/v1/work-objects/:workObjectId/content",
        "POST /api/v1/work-objects/:workObjectId/operations",
        "GET /api/v1/artifacts/:artifactId/download",
        "GET /api/v1/interactions",
        "POST /api/v1/sessions",
        "POST /api/v1/sessions/:sessionId/reset",
        "DELETE /api/v1/sessions/:sessionId",
        "GET /api/v1/capabilities"
      ],
      auth: {
        type: "api_key",
        headers: ["Authorization: Bearer <key>", "x-hydria-api-key: <key>", "x-api-key: <key>"]
      },
      runtime: {
        orchestration: [
          "intent routing",
          "tool routing",
          "source-backed answerability",
          "governed memory retrieval",
          "agentic mission plan",
          "post-answer verification",
          "workspace action proposals",
          "confirmed work object execution",
          "workspace tool operation calls"
        ],
        memory: [
          "session continuity via sessionId",
          "interaction audit persistence",
          "governed learning queue capture",
          "persistent work object history"
        ],
        chainOfThought: "not_exposed"
      },
      tools: [
        "calculator",
        "weather",
        "finance",
        "time",
        "release/status lookup",
        "repo facts",
        "source-backed research",
        "workspace sheet operations",
        "workspace document operations",
        "workspace slide operations"
      ],
      modelRoles: [
        { role: "fast_router", model: "qwen2.5:3b", provider: "ollama" },
        { role: "concise_standard", model: "qwen2.5:3b", provider: "ollama" },
        { role: "primary_reasoning", model: "qwen2.5:14b", provider: "ollama" },
        { role: "code_debug", model: "qwen2.5-coder:7b", provider: "ollama" },
        { role: "deep_reasoning", model: "deepseek-r1:14b", provider: "ollama" },
        { role: "writing_business", model: "mistral:7b", provider: "ollama" },
        { role: "default_chat_runtime", model: env.STUDENT_CHAT_LOCAL_MODEL_NAME, provider: "ollama" },
        { role: "retrieval", model: "bge-m3 + bge-reranker", provider: "local_services" }
      ]
    });
  }
}

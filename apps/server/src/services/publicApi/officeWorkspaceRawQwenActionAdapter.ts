import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  publicApiOsActionTypeSchema,
  publicApiProposedActionSchema,
  type PublicApiAskRequest,
  type PublicApiProposedAction
} from "../../types/publicApi.js";
import { env } from "../../utils/env.js";
import { parseLooseJson } from "../../utils/jsonRepair.js";

const defaultModel = "student-local-1p5b-toolbench-lora-v11-office-workspace-light:latest";

const rawCandidateActionSchema = z.object({
  type: publicApiOsActionTypeSchema,
  title: z.string().optional(),
  target: z.unknown().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  requiresConfirmation: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  rationale: z.string().optional()
}).passthrough();

const rawCandidatePlanSchema = z.object({
  proposedActions: z.array(rawCandidateActionSchema).max(5)
});

type RawCandidateAction = z.infer<typeof rawCandidateActionSchema>;

export type OfficeWorkspaceRawQwenPlanArgs = {
  request: PublicApiAskRequest;
  requestId?: string;
  createdAt?: string;
  runtimeAnswer?: string;
  sourceCount?: number;
};

export type OfficeWorkspaceRawQwenPlanResult = {
  provider: "ollama";
  model: string;
  promptTemplate: "qwen_raw_chat";
  durationMs: number;
  rawResponse: string;
  proposedActions: PublicApiProposedAction[];
  issues: string[];
};

type AdapterDeps = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  numPredict?: number;
};

function compact(value: unknown, maxChars = 1200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trim()}...`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && !/^(null|undefined)$/i.test(trimmed) ? trimmed : null;
}

function resolveQuestion(request: PublicApiAskRequest) {
  return compact(request.input ?? request.question ?? "", 12000);
}

function requiredConfirmation(request: PublicApiAskRequest) {
  return request.workspaceContext?.executionPolicy?.requireConfirmation ?? true;
}

function allowedActionTypes(request: PublicApiAskRequest) {
  return new Set(
    request.workspaceContext?.capabilities?.actions ?? [
      "reply",
      "create_artifact",
      "create_work_object",
      "update_work_object",
      "set_work_object_metadata"
    ]
  );
}

function actionTitle(type: PublicApiProposedAction["type"], rawTitle?: string) {
  const title = compact(rawTitle, 180);
  if (title) {
    return title;
  }
  if (type === "reply") {
    return "Repondre sans action OS";
  }
  if (type === "create_artifact") {
    return "Creer un artefact en dry-run";
  }
  if (type === "create_work_object") {
    return "Creer un work object en dry-run";
  }
  if (type === "set_work_object_metadata") {
    return "Mettre a jour les metadonnees en dry-run";
  }
  return "Mettre a jour le work object en dry-run";
}

function defaultRiskLevel(type: PublicApiProposedAction["type"]) {
  return type === "reply" || type === "create_artifact" || type === "create_work_object" ? "low" : "medium";
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function wantsMetadataChange(prompt: string) {
  const normalized = normalizeText(prompt);
  return hasAny(normalized, [
    /\b(renomme|renommer|change le titre|statut|status)\b/,
    /\b(rename|retitle|change title|set status)\b/
  ]);
}

function wantsActiveUpdate(prompt: string) {
  const normalized = normalizeText(prompt);
  return hasAny(normalized, [
    /\b(ajoute|add|complete|continue|ameliore|improve|reformule|rewrite|corrige|fix|mets a jour|update|edit|modify)\b/
  ]);
}

function wantsCreation(prompt: string) {
  const normalized = normalizeText(prompt);
  return hasAny(normalized, [
    /\b(cree|creer|redige|rediger|ecris|ecrire|genere|generer|fais|faire|produis|create|build|generate|write|draft|produce)\b/
  ]);
}

function isConceptualQuestion(prompt: string) {
  const normalized = normalizeText(prompt);
  return (
    hasAny(normalized, [
      /\b(comment|how)\b/,
      /\b(explique|explain|definition|definis|define)\b/,
      /\b(qu est ce|what is|what are)\b/
    ]) &&
    !wantsCreation(prompt) &&
    !wantsActiveUpdate(prompt) &&
    !wantsMetadataChange(prompt)
  );
}

function coerceActionType(action: RawCandidateAction, request: PublicApiAskRequest) {
  const question = resolveQuestion(request);
  const allowed = allowedActionTypes(request);
  const active = request.workspaceContext?.activeWorkObject;

  if (isConceptualQuestion(question) && allowed.has("reply")) {
    return "reply";
  }

  if (
    action.type === "update_work_object" &&
    wantsMetadataChange(question) &&
    allowed.has("set_work_object_metadata")
  ) {
    return "set_work_object_metadata";
  }

  if (
    action.type === "create_artifact" &&
    active &&
    wantsActiveUpdate(question) &&
    allowed.has("update_work_object")
  ) {
    return "update_work_object";
  }

  return action.type;
}

function updateMode(prompt: string) {
  return hasAny(normalizeText(prompt), [/\b(ajoute|append|add|continue|complete)\b/]) ? "append" : "replace";
}

function extractRequestedColumns(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const match =
    normalized.match(/(?:colonne|column|champ|field)\s+["'`]?([^"',.;:\n\r]+)/i) ||
    normalized.match(/(?:colonnes|columns|champs|fields)\s+["'`]?([^.;:\n\r]+)/i);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/,|\bet\b|\band\b|\//i)
    .map((entry) =>
      entry
        .replace(/^(de|du|des|la|le|les|une|un|the|a|an)\s+/i, "")
        .replace(/\s+(au|aux|dans|to|in|into)\s+.*$/i, "")
        .trim()
    )
    .filter(Boolean)
    .slice(0, 12);
}

function extractRequestedSections(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const match =
    normalized.match(/(?:section|sections|partie|parties|heading|headings)\s+["'`]?([^.;:\n\r]+)/i) ||
    normalized.match(/(?:avec|with)\s+(?:les\s+)?(?:sections|parties|headings)\s+["'`]?([^.;:\n\r]+)/i);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/,|\bet\b|\band\b|\//i)
    .map((entry) =>
      entry
        .replace(/^(de|du|des|la|le|les|une|un|the|a|an)\s+/i, "")
        .replace(/\s+(au|aux|dans|to|in|into)\s+.*$/i, "")
        .trim()
    )
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeTarget(request: PublicApiAskRequest, action: RawCandidateAction) {
  const active = request.workspaceContext?.activeWorkObject;
  const actionType = coerceActionType(action, request);
  const targetsActiveObject = actionType === "update_work_object" || actionType === "set_work_object_metadata";
  const target = asRecord(action.target);
  const targetWorkObject = asRecord(target.workObject);

  return {
    workObjectId:
      readString(target.workObjectId) ??
      readString(target.id) ??
      readString(targetWorkObject.id) ??
      (targetsActiveObject ? active?.id ?? null : null),
    entryPath:
      readString(target.entryPath) ??
      readString(targetWorkObject.entryPath) ??
      (targetsActiveObject ? active?.entryPath ?? null : null)
  };
}

function normalizePayload(action: RawCandidateAction, args: OfficeWorkspaceRawQwenPlanArgs) {
  const target = asRecord(action.target);
  const payload = {
    ...asRecord(target.payload),
    ...(action.payload ?? {})
  };
  const question = resolveQuestion(args.request);
  const actionType = coerceActionType(action, args.request);

  if (!("instruction" in payload) && actionType !== "reply") {
    payload.instruction = readString(target.instruction) ?? question;
  }
  if (args.runtimeAnswer && !("answerDraft" in payload) && actionType !== "reply") {
    payload.answerDraft = compact(payload.answer ?? args.runtimeAnswer, 3000);
  }
  if (actionType === "reply" && !("content" in payload)) {
    payload.content = args.runtimeAnswer
      ? compact(args.runtimeAnswer, 3000)
      : "Aucune action OS concrete n'est necessaire pour cette demande.";
  }
  if (actionType === "update_work_object" && !("mode" in payload)) {
    payload.mode = updateMode(question);
  }
  const columnAliases = ["columnsToInsert", "newColumns", "requestedColumns", "addedColumns", "targetColumns"];
  const aliasedColumns = columnAliases
    .map((key) => payload[key])
    .find((value) => Array.isArray(value) && value.length > 0);
  if (aliasedColumns) {
    payload.columns = aliasedColumns;
  }
  if (!("columns" in payload) || !Array.isArray(payload.columns) || payload.columns.length === 0) {
    const columns = extractRequestedColumns(question);
    if (columns.length > 0) {
      payload.columns = columns;
    }
  }
  const sectionAliases = ["sectionsToInsert", "sectionsToAdd", "newSections", "requestedSections", "addedSections"];
  const aliasedSections = sectionAliases
    .map((key) => payload[key])
    .find((value) => Array.isArray(value) && value.length > 0);
  if (aliasedSections) {
    payload.sections = aliasedSections;
  }
  if (!("sections" in payload) || !Array.isArray(payload.sections) || payload.sections.length === 0) {
    const sections = extractRequestedSections(question);
    if (sections.length > 0) {
      payload.sections = sections;
    }
  }

  return payload;
}

function normalizeCandidateAction(
  action: RawCandidateAction,
  args: OfficeWorkspaceRawQwenPlanArgs,
  index: number
) {
  const issues: string[] = [];
  const requestId = args.requestId ?? randomUUID();
  const createdAt = args.createdAt ?? new Date().toISOString();
  const actionType = coerceActionType(action, args.request);
  const target = normalizeTarget(args.request, action);

  if (action.dryRun === false) {
    issues.push(`action_${index}_not_dry_run`);
  }
  if (!allowedActionTypes(args.request).has(actionType)) {
    issues.push(`action_${index}_not_allowed:${actionType}`);
  }
  if ((actionType === "update_work_object" || actionType === "set_work_object_metadata") && !target.workObjectId) {
    issues.push(`action_${index}_missing_active_target`);
  }

  const candidate = {
    id: randomUUID(),
    type: actionType,
    title: actionTitle(actionType, action.title),
    target,
    payload: normalizePayload(action, args),
    riskLevel: action.riskLevel ?? defaultRiskLevel(actionType),
    requiresConfirmation: actionType === "reply" ? false : requiredConfirmation(args.request),
    dryRun: true,
    rationale:
      compact(action.rationale, 800) ||
      "Hydria Core propose une action OS gouvernee en dry-run; l'OS conserve l'execution.",
    provenance: {
      source: "hydria_core_public_api_v1",
      requestId,
      generatedAt: createdAt
    }
  };

  const parsed = publicApiProposedActionSchema.safeParse(candidate);
  if (!parsed.success) {
    issues.push(`action_${index}_schema_invalid`);
    return { action: null, issues };
  }

  return { action: parsed.data, issues };
}

export function renderOfficeWorkspaceQwenRawPrompt(args: {
  request: PublicApiAskRequest;
  runtimeAnswer?: string;
  sourceCount?: number;
}) {
  const system = [
    "You are Hydria Core's Hydria OS action planner.",
    "Return only compact JSON. Do not use markdown.",
    "Return shape: {\"proposedActions\":[...]}",
    "Actions are proposals only: dryRun must be true. Never execute files or tools.",
    "Use only actions allowed by workspaceContext.capabilities.actions.",
    "Preserve activeWorkObject.id and activeWorkObject.entryPath for updates or metadata changes.",
    "If the user only asks a conceptual question, return one reply action.",
    "If external facts are required and no runtimeAnswer/source evidence is provided, return one reply action explaining that source-backed runtime is required before document creation.",
    "Do not include private reasoning."
  ].join("\n");
  const user = JSON.stringify({
    task: "plan_hydria_os_workspace_actions",
    input: resolveQuestion(args.request),
    workspaceContext: args.request.workspaceContext ?? null,
    metadata: args.request.metadata ?? {},
    runtimeAnswer: args.runtimeAnswer ? compact(args.runtimeAnswer, 4000) : null,
    sourceCount: args.sourceCount ?? 0
  });

  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;
}

export class OfficeWorkspaceRawQwenActionAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly numPredict: number;

  constructor(deps: AdapterDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.baseUrl = deps.baseUrl ?? env.LOCAL_MODEL_BASE_URL;
    this.model = deps.model ?? defaultModel;
    this.timeoutMs = deps.timeoutMs ?? Math.max(env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS, 60000);
    this.numPredict = deps.numPredict ?? 640;
  }

  async plan(args: OfficeWorkspaceRawQwenPlanArgs): Promise<OfficeWorkspaceRawQwenPlanResult> {
    const startedAt = Date.now();
    const prompt = renderOfficeWorkspaceQwenRawPrompt({
      request: args.request,
      runtimeAnswer: args.runtimeAnswer,
      sourceCount: args.sourceCount
    });
    const response = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        raw: true,
        stream: false,
        options: {
          temperature: 0,
          num_predict: this.numPredict
        }
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Office workspace model returned ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as { response?: string };
    return this.parsePlan(String(payload.response ?? ""), args, Date.now() - startedAt);
  }

  parsePlan(rawResponse: string, args: OfficeWorkspaceRawQwenPlanArgs, durationMs = 0): OfficeWorkspaceRawQwenPlanResult {
    const issues: string[] = [];
    let parsedPlan: z.infer<typeof rawCandidatePlanSchema>;

    try {
      parsedPlan = rawCandidatePlanSchema.parse(parseLooseJson(rawResponse, "Office workspace raw Qwen action plan"));
    } catch (error) {
      return {
        provider: "ollama",
        model: this.model,
        promptTemplate: "qwen_raw_chat",
        durationMs,
        rawResponse,
        proposedActions: [],
        issues: [`json_parse_failed:${String(error)}`]
      };
    }

    if (parsedPlan.proposedActions.length === 0) {
      issues.push("missing_proposed_actions");
    }

    const proposedActions: PublicApiProposedAction[] = [];
    parsedPlan.proposedActions.forEach((action, index) => {
      const normalized = normalizeCandidateAction(action, args, index);
      issues.push(...normalized.issues);
      if (normalized.action) {
        proposedActions.push(normalized.action);
      }
    });

    return {
      provider: "ollama",
      model: this.model,
      promptTemplate: "qwen_raw_chat",
      durationMs,
      rawResponse,
      proposedActions,
      issues
    };
  }
}

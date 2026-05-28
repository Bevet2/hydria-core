import { randomUUID } from "node:crypto";
import type { PublicApiAskRequest, PublicApiProposedAction } from "../../types/publicApi.js";

type PlanArgs = {
  requestId: string;
  createdAt: string;
  request: PublicApiAskRequest;
  answer: string;
};

const DEFAULT_ACTIONS = [
  "reply",
  "create_artifact",
  "create_work_object",
  "update_work_object",
  "set_work_object_metadata"
] as const;

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function compact(value: string | null | undefined, maxChars = 1000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trim()}...`;
}

function allowedActions(request: PublicApiAskRequest) {
  return new Set(request.workspaceContext?.capabilities?.actions ?? DEFAULT_ACTIONS);
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferArtifactFormat(prompt: string, allowedFormats: string[]) {
  const normalized = normalizeText(prompt);
  const preferred = [
    { format: "xlsx", pattern: /\b(excel|xlsx|xls|tableur|spreadsheet|sheet)\b/ },
    { format: "csv", pattern: /\b(csv)\b/ },
    { format: "pptx", pattern: /\b(pptx|powerpoint|presentation|slides?|diapos?)\b/ },
    { format: "pdf", pattern: /\b(pdf)\b/ },
    { format: "docx", pattern: /\b(docx|word)\b/ },
    { format: "html", pattern: /\b(html|page web|landing)\b/ },
    { format: "md", pattern: /\b(markdown|md)\b/ }
  ];
  const allowed = new Set(allowedFormats.map((format) => format.toLowerCase()));
  const match = preferred.find((candidate) => candidate.pattern.test(normalized));

  if (match && (allowed.size === 0 || allowed.has(match.format))) {
    return match.format;
  }

  return allowed.has("md") ? "md" : allowedFormats[0]?.toLowerCase() || "md";
}

function inferWorkObjectKind(prompt: string, allowedKinds: string[]) {
  const normalized = normalizeText(prompt);
  const preferred = [
    { kind: "dataset", pattern: /\b(excel|xlsx|xls|csv|tableur|spreadsheet|dataset|sheet)\b/ },
    { kind: "presentation", pattern: /\b(presentation|slides?|diapos?|pptx|powerpoint)\b/ },
    { kind: "dashboard", pattern: /\b(dashboard|tableau de bord|kpi|reporting)\b/ },
    { kind: "workflow", pattern: /\b(workflow|process|processus|automatisation)\b/ },
    { kind: "project", pattern: /\b(app|application|site|webapp|projet)\b/ },
    { kind: "document", pattern: /\b(document|doc|texte|note|brief|rapport)\b/ }
  ];
  const allowed = new Set(allowedKinds.map((kind) => kind.toLowerCase()));
  const match = preferred.find((candidate) => candidate.pattern.test(normalized));

  if (match && (allowed.size === 0 || allowed.has(match.kind))) {
    return match.kind;
  }

  return allowed.has("document") ? "document" : allowedKinds[0]?.toLowerCase() || "document";
}

function wantsCreate(prompt: string) {
  return hasAny(normalizeText(prompt), [
    /\b(cree|creer|crée|créer|fais|faire|genere|generer|génère|générer|construis|fabrique|produis)\b/,
    /\b(create|build|generate|make|produce|draft|scaffold)\b/
  ]);
}

function wantsUpdate(prompt: string) {
  return hasAny(normalizeText(prompt), [
    /\b(modifie|modifier|mets a jour|met a jour|ameliore|améliore|corrige|ajoute|supprime|remplace|complete|continue)\b/,
    /\b(update|edit|modify|improve|fix|add|remove|replace|complete|continue)\b/
  ]);
}

function wantsMetadataChange(prompt: string) {
  return hasAny(normalizeText(prompt), [
    /\b(renomme|renommer|change le titre|statut|status)\b/,
    /\b(rename|retitle|change title|set status)\b/
  ]);
}

function updateMode(prompt: string) {
  return hasAny(normalizeText(prompt), [/\b(ajoute|append|add|continue|complete)\b/]) ? "append" : "replace";
}

function makeAction(
  args: PlanArgs,
  partial: Omit<PublicApiProposedAction, "id" | "provenance">
): PublicApiProposedAction {
  return {
    id: randomUUID(),
    ...partial,
    provenance: {
      source: "hydria_core_public_api_v1",
      requestId: args.requestId,
      generatedAt: args.createdAt
    }
  };
}

export function planPublicApiProposedActions(args: PlanArgs): PublicApiProposedAction[] {
  const { request, answer } = args;
  const workspace = request.workspaceContext;

  if (!request.options.includeProposedActions || !workspace) {
    return [];
  }

  const question = compact(request.input ?? request.question ?? "", 4000);
  const actions = allowedActions(request);
  const allowedFormats = request.workspaceContext?.capabilities?.artifactFormats ?? [];
  const allowedKinds = request.workspaceContext?.capabilities?.workObjectKinds ?? [];
  const active = workspace.activeWorkObject ?? null;
  const requireConfirmation = workspace.executionPolicy?.requireConfirmation ?? true;

  if (active && wantsMetadataChange(question) && actions.has("set_work_object_metadata")) {
    return [
      makeAction(args, {
        type: "set_work_object_metadata",
        title: `Mettre a jour les metadonnees de ${active.title || active.id}`,
        target: {
          workObjectId: active.id,
          entryPath: active.entryPath ?? null
        },
        payload: {
          instruction: question,
          currentTitle: active.title ?? "",
          currentKind: active.kind ?? ""
        },
        riskLevel: "medium",
        requiresConfirmation: requireConfirmation,
        dryRun: true,
        rationale: "La requete vise les metadonnees de l'objet actif dans le workspace OS."
      })
    ];
  }

  if (active && wantsUpdate(question) && actions.has("update_work_object")) {
    return [
      makeAction(args, {
        type: "update_work_object",
        title: `Modifier ${active.title || active.id}`,
        target: {
          workObjectId: active.id,
          entryPath: active.entryPath ?? null
        },
        payload: {
          instruction: question,
          mode: updateMode(question),
          answerDraft: compact(answer, 3000),
          currentKind: active.kind ?? "",
          currentPreview: compact(active.contentPreview, 1500)
        },
        riskLevel: "medium",
        requiresConfirmation: requireConfirmation,
        dryRun: true,
        rationale: "La requete demande de travailler sur l'objet actif. Core propose une action, l'OS garde l'execution."
      })
    ];
  }

  if (wantsCreate(question) && actions.has("create_artifact")) {
    const format = inferArtifactFormat(question, allowedFormats);
    return [
      makeAction(args, {
        type: "create_artifact",
        title: "Creer un artefact depuis la demande utilisateur",
        target: {
          workObjectId: null,
          entryPath: null
        },
        payload: {
          instruction: question,
          format,
          kind: inferWorkObjectKind(question, allowedKinds),
          answerDraft: compact(answer, 3000)
        },
        riskLevel: "low",
        requiresConfirmation: requireConfirmation,
        dryRun: true,
        rationale: "La requete demande une creation. Core prepare le plan, l'OS cree le fichier ou workspace localement."
      })
    ];
  }

  if (wantsCreate(question) && actions.has("create_work_object")) {
    return [
      makeAction(args, {
        type: "create_work_object",
        title: "Creer un work object",
        target: {
          workObjectId: null,
          entryPath: null
        },
        payload: {
          instruction: question,
          kind: inferWorkObjectKind(question, allowedKinds),
          initialContent: compact(answer, 5000)
        },
        riskLevel: "low",
        requiresConfirmation: requireConfirmation,
        dryRun: true,
        rationale: "La requete demande un nouvel objet de travail que seul l'OS doit materialiser."
      })
    ];
  }

  if (actions.has("reply")) {
    return [
      makeAction(args, {
        type: "reply",
        title: "Repondre sans action OS",
        target: {
          workObjectId: active?.id ?? null,
          entryPath: active?.entryPath ?? null
        },
        payload: {
          content: compact(answer, 5000)
        },
        riskLevel: "low",
        requiresConfirmation: false,
        dryRun: true,
        rationale: "Aucune action OS concrete n'est necessaire pour cette demande."
      })
    ];
  }

  return [];
}

import type { PublicApiAskRequest, PublicApiProposedAction } from "../../types/publicApi.js";

type CanonicalOperation = Record<string, unknown> & {
  type: string;
  target?: Record<string, unknown>;
};

function compact(value: unknown, maxChars = 1000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trim()}...`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function activeWorkspaceFamilyId(request: PublicApiAskRequest) {
  return compact(
    request.metadata?.workspaceFamilyId ??
      request.metadata?.workspaceFamily ??
      request.workspaceContext?.activeWorkObject?.workspaceFamilyId,
    120
  ).toLowerCase();
}

function canonicalToolName(operationType: string, fallback: unknown) {
  const normalized = normalizeText(operationType);
  if (normalized.startsWith("sheet.")) {
    if (normalized === "sheet.set_cell") {
      return "sheet.set_cell";
    }
    return "sheet.apply_formula";
  }
  if (normalized.startsWith("doc.")) {
    return "doc.edit";
  }
  if (normalized.startsWith("slide.")) {
    return "slide.edit";
  }
  if (normalized.startsWith("crm.")) {
    return compact(operationType, 120);
  }
  return compact(fallback, 120) || "workspace.apply_operations";
}

function isSupportedOperationType(value: unknown) {
  const type = compact(value, 120);
  return /^(sheet|doc|slide|crm)\.[a-z][a-z0-9_]*$/i.test(type);
}

function normalizeTupleOperation(tuple: unknown[]): CanonicalOperation | null {
  const [cell, value] = tuple;
  const cellText = compact(cell, 40).toUpperCase();
  const valueText = compact(value, 500);
  if (!/^[A-Z]{1,4}\d{1,7}$/.test(cellText) || !valueText) {
    return null;
  }
  return {
    type: valueText.startsWith("=") ? "sheet.set_formula" : "sheet.set_cell",
    target: {
      cell: cellText
    },
    ...(valueText.startsWith("=") ? { formula: valueText } : { value: valueText })
  };
}

function normalizeOperation(raw: unknown): CanonicalOperation | null {
  if (Array.isArray(raw)) {
    return normalizeTupleOperation(raw);
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const type = compact(source.type ?? source.kind ?? source.operationType, 120);
  if (!isSupportedOperationType(type)) {
    return null;
  }

  const target = typeof source.target === "object" && source.target !== null
    ? { ...(source.target as Record<string, unknown>) }
    : {};
  const operation: CanonicalOperation = {
    type,
    target
  };

  for (const key of [
    "columnName",
    "rowIndex",
    "values",
    "range",
    "direction",
    "format",
    "payload",
    "options",
    "metadata",
    "count",
    "width",
    "height",
    "formula",
    "value",
    "title",
    "content",
    "blockId",
    "blockTitle",
    "slideIndex",
    "afterSlideIndex",
    "bullets",
    "firstName",
    "lastName",
    "email",
    "phone",
    "jobTitle",
    "companyName",
    "name",
    "description",
    "status",
    "priority",
    "dueAt",
    "rating",
    "currency",
    "probability",
    "stageName",
    "dealName",
    "nextStep",
    "entity",
    "recordId",
    "fields",
    "ownerId",
    "createDeal",
    "dealValue",
    "productName",
    "sku",
    "quantity",
    "unitPrice",
    "discountPercent",
    "taxPercent",
    "validUntil",
    "notes",
    "contactId",
    "leadId",
    "dealId",
    "companyId"
  ]) {
    if (source[key] !== undefined) {
      operation[key] = source[key];
    }
  }

  return operation;
}

function normalizeOperations(raw: unknown) {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values
    .map(normalizeOperation)
    .filter((operation): operation is CanonicalOperation => Boolean(operation))
    .slice(0, 50);
}

function verifyWorkspaceToolAction(
  request: PublicApiAskRequest,
  action: PublicApiProposedAction
): PublicApiProposedAction | null {
  const active = request.workspaceContext?.activeWorkObject ?? null;
  const operations = normalizeOperations(action.payload.operations ?? action.payload.operation);
  if (!active || operations.length === 0) {
    return null;
  }

  const firstType = operations[0]?.type ?? "";
  const toolName = canonicalToolName(firstType, action.payload.toolName);
  return {
    ...action,
    type: "workspace_tool_call",
    target: {
      workObjectId: action.target.workObjectId || active.id,
      entryPath: action.target.entryPath || active.entryPath || null
    },
    payload: {
      contractVersion: "workspace_tool_call.v1",
      instruction: compact(action.payload.instruction ?? request.input ?? request.question, 4000),
      workspaceFamilyId: compact(action.payload.workspaceFamilyId, 120).toLowerCase() || activeWorkspaceFamilyId(request),
      currentKind: compact(action.payload.currentKind ?? active.kind, 80),
      currentPreview: compact(action.payload.currentPreview ?? active.contentPreview, 1500),
      toolName,
      operations,
      expectedSurface: firstType.split(".")[0] || "workspace"
    }
  };
}

export function verifyPublicApiProposedActions(args: {
  request: PublicApiAskRequest;
  actions: PublicApiProposedAction[];
}) {
  const verifiedWorkspaceActions = args.actions
    .filter((action) => action.type === "workspace_tool_call")
    .map((action) => verifyWorkspaceToolAction(args.request, action))
    .filter((action): action is PublicApiProposedAction => Boolean(action));

  if (verifiedWorkspaceActions.length > 0) {
    return verifiedWorkspaceActions;
  }

  return args.actions.filter((action) => {
    if (action.type === "create_artifact" && args.actions.some((candidate) => candidate.type === "workspace_tool_call")) {
      return false;
    }
    return true;
  });
}

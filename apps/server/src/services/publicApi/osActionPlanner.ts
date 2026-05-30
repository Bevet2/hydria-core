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
  "set_work_object_metadata",
  "workspace_tool_call"
] as const;

const SHEET_WORKSPACE_TOOLS = [
  "sheet.apply_formula",
  "sheet.set_cell",
  "sheet.add_column",
  "sheet.add_row",
  "sheet.insert_rows",
  "sheet.insert_columns",
  "sheet.rename_column",
  "sheet.delete_column",
  "sheet.delete_row",
  "sheet.delete_rows",
  "sheet.delete_columns",
  "sheet.resize_row",
  "sheet.resize_column",
  "sheet.set_formula",
  "sheet.set_range",
  "sheet.clear_cells",
  "sheet.sort_range",
  "sheet.filter_rows",
  "sheet.clear_filter",
  "sheet.format_cells",
  "sheet.clear_format",
  "sheet.merge_cells",
  "sheet.unmerge_cells",
  "sheet.set_note",
  "sheet.clear_note",
  "sheet.set_data_validation",
  "sheet.clear_data_validation",
  "sheet.add_conditional_format",
  "sheet.remove_conditional_format",
  "sheet.add_table",
  "sheet.remove_table",
  "sheet.add_pivot_table",
  "sheet.remove_pivot_table",
  "sheet.add_chart",
  "sheet.update_chart",
  "sheet.remove_chart",
  "sheet.add_sparkline",
  "sheet.remove_sparkline",
  "sheet.add_slicer",
  "sheet.remove_slicer",
  "sheet.add_named_range",
  "sheet.remove_named_range",
  "sheet.protect_sheet",
  "sheet.unprotect_sheet",
  "sheet.protect_range",
  "sheet.unprotect_range",
  "sheet.freeze_panes",
  "sheet.set_zoom",
  "sheet.show_gridlines",
  "sheet.add_sheet",
  "sheet.rename_sheet",
  "sheet.delete_sheet",
  "sheet.duplicate_sheet",
  "sheet.move_sheet",
  "sheet.set_active_sheet",
  "sheet.hide_sheet",
  "sheet.unhide_sheet"
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
    { format: "docx", pattern: /\b(docx|word|document|rapport|brief|note|sop|wiki)\b/ },
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
    { kind: "document", pattern: /\b(document|doc|texte|note|brief|rapport)\b/ },
    { kind: "project", pattern: /\b(app|application|site|webapp|projet)\b/ }
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
    /\b(cree|creer|crée|créer|fais|faire|genere|generer|génère|générer|construis|fabrique|produis|presente|presenter|présente|présenter|mets|mettre)\b/,
    /\b(redige|rediger|ecris|ecrire|write|create|build|generate|make|produce|draft|scaffold|present)\b/
  ]);
}

function wantsUpdate(prompt: string) {
  return hasAny(normalizeText(prompt), [
    /\b(modifie|modifier|mets a jour|met a jour|ameliore|améliore|corrige|ajoute|supprime|remplace|complete|continue)\b/,
    /\b(reformule|rewrite|update|edit|modify|improve|fix|add|remove|replace|complete|continue)\b/
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

function wantsWorkspaceToolCall(prompt: string) {
  return hasAny(normalizeText(prompt), [
    /=/,
    /\b(formule|formula|calcul|calcule|calculate|complete|remplis|renseigne|somme|sum|total|totaux|montant|amount|resultat|result|moyenne|average|cellules?|cells?|range|plage)\b/,
    /\b(chart|graphique|validation|filtre|filter|tri|sort|pivot|tcd|lignes?|rows?|colonnes?|columns?|renomme|rename|supprime|delete|remove|format|style|gras|bold|devise|currency|pourcentage|percent)\b/,
    /\b(insere|insert|redimensionne|resize|fusionne|merge|defusionne|unmerge|note|commentaire|conditional|conditionnel|tableau|table|sparkline|segment|slicer|liste|deroulante|déroulante|dropdown|nommee|nommée|protect|protege|protège|deprotege|déprotège|fige|freeze|zoom|quadrillage|gridlines?|feuille|onglet|sheet|tab)\b/,
    /\b(section|paragraphe|paragraph|intro|introduction|bloc|block|append|insert|replace|remplace|lien|link|url|image|citation|quote|code|saut de page|page break|toc|sommaire|table|tableau)\b/,
    /\b(slide|slides|diapo|diapositive|presentation|deck)\b/
  ]);
}

function inferWorkspaceFamily(request: PublicApiAskRequest) {
  return String(request.metadata?.workspaceFamilyId ?? request.metadata?.workspaceFamily ?? "").toLowerCase();
}

function activeKind(request: PublicApiAskRequest) {
  return normalizeText(request.workspaceContext?.activeWorkObject?.kind ?? "");
}

function activeEntryPath(request: PublicApiAskRequest) {
  return normalizeText(request.workspaceContext?.activeWorkObject?.entryPath ?? "");
}

function activeContentLooksLikeSheet(request: PublicApiAskRequest) {
  return /"kind"\s*:\s*"hydria-sheet"/i.test(String(request.workspaceContext?.activeWorkObject?.contentPreview ?? ""));
}

function activeWorkspaceFamilyId(request: PublicApiAskRequest) {
  return (
    inferWorkspaceFamily(request) ||
    normalizeText(request.workspaceContext?.activeWorkObject?.workspaceFamilyId) ||
    ""
  );
}

function isDatasetWorkspaceRequest(request: PublicApiAskRequest, question: string) {
  const family = inferWorkspaceFamily(request);
  const kind = activeKind(request);
  const entryPath = activeEntryPath(request);
  return (
    family === "data_spreadsheet" ||
    kind === "dataset" ||
    activeContentLooksLikeSheet(request) ||
    /\.(csv|xlsx|xls)\b/.test(entryPath) ||
    /\b(excel|xlsx|xls|csv|tableur|spreadsheet|sheet|feuille|classeur)\b/.test(question)
  );
}

function isDocumentWorkspaceRequest(request: PublicApiAskRequest, question: string) {
  const family = inferWorkspaceFamily(request);
  const kind = activeKind(request);
  const entryPath = activeEntryPath(request);
  return (
    family === "document_knowledge" ||
    kind === "document" ||
    /\.(md|txt|docx|html|pdf)\b/.test(entryPath) ||
    /\b(word|docx|document|rapport|brief|note|wiki|sop|memo|texte)\b/.test(question)
  );
}

function isPresentationWorkspaceRequest(request: PublicApiAskRequest, question: string) {
  const family = inferWorkspaceFamily(request);
  const kind = activeKind(request);
  const entryPath = activeEntryPath(request);
  return (
    family === "presentation" ||
    kind === "presentation" ||
    /\.(pptx|odp|slides\.md)\b/.test(entryPath) ||
    /\b(presentation|slides?|diapos?|diapositive|deck|powerpoint|pptx)\b/.test(question)
  );
}

function hasSourceSensitiveNeed(question: string) {
  return /\b(cette semaine|today|latest|recent|actuel|actuelle|nouveaute|nouveautes|news|cherche|recherche|source|sources|biograph|qui est|who is|historique|histoire|roi|louis|date de naissance|mort|wikipedia|web)\b/.test(
    question
  );
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
    .filter((entry) => entry.length > 0)
    .slice(0, 12);
}

function cleanNumericTableLabel(value: string) {
  return value
    .replace(/^[\s"'`.:;,-]+|[\s"'`.:;,-]+$/g, "")
    .replace(/^(et|and|avec|with|les?|la|des?|du|un|une|the|a|an|pour|for)\s+/i, "")
    .replace(/\b(dans|en|sur|vers|to|into)\s+(un\s+)?(excel|xlsx|csv|tableur|spreadsheet|sheet)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumericCell(value: string) {
  return value.replace(/\s+/g, "").replace(",", ".").trim();
}

function extractNumericTableFromPrompt(prompt: string) {
  const source =
    prompt.match(/\b(?:excel|xlsx|csv|tableur|spreadsheet|sheet)\s*:\s*([\s\S]+)$/i)?.[1] ??
    prompt.match(/\b(?:texte|donnees|données|chiffres|numbers|data)\s*:\s*([\s\S]+)$/i)?.[1] ??
    prompt.match(/["'`]([\s\S]*?\d[\s\S]*?)["'`]/)?.[1] ??
    prompt;
  const segments = source
    .split(/\r?\n|;|,/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const rows: string[][] = [];

  for (const segment of segments) {
    const match = segment.match(
      /(.{1,80}?)(?:\s*[:=]\s*|\s+)(-?\d[\d\s]*(?:[.,]\d+)?)(?:\s*(k€|m€|€|eur|euros?|usd|dollars?|\$|%|pct|points?|clients?|users?|utilisateurs?))?(?:\s*[.;:]?\s*$)/i
    );
    if (!match?.[1] || !match?.[2]) {
      continue;
    }
    const label = cleanNumericTableLabel(match[1]);
    const value = normalizeNumericCell(match[2]);
    const unit = String(match[3] ?? "").trim();
    if (!label || !/^-?\d+(?:\.\d+)?$/.test(value)) {
      continue;
    }
    rows.push([label, value, unit]);
  }

  if (rows.length === 0) {
    return null;
  }

  const hasUnit = rows.some((row) => row[2]);
  return {
    columns: hasUnit ? ["Libelle", "Valeur", "Unite"] : ["Libelle", "Valeur"],
    rows: hasUnit ? rows : rows.map(([label, value]) => [label, value])
  };
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
    .filter((entry) => entry.length > 0)
    .slice(0, 12);
}

function extractCellReference(prompt: string) {
  const match =
    prompt.match(/\b(?:cellule|cell|en|dans|to|in)\s+([$]?[A-Z]{1,4}[$]?\d{1,7})\b/i) ||
    prompt.match(/\b([$]?[A-Z]{1,4}[$]?\d{1,7})\b/);
  return match?.[1]?.toUpperCase().replace(/\$/g, "") ?? "";
}

function extractExplicitFormula(prompt: string) {
  const match = prompt.match(/=\s*[^.;\n\r]+/);
  return match?.[0]
    ?.replace(/^=\s*/, "=")
    .replace(/\s+(?:dans|en|to|in)\b.*$/i, "")
    .trim()
    .replace(/[,\s]+$/g, "") ?? "";
}

function extractFormulaRange(prompt: string) {
  const match = prompt.match(/\b([$]?[A-Z]{1,4}[$]?\d{1,7}\s*:\s*[$]?[A-Z]{1,4}[$]?\d{1,7})\b/i);
  return match?.[1]?.toUpperCase().replace(/\$/g, "").replace(/\s+/g, "") ?? "";
}

function columnIndexToLetter(index: number) {
  let value = Math.max(0, Math.floor(index)) + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || "A";
}

function columnLetterToIndex(value: string) {
  const letters = value.toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters) {
    return -1;
  }
  return letters.split("").reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function extractTargetColumnLetter(prompt: string) {
  const columnMatch = prompt.match(/\b(?:colonne|column)\s+([A-Z]{1,4})\b/i);
  const positionMatch = prompt.match(/\b(?:en|dans|sur|to|in)\s+([A-Z])\b/i);
  const value = (columnMatch?.[1] ?? positionMatch?.[1] ?? "").toUpperCase();
  return /^[A-Z]{1,4}$/.test(value) ? value : "";
}

function extractSourceColumnLetters(prompt: string, targetColumnLetter: string) {
  const target = targetColumnLetter.toUpperCase();
  const columnToken = "\\$?[A-Z]{1,4}\\$?";
  const separator = "(?:\\+|,|\\bet\\b|\\band\\b)";
  const pair =
    prompt.match(new RegExp(`\\b(?:de|des|entre|avec|from|of)\\s+(${columnToken})\\s*${separator}\\s*(${columnToken})(?=$|[^A-Za-z])`, "i")) ||
    prompt.match(new RegExp(`(?:^|[^A-Za-z])(${columnToken})\\s*${separator}\\s*(${columnToken})(?=$|[^A-Za-z])`, "i"));
  if (pair?.[1] && pair?.[2]) {
    return [pair[1].toUpperCase(), pair[2].toUpperCase()]
      .map((letter) => letter.replace(/\$/g, ""))
      .filter((letter) => letter !== target);
  }
  return [];
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function sheetPreview(request: PublicApiAskRequest) {
  const preview = String(request.workspaceContext?.activeWorkObject?.contentPreview ?? "").trim();
  const fallback = {
    columns: [] as string[],
    rows: [] as string[][],
    rowCount: 1
  };
  if (!preview) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(preview) as {
      columns?: unknown[];
      rows?: unknown[];
      rowCount?: unknown;
      activeSheetId?: string;
      sheets?: Array<{ id?: string; columns?: unknown[]; rows?: unknown[]; rowCount?: unknown }>;
    };
    const sheet =
      parsed.sheets?.find((candidate) => candidate.id && candidate.id === parsed.activeSheetId) ??
      parsed.sheets?.[0] ??
      parsed;
    const columns = Array.isArray(sheet.columns) ? sheet.columns.map((column) => String(column ?? "")) : [];
    const rows = Array.isArray(sheet.rows)
      ? sheet.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
      : [];
    const declaredRowCount = Number((sheet as { rowCount?: unknown }).rowCount ?? parsed.rowCount);
    return {
      columns,
      rows,
      rowCount: Math.max(1, Number.isFinite(declaredRowCount) ? declaredRowCount : rows.length || 1)
    };
  } catch {
    const rows = preview
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(splitCsvLine);
    if (rows.length > 0) {
      return {
        columns: rows[0]?.map((cell) => String(cell ?? "")) ?? [],
        rows: rows.slice(1).map((row) => row.map((cell) => String(cell ?? ""))),
        rowCount: Math.max(1, rows.length - 1 || 1)
      };
    }
  }

  return fallback;
}

function inferFormula(prompt: string) {
  const explicit = extractExplicitFormula(prompt);
  if (explicit) {
    return explicit;
  }
  const normalized = normalizeText(prompt);
  const range = extractFormulaRange(prompt);
  if (!range) {
    return "";
  }
  if (/\b(somme|sum|total)\b/.test(normalized)) {
    return normalized.includes("sum") ? `=SUM(${range})` : `=SOMME(${range})`;
  }
  if (/\b(moyenne|average|avg)\b/.test(normalized)) {
    return normalized.includes("average") || normalized.includes("avg") ? `=AVERAGE(${range})` : `=MOYENNE(${range})`;
  }
  return "";
}

function semanticColumnRole(label: string) {
  const normalized = normalizeText(label);
  if (/\b(nb|nombre|quantite|qte|qty|quantity|count|units?|unites?|heures|hours|duree|duration)\b/.test(normalized)) {
    return "quantity";
  }
  if (/\b(prix|price|cost|cout|tarif|rate|taux|taux horaire|hourly rate|unit price|prix unitaire|montant unitaire)\b/.test(normalized)) {
    return "price";
  }
  if (/\b(total|totaux|montant|amount|subtotal|sous total|revenue|revenu|ventes|sales|chiffre d affaires|valeur totale)\b/.test(normalized)) {
    return "total";
  }
  return "";
}

function isExplicitSheetAdditionPrompt(prompt: string) {
  return /\b(somme|sum|addition|additionne|ajoute|add|plus)\b/.test(normalizeText(prompt));
}

function isComputedTotalPrompt(prompt: string) {
  return /\b(total|totaux|totalise|totaliser|montant|amount|resultat|result|value|valeur|revenue|revenu|ventes|sales|chiffre d affaires|prix total|valeur totale|complete|remplis|renseigne|calcul|calcule|corrige|corriger|correct|fix|bon|bonne)\b/.test(normalizeText(prompt));
}

function parseSheetNumber(value: string) {
  const text = String(value ?? "").trim();
  if (!text || text.startsWith("=")) {
    return null;
  }
  const normalized = text
    .replace(/\s+/g, "")
    .replace(/[€$£%]/g, "")
    .replace(/,/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericSourceLettersFromPreview(preview: ReturnType<typeof sheetPreview>, targetColumnIndex: number) {
  return preview.columns
    .map((column, index) => {
      const values = preview.rows.map((row) => String(row[index] ?? "").trim()).filter(Boolean);
      const numericCount = values.filter((value) => parseSheetNumber(value) !== null).length;
      const numericRatio = values.length ? numericCount / values.length : 0;
      return {
        index,
        semantic: semanticColumnRole(column),
        numericRatio,
        empty: values.length === 0
      };
    })
    .filter((column) => column.index < targetColumnIndex)
    .filter((column) => column.semantic !== "total")
    .filter((column) => column.numericRatio >= 0.6 || column.empty)
    .map((column) => columnIndexToLetter(column.index));
}

function semanticQuantityPricePlanFromPreview(preview: ReturnType<typeof sheetPreview>, targetColumnIndex: number) {
  const candidates = preview.columns
    .map((column, index) => ({ index, role: semanticColumnRole(column) }))
    .filter((column) => column.index < targetColumnIndex);
  const quantityIndexes = candidates
    .filter((column) => column.role === "quantity")
    .map((column) => column.index);
  const priceIndex = candidates.find((column) => column.role === "price")?.index ?? -1;
  if (quantityIndexes.length > 0 && priceIndex >= 0 && !quantityIndexes.includes(priceIndex)) {
    return {
      quantityLetters: quantityIndexes.map(columnIndexToLetter),
      priceLetter: columnIndexToLetter(priceIndex),
      sourceLetters: [...quantityIndexes, priceIndex]
        .sort((left, right) => left - right)
        .map(columnIndexToLetter)
    };
  }
  return null;
}

function semanticSourceLettersFromPreview(preview: ReturnType<typeof sheetPreview>, targetColumnIndex: number) {
  return semanticQuantityPricePlanFromPreview(preview, targetColumnIndex)?.sourceLetters ?? [];
}

function rowSumExpression(sourceLetters: string[], spreadsheetRow: number) {
  const letters = sourceLetters
    .map((letter) => letter.toUpperCase())
    .filter((letter) => columnLetterToIndex(letter) >= 0);
  if (letters.length === 0) {
    return "";
  }
  if (letters.length === 1) {
    return `${letters[0]}${spreadsheetRow}`;
  }

  const indexes = letters.map(columnLetterToIndex);
  const contiguous = indexes.every((index, position) => position === 0 || index === indexes[position - 1]! + 1);
  if (contiguous) {
    return `SOMME(${letters[0]}${spreadsheetRow}:${letters[letters.length - 1]}${spreadsheetRow})`;
  }

  return `(${letters.map((letter) => `${letter}${spreadsheetRow}`).join("+")})`;
}

function formulaExpressionForRow(args: {
  prompt: string;
  preview: ReturnType<typeof sheetPreview>;
  sourceLetters: string[];
  spreadsheetRow: number;
}) {
  const normalized = normalizeText(args.prompt);
  const sourceIndexes = args.sourceLetters.map(columnLetterToIndex);
  const sourceRoles = sourceIndexes.map((index) => semanticColumnRole(args.preview.columns[index] ?? ""));
  const hasQuantity = sourceRoles.includes("quantity");
  const hasPrice = sourceRoles.includes("price");
  const hasMultiplicationSignal =
    !isExplicitSheetAdditionPrompt(args.prompt) &&
    /\b(total|totaux|montant|amount|subtotal|prix total|total price|revenue|revenu|ventes|sales|chiffre d affaires|resultat|result|valeur totale|complete|remplis|renseigne|calcul|calcule|corrige|corriger|correct|fix|bon|bonne)\b/.test(normalized) &&
    hasQuantity &&
    hasPrice;

  if (hasMultiplicationSignal && args.sourceLetters.length >= 2) {
    const quantityLetters = args.sourceLetters.filter((letter) => {
      const index = columnLetterToIndex(letter);
      return index >= 0 && semanticColumnRole(args.preview.columns[index] ?? "") === "quantity";
    });
    const priceLetter = args.sourceLetters.find((letter) => {
      const index = columnLetterToIndex(letter);
      return index >= 0 && semanticColumnRole(args.preview.columns[index] ?? "") === "price";
    });

    if (quantityLetters.length > 1 && priceLetter) {
      const quantityExpression = rowSumExpression(quantityLetters, args.spreadsheetRow);
      return `=${quantityExpression}*${priceLetter}${args.spreadsheetRow}`;
    }

    if (quantityLetters.length === 1 && priceLetter) {
      return `=${quantityLetters[0]}${args.spreadsheetRow}*${priceLetter}${args.spreadsheetRow}`;
    }

    return `=${args.sourceLetters[0]}${args.spreadsheetRow}*${args.sourceLetters[1]}${args.spreadsheetRow}`;
  }

  if (/\b(produit|multiply|multiplie|multiplication)\b/.test(normalized) && args.sourceLetters.length >= 2) {
    return `=${args.sourceLetters[0]}${args.spreadsheetRow}*${args.sourceLetters[1]}${args.spreadsheetRow}`;
  }

  if (args.sourceLetters.length === 1) {
    return `=${args.sourceLetters[0]}${args.spreadsheetRow}`;
  }

  if (args.sourceLetters.length > 2) {
    return `=${rowSumExpression(args.sourceLetters, args.spreadsheetRow)}`;
  }

  return `=${rowSumExpression(args.sourceLetters, args.spreadsheetRow)}`;
}

function targetHeaderForPrompt(prompt: string, targetColumnLetter: string) {
  const normalized = normalizeText(prompt);
  if (/\b(montant|amount|revenue|revenu|ventes|sales|chiffre d affaires|valeur totale)\b/.test(normalized)) {
    return "Montant";
  }
  if (/\b(total|totaux|subtotal|prix total)\b/.test(normalized)) {
    return "Total";
  }
  if (/\b(resultat|result|value|valeur|calcul|calcule|corrige|corriger|correct|fix)\b/.test(normalized)) {
    return "Resultat";
  }
  return targetColumnLetter;
}

function shouldSetTargetHeader(currentHeader: string, desiredHeader: string, targetColumnLetter: string) {
  const current = normalizeText(currentHeader);
  if (!current) {
    return true;
  }
  if (current === normalizeText(desiredHeader)) {
    return false;
  }
  return current === normalizeText(targetColumnLetter) || /^column \d+$/.test(current) || /^colonne \d+$/.test(current);
}

function inferTargetColumnIndexFromPreview(preview: ReturnType<typeof sheetPreview>, prompt: string) {
  const columns = preview.columns;
  if (columns.length === 0) {
    return 2;
  }

  const semanticSources = columns
    .map((column, index) => ({ index, role: semanticColumnRole(column) }))
    .filter((column) => column.role === "quantity" || column.role === "price");
  const numericSourceIndexes = numericSourceLettersFromPreview(preview, columns.length)
    .map(columnLetterToIndex)
    .filter((index) => index >= 0);
  const minimumResultIndex = semanticSources.length >= 2
    ? Math.max(...semanticSources.map((column) => column.index)) + 1
    : numericSourceIndexes.length
      ? Math.max(...numericSourceIndexes) + 1
    : Math.max(1, columns.length);
  const totalIndex = columns.findIndex(
    (column, index) => index >= minimumResultIndex && semanticColumnRole(column) === "total"
  );
  if (totalIndex >= 0) {
    return totalIndex;
  }

  const totalPrompt = /\b(total|totaux|montant|amount|subtotal)\b/.test(normalizeText(prompt));
  const reusableGenericIndex = columns.findIndex((column, index) => {
    if (index < minimumResultIndex || !shouldSetTargetHeader(column, targetHeaderForPrompt(prompt, columnIndexToLetter(index)), columnIndexToLetter(index))) {
      return false;
    }

    const values = preview.rows
      .map((row) => String(row[index] ?? "").trim())
      .filter(Boolean);
    if (values.length === 0) {
      return true;
    }

    const looksFormulaOnly = values.every((value) => value.startsWith("="));
    return looksFormulaOnly || (totalPrompt && semanticSources.length >= 2);
  });
  if (reusableGenericIndex >= 0) {
    return reusableGenericIndex;
  }

  return Math.max(columns.length, minimumResultIndex);
}

function inferImplicitSheetFormulaPlan(request: PublicApiAskRequest, prompt: string) {
  const normalized = normalizeText(prompt);
  if (!/\b(somme|sum|total|totaux|montant|amount|resultat|result|complete|remplis|renseigne|calcul|calcule|corrige|corriger|correct|fix|bon|bonne)\b/.test(normalized)) {
    return null;
  }

  const preview = sheetPreview(request);
  const explicitTargetColumnLetter = extractTargetColumnLetter(prompt);
  const resolvedTargetColumnIndex = explicitTargetColumnLetter
    ? columnLetterToIndex(explicitTargetColumnLetter)
    : inferTargetColumnIndexFromPreview(preview, prompt);
  const targetColumnLetter = explicitTargetColumnLetter || columnIndexToLetter(resolvedTargetColumnIndex);
  const targetColumnIndex = columnLetterToIndex(targetColumnLetter);
  if (targetColumnIndex <= 0) {
    return null;
  }

  const explicitSources = extractSourceColumnLetters(prompt, targetColumnLetter);
  const semanticSources = semanticSourceLettersFromPreview(preview, targetColumnIndex);
  const numericSources = numericSourceLettersFromPreview(preview, targetColumnIndex);
  const sourceLetters = explicitSources.length >= 2
    ? explicitSources
    : semanticSources.length >= 2 && isComputedTotalPrompt(prompt) && !isExplicitSheetAdditionPrompt(prompt)
      ? semanticSources
      : numericSources.length >= 2
        ? numericSources
        : Array.from({ length: targetColumnIndex }, (_, index) => columnIndexToLetter(index))
            .filter((letter) => {
              const index = columnLetterToIndex(letter);
              return index >= 0 && index < Math.max(preview.columns.length, targetColumnIndex);
            });
  if (sourceLetters.length < 1) {
    return null;
  }

  const rowCount = Math.max(1, Math.min(200, preview.rowCount));
  const formulaValues = Array.from({ length: rowCount }, (_, index) => {
    const spreadsheetRow = index + 2;
    const formula = formulaExpressionForRow({
      prompt,
      preview,
      sourceLetters,
      spreadsheetRow
    });
    return [formula];
  });
  const operations: Array<Record<string, unknown>> = [];
  const desiredHeader = targetHeaderForPrompt(prompt, targetColumnLetter);

  if (
    preview.columns.length <= targetColumnIndex ||
    shouldSetTargetHeader(preview.columns[targetColumnIndex] ?? "", desiredHeader, targetColumnLetter)
  ) {
    operations.push({
      type: "sheet.add_column",
      columnName: desiredHeader,
      target: {
        columnIndex: targetColumnIndex
      }
    });
  }

  operations.push({
    type: "sheet.set_range",
    range: `${targetColumnLetter}2:${targetColumnLetter}${rowCount + 1}`,
    values: formulaValues
  });

  return {
    toolName: "sheet.apply_formula",
    operations
  };
}

function extractFormulaColumnName(prompt: string) {
  const match =
    prompt.match(/\b(?:colonne|column|champ|field)\s+["'`]?([^"',.;:\n\r]+)/i) ||
    prompt.match(/\b(?:dans|to|in)\s+(?:la\s+)?(?:colonne|column)\s+["'`]?([^"',.;:\n\r]+)/i);
  return match?.[1]
    ?.replace(/\s+(avec|with|qui|that|formule|formula)\s+.*$/i, "")
    .trim() ?? "";
}

function extractNamedPart(prompt: string, keywords: RegExp, fallback = "") {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const match =
    normalized.match(new RegExp(`${keywords.source}\\s+["'\`]?([^"',.;:\\n\\r]+)`, "i")) ||
    normalized.match(/\b(?:intitulee?|called|nommee?|named)\s+["'`]?([^"',.;:\n\r]+)/i);
  return match?.[1]
    ?.replace(/\s+(au|aux|du|de|des|dans|sur|to|in|on|with|avec|qui|that|document|tableur|spreadsheet|actif|active)\s+.*$/i, "")
    .trim() || fallback;
}

function extractParagraphContent(prompt: string) {
  const quoted = prompt.match(/["'`](.+?)["'`]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  return "";
}

function extractUrl(prompt: string) {
  const match = prompt.match(/\bhttps?:\/\/[^\s"'<>]+/i);
  return match?.[0]?.replace(/[),.;]+$/g, "") ?? "";
}

function extractReplaceTextPair(prompt: string) {
  const pair =
    prompt.match(/\b(?:remplace|replace)\s+["'`](.+?)["'`]\s+(?:par|with)\s+["'`](.+?)["'`]/i) ||
    prompt.match(/\b(?:change|corrige|fix)\s+["'`](.+?)["'`]\s+(?:en|to|par|with)\s+["'`](.+?)["'`]/i);
  if (!pair?.[1] || !pair?.[2]) {
    return null;
  }
  return {
    oldText: pair[1].trim(),
    newText: pair[2].trim()
  };
}

function extractInlineCodeContent(prompt: string) {
  const fenced = prompt.match(/```[a-z0-9_-]*\n?([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return extractParagraphContent(prompt);
}

function stripDocumentMarkup(value: string) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_`>\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHtmlDocumentContent(content: string) {
  const text = String(content ?? "").trim();
  return /^</.test(text) || /<\/(?:p|h1|h2|h3|section|div|ul|ol|table)>/i.test(text);
}

function documentContentPreview(request: PublicApiAskRequest) {
  return String(request.workspaceContext?.activeWorkObject?.contentPreview ?? "");
}

function documentSectionsFromContent(content: string) {
  const sections: Array<{ title: string; normalizedTitle: string; level: number; body: string; index: number }> = [];
  const text = String(content ?? "");

  if (isHtmlDocumentContent(text)) {
    const matches = [...text.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      if (!match) {
        continue;
      }
      const title = stripDocumentMarkup(match[2] ?? "");
      if (!title) {
        continue;
      }
      const start = Number(match.index ?? 0);
      const bodyStart = start + String(match[0] ?? "").length;
      const bodyEnd = matches[index + 1]?.index ?? text.length;
      sections.push({
        title,
        normalizedTitle: normalizeText(title),
        level: Number(match[1]) || 2,
        body: stripDocumentMarkup(text.slice(bodyStart, bodyEnd)),
        index
      });
    }
    return sections;
  }

  const matches = [...text.matchAll(/^(\#{1,6})\s+(.+)$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!match) {
      continue;
    }
    const title = stripDocumentMarkup(match[2] ?? "");
    if (!title) {
      continue;
    }
    const start = Number(match.index ?? 0);
    const bodyStart = start + String(match[0] ?? "").length;
    const bodyEnd = matches[index + 1]?.index ?? text.length;
    sections.push({
      title,
      normalizedTitle: normalizeText(title),
      level: String(match[1] ?? "#").length,
      body: stripDocumentMarkup(text.slice(bodyStart, bodyEnd)),
      index
    });
  }

  if (!sections.length && text.trim()) {
    sections.push({
      title: "Document",
      normalizedTitle: "document",
      level: 1,
      body: stripDocumentMarkup(text),
      index: 0
    });
  }

  return sections;
}

function extractDocumentTargetName(prompt: string) {
  const match =
    prompt.match(/\b(?:section|partie|bloc|block|paragraphe|paragraph|titre|heading)\s+["'`]?\s*([^"',.;:\n\r]+)/i) ||
    prompt.match(/\b(?:intro|introduction|conclusion|resume|synthese|risques?|objectifs?|decision|decisions)\b/i);
  const raw = match?.[1] || match?.[0] || "";
  return raw
    .replace(/^(la|le|les|du|de|des|une|un|the|a|an)\s+/i, "")
    .replace(/\s+(au|aux|du|de|des|dans|sur|to|in|on|with|avec|qui|that|document|actif|active)(?:\s+.*)?$/i, "")
    .trim();
}

function resolveDocumentHeading(prompt: string, sections: ReturnType<typeof documentSectionsFromContent>) {
  const normalizedPrompt = normalizeText(prompt);
  const explicit = extractDocumentTargetName(prompt);
  if (explicit) {
    const normalizedExplicit = normalizeText(explicit);
    const match = sections.find((section) =>
      section.normalizedTitle === normalizedExplicit ||
      section.normalizedTitle.includes(normalizedExplicit) ||
      normalizedExplicit.includes(section.normalizedTitle)
    );
    return match?.title || explicit.replace(/^\w/, (letter) => letter.toUpperCase());
  }

  const aliases = [
    { pattern: /\b(intro|introduction)\b/, candidates: ["introduction", "intro"] },
    { pattern: /\b(conclusion|fin)\b/, candidates: ["conclusion"] },
    { pattern: /\b(resume|synthese|summary)\b/, candidates: ["resume", "synthese", "summary"] },
    { pattern: /\b(risque|risques|risk|risks)\b/, candidates: ["risque", "risques", "risk", "risks"] },
    { pattern: /\b(objectif|objectifs|goal|goals)\b/, candidates: ["objectif", "objectifs", "goal", "goals"] },
    { pattern: /\b(decision|decisions)\b/, candidates: ["decision", "decisions"] }
  ];

  for (const alias of aliases) {
    if (!alias.pattern.test(normalizedPrompt)) {
      continue;
    }
    const match = sections.find((section) =>
      alias.candidates.some((candidate) => section.normalizedTitle.includes(candidate))
    );
    const fallback = alias.candidates[0] ?? "Section";
    return match?.title || fallback.replace(/^\w/, (letter) => letter.toUpperCase());
  }

  const mentioned = [...sections]
    .sort((left, right) => right.normalizedTitle.length - left.normalizedTitle.length)
    .find((section) => section.normalizedTitle.length >= 3 && normalizedPrompt.includes(section.normalizedTitle));
  return mentioned?.title || "";
}

function summarizeDocumentSectionText(text: string, maxChars = 420) {
  const clean = stripDocumentMarkup(text);
  if (!clean) {
    return "";
  }
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const summary = (sentences.length ? sentences.slice(0, 2).join(" ") : clean).slice(0, maxChars).trim();
  return summary.length < clean.length ? `${summary.replace(/[.,;:]$/, "")}.` : summary;
}

function documentSectionBodyByHeading(sections: ReturnType<typeof documentSectionsFromContent>, heading: string) {
  const normalizedHeading = normalizeText(heading);
  return sections.find((section) =>
    section.normalizedTitle === normalizedHeading ||
    section.normalizedTitle.includes(normalizedHeading) ||
    normalizedHeading.includes(section.normalizedTitle)
  )?.body ?? "";
}

function supportsWorkspaceTool(request: PublicApiAskRequest, toolName: string) {
  const tools = request.workspaceContext?.capabilities?.workspaceTools;
  if (!tools || tools.length === 0) {
    return true;
  }
  const allowed = new Set(tools.map((tool) => tool.toLowerCase()));
  const normalized = toolName.toLowerCase();
  if (allowed.has(normalized) || allowed.has("workspace.apply_operations")) {
    return true;
  }
  if (normalized === "sheet.apply_formula" && Array.from(allowed).some((tool) => tool.startsWith("sheet."))) {
    return true;
  }
  if (normalized === "doc.edit" && Array.from(allowed).some((tool) => tool.startsWith("doc."))) {
    return true;
  }
  if (normalized === "slide.edit" && Array.from(allowed).some((tool) => tool.startsWith("slide."))) {
    return true;
  }

  const aliases: Record<string, string[]> = {
    "sheet.apply_formula": [...SHEET_WORKSPACE_TOOLS],
    "doc.edit": [
      "doc.insert_section",
      "doc.insert_heading",
      "doc.insert_paragraph",
      "doc.append_paragraph",
      "doc.replace_block",
      "doc.replace_text",
      "doc.delete_text",
      "doc.insert_table",
      "doc.insert_list",
      "doc.insert_image",
      "doc.insert_link",
      "doc.insert_page_break",
      "doc.insert_toc",
      "doc.insert_quote",
      "doc.insert_code_block",
      "doc.set_title",
      "doc.format_block",
      "doc.set_metadata",
      "doc.add_comment",
      "doc.resolve_comment",
      "doc.delete_section"
    ],
    "slide.edit": ["slide.add", "slide.update", "slide.reorder"]
  };
  return (aliases[normalized] || []).some((alias) => allowed.has(alias));
}

function extractColumnRename(prompt: string) {
  const match =
    prompt.match(/\b(?:renomme|rename)\s+(?:la\s+)?(?:colonne|column)\s+["'`]?([^"',.;:\n\r]+?)["'`]?\s+(?:en|to)\s+["'`]?([^"',.;:\n\r]+)/i) ||
    prompt.match(/\b(?:colonne|column)\s+["'`]?([^"',.;:\n\r]+?)["'`]?\s+(?:devient|becomes)\s+["'`]?([^"',.;:\n\r]+)/i);
  return match?.[1] && match?.[2]
    ? {
        from: match[1].trim(),
        to: match[2].trim()
      }
    : null;
}

function extractColumnNameFromAction(prompt: string) {
  const match =
    prompt.match(/\b(?:colonne|column)\s+["'`]?([^"',.;:\n\r]+)/i) ||
    prompt.match(/\b(?:champ|field)\s+["'`]?([^"',.;:\n\r]+)/i);
  return match?.[1]
    ?.replace(/\s+(avec|with|en|to|dans|in|sur|on|qui|that)\s+.*$/i, "")
    .trim() ?? "";
}

function extractRowIndex(prompt: string) {
  const match = prompt.match(/\b(?:ligne|row)\s+(\d{1,7})\b/i);
  return match?.[1] ? Math.max(0, Number(match[1]) - 2) : undefined;
}

function extractSortDirection(prompt: string) {
  const normalized = normalizeText(prompt);
  if (/\b(desc|descendant|decroissant|descending|du plus grand|largest)\b/.test(normalized)) {
    return "desc";
  }
  return "asc";
}

function extractFilterValue(prompt: string) {
  const match =
    prompt.match(/\b(?:filtre|filter)\b[\s\S]*?\b(?:sur|avec|=|egal(?:e)? a|equals?)\s+["'`]?([^"',.;:\n\r]+)/i) ||
    prompt.match(/\b(?:statut|status)\s+["'`]?([^"',.;:\n\r]+)/i);
  return match?.[1]?.trim() ?? "";
}

function inferSheetFormat(prompt: string) {
  const normalized = normalizeText(prompt);
  const format: Record<string, unknown> = {};
  if (/\b(gras|bold)\b/.test(normalized)) {
    format.bold = true;
  }
  if (/\b(italique|italic)\b/.test(normalized)) {
    format.italic = true;
  }
  if (/\b(devise|currency|euro|eur|€)\b/.test(normalized)) {
    format.numberFormat = "currency";
  }
  if (/\b(pourcentage|percent|%)\b/.test(normalized)) {
    format.numberFormat = "percent";
  }
  return Object.keys(format).length ? format : null;
}

function sheetWorkspacePlan(operations: Array<Record<string, unknown>>, toolName = "sheet.apply_formula") {
  return {
    toolName,
    operations
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownColumnFromPrompt(prompt: string, preview: ReturnType<typeof sheetPreview>) {
  const normalized = normalizeText(prompt);
  return [...preview.columns]
    .filter((column) => normalizeText(column).length >= 2)
    .sort((left, right) => normalizeText(right).length - normalizeText(left).length)
    .find((column) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizeText(column))}($|[^a-z0-9])`).test(normalized)) ?? "";
}

function resolvePromptColumnName(prompt: string, preview: ReturnType<typeof sheetPreview>) {
  return knownColumnFromPrompt(prompt, preview) || extractColumnNameFromAction(prompt);
}

function inferFilterColumnName(prompt: string, preview: ReturnType<typeof sheetPreview>, value: string) {
  const direct = resolvePromptColumnName(prompt, preview);
  if (direct) {
    return direct;
  }
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }
  const matchedIndex = preview.columns.findIndex((_, index) =>
    preview.rows.some((row) => {
      const cell = normalizeText(row[index] ?? "");
      return cell === normalizedValue || cell.includes(normalizedValue);
    })
  );
  return matchedIndex >= 0 ? preview.columns[matchedIndex] ?? "" : "";
}

function usedSheetRange(preview: ReturnType<typeof sheetPreview>) {
  const width = Math.max(1, preview.columns.length || Math.max(1, ...preview.rows.map((row) => row.length)));
  const rowCount = Math.max(1, preview.rowCount || preview.rows.length || 1);
  return `A1:${columnIndexToLetter(width - 1)}${rowCount + 1}`;
}

function defaultCellAfterData(preview: ReturnType<typeof sheetPreview>, rowNumber = 2) {
  return `${columnIndexToLetter(Math.max(0, preview.columns.length))}${rowNumber}`;
}

function extractSheetRange(prompt: string, preview: ReturnType<typeof sheetPreview>) {
  return extractFormulaRange(prompt) || usedSheetRange(preview);
}

function extractCountFor(prompt: string, nouns: string) {
  const match = normalizeText(prompt).match(new RegExp(`\\b(\\d{1,3})\\s*(?:${nouns})\\b`));
  if (match?.[1]) {
    return Math.max(1, Math.min(200, Number(match[1])));
  }
  return 1;
}

function extractDimensionValue(prompt: string) {
  const normalized = normalizeText(prompt);
  const match =
    normalized.match(/\b(?:largeur|width|hauteur|height)\s*(?:a|à|de|to)?\s*(\d{1,4})\b/) ||
    normalized.match(/\b(\d{1,4})\s*(?:px|pixels?|points?|pt)\b/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function extractZoomValue(prompt: string) {
  const match = normalizeText(prompt).match(/\b(\d{2,3})\s*%?\b/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function inferFreezePayload(prompt: string) {
  const normalized = normalizeText(prompt);
  const rows =
    normalized.match(/\b(\d{1,2})\s*(?:lignes?|rows?)\b/)?.[1] ??
    (/\b(premiere|first|en[- ]?tete|header)\s+(?:ligne|row)\b/.test(normalized) ? "1" : "0");
  const columns =
    normalized.match(/\b(\d{1,2})\s*(?:colonnes?|columns?)\b/)?.[1] ??
    (/\b(premiere|first)\s+(?:colonne|column)\b/.test(normalized) ? "1" : "0");
  return {
    rows: Math.max(0, Number(rows) || 0),
    columns: Math.max(0, Number(columns) || 0)
  };
}

function inferChartType(prompt: string) {
  const normalized = normalizeText(prompt);
  if (/\b(camembert|pie|donut)\b/.test(normalized)) {
    return "pie";
  }
  if (/\b(ligne|line|courbe)\b/.test(normalized)) {
    return "line";
  }
  if (/\b(barre|barres|bar|histogramme|column)\b/.test(normalized)) {
    return "bar";
  }
  return "bar";
}

function extractListValues(prompt: string) {
  const quoted = extractParagraphContent(prompt);
  const raw =
    quoted ||
    prompt.match(/\b(?:liste|valeurs?|options?|choices?)\s+["'`]?([^.;:\n\r]+)/i)?.[1] ||
    "";
  return raw
    .split(/,|\bou\b|\bor\b|\|/i)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function inferGridlineValue(prompt: string) {
  return !/\b(masque|masquer|cache|cacher|hide|off|sans|remove)\b/.test(normalizeText(prompt));
}

function extractSheetRename(prompt: string) {
  const match =
    prompt.match(/\b(?:renomme|rename)\s+(?:la\s+)?(?:feuille|onglet|sheet|tab)\s+["'`]?([^"',.;:\n\r]+?)["'`]?\s+(?:en|to)\s+["'`]?([^"',.;:\n\r]+)/i) ||
    prompt.match(/\b(?:feuille|onglet|sheet|tab)\s+["'`]?([^"',.;:\n\r]+?)["'`]?\s+(?:devient|becomes)\s+["'`]?([^"',.;:\n\r]+)/i);
  return match?.[1] && match?.[2]
    ? {
        from: match[1].trim(),
        to: match[2].trim()
      }
    : null;
}

function extractSheetName(prompt: string, fallback = "Sheet") {
  return extractNamedPart(prompt, /(?:feuille|onglet|sheet|tab)/, fallback);
}

function extractObjectTitle(prompt: string, keywords: RegExp, fallback: string) {
  return extractNamedPart(prompt, keywords, fallback);
}

function planSheetWorkspaceToolOperation(request: PublicApiAskRequest, question: string) {
  const normalized = normalizeText(question);
  if (!request.workspaceContext?.activeWorkObject || !isDatasetWorkspaceRequest(request, normalized)) {
    return null;
  }
  if (!supportsWorkspaceTool(request, "sheet.apply_formula") && !supportsWorkspaceTool(request, "sheet.set_cell")) {
    return null;
  }
  const preview = sheetPreview(request);

  const formula = inferFormula(question);
  if (formula) {
    const cell = extractCellReference(question);
    const columnName = extractFormulaColumnName(question);
    if (columnName) {
      return {
        toolName: "sheet.apply_formula",
        operations: [
          {
            type: "sheet.add_column",
            columnName,
            formula,
            target: {
              columnName,
              rowIndex: 0
            }
          }
        ]
      };
    }

    if (cell) {
      return {
        toolName: "sheet.apply_formula",
        operations: [
          {
            type: "sheet.set_formula",
            formula,
            target: {
              cell
            }
          }
        ]
      };
    }
  }

  const implicitFormulaPlan = inferImplicitSheetFormulaPlan(request, question);
  if (implicitFormulaPlan) {
    return implicitFormulaPlan;
  }

  const range = extractSheetRange(question, preview);
  const explicitRange = extractFormulaRange(question);
  const cell = extractCellReference(question);

  const sheetRename = extractSheetRename(question);
  if (sheetRename) {
    return sheetWorkspacePlan([
      {
        type: "sheet.rename_sheet",
        title: sheetRename.to,
        value: sheetRename.to
      }
    ]);
  }

  if (/\b(ajoute|add|cree|create|nouvelle|new)\b/.test(normalized) && /\b(feuille|onglet|sheet|tab)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.add_sheet",
        title: extractSheetName(question, "Sheet")
      }
    ]);
  }

  if (/\b(duplique|duplicate|copie|copy)\b/.test(normalized) && /\b(feuille|onglet|sheet|tab)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.duplicate_sheet",
        title: extractSheetName(question, "Copy")
      }
    ]);
  }

  if (/\b(active|ouvre|open|selectionne|select)\b/.test(normalized) && /\b(feuille|onglet|sheet|tab)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.set_active_sheet",
        title: extractSheetName(question, "Sheet")
      }
    ]);
  }

  if (/\b(masque|hide|cache)\b/.test(normalized) && /\b(feuille|onglet|sheet|tab)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.hide_sheet",
        title: extractSheetName(question, "Sheet")
      }
    ]);
  }

  if (/\b(affiche|show|unhide)\b/.test(normalized) && /\b(feuille|onglet|sheet|tab)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.unhide_sheet",
        title: extractSheetName(question, "Sheet")
      }
    ]);
  }

  if (/\b(supprime|delete|remove)\b/.test(normalized) && /\b(feuille|onglet|sheet|tab)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.delete_sheet",
        title: extractSheetName(question, "Sheet")
      }
    ]);
  }

  if (/\b(deplace|move|reorder)\b/.test(normalized) && /\b(feuille|onglet|sheet|tab)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.move_sheet",
        title: extractSheetName(question, "Sheet"),
        target: {
          toIndex: Math.max(0, (extractCountFor(question, "position|place|index") || 1) - 1)
        }
      }
    ]);
  }

  const rename = extractColumnRename(question);
  if (rename) {
    return {
      toolName: "sheet.apply_formula",
      operations: [
        {
          type: "sheet.rename_column",
          value: rename.to,
          target: {
            columnName: rename.from
          }
        }
      ]
    };
  }

  if (/\b(ajoute|add|cree|create)\b/.test(normalized) && /\b(colonnes?|columns?|champs?|fields?)\b/.test(normalized)) {
    const columnName = extractColumnNameFromAction(question) || "Nouvelle colonne";
    return sheetWorkspacePlan([
      {
        type: "sheet.add_column",
        columnName,
        target: {
          columnName
        }
      }
    ]);
  }

  if (/\b(insere|insert)\b/.test(normalized) && /\b(colonnes?|columns?)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.insert_columns",
        count: extractCountFor(question, "colonnes?|columns?"),
        values: [extractColumnNameFromAction(question)].filter(Boolean),
        target: {
          columnIndex: Math.max(0, preview.columns.length)
        }
      }
    ]);
  }

  if (/\b(insere|insert)\b/.test(normalized) && /\b(lignes?|rows?)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.insert_rows",
        count: extractCountFor(question, "lignes?|rows?"),
        target: {
          rowIndex: extractRowIndex(question) ?? Math.max(0, preview.rowCount)
        }
      }
    ]);
  }

  if (/\b(supprime|delete|remove)\b/.test(normalized) && /\b(colonnes?|columns?)\b/.test(normalized)) {
    const columnName = resolvePromptColumnName(question, preview);
    if (columnName) {
      return {
        toolName: "sheet.apply_formula",
        operations: [
          {
            type: extractCountFor(question, "colonnes?|columns?") > 1 ? "sheet.delete_columns" : "sheet.delete_column",
            count: extractCountFor(question, "colonnes?|columns?"),
            target: {
              columnName
            }
          }
        ]
      };
    }
  }

  if (/\b(supprime|delete|remove)\b/.test(normalized) && /\b(lignes?|rows?)\b/.test(normalized)) {
    const rowIndex = extractRowIndex(question);
    if (rowIndex !== undefined) {
      return {
        toolName: "sheet.apply_formula",
        operations: [
          {
            type: extractCountFor(question, "lignes?|rows?") > 1 ? "sheet.delete_rows" : "sheet.delete_row",
            count: extractCountFor(question, "lignes?|rows?"),
            target: {
              rowIndex
            }
          }
        ]
      };
    }
  }

  if (
    /\b(ajoute|add|insert)\b/.test(normalized) &&
    /\b(lignes?|rows?)\b/.test(normalized) &&
    !/\b(graphique|chart|diagramme|courbe)\b/.test(normalized)
  ) {
    return {
      toolName: "sheet.apply_formula",
      operations: [
        {
          type: "sheet.add_row",
          target: {
            rowIndex: extractRowIndex(question)
          }
        }
      ]
    };
  }

  if (/\b(redimensionne|resize|largeur|width)\b/.test(normalized) && /\b(colonnes?|columns?)\b/.test(normalized)) {
    const columnName = resolvePromptColumnName(question, preview);
    const width = extractDimensionValue(question);
    if (columnName && width) {
      return sheetWorkspacePlan([
        {
          type: "sheet.resize_column",
          width,
          target: {
            columnName
          }
        }
      ]);
    }
  }

  if (/\b(redimensionne|resize|hauteur|height)\b/.test(normalized) && /\b(lignes?|rows?)\b/.test(normalized)) {
    const height = extractDimensionValue(question);
    if (height) {
      return sheetWorkspacePlan([
        {
          type: "sheet.resize_row",
          height,
          target: {
            rowIndex: extractRowIndex(question) ?? 0
          }
        }
      ]);
    }
  }

  if (/\b(efface|clear|vide|nettoie)\b/.test(normalized) && /\b(filtre|filter)\b/.test(normalized)) {
    return sheetWorkspacePlan([{ type: "sheet.clear_filter" }]);
  }

  if (/\b(efface|clear|vide|nettoie)\b/.test(normalized) && /\b(format|style|mise en forme)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.clear_format",
        range: explicitRange,
        target: {
          ...(cell ? { cell } : {}),
          ...(resolvePromptColumnName(question, preview) ? { columnName: resolvePromptColumnName(question, preview) } : {})
        }
      }
    ]);
  }

  if (/\b(efface|clear|vide|nettoie)\b/.test(normalized) && /\b(note|commentaire|comment)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.clear_note",
        range: explicitRange || (cell ? "" : range),
        target: {
          ...(cell ? { cell } : {})
        }
      }
    ]);
  }

  if (/\b(efface|clear|vide|nettoie)\b/.test(normalized) && /\b(validation|liste|dropdown)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.clear_data_validation",
        range: explicitRange || (cell ? "" : range),
        target: {
          ...(cell ? { cell } : {})
        }
      }
    ]);
  }

  if (/\b(efface|clear|vide|nettoie)\b/.test(normalized) && /\b(cellules?|cells?|plage|range|contenu|valeurs?)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.clear_cells",
        range: explicitRange,
        target: {
          ...(cell ? { cell } : {}),
          ...(resolvePromptColumnName(question, preview) ? { columnName: resolvePromptColumnName(question, preview) } : {})
        }
      }
    ]);
  }

  if (/\b(tri|trie|trier|sort|classe|classer|ordonner)\b/.test(normalized)) {
    const columnName = resolvePromptColumnName(question, preview);
    if (columnName) {
      return {
        toolName: "sheet.apply_formula",
        operations: [
          {
            type: "sheet.sort_range",
            direction: extractSortDirection(question),
            target: {
              columnName
            }
          }
        ]
      };
    }
  }

  if (/\b(filtre|filter)\b/.test(normalized)) {
    const value = extractFilterValue(question);
    const columnName = inferFilterColumnName(question, preview, value);
    if (columnName || value) {
      return {
        toolName: "sheet.apply_formula",
        operations: [
          {
            type: "sheet.filter_rows",
            value,
            target: {
              columnName
            }
          }
        ]
      };
    }
  }

  const format = inferSheetFormat(question);
  if (format) {
    const columnName = resolvePromptColumnName(question, preview);
    return {
      toolName: "sheet.apply_formula",
      operations: [
        {
          type: "sheet.format_cells",
          format,
          range: explicitRange,
          target: {
            ...(cell ? { cell } : {}),
            ...(columnName ? { columnName } : {})
          }
        }
      ]
    };
  }

  if (/\b(fusionne|merge)\b/.test(normalized) && /\b(cellules?|cells?|plage|range|:)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.merge_cells",
        range: explicitRange || range
      }
    ]);
  }

  if (/\b(defusionne|de[- ]?fusionne|unmerge)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.unmerge_cells",
        range: explicitRange
      }
    ]);
  }

  if (/\b(note|commentaire|comment)\b/.test(normalized)) {
    const text = extractParagraphContent(question);
    return sheetWorkspacePlan([
      {
        type: "sheet.set_note",
        value: text,
        range: explicitRange || (cell ? "" : range),
        target: {
          ...(cell ? { cell } : {})
        }
      }
    ]);
  }

  if (/\b(validation|liste deroulante|liste déroulante|dropdown|choix)\b/.test(normalized)) {
    const values = extractListValues(question);
    return sheetWorkspacePlan([
      {
        type: "sheet.set_data_validation",
        range: explicitRange || (cell ? "" : range),
        payload: {
          type: values.length ? "list" : "any",
          values
        },
        target: {
          ...(cell ? { cell } : {})
        }
      }
    ]);
  }

  if (/\b(conditionnel|conditional)\b/.test(normalized) && /\b(format|mise en forme|couleur|color)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: /\b(supprime|remove|delete)\b/.test(normalized) ? "sheet.remove_conditional_format" : "sheet.add_conditional_format",
        title: extractObjectTitle(question, /(?:format|regle|rule)/, "Format conditionnel"),
        range: explicitRange || range,
        format: inferSheetFormat(question) || { fillColor: "yellow" }
      }
    ]);
  }

  if (/\b(tableau croise|tableau croisé|pivot|tcd)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: /\b(supprime|remove|delete)\b/.test(normalized) ? "sheet.remove_pivot_table" : "sheet.add_pivot_table",
        title: extractObjectTitle(question, /(?:pivot|tcd|tableau croise|tableau croisé)/, "Pivot"),
        range: explicitRange || range
      }
    ]);
  }

  if (/\b(tableau|table)\b/.test(normalized) && !/\b(tableur|spreadsheet|sheet)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: /\b(supprime|remove|delete)\b/.test(normalized) ? "sheet.remove_table" : "sheet.add_table",
        title: extractObjectTitle(question, /(?:tableau|table)/, "Table"),
        range: explicitRange || range
      }
    ]);
  }

  if (/\b(graphique|chart|diagramme|courbe|camembert|histogramme)\b/.test(normalized)) {
    const remove = /\b(supprime|remove|delete)\b/.test(normalized);
    return sheetWorkspacePlan([
      {
        type: remove ? "sheet.remove_chart" : /\b(modifie|update|mets a jour|met a jour)\b/.test(normalized) ? "sheet.update_chart" : "sheet.add_chart",
        title: extractObjectTitle(question, /(?:graphique|chart|diagramme)/, "Graphique"),
        range: explicitRange || range,
        payload: {
          chartType: inferChartType(question)
        }
      }
    ]);
  }

  if (/\b(sparkline|mini[- ]?graphique)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: /\b(supprime|remove|delete)\b/.test(normalized) ? "sheet.remove_sparkline" : "sheet.add_sparkline",
        range: explicitRange || range,
        target: {
          cell: cell || defaultCellAfterData(preview)
        }
      }
    ]);
  }

  if (/\b(segment|slicer)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: /\b(supprime|remove|delete)\b/.test(normalized) ? "sheet.remove_slicer" : "sheet.add_slicer",
        title: extractObjectTitle(question, /(?:segment|slicer)/, "Slicer"),
        range: explicitRange || range,
        target: {
          columnName: resolvePromptColumnName(question, preview)
        }
      }
    ]);
  }

  if (/\b(plage nommee|plage nommée|named range|nomme la plage|name the range)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: /\b(supprime|remove|delete)\b/.test(normalized) ? "sheet.remove_named_range" : "sheet.add_named_range",
        title: extractObjectTitle(question, /(?:plage nommee|plage nommée|named range|plage)/, "Plage"),
        range: explicitRange || range
      }
    ]);
  }

  if (/\b(protege|protège|protect|verrouille|lock)\b/.test(normalized) && /\b(feuille|sheet)\b/.test(normalized)) {
    return sheetWorkspacePlan([{ type: "sheet.protect_sheet" }]);
  }

  if (/\b(deprotege|déprotège|unprotect|deverrouille|déverrouille|unlock)\b/.test(normalized) && /\b(feuille|sheet)\b/.test(normalized)) {
    return sheetWorkspacePlan([{ type: "sheet.unprotect_sheet" }]);
  }

  if (/\b(protege|protège|protect|verrouille|lock)\b/.test(normalized) && /\b(plage|range|cellules?|cells?)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.protect_range",
        range: explicitRange || range
      }
    ]);
  }

  if (/\b(deprotege|déprotège|unprotect|deverrouille|déverrouille|unlock)\b/.test(normalized) && /\b(plage|range|cellules?|cells?)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.unprotect_range",
        range: explicitRange || range
      }
    ]);
  }

  if (/\b(fixe|fige|freeze|gel|pane|volet)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.freeze_panes",
        payload: inferFreezePayload(question)
      }
    ]);
  }

  if (/\b(zoom)\b/.test(normalized)) {
    const zoom = extractZoomValue(question);
    if (zoom) {
      return sheetWorkspacePlan([
        {
          type: "sheet.set_zoom",
          value: zoom
        }
      ]);
    }
  }

  if (/\b(quadrillage|gridlines?|grille)\b/.test(normalized)) {
    return sheetWorkspacePlan([
      {
        type: "sheet.show_gridlines",
        value: inferGridlineValue(question)
      }
    ]);
  }

  const quotedValue = extractParagraphContent(question);
  if (cell && quotedValue && /\b(mets|met|set|ecris|write|remplis|fill)\b/.test(normalized)) {
    return {
      toolName: "sheet.set_cell",
      operations: [
        {
          type: "sheet.set_cell",
          value: quotedValue,
          target: {
            cell
          }
        }
      ]
    };
  }

  return null;
}

function planDocumentWorkspaceToolOperation(request: PublicApiAskRequest, question: string, answer: string) {
  const normalized = normalizeText(question);
  if (!request.workspaceContext?.activeWorkObject || !isDocumentWorkspaceRequest(request, normalized)) {
    return null;
  }
  if (!supportsWorkspaceTool(request, "doc.edit")) {
    return null;
  }

  const preview = documentContentPreview(request);
  const sections = documentSectionsFromContent(preview);
  const targetHeading = resolveDocumentHeading(question, sections);
  const quotedContent = extractParagraphContent(question);
  const explicitTarget = extractDocumentTargetName(question);

  if (/\b(toc|sommaire|table des matieres|table of contents)\b/.test(normalized)) {
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.insert_toc"
        }
      ]
    };
  }

  if (/\b(titre|title)\b/.test(normalized) && /\b(change|set|mets|met|renomme|rename)\b/.test(normalized)) {
    const title = quotedContent || explicitTarget;
    if (!title) {
      return null;
    }
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.set_title",
          title
        }
      ]
    };
  }

  const replacePair = extractReplaceTextPair(question);
  if (replacePair) {
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.replace_text",
          content: replacePair.newText,
          target: {
            oldText: replacePair.oldText
          }
        }
      ]
    };
  }

  if (/\b(saut de page|page break)\b/.test(normalized)) {
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.insert_page_break"
        }
      ]
    };
  }

  if (/\b(lien|link|url)\b/.test(normalized)) {
    const href = extractUrl(question);
    if (href) {
      return {
        toolName: "doc.edit",
        operations: [
          {
            type: "doc.insert_link",
            title: quotedContent || extractNamedPart(question, /(?:lien|link)/, "Lien"),
            value: href,
            target: targetHeading ? { heading: targetHeading } : { position: "end" }
          }
        ]
      };
    }
  }

  if (/\b(image|logo|illustration)\b/.test(normalized)) {
    const src = extractUrl(question);
    if (src) {
      return {
        toolName: "doc.edit",
        operations: [
          {
            type: "doc.insert_image",
            title: extractNamedPart(question, /(?:image|logo|illustration)/, "Image"),
            value: src,
            target: targetHeading ? { heading: targetHeading } : { position: "end" }
          }
        ]
      };
    }
  }

  if (/\b(citation|quote|blockquote)\b/.test(normalized)) {
    const content = quotedContent || explicitTarget;
    if (content) {
      return {
        toolName: "doc.edit",
        operations: [
          {
            type: "doc.insert_quote",
            content,
            target: targetHeading ? { heading: targetHeading } : { position: "end" }
          }
        ]
      };
    }
  }

  if (/\b(code|snippet|extrait de code)\b/.test(normalized)) {
    const content = extractInlineCodeContent(question);
    if (content) {
      return {
        toolName: "doc.edit",
        operations: [
          {
            type: "doc.insert_code_block",
            content,
            payload: {
              language: compact(question.match(/\b(?:js|ts|tsx|python|py|sql|bash|json|html|css)\b/i)?.[0], 40)
            },
            target: targetHeading ? { heading: targetHeading } : { position: "end" }
          }
        ]
      };
    }
  }

  if (/\b(commentaire|comment|note de revision|review note)\b/.test(normalized)) {
    const content = quotedContent || explicitTarget || "A verifier.";
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.add_comment",
          title: targetHeading || "Commentaire",
          content,
          target: targetHeading ? { heading: targetHeading } : { position: "end" }
        }
      ]
    };
  }

  if (/\b(ajoute|add|insert|insere|cree|create)\b/.test(normalized) && /\b(titre|heading)\b/.test(normalized)) {
    const title = explicitTarget || quotedContent || extractNamedPart(question, /(?:titre|heading)/, "Titre");
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.insert_heading",
          title,
          target: {
            level: /\b(h1|niveau 1|level 1)\b/.test(normalized) ? 1 : 2
          }
        }
      ]
    };
  }

  if (/\b(ajoute|add|insert|insere|cree|create)\b/.test(normalized) && /\b(paragraphe|paragraph)\b/.test(normalized)) {
    const content = quotedContent || explicitTarget;
    if (content) {
      return {
        toolName: "doc.edit",
        operations: [
          {
            type: "doc.insert_paragraph",
            content,
            target: targetHeading ? { heading: targetHeading } : { position: "end" }
          }
        ]
      };
    }
  }

  if (/\b(supprime|delete|remove)\b/.test(normalized) && /\b(section|partie|heading)\b/.test(normalized)) {
    const heading = targetHeading || explicitTarget || "Section";
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.delete_section",
          title: heading,
          target: {
            heading
          }
        }
      ]
    };
  }

  if (/\b(ajoute|add|insert|insere|cree|create)\b/.test(normalized) && /\b(table|tableau)\b/.test(normalized)) {
    const title = extractNamedPart(question, /(?:table|tableau)/, "") || explicitTarget || "Tableau";
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.insert_table",
          title,
          content: quotedContent || answer || "",
          target: {
            ...(targetHeading ? { heading: targetHeading } : { position: "end" })
          }
        }
      ]
    };
  }

  if (/\b(liste|checklist|points?|bullets?)\b/.test(normalized) && /\b(ajoute|add|insert|insere|cree|create)\b/.test(normalized)) {
    const values = quotedContent
      ? quotedContent.split(/;|\n/).map((item) => item.trim()).filter(Boolean)
      : [];
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.insert_list",
          values: values.length ? values : ["A completer"],
          target: targetHeading ? { heading: targetHeading } : { position: "end" }
        }
      ]
    };
  }

  if (/\b(ajoute|add|insert|insere|cree|create)\b/.test(normalized) && /\b(section|partie|heading)\b/.test(normalized)) {
    const heading = targetHeading || explicitTarget || extractNamedPart(question, /(?:section|partie|heading)/, "") || "Nouvelle section";
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.insert_section",
          title: heading,
          content: quotedContent || "A completer.",
          target: {
            position: "end"
          }
        }
      ]
    };
  }

  const blockTitle = targetHeading || extractNamedPart(question, /(?:bloc|block|section|partie)/, "");
  if (/\b(remplace|replace|rewrite|reformule|modifie|modify|corrige|fix|resume|summarize|raccourcis|shorten)\b/.test(normalized)) {
    const replacement =
      quotedContent ||
      (/\b(resume|summarize|raccourcis|shorten)\b/.test(normalized)
        ? summarizeDocumentSectionText(documentSectionBodyByHeading(sections, blockTitle))
        : answer);
    if (!replacement) {
      return null;
    }
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.replace_block",
          blockTitle: blockTitle || "Contenu",
          content: replacement,
          target: {
            heading: blockTitle || "Contenu"
          }
        }
      ]
    };
  }

  if (/\b(ajoute|append|add|complete|continue)\b/.test(normalized)) {
    const contentToAppend = quotedContent || explicitTarget || answer;
    if (!contentToAppend) {
      return null;
    }
    return {
      toolName: "doc.edit",
      operations: [
        {
          type: "doc.append_paragraph",
          content: contentToAppend,
          target: targetHeading ? { heading: targetHeading } : { position: "end" }
        }
      ]
    };
  }

  return null;
}

function extractSlideIndex(prompt: string) {
  const match = prompt.match(/\b(?:slide|diapo|diapositive)\s+(\d{1,3})\b/i);
  return match?.[1] ? Math.max(0, Number(match[1]) - 1) : undefined;
}

function planSlideWorkspaceToolOperation(request: PublicApiAskRequest, question: string, answer: string) {
  const normalized = normalizeText(question);
  if (!request.workspaceContext?.activeWorkObject || !isPresentationWorkspaceRequest(request, normalized)) {
    return null;
  }
  if (!supportsWorkspaceTool(request, "slide.edit")) {
    return null;
  }

  const title = extractNamedPart(question, /(?:slide|diapo|diapositive)/, "");
  const slideIndex = extractSlideIndex(question);
  if (/\b(ajoute|add|insert|insere|cree|create)\b/.test(normalized)) {
    return {
      toolName: "slide.edit",
      operations: [
        {
          type: "slide.add",
          title: title || "Nouvelle slide",
          content: answer || "",
          target: {
            position: "end"
          }
        }
      ]
    };
  }

  if (/\b(modifie|modify|update|mets a jour|remplace|replace|rewrite|reformule)\b/.test(normalized)) {
    const target = slideIndex !== undefined
      ? { slideIndex }
      : { position: "current" };
    return {
      toolName: "slide.edit",
      operations: [
        {
          type: "slide.update",
          title: title || undefined,
          content: answer || extractParagraphContent(question) || question,
          target
        }
      ]
    };
  }

  return null;
}

function planWorkspaceToolOperation(request: PublicApiAskRequest, question: string, answer: string) {
  return (
    planSheetWorkspaceToolOperation(request, question) ||
    planDocumentWorkspaceToolOperation(request, question, answer) ||
    planSlideWorkspaceToolOperation(request, question, answer)
  );
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

  const workspaceToolPlan = active && actions.has("workspace_tool_call") && wantsWorkspaceToolCall(question)
    ? planWorkspaceToolOperation(request, question, answer)
    : null;
  if (active && workspaceToolPlan) {
    return [
      makeAction(args, {
        type: "workspace_tool_call",
        title: `Utiliser un outil workspace sur ${active.title || active.id}`,
        target: {
          workObjectId: active.id,
          entryPath: active.entryPath ?? "table.csv"
        },
        payload: {
          instruction: question,
          workspaceFamilyId: activeWorkspaceFamilyId(request),
          currentKind: active.kind ?? "",
          currentPreview: compact(active.contentPreview, 1500),
          ...workspaceToolPlan
        },
        riskLevel: "medium",
        requiresConfirmation: requireConfirmation,
        dryRun: true,
        rationale: "La requete demande une operation d'outil workspace. Core propose l'operation; l'OS confirme et l'applique sur la surface active."
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
          currentPreview: compact(active.contentPreview, 1500),
          workspaceFamilyId: activeWorkspaceFamilyId(request),
          columns: extractRequestedColumns(question),
          sections: extractRequestedSections(question)
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
    const numericTable = inferWorkObjectKind(question, allowedKinds) === "dataset"
      ? extractNumericTableFromPrompt(question)
      : null;
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
          workspaceFamilyId: activeWorkspaceFamilyId(request),
          answerDraft: compact(answer, 3000),
          columns: numericTable?.columns ?? extractRequestedColumns(question),
          rows: numericTable?.rows ?? [],
          sections: extractRequestedSections(question)
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
          workspaceFamilyId: activeWorkspaceFamilyId(request),
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

export function shouldUsePublicApiWorkspaceActionFastPath(request: PublicApiAskRequest) {
  if (!request.options.includeProposedActions || !request.workspaceContext) {
    return false;
  }

  const question = normalizeText(request.input ?? request.question ?? "");

  if (hasSourceSensitiveNeed(question)) {
    return false;
  }

  const datasetRequest = isDatasetWorkspaceRequest(request, question);
  const documentRequest = isDocumentWorkspaceRequest(request, question);
  const datasetUpdate =
    datasetRequest && /\b(ajoute|add)\b.*\b(colonne|column|champ|field)\b/.test(question);
  const presentationRequest = isPresentationWorkspaceRequest(request, question);
  const workspaceToolRequest =
    (datasetRequest || documentRequest || presentationRequest) && wantsWorkspaceToolCall(question);
  const metadataUpdate =
    /\b(renomme|rename|retitle|statut|status)\b/.test(question) ||
    /\b(change le titre|set title)\b/.test(question);
  const datasetCreate =
    /\b(cree|create|genere|generate|fais|make|presente|presenter|mets|mettre)\b/.test(question) &&
      /\b(excel|xlsx|csv|tableur|spreadsheet|sheet)\b/.test(question) &&
      (/\b(colonne|colonnes|column|columns|champ|fields)\b/.test(question) || Boolean(extractNumericTableFromPrompt(question)));
  const documentUpdate =
    documentRequest &&
    /\b(ajoute|add|complete|continue|ameliore|improve|reformule|rewrite|corrige|fix)\b/.test(question) &&
    /\b(section|partie|paragraphe|paragraph|heading|titre|intro|introduction|document|texte|brief|rapport|note)\b/.test(question);
  const documentCreate =
    /\b(cree|create|genere|generate|fais|make|redige|write|draft)\b/.test(question) &&
    /\b(word|docx|document|rapport|brief|note|sop|wiki)\b/.test(question);

  return workspaceToolRequest || datasetUpdate || metadataUpdate || datasetCreate || documentUpdate || documentCreate;
}

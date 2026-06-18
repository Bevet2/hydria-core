import type { WorkObjectKind } from "../../types/workObjects.js";

export type HydriaSheetModel = {
  kind: "hydria-sheet";
  version: 1;
  activeSheetId: string;
  namedRanges: unknown[];
  sheets: Array<{
    id: string;
    name: string;
    columns: string[];
    rows: string[][];
    columnWidths: Record<string, number>;
    rowHeights: Record<string, number>;
    merges: unknown[];
    cellFormats: Record<string, unknown>;
    cellNotes: Record<string, unknown>;
    dataValidations: Record<string, unknown>;
    conditionalFormats: unknown[];
    tables: unknown[];
    pivotTables: unknown[];
    charts: unknown[];
    sparklines: Record<string, unknown>;
    slicers: unknown[];
    filterQuery: string;
    filterColumnIndex: number;
    tableFilters: Record<string, unknown>;
    sort: unknown | null;
    hidden: boolean;
    protected: boolean;
    protectedRanges: unknown[];
    zoomLevel: number;
    showGridlines: boolean;
    frozenRows: number;
    frozenColumns: number;
  }>;
  columns?: string[];
  rows?: string[][];
};

export type WorkspaceSourceFile = {
  path: string;
  content: string;
};

export type HydriaWorkspaceToolOperation = {
  type: string;
  sheetId?: string;
  target?: {
    cell?: string;
    columnName?: string;
    columnIndex?: number;
    rowIndex?: number;
    heading?: string;
    oldText?: string;
    blockId?: string;
    wholeFile?: boolean;
    blockTitle?: string;
    position?: string;
    count?: number;
    fromIndex?: number;
    toIndex?: number;
    level?: number;
    slideIndex?: number;
  };
  columnName?: string;
  formula?: string;
  value?: string;
  values?: unknown;
  range?: string;
  direction?: string;
  format?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  options?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  count?: number;
  width?: number;
  height?: number;
  title?: string;
  content?: string;
  blockTitle?: string;
  slideIndex?: number;
  bullets?: string[];
};

export type HydriaWorkspaceToolApplyResult = {
  content: string;
  applied: string[];
  issues: string[];
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeSheetLabel(value: unknown, fallback = "") {
  return compact(value, 80).replace(/[\r\n\t]+/g, " ").trim() || fallback;
}

function uniqueLabels(values: string[]) {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    const label = sanitizeSheetLabel(value, "Column");
    const key = normalizeText(label);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

function normalizeRows(rows: string[][], columnCount: number) {
  return rows.map((row) => {
    const next = row.slice(0, columnCount).map((cell) => compact(cell, 500));
    while (next.length < columnCount) {
      next.push("");
    }
    return next;
  });
}

function columnNameFromIndex(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name || "A";
}

function columnIndexFromName(value: string) {
  const letters = String(value || "").replace(/[^a-z]/gi, "").toUpperCase();
  if (!letters) {
    return -1;
  }
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseA1Cell(value: string) {
  const match = /^\$?([A-Z]{1,4})\$?(\d{1,7})$/i.exec(String(value || "").trim());
  if (!match) {
    return null;
  }
  const spreadsheetRowIndex = Number(match[2]) - 1;
  return {
    columnIndex: columnIndexFromName(match[1] || ""),
    rowIndex: Math.max(0, spreadsheetRowIndex - 1),
    header: spreadsheetRowIndex === 0
  };
}

function parseA1Range(value: string) {
  const [startRaw = "", endRaw = ""] = String(value || "").toUpperCase().replace(/\$/g, "").split(":");
  const start = parseA1Cell(startRaw.trim());
  const end = parseA1Cell((endRaw || startRaw).trim());
  if (!start || !end) {
    return null;
  }
  return {
    startRowIndex: Math.min(start.rowIndex, end.rowIndex),
    endRowIndex: Math.max(start.rowIndex, end.rowIndex),
    startColumnIndex: Math.min(start.columnIndex, end.columnIndex),
    endColumnIndex: Math.max(start.columnIndex, end.columnIndex)
  };
}

function boundedCount(value: unknown, fallback = 1) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(1, Math.min(500, Math.floor(count))) : fallback;
}

function normalizeFormula(value: unknown) {
  const formula = compact(value, 500).replace(/[.;,\s]+$/g, "");
  if (!formula) {
    return "";
  }
  return formula.startsWith("=") ? formula : `=${formula}`;
}

function isHtmlSource(content: string) {
  return /^\s*</.test(content);
}

function appendDocumentSection(content: string, title: string, body: string) {
  if (isHtmlSource(content)) {
    return `${content.replace(/\s*$/, "")}\n<h2>${escapeHtml(title)}</h2>\n${body ? `<p>${escapeHtml(body)}</p>\n` : ""}`;
  }
  return `${content.replace(/\s*$/, "")}\n\n## ${title}\n\n${body || ""}\n`;
}

function appendDocumentParagraph(content: string, body: string) {
  if (isHtmlSource(content)) {
    return `${content.replace(/\s*$/, "")}\n<p>${escapeHtml(body)}</p>\n`;
  }
  return `${content.replace(/\s*$/, "")}\n\n${body}\n`;
}

function documentListItems(operation: HydriaWorkspaceToolOperation) {
  if (Array.isArray(operation.values)) {
    return operation.values.map((item) => compact(item, 500)).filter(Boolean);
  }
  return (operation.content || "")
    .split(/\r?\n|;/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
}

function appendDocumentList(content: string, operation: HydriaWorkspaceToolOperation) {
  const items = documentListItems(operation);
  if (items.length === 0) {
    return content;
  }
  const ordered = Boolean(operation.options?.ordered || operation.payload?.ordered);
  if (isHtmlSource(content)) {
    const tag = ordered ? "ol" : "ul";
    return `${content.replace(/\s*$/, "")}\n<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>\n`;
  }
  return `${content.replace(/\s*$/, "")}\n\n${items.map((item, index) => (ordered ? `${index + 1}. ${item}` : `- ${item}`)).join("\n")}\n`;
}

function replaceDocumentBlock(content: string, blockTitle: string, body: string) {
  if (!body) {
    return content;
  }
  if (isHtmlSource(content)) {
    const escapedTitle = blockTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sectionPattern = new RegExp(
      `(<h[1-3][^>]*>\\s*${escapedTitle}\\s*</h[1-3]>)([\\s\\S]*?)(?=<h[1-3][^>]*>|$)`,
      "i"
    );
    if (sectionPattern.test(content)) {
      return content.replace(sectionPattern, `$1\n<p>${escapeHtml(body)}</p>\n`);
    }
    return appendDocumentSection(content, blockTitle, body);
  }

  const escapedTitle = blockTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // $(?![\s\S]) = true end-of-string in multiline mode (plain $ matches end-of-line with m flag)
  const sectionPattern = new RegExp(`(^##?\\s+${escapedTitle}\\s*$)([\\s\\S]*?)(?=^##?\\s+|$(?![\\s\\S]))`, "im");
  if (sectionPattern.test(content)) {
    return content.replace(sectionPattern, `$1\n\n${body}\n`);
  }
  return appendDocumentSection(content, blockTitle, body);
}

function tableRowsFromOperation(operation: HydriaWorkspaceToolOperation) {
  const rawRows = operation.values;
  if (Array.isArray(rawRows) && rawRows.length > 0) {
    const rows = rawRows
      .map((row) => {
        if (Array.isArray(row)) {
          return row.map((cell) => compact(cell, 240));
        }
        if (typeof row === "object" && row !== null) {
          return Object.values(row as Record<string, unknown>).map((cell) => compact(cell, 240));
        }
        return [compact(row, 240)];
      })
      .filter((row) => row.some(Boolean));
    if (rows.length > 0) {
      return rows;
    }
  }

  const content = operation.content || "";
  const pipeRows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean))
    .filter((row) => row.length > 0);
  if (pipeRows.length > 0) {
    return pipeRows;
  }

  const csvRows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(","))
    .map((line) => line.split(",").map((cell) => cell.trim()).filter(Boolean))
    .filter((row) => row.length > 1);
  if (csvRows.length > 0) {
    return csvRows;
  }

  return [
    ["Element", "Details"],
    [operation.title || operation.target?.heading || "Point", content || "A completer"]
  ];
}

function renderDocumentTable(operation: HydriaWorkspaceToolOperation): string[][] {
  return tableRowsFromOperation(operation);
}

function appendDocumentTable(content: string, operation: HydriaWorkspaceToolOperation) {
  const title = operation.title || operation.target?.heading || "Tableau";
  const rows = renderDocumentTable(operation);
  if (isHtmlSource(content)) {
    const [header = ["Element", "Details"], ...bodyRows] = rows;
    const htmlRows = [
      `<thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>`,
      `<tbody>${(bodyRows.length ? bodyRows : [["", ""]])
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`
    ].join("");
    return `${content.replace(/\s*$/, "")}\n<h2>${escapeHtml(title)}</h2>\n<table>${htmlRows}</table>\n`;
  }

  const markdownRows = rows.length >= 2 ? rows : [["Element", "Details"], ["", ""]];
  const [header = ["Element", "Details"], ...bodyRows] = markdownRows;
  const separator = header.map(() => "---");
  return [
    content.replace(/\s*$/, ""),
    "",
    `## ${title}`,
    "",
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...(bodyRows.length ? bodyRows : [["", ""]]).map((row) => `| ${row.join(" | ")} |`),
    ""
  ].join("\n");
}

function deleteDocumentSection(content: string, title: string) {
  const heading = compact(title, 180);
  if (!heading) {
    return content;
  }
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (isHtmlSource(content)) {
    const sectionPattern = new RegExp(
      `\\s*<h[1-6][^>]*>\\s*${escapedHeading}\\s*</h[1-6]>[\\s\\S]*?(?=<h[1-6][^>]*>|$)`,
      "i"
    );
    return content.replace(sectionPattern, "").trimEnd();
  }

  // $(?![\s\S]) = true end-of-string in multiline mode (plain $ matches end-of-line with m flag)
  const sectionPattern = new RegExp(`\\n*^#{1,6}\\s+.*${escapedHeading}.*\\n[\\s\\S]*?(?=\\n#{1,6}\\s+|$(?![\\s\\S]))`, "im");
  return content.replace(sectionPattern, "").trimEnd();
}

function appendSlide(content: string, title: string, body: string, bullets: string[] = []) {
  const existingSlides = Array.from(content.matchAll(/^##\s+/gm)).length;
  const bulletLines = bullets.length > 0
    ? bullets.map((bullet) => `- ${bullet}`)
    : body
      ? body.split(/\n+/).map((line) => `- ${line.trim()}`).filter((line) => line.length > 2)
      : ["- A completer"];
  return [
    content.replace(/\s*$/, ""),
    "",
    `## Slide ${existingSlides + 1} - ${title || "Nouvelle slide"}`,
    "",
    ...bulletLines,
    ""
  ].join("\n");
}

function updateSlide(content: string, slideIndex: number | undefined, title: string, body: string) {
  if (slideIndex === undefined || slideIndex < 0) {
    return appendSlide(content, title || "Mise a jour", body);
  }
  const sections = content.split(/(?=^##\s+)/m);
  const prefix = sections[0]?.startsWith("## ") ? "" : sections.shift() ?? "";
  if (slideIndex >= sections.length) {
    return appendSlide(content, title || `Slide ${slideIndex + 1}`, body);
  }
  const current = sections[slideIndex] ?? "";
  const heading = title ? `## Slide ${slideIndex + 1} - ${title}` : current.split(/\r?\n/)[0] || `## Slide ${slideIndex + 1}`;
  const nextBody = body
    ? body.split(/\n+/).map((line) => `- ${line.trim()}`).filter((line) => line.length > 2).join("\n")
    : current.split(/\r?\n/).slice(1).join("\n").trim();
  sections[slideIndex] = `${heading}\n\n${nextBody}\n`;
  return `${prefix}${sections.join("")}`.replace(/\s*$/, "\n");
}

function ensureColumn(sheet: HydriaSheetModel["sheets"][number], columnName: string, issues: string[]) {
  const currentColumns = Array.isArray(sheet.columns) ? sheet.columns.map((column) => String(column ?? "")) : [""];
  const existingIndex = currentColumns.findIndex((column) => normalizeText(column) === normalizeText(columnName));
  if (existingIndex >= 0) {
    return existingIndex;
  }

  const label = sanitizeSheetLabel(columnName, `Column ${columnNameFromIndex(currentColumns.length)}`);
  sheet.columns = [...currentColumns, label];
  sheet.rows = normalizeRows(sheet.rows ?? [[]], sheet.columns.length);
  issues.push(`column_created:${label}`);
  return sheet.columns.length - 1;
}

function ensureColumnIndex(sheet: HydriaSheetModel["sheets"][number], columnIndex: number) {
  const nextColumns = Array.isArray(sheet.columns) ? [...sheet.columns] : [""];
  while (nextColumns.length <= columnIndex) {
    nextColumns.push(columnNameFromIndex(nextColumns.length));
  }
  sheet.columns = nextColumns;
  sheet.rows = normalizeRows(sheet.rows ?? [[]], sheet.columns.length);
}

function ensureRow(sheet: HydriaSheetModel["sheets"][number], rowIndex: number) {
  const width = Math.max(1, sheet.columns.length);
  const rows = normalizeRows(sheet.rows ?? [[]], width);
  while (rows.length <= rowIndex) {
    rows.push(Array(width).fill(""));
  }
  sheet.rows = rows;
}

function resolveSheetTarget(
  sheet: HydriaSheetModel["sheets"][number],
  operation: HydriaWorkspaceToolOperation,
  issues: string[]
) {
  const cell = operation.target?.cell;
  if (cell) {
    const parsed = parseA1Cell(cell);
    if (!parsed || parsed.columnIndex < 0) {
      issues.push(`invalid_cell:${cell}`);
      return null;
    }
    ensureColumnIndex(sheet, parsed.columnIndex);
    if (parsed.header) {
      return {
        columnIndex: parsed.columnIndex,
        rowIndex: -1
      };
    }
    ensureRow(sheet, parsed.rowIndex);
    return parsed;
  }

  const explicitColumnIndex = operation.target?.columnIndex;
  if (Number.isInteger(explicitColumnIndex) && Number(explicitColumnIndex) >= 0) {
    const columnIndex = Number(explicitColumnIndex);
    ensureColumnIndex(sheet, columnIndex);
    const rowIndex = Math.max(0, Number(operation.target?.rowIndex ?? 0));
    ensureRow(sheet, rowIndex);
    return {
      columnIndex,
      rowIndex
    };
  }

  const columnName = operation.target?.columnName || operation.columnName;
  if (columnName) {
    const columnIndex = ensureColumn(sheet, columnName, issues);
    const rowIndex = Math.max(0, Number(operation.target?.rowIndex ?? 0));
    ensureRow(sheet, rowIndex);
    return {
      columnIndex,
      rowIndex
    };
  }

  issues.push("missing_target");
  return null;
}

function resolveSheetColumnIndex(
  sheet: HydriaSheetModel["sheets"][number],
  operation: HydriaWorkspaceToolOperation
) {
  const explicitColumnIndex = operation.target?.columnIndex;
  if (Number.isInteger(explicitColumnIndex) && Number(explicitColumnIndex) >= 0) {
    ensureColumnIndex(sheet, Number(explicitColumnIndex));
    return Number(explicitColumnIndex);
  }

  const cell = operation.target?.cell;
  if (cell) {
    const parsed = parseA1Cell(cell);
    if (parsed && parsed.columnIndex >= 0) {
      ensureColumnIndex(sheet, parsed.columnIndex);
      return parsed.columnIndex;
    }
  }

  const columnName = operation.target?.columnName || operation.columnName;
  if (columnName) {
    return sheet.columns.findIndex((column) => normalizeText(column) === normalizeText(columnName));
  }

  return -1;
}

function normalizeSortValue(value: unknown) {
  const text = String(value ?? "").trim();
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) && text !== "" ? number : text.toLowerCase();
}

function normalizeCellFormat(format: Record<string, unknown> | undefined) {
  const next: Record<string, unknown> = {};
  if (!format) {
    return next;
  }
  if (format.bold !== undefined) {
    next.bold = Boolean(format.bold);
  }
  if (format.italic !== undefined) {
    next.italic = Boolean(format.italic);
  }
  if (format.underline !== undefined) {
    next.underline = Boolean(format.underline);
  }
  if (format.numberFormat) {
    next.numberFormat = compact(format.numberFormat, 40);
  }
  if (format.fillColor) {
    next.fillColor = compact(format.fillColor, 40);
  }
  if (format.textColor) {
    next.textColor = compact(format.textColor, 40);
  }
  return next;
}

function targetCellsForFormat(
  sheet: HydriaSheetModel["sheets"][number],
  operation: HydriaWorkspaceToolOperation
) {
  const cell = operation.target?.cell ? parseA1Cell(operation.target.cell) : null;
  if (cell) {
    ensureColumnIndex(sheet, cell.columnIndex);
    ensureRow(sheet, cell.rowIndex);
    return [[cell.rowIndex + 1, cell.columnIndex]];
  }

  const columnIndex = resolveSheetColumnIndex(sheet, operation);
  if (columnIndex >= 0) {
    ensureColumnIndex(sheet, columnIndex);
    return Array.from({ length: (sheet.rows?.length ?? 0) + 1 }, (_, rowIndex) => [rowIndex, columnIndex]);
  }

  return [];
}

function operationRecord(operation: HydriaWorkspaceToolOperation, fallback: Record<string, unknown> = {}) {
  return {
    ...fallback,
    ...(operation.payload || {}),
    ...(operation.options || {}),
    ...(operation.metadata || {})
  };
}

function itemKey(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return compact(value, 160);
  }
  const item = value as Record<string, unknown>;
  return compact(item.id || item.name || item.title || item.range, 160);
}

function upsertArrayItem(items: unknown[], item: Record<string, unknown>) {
  const key = itemKey(item);
  const index = items.findIndex((candidate) => itemKey(candidate) === key);
  if (!key || index < 0) {
    return [...items, item];
  }
  return items.map((candidate, candidateIndex) =>
    candidateIndex === index && typeof candidate === "object" && candidate !== null
      ? { ...(candidate as Record<string, unknown>), ...item }
      : candidate
  );
}

function removeArrayItem(items: unknown[], operation: HydriaWorkspaceToolOperation) {
  const key = compact(operation.value || operation.title || operation.range || operation.payload?.id || operation.payload?.name, 160);
  if (!key) {
    return items.slice(0, -1);
  }
  return items.filter((candidate) => itemKey(candidate) !== key);
}

function rangeOrTargetKey(operation: HydriaWorkspaceToolOperation) {
  if (operation.range) {
    return operation.range;
  }
  if (operation.target?.cell) {
    const cell = parseA1Cell(operation.target.cell);
    return cell ? `${cell.rowIndex + 1}:${cell.columnIndex}` : operation.target.cell;
  }
  if (Number.isInteger(operation.target?.columnIndex)) {
    return `column:${operation.target?.columnIndex}`;
  }
  if (operation.target?.columnName) {
    return `column:${operation.target.columnName}`;
  }
  return "";
}

function createSheetFromOperation(model: HydriaSheetModel, operation: HydriaWorkspaceToolOperation) {
  const index = model.sheets.length;
  return buildHydriaSheetModel({
    columns: Array.isArray(operation.values) && Array.isArray(operation.values[0])
      ? (operation.values[0] as unknown[]).map((value) => compact(value, 120))
      : ["Column 1", "Column 2", "Column 3"],
    rows: Array.isArray(operation.values) && Array.isArray(operation.values[0])
      ? (operation.values as unknown[][]).slice(1).map((row) => row.map((cell) => compact(cell, 500)))
      : [["", "", ""]],
    sheetName: operation.title || compact(operation.value, 120) || `Sheet ${index + 1}`
  }).sheets[0]!;
}

export function buildHydriaSheetModel(args: {
  columns?: string[];
  rows?: string[][];
  sheetName?: string;
} = {}): HydriaSheetModel {
  const columns = uniqueLabels(args.columns ?? []);
  const effectiveColumns = columns.length > 0 ? columns : [""];
  const rows = normalizeRows(args.rows ?? [[]], effectiveColumns.length);
  const sheet = {
    id: "sheet-1",
    name: sanitizeSheetLabel(args.sheetName, "Sheet 1") || "Sheet 1",
    columns: effectiveColumns,
    rows: rows.length > 0 ? rows : [Array(effectiveColumns.length).fill("")],
    columnWidths: {},
    rowHeights: {},
    merges: [],
    cellFormats: {},
    cellNotes: {},
    dataValidations: {},
    conditionalFormats: [],
    tables: [],
    pivotTables: [],
    charts: [],
    sparklines: {},
    slicers: [],
    filterQuery: "",
    filterColumnIndex: -1,
    tableFilters: {},
    sort: null,
    hidden: false,
    protected: false,
    protectedRanges: [],
    zoomLevel: 1,
    showGridlines: true,
    frozenRows: 0,
    frozenColumns: 0
  };

  return {
    kind: "hydria-sheet",
    version: 1,
    activeSheetId: sheet.id,
    namedRanges: [],
    sheets: [sheet],
    columns: sheet.columns,
    rows: sheet.rows
  };
}

export function serializeHydriaSheetModel(model: HydriaSheetModel) {
  return `${JSON.stringify(model, null, 2)}\n`;
}

export function parseHydriaSheetModel(content: string): HydriaSheetModel | null {
  try {
    const parsed = JSON.parse(content) as Partial<HydriaSheetModel>;
    if (parsed?.kind !== "hydria-sheet" || !Array.isArray(parsed.sheets) || parsed.sheets.length === 0) {
      return null;
    }
    const firstSheet = parsed.sheets[0]!;
    const columns = Array.isArray(firstSheet.columns) ? firstSheet.columns.map((item) => String(item ?? "")) : [""];
    const rows = Array.isArray(firstSheet.rows)
      ? firstSheet.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
      : [[]];
    return {
      ...buildHydriaSheetModel({ columns, rows, sheetName: firstSheet.name }),
      ...parsed,
      sheets: [
        {
          ...buildHydriaSheetModel({ columns, rows, sheetName: firstSheet.name }).sheets[0]!,
          ...firstSheet,
          columns,
          rows: normalizeRows(rows, columns.length)
        },
        ...parsed.sheets.slice(1)
      ],
      columns,
      rows: normalizeRows(rows, columns.length)
    } as HydriaSheetModel;
  } catch {
    return null;
  }
}

export function appendColumnsToHydriaSheetContent(content: string, columns: string[]) {
  const model = parseHydriaSheetModel(content);
  if (!model) {
    return null;
  }
  const sheet = model.sheets[0]!;
  const currentColumns = Array.isArray(sheet.columns) ? sheet.columns.map((column) => String(column ?? "")) : [""];
  const existing = new Set(currentColumns.map(normalizeText));
  const nextColumns = uniqueLabels(columns).filter((column) => !existing.has(normalizeText(column)));
  if (nextColumns.length === 0) {
    return content;
  }
  const combinedColumns = [...currentColumns, ...nextColumns];
  const rows = normalizeRows(sheet.rows ?? [[]], combinedColumns.length);
  const nextModel: HydriaSheetModel = {
    ...model,
    sheets: [
      {
        ...sheet,
        columns: combinedColumns,
        rows
      },
      ...model.sheets.slice(1)
    ],
    columns: combinedColumns,
    rows
  };
  return serializeHydriaSheetModel(nextModel);
}

export function hydriaSheetContentToRows(content: string) {
  const model = parseHydriaSheetModel(content);
  if (!model) {
    return null;
  }
  const sheet = model.sheets[0]!;
  const columns = sheet.columns.length > 0 ? sheet.columns : [""];
  return [columns, ...normalizeRows(sheet.rows ?? [[]], columns.length)];
}

function normalizeWorkspaceToolOperations(value: unknown): HydriaWorkspaceToolOperation[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      type: compact(item.type ?? item.kind ?? item.operationType, 120),
      sheetId: compact(item.sheetId, 80) || undefined,
      target: typeof item.target === "object" && item.target !== null
        ? {
            cell: compact((item.target as Record<string, unknown>).cell, 40) || undefined,
            columnName: compact((item.target as Record<string, unknown>).columnName, 120) || undefined,
            blockTitle: compact((item.target as Record<string, unknown>).blockTitle, 120) || undefined,
            heading: compact((item.target as Record<string, unknown>).heading, 180) || undefined,
            oldText: compact((item.target as Record<string, unknown>).oldText, 5000) || undefined,
            blockId: compact((item.target as Record<string, unknown>).blockId, 120) || undefined,
            wholeFile: Boolean((item.target as Record<string, unknown>).wholeFile) || undefined,
            position: compact((item.target as Record<string, unknown>).position, 40) || undefined,
            columnIndex: Number.isInteger((item.target as Record<string, unknown>).columnIndex)
              ? Number((item.target as Record<string, unknown>).columnIndex)
              : undefined,
            rowIndex: Number.isInteger((item.target as Record<string, unknown>).rowIndex)
              ? Number((item.target as Record<string, unknown>).rowIndex)
              : undefined,
            count: Number.isInteger((item.target as Record<string, unknown>).count)
              ? Number((item.target as Record<string, unknown>).count)
              : undefined,
            fromIndex: Number.isInteger((item.target as Record<string, unknown>).fromIndex)
              ? Number((item.target as Record<string, unknown>).fromIndex)
              : undefined,
            toIndex: Number.isInteger((item.target as Record<string, unknown>).toIndex)
              ? Number((item.target as Record<string, unknown>).toIndex)
              : undefined,
            level: Number.isInteger((item.target as Record<string, unknown>).level)
              ? Number((item.target as Record<string, unknown>).level)
              : undefined,
            slideIndex: Number.isInteger((item.target as Record<string, unknown>).slideIndex)
              ? Number((item.target as Record<string, unknown>).slideIndex)
              : undefined
          }
        : undefined,
      columnName: compact(item.columnName, 120) || undefined,
      formula: compact(item.formula, 500) || undefined,
      value: compact(item.value, 500) || undefined,
      values: item.values,
      range: compact(item.range, 80) || undefined,
      direction: compact(item.direction, 20).toLowerCase() || undefined,
      format: typeof item.format === "object" && item.format !== null && !Array.isArray(item.format)
        ? { ...(item.format as Record<string, unknown>) }
        : undefined,
      payload: typeof item.payload === "object" && item.payload !== null && !Array.isArray(item.payload)
        ? { ...(item.payload as Record<string, unknown>) }
        : undefined,
      options: typeof item.options === "object" && item.options !== null && !Array.isArray(item.options)
        ? { ...(item.options as Record<string, unknown>) }
        : undefined,
      metadata: typeof item.metadata === "object" && item.metadata !== null && !Array.isArray(item.metadata)
        ? { ...(item.metadata as Record<string, unknown>) }
        : undefined,
      count: Number.isInteger(item.count) ? Number(item.count) : undefined,
      width: Number.isFinite(Number(item.width)) ? Number(item.width) : undefined,
      height: Number.isFinite(Number(item.height)) ? Number(item.height) : undefined,
      title: compact(item.title, 160) || undefined,
      content: compact(item.content, 5000) || undefined,
      blockTitle: compact(item.blockTitle, 120) || undefined,
      slideIndex: Number.isInteger(item.slideIndex) ? Number(item.slideIndex) : undefined,
      bullets: Array.isArray(item.bullets)
        ? item.bullets.map((bullet) => compact(bullet, 240)).filter(Boolean).slice(0, 12)
        : undefined
    }))
    .filter((operation) => operation.type.length > 0)
    .slice(0, 50);
}

export function applyHydriaWorkspaceToolOperationsToContent(
  content: string,
  rawOperations: unknown
): HydriaWorkspaceToolApplyResult {
  const operations = normalizeWorkspaceToolOperations(rawOperations);
  const model = parseHydriaSheetModel(content);
  if (!model) {
    let nextContent = content;
    const applied: string[] = [];
    const issues: string[] = [];
    for (const operation of operations) {
      if (operation.type === "doc.insert_section") {
        nextContent = appendDocumentSection(
          nextContent,
          operation.title || operation.target?.blockTitle || "Nouvelle section",
          operation.content || ""
        );
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_heading") {
        const level = Math.max(1, Math.min(6, Number(operation.target?.level || operation.payload?.level || 2) || 2));
        const title = operation.title || operation.content || "Titre";
        nextContent = isHtmlSource(nextContent)
          ? `${nextContent.replace(/\s*$/, "")}\n<h${level}>${escapeHtml(title)}</h${level}>\n`
          : `${nextContent.replace(/\s*$/, "")}\n\n${"#".repeat(level)} ${title}\n`;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_paragraph") {
        if (!operation.content) {
          issues.push("missing_content");
          continue;
        }
        nextContent = appendDocumentParagraph(nextContent, operation.content);
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.append_paragraph") {
        if (!operation.content) {
          issues.push("missing_content");
          continue;
        }
        nextContent = appendDocumentParagraph(nextContent, operation.content);
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.replace_block") {
        if (operation.target?.oldText && nextContent.includes(operation.target.oldText)) {
          nextContent = nextContent.replace(operation.target.oldText, operation.content || "");
          applied.push(operation.type);
          continue;
        }
        if (operation.target?.wholeFile) {
          nextContent = operation.content || "";
          applied.push(operation.type);
          continue;
        }
        nextContent = replaceDocumentBlock(
          nextContent,
          operation.blockTitle || operation.target?.blockTitle || operation.target?.heading || "Contenu",
          operation.content || ""
        );
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.replace_text" || operation.type === "doc.delete_text") {
        const oldText = operation.target?.oldText || compact(operation.payload?.oldText || operation.payload?.find || operation.title, 5000);
        if (!oldText || !nextContent.includes(oldText)) {
          issues.push(`${operation.type}:missing_old_text`);
          continue;
        }
        nextContent = nextContent.replaceAll(oldText, operation.type === "doc.delete_text" ? "" : operation.content || "");
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_table") {
        nextContent = appendDocumentTable(nextContent, operation);
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_list") {
        const updated = appendDocumentList(nextContent, operation);
        if (updated === nextContent) {
          issues.push("doc.insert_list:missing_items");
          continue;
        }
        nextContent = updated;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_image") {
        const src = compact(operation.value || operation.payload?.src || operation.payload?.url, 1000);
        if (!src) {
          issues.push("doc.insert_image:missing_src");
          continue;
        }
        const alt = operation.title || compact(operation.payload?.alt, 160) || "Image";
        nextContent = isHtmlSource(nextContent)
          ? `${nextContent.replace(/\s*$/, "")}\n<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">\n`
          : `${nextContent.replace(/\s*$/, "")}\n\n![${alt}](${src})\n`;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_link") {
        const href = compact(operation.value || operation.payload?.href || operation.payload?.url, 1000);
        if (!href) {
          issues.push("doc.insert_link:missing_href");
          continue;
        }
        const label = operation.title || compact(operation.payload?.label, 160) || href;
        nextContent = isHtmlSource(nextContent)
          ? `${nextContent.replace(/\s*$/, "")}\n<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>\n`
          : `${nextContent.replace(/\s*$/, "")}\n\n[${label}](${href})\n`;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_page_break" || operation.type === "doc.insert_toc") {
        const marker = operation.type === "doc.insert_page_break"
          ? (isHtmlSource(nextContent) ? '<hr class="page-break">' : "---")
          : (isHtmlSource(nextContent) ? '<nav data-hydria-toc="true">Table of contents</nav>' : "## Table of contents\n\n<!-- hydria-toc -->");
        nextContent = `${nextContent.replace(/\s*$/, "")}\n\n${marker}\n`;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.insert_quote" || operation.type === "doc.insert_code_block") {
        if (!operation.content) {
          issues.push(`${operation.type}:missing_content`);
          continue;
        }
        const marker = operation.type === "doc.insert_quote"
          ? (isHtmlSource(nextContent) ? `<blockquote>${escapeHtml(operation.content)}</blockquote>` : operation.content.split(/\r?\n/).map((line) => `> ${line}`).join("\n"))
          : (isHtmlSource(nextContent) ? `<pre><code>${escapeHtml(operation.content)}</code></pre>` : `\`\`\`${compact(operation.payload?.language, 40)}\n${operation.content}\n\`\`\``);
        nextContent = `${nextContent.replace(/\s*$/, "")}\n\n${marker}\n`;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.set_title") {
        const title = operation.title || compact(operation.value, 160) || operation.content;
        if (!title) {
          issues.push("doc.set_title:missing_title");
          continue;
        }
        nextContent = isHtmlSource(nextContent)
          ? (/<h1[^>]*>[\s\S]*?<\/h1>/i.test(nextContent) ? nextContent.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, `<h1>${escapeHtml(title)}</h1>`) : `<h1>${escapeHtml(title)}</h1>\n${nextContent}`)
          : (/^#\s+.*$/m.test(nextContent) ? nextContent.replace(/^#\s+.*$/m, `# ${title}`) : `# ${title}\n\n${nextContent}`);
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.format_block" || operation.type === "doc.set_metadata" || operation.type === "doc.add_comment" || operation.type === "doc.resolve_comment") {
        const payload = JSON.stringify(operationRecord(operation));
        nextContent = `${nextContent.replace(/\s*$/, "")}\n\n<!-- hydria-${operation.type.replace("doc.", "")}:${payload} -->\n`;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "doc.delete_section") {
        const title = operation.title || operation.target?.heading || operation.target?.blockTitle || operation.blockTitle || "";
        const updated = deleteDocumentSection(nextContent, title);
        if (updated === nextContent) {
          issues.push(`missing_section:${title || "unknown"}`);
          continue;
        }
        nextContent = updated;
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "slide.add") {
        nextContent = appendSlide(nextContent, operation.title || "Nouvelle slide", operation.content || "", operation.bullets);
        applied.push(operation.type);
        continue;
      }
      if (operation.type === "slide.update") {
        nextContent = updateSlide(nextContent, operation.target?.slideIndex ?? operation.slideIndex, operation.title || "", operation.content || "");
        applied.push(operation.type);
        continue;
      }
      issues.push(`unsupported_operation:${operation.type}`);
    }
    if (applied.length > 0) {
      return {
        content: nextContent,
        applied,
        issues
      };
    }
    return {
      content,
      applied: [],
      issues: issues.length > 0 ? issues : ["unsupported_workspace_source"]
    };
  }

  const issues: string[] = [];
  const applied: string[] = [];
  const sheet = model.sheets.find((candidate) => candidate.id === operations[0]?.sheetId) ?? model.sheets[0]!;

  for (const operation of operations) {
    if (operation.type === "sheet.add_sheet") {
      const nextSheet = {
        ...createSheetFromOperation(model, operation),
        id: `sheet-${Date.now()}-${model.sheets.length + 1}`
      };
      model.sheets.push(nextSheet);
      model.activeSheetId = nextSheet.id;
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.duplicate_sheet") {
      const clone = JSON.parse(JSON.stringify(sheet)) as typeof sheet;
      clone.id = `sheet-${Date.now()}-${model.sheets.length + 1}`;
      clone.name = operation.title || compact(operation.value, 120) || `${sheet.name} copy`;
      model.sheets.push(clone);
      model.activeSheetId = clone.id;
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.rename_sheet") {
      const nextName = operation.title || compact(operation.value, 120);
      if (!nextName) {
        issues.push("rename_sheet_requires_name");
        continue;
      }
      sheet.name = nextName;
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.delete_sheet") {
      if (model.sheets.length <= 1) {
        issues.push("delete_sheet_requires_at_least_two_sheets");
        continue;
      }
      model.sheets = model.sheets.filter((candidate) => candidate.id !== sheet.id);
      model.activeSheetId = model.sheets[0]?.id || "";
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.set_active_sheet") {
      model.activeSheetId = sheet.id;
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.hide_sheet" || operation.type === "sheet.unhide_sheet") {
      sheet.hidden = operation.type === "sheet.hide_sheet";
      if (sheet.hidden && model.activeSheetId === sheet.id) {
        model.activeSheetId = model.sheets.find((candidate) => !candidate.hidden && candidate.id !== sheet.id)?.id || sheet.id;
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.move_sheet") {
      const fromIndex = model.sheets.findIndex((candidate) => candidate.id === sheet.id);
      const toIndex = Math.max(0, Math.min(model.sheets.length - 1, Number(operation.target?.toIndex ?? model.sheets.length - 1) || 0));
      const [moved] = model.sheets.splice(fromIndex, 1);
      if (moved) {
        model.sheets.splice(toIndex, 0, moved);
        applied.push(operation.type);
      } else {
        issues.push("move_sheet_requires_existing_sheet");
      }
      continue;
    }

    if (operation.type === "sheet.insert_rows") {
      const rowIndex = Number.isInteger(operation.target?.rowIndex)
        ? Math.max(0, Math.min(Number(operation.target?.rowIndex), sheet.rows.length))
        : sheet.rows.length;
      const count = boundedCount(operation.count ?? operation.target?.count);
      const newRows = Array.from({ length: count }, () => Array.from({ length: sheet.columns.length }, () => ""));
      sheet.rows.splice(rowIndex, 0, ...newRows);
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.insert_columns") {
      const columnIndex = Number.isInteger(operation.target?.columnIndex)
        ? Math.max(0, Math.min(Number(operation.target?.columnIndex), sheet.columns.length))
        : sheet.columns.length;
      const count = boundedCount(operation.count ?? operation.target?.count);
      const names = Array.isArray(operation.values) ? operation.values : [];
      const newColumns = Array.from({ length: count }, (_, index) => compact(names[index], 120) || `Column ${sheet.columns.length + index + 1}`);
      sheet.columns.splice(columnIndex, 0, ...newColumns);
      sheet.rows = sheet.rows.map((row) => {
        const next = [...row];
        next.splice(columnIndex, 0, ...Array.from({ length: count }, () => ""));
        return next;
      });
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.add_column") {
      const columnName = operation.columnName || operation.target?.columnName;
      if (!columnName) {
        issues.push("missing_column_name");
        continue;
      }
      const requestedColumnIndex = Number.isInteger(operation.target?.columnIndex)
        ? Math.max(0, Number(operation.target?.columnIndex))
        : -1;
      let columnIndex = -1;
      if (requestedColumnIndex >= 0) {
        const existingIndex = sheet.columns.findIndex((column) => normalizeText(column) === normalizeText(columnName));
        if (existingIndex >= 0) {
          columnIndex = existingIndex;
        } else {
          ensureColumnIndex(sheet, requestedColumnIndex);
          sheet.columns[requestedColumnIndex] = sanitizeSheetLabel(columnName, columnNameFromIndex(requestedColumnIndex));
          sheet.rows = normalizeRows(sheet.rows ?? [[]], sheet.columns.length);
          columnIndex = requestedColumnIndex;
          issues.push(`column_created:${sheet.columns[requestedColumnIndex]}`);
        }
      } else {
        columnIndex = ensureColumn(sheet, columnName, issues);
      }
      const formula = normalizeFormula(operation.formula);
      if (formula) {
        const rowIndex = Math.max(0, Number(operation.target?.rowIndex ?? 0));
        ensureRow(sheet, rowIndex);
        sheet.rows[rowIndex]![columnIndex] = formula;
      }
      applied.push("sheet.add_column");
      continue;
    }

    if (operation.type === "sheet.add_row") {
      const rowIndex = Number.isInteger(operation.target?.rowIndex)
        ? Math.max(0, Math.min(Number(operation.target?.rowIndex), sheet.rows.length))
        : sheet.rows.length;
      const values = Array.isArray(operation.values)
        ? operation.values
        : operation.values && typeof operation.values === "object"
          ? sheet.columns.map((column) => (operation.values as Record<string, unknown>)[column] ?? "")
          : [];
      const nextRow = Array.from({ length: sheet.columns.length }, (_, index) => compact(values[index], 500));
      sheet.rows.splice(rowIndex, 0, nextRow);
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.rename_column") {
      const columnIndex = resolveSheetColumnIndex(sheet, operation);
      const nextName = sanitizeSheetLabel(operation.value || operation.title || operation.content, "");
      if (columnIndex < 0 || !nextName) {
        issues.push("rename_column_requires_existing_column_and_name");
        continue;
      }
      sheet.columns[columnIndex] = nextName;
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.delete_column") {
      const columnIndex = resolveSheetColumnIndex(sheet, operation);
      if (columnIndex < 0 || columnIndex >= sheet.columns.length) {
        issues.push("delete_column_requires_existing_column");
        continue;
      }
      sheet.columns.splice(columnIndex, 1);
      sheet.rows = sheet.rows.map((row) => {
        const next = [...row];
        next.splice(columnIndex, 1);
        return next;
      });
      if (sheet.columns.length === 0) {
        sheet.columns.push("Column 1");
        sheet.rows = sheet.rows.map(() => [""]);
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.delete_row") {
      const rowIndex = Number.isInteger(operation.target?.rowIndex) ? Number(operation.target?.rowIndex) : -1;
      if (rowIndex < 0 || rowIndex >= sheet.rows.length) {
        issues.push("delete_row_requires_existing_row");
        continue;
      }
      sheet.rows.splice(rowIndex, 1);
      if (!sheet.rows.length) {
        sheet.rows.push(Array.from({ length: sheet.columns.length }, () => ""));
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.delete_rows") {
      const rowIndex = Number.isInteger(operation.target?.rowIndex) ? Number(operation.target?.rowIndex) : -1;
      if (rowIndex < 0 || rowIndex >= sheet.rows.length) {
        issues.push("delete_rows_requires_existing_row");
        continue;
      }
      sheet.rows.splice(rowIndex, boundedCount(operation.count ?? operation.target?.count));
      if (!sheet.rows.length) {
        sheet.rows.push(Array.from({ length: sheet.columns.length }, () => ""));
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.delete_columns") {
      const columnIndex = resolveSheetColumnIndex(sheet, operation);
      if (columnIndex < 0 || columnIndex >= sheet.columns.length) {
        issues.push("delete_columns_requires_existing_column");
        continue;
      }
      const count = Math.min(boundedCount(operation.count ?? operation.target?.count), sheet.columns.length - columnIndex);
      sheet.columns.splice(columnIndex, count);
      sheet.rows = sheet.rows.map((row) => {
        const next = [...row];
        next.splice(columnIndex, count);
        return next;
      });
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.resize_row") {
      const rowIndex = Number.isInteger(operation.target?.rowIndex) ? Number(operation.target?.rowIndex) : -1;
      const height = Number(operation.height ?? operation.value);
      if (rowIndex < 0 || !Number.isFinite(height)) {
        issues.push("resize_row_requires_row_and_height");
        continue;
      }
      sheet.rowHeights[String(rowIndex)] = Math.max(8, Math.min(400, height));
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.resize_column") {
      const columnIndex = resolveSheetColumnIndex(sheet, operation);
      const width = Number(operation.width ?? operation.value);
      if (columnIndex < 0 || !Number.isFinite(width)) {
        issues.push("resize_column_requires_column_and_width");
        continue;
      }
      sheet.columnWidths[String(columnIndex)] = Math.max(20, Math.min(800, width));
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.sort_range") {
      const columnIndex = resolveSheetColumnIndex(sheet, operation);
      if (columnIndex < 0) {
        issues.push("sort_range_requires_target_column");
        continue;
      }
      const direction = operation.direction === "desc" || operation.direction === "descending" ? "desc" : "asc";
      sheet.rows = [...sheet.rows].sort((left, right) => {
        const leftValue = normalizeSortValue(left[columnIndex]);
        const rightValue = normalizeSortValue(right[columnIndex]);
        const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        return direction === "desc" ? -comparison : comparison;
      });
      sheet.sort = {
        columnIndex,
        direction
      };
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.filter_rows") {
      const columnIndex = resolveSheetColumnIndex(sheet, operation);
      const query = compact(operation.value, 200);
      sheet.filterColumnIndex = columnIndex >= 0 ? columnIndex : -1;
      sheet.filterQuery = query;
      if (columnIndex >= 0) {
        sheet.tableFilters = {
          ...(sheet.tableFilters || {}),
          [String(columnIndex)]: query
        };
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.clear_filter") {
      sheet.filterColumnIndex = -1;
      sheet.filterQuery = "";
      sheet.tableFilters = {};
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.format_cells") {
      const format = normalizeCellFormat(operation.format);
      const targets = targetCellsForFormat(sheet, operation);
      if (!Object.keys(format).length || !targets.length) {
        issues.push("format_cells_requires_target_and_format");
        continue;
      }
      sheet.cellFormats = sheet.cellFormats || {};
      for (const [rowIndex, columnIndex] of targets) {
        const key = `${rowIndex}:${columnIndex}`;
        sheet.cellFormats[key] = {
          ...((sheet.cellFormats[key] as Record<string, unknown>) || {}),
          ...format
        };
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.clear_format") {
      const targets = targetCellsForFormat(sheet, operation);
      if (!targets.length) {
        sheet.cellFormats = {};
      } else {
        for (const [rowIndex, columnIndex] of targets) {
          delete sheet.cellFormats[`${rowIndex}:${columnIndex}`];
        }
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.merge_cells") {
      const range = operation.range || "";
      if (!parseA1Range(range)) {
        issues.push("merge_cells_requires_a1_range");
        continue;
      }
      sheet.merges = upsertArrayItem(sheet.merges || [], { id: range, range });
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.unmerge_cells") {
      sheet.merges = operation.range ? removeArrayItem(sheet.merges || [], operation) : [];
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.set_note" || operation.type === "sheet.clear_note") {
      const key = rangeOrTargetKey(operation);
      if (!key) {
        issues.push(`${operation.type}:missing_target`);
        continue;
      }
      sheet.cellNotes = sheet.cellNotes || {};
      if (operation.type === "sheet.clear_note") {
        delete sheet.cellNotes[key];
      } else {
        sheet.cellNotes[key] = operation.value || operation.content || "";
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.set_data_validation" || operation.type === "sheet.clear_data_validation") {
      const key = rangeOrTargetKey(operation);
      if (!key) {
        issues.push(`${operation.type}:missing_target`);
        continue;
      }
      sheet.dataValidations = sheet.dataValidations || {};
      if (operation.type === "sheet.clear_data_validation") {
        delete sheet.dataValidations[key];
      } else {
        sheet.dataValidations[key] = operationRecord(operation);
      }
      applied.push(operation.type);
      continue;
    }

    const arrayOperationMap: Record<string, [keyof typeof sheet, "upsert" | "remove"]> = {
      "sheet.add_conditional_format": ["conditionalFormats", "upsert"],
      "sheet.remove_conditional_format": ["conditionalFormats", "remove"],
      "sheet.add_table": ["tables", "upsert"],
      "sheet.remove_table": ["tables", "remove"],
      "sheet.add_pivot_table": ["pivotTables", "upsert"],
      "sheet.remove_pivot_table": ["pivotTables", "remove"],
      "sheet.add_chart": ["charts", "upsert"],
      "sheet.update_chart": ["charts", "upsert"],
      "sheet.remove_chart": ["charts", "remove"],
      "sheet.add_slicer": ["slicers", "upsert"],
      "sheet.remove_slicer": ["slicers", "remove"],
      "sheet.protect_range": ["protectedRanges", "upsert"],
      "sheet.unprotect_range": ["protectedRanges", "remove"]
    };
    if (arrayOperationMap[operation.type]) {
      const [property, mode] = arrayOperationMap[operation.type]!;
      const current = Array.isArray(sheet[property]) ? (sheet[property] as unknown[]) : [];
      const record = {
        id: operation.title || compact(operation.value, 160) || operation.range || `${property}-${Date.now()}`,
        title: operation.title,
        range: operation.range || "",
        ...operationRecord(operation)
      };
      (sheet as any)[property] = mode === "remove" ? removeArrayItem(current, operation) : upsertArrayItem(current, record);
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.add_sparkline" || operation.type === "sheet.remove_sparkline") {
      const key = rangeOrTargetKey(operation) || operation.title || compact(operation.value, 160);
      if (!key) {
        issues.push(`${operation.type}:missing_target`);
        continue;
      }
      (sheet as any).sparklines = sheet.sparklines && typeof sheet.sparklines === "object" && !Array.isArray(sheet.sparklines) ? sheet.sparklines : {};
      if (operation.type === "sheet.remove_sparkline") {
        delete ((sheet as any).sparklines as Record<string, unknown>)[key];
      } else {
        ((sheet as any).sparklines as Record<string, unknown>)[key] = { range: operation.range || "", ...operationRecord(operation) };
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.add_named_range" || operation.type === "sheet.remove_named_range") {
      const name = operation.title || compact(operation.value, 160);
      if (!name) {
        issues.push(`${operation.type}:missing_name`);
        continue;
      }
      if (operation.type === "sheet.remove_named_range") {
        model.namedRanges = removeArrayItem(model.namedRanges || [], operation);
      } else {
        model.namedRanges = upsertArrayItem(model.namedRanges || [], { id: name, name, sheetId: sheet.id, range: operation.range || "" });
      }
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.protect_sheet" || operation.type === "sheet.unprotect_sheet") {
      sheet.protected = operation.type === "sheet.protect_sheet";
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.freeze_panes") {
      sheet.frozenRows = Math.max(0, Math.min(100, Number(operation.payload?.rows ?? operation.payload?.frozenRows ?? operation.target?.rowIndex ?? 0) || 0));
      sheet.frozenColumns = Math.max(0, Math.min(100, Number(operation.payload?.columns ?? operation.payload?.frozenColumns ?? operation.target?.columnIndex ?? 0) || 0));
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.set_zoom") {
      const zoom = Number(operation.value ?? operation.payload?.zoom ?? operation.payload?.zoomLevel);
      if (!Number.isFinite(zoom)) {
        issues.push("set_zoom_requires_value");
        continue;
      }
      sheet.zoomLevel = Math.max(0.5, Math.min(3, zoom > 10 ? zoom / 100 : zoom));
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.show_gridlines") {
      sheet.showGridlines = operation.value === undefined ? true : !["false", "0", "no"].includes(String(operation.value).toLowerCase());
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.set_range") {
      const parsed = parseA1Range(operation.range || operation.target?.cell || "");
      if (!parsed || !Array.isArray(operation.values)) {
        issues.push("set_range_requires_range_and_values");
        continue;
      }
      ensureColumnIndex(sheet, parsed.endColumnIndex);
      ensureRow(sheet, parsed.endRowIndex);
      operation.values.forEach((row, rowOffset) => {
        const values = Array.isArray(row) ? row : [row];
        values.forEach((cellValue, columnOffset) => {
          const rowIndex = parsed.startRowIndex + rowOffset;
          const columnIndex = parsed.startColumnIndex + columnOffset;
          if (rowIndex <= parsed.endRowIndex && columnIndex <= parsed.endColumnIndex) {
            sheet.rows[rowIndex]![columnIndex] = compact(cellValue, 500);
          }
        });
      });
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.clear_cells") {
      const parsed = parseA1Range(operation.range || operation.target?.cell || "");
      if (parsed) {
        ensureColumnIndex(sheet, parsed.endColumnIndex);
        ensureRow(sheet, parsed.endRowIndex);
        for (let rowIndex = parsed.startRowIndex; rowIndex <= parsed.endRowIndex; rowIndex += 1) {
          for (let columnIndex = parsed.startColumnIndex; columnIndex <= parsed.endColumnIndex; columnIndex += 1) {
            sheet.rows[rowIndex]![columnIndex] = "";
          }
        }
        applied.push(operation.type);
        continue;
      }
      const columnIndex = resolveSheetColumnIndex(sheet, operation);
      if (columnIndex < 0) {
        issues.push("clear_cells_requires_target");
        continue;
      }
      sheet.rows = sheet.rows.map((row) => {
        const next = [...row];
        next[columnIndex] = "";
        return next;
      });
      applied.push(operation.type);
      continue;
    }

    if (operation.type === "sheet.set_formula" || operation.type === "sheet.set_cell") {
      const target = resolveSheetTarget(sheet, operation, issues);
      if (!target) {
        continue;
      }
      const value = operation.type === "sheet.set_formula"
        ? normalizeFormula(operation.formula || operation.value)
        : compact(operation.value ?? operation.formula, 500);
      if (!value) {
        issues.push("missing_value");
        continue;
      }
      if (target.rowIndex < 0) {
        sheet.columns[target.columnIndex] = value.replace(/^=/, "");
      } else {
        ensureRow(sheet, target.rowIndex);
        sheet.rows[target.rowIndex]![target.columnIndex] = value;
      }
      applied.push(operation.type);
      continue;
    }

    issues.push(`unsupported_operation:${operation.type}`);
  }

  const normalizedRows = normalizeRows(sheet.rows ?? [[]], sheet.columns.length);
  sheet.rows = normalizedRows;
  model.columns = sheet.columns;
  model.rows = normalizedRows;

  return {
    content: serializeHydriaSheetModel(model),
    applied,
    issues
  };
}

export function buildWorkspaceSpec(args: {
  title: string;
  format: string;
  documentType: string;
  workspaceFamilyId?: string;
}) {
  return `${JSON.stringify(
    {
      title: args.title,
      format: args.format,
      documentType: args.documentType,
      audience: "workspace user",
      tone: "structured and operational",
      ...(args.workspaceFamilyId ? { workspaceFamilyId: args.workspaceFamilyId } : {})
    },
    null,
    2
  )}\n`;
}

function answerDraftToHtml(answerDraft: string) {
  const lines = String(answerDraft || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  const html: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1]?.length ?? 2);
      html.push(`<h${level}>${escapeHtml(heading[2] || "")}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${escapeHtml(bullet[1] || "")}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}

export function buildHydriaDocumentHtml(args: {
  title: string;
  instruction: string;
  answerDraft?: string;
  sections?: string[];
}) {
  const title = compact(args.title, 160) || "document";
  const answerHtml = answerDraftToHtml(args.answerDraft ?? "");
  if (answerHtml) {
    return `<h1>${escapeHtml(title)}</h1>\n${answerHtml}\n`;
  }
  const sections = args.sections && args.sections.length > 0
    ? args.sections
    : ["Contexte", "Contenu", "Prochaines etapes"];
  return [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p><strong>Demande:</strong> ${escapeHtml(args.instruction)}</p>`,
    ...sections.flatMap((section) => [
      `<h2>${escapeHtml(section)}</h2>`,
      "<p>A completer avec les informations validees par Hydria.</p>"
    ])
  ].join("\n") + "\n";
}

export function buildWorkspaceSourceFiles(args: {
  kind: WorkObjectKind;
  title: string;
  entryPath: string;
  instruction: string;
  format: string;
  workspaceFamilyId?: string;
  answerDraft?: string;
  sections?: string[];
  columns?: string[];
  rows?: string[][];
  fallbackContent: string;
}): WorkspaceSourceFile[] {
  if (args.kind === "dataset") {
    return [
      {
        path: "table.csv",
        content: serializeHydriaSheetModel(
          buildHydriaSheetModel({
            columns: args.columns,
            rows: args.rows,
            sheetName: "Sheet 1"
          })
        )
      },
      {
        path: "spec.json",
        content: buildWorkspaceSpec({
          title: args.title,
          format: "csv",
          documentType: "spreadsheet",
          workspaceFamilyId: args.workspaceFamilyId || "data_spreadsheet"
        })
      }
    ];
  }

  if (args.entryPath === "document.html") {
    return [
      {
        path: "document.html",
        content: buildHydriaDocumentHtml({
          title: args.title,
          instruction: args.instruction,
          answerDraft: args.answerDraft,
          sections: args.sections
        })
      },
      {
        path: "spec.json",
        content: buildWorkspaceSpec({
          title: args.title,
          format: "html",
          documentType: "document",
          workspaceFamilyId: args.workspaceFamilyId || "document_knowledge"
        })
      }
    ];
  }

  if (args.kind === "presentation") {
    return [
      {
        path: args.entryPath,
        content: args.fallbackContent
      },
      {
        path: "spec.json",
        content: buildWorkspaceSpec({
          title: args.title,
          format: "md",
          documentType: "presentation",
          workspaceFamilyId: args.workspaceFamilyId || "presentation"
        })
      }
    ];
  }

  return [
    {
      path: args.entryPath,
      content: args.fallbackContent
    }
  ];
}

export function appendHtmlUpdate(content: string, args: {
  instruction: string;
  answerDraft?: string;
  sections?: string[];
  mode?: string;
}) {
  const addition = buildHydriaDocumentHtml({
    title: "Mise a jour",
    instruction: args.instruction,
    answerDraft: args.answerDraft,
    sections: args.sections
  }).replace(/^<h1>Mise a jour<\/h1>\n?/, "<h2>Mise a jour</h2>\n");

  if (args.mode === "replace") {
    return addition;
  }
  return `${content.replace(/\s*$/, "")}\n${addition}`;
}

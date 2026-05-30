import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import type { PublicApiProposedAction } from "../../types/publicApi.js";
import {
  workObjectArtifactSchema,
  workObjectExecutionResultSchema,
  workObjectSchema,
  type WorkObject,
  type WorkObjectArtifact,
  type WorkObjectEntry,
  type WorkObjectExecutionResult,
  type WorkObjectKind
} from "../../types/workObjects.js";
import { env } from "../../utils/env.js";
import {
  appendColumnsToHydriaSheetContent,
  appendHtmlUpdate,
  applyHydriaWorkspaceToolOperationsToContent,
  buildHydriaSheetModel,
  buildWorkspaceSourceFiles,
  serializeHydriaSheetModel
} from "./hydriaWorkspaceModelFactory.js";
import { generateOfficeArtifact } from "./officeArtifactGenerator.js";

type WorkObjectStoreFile = {
  version: "hydria-work-objects-v1";
  updatedAt: string;
  workObjects: WorkObject[];
  artifacts: WorkObjectArtifact[];
  executions: WorkObjectExecutionResult[];
};

export type ExecuteWorkObjectActionArgs = {
  action: PublicApiProposedAction;
  confirmed?: boolean;
  sessionId?: string | null;
  userId?: string | null;
  projectId?: string | null;
};

export type ListWorkObjectsOptions = {
  sessionId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  limit?: number;
};

export type UpdateWorkObjectContentArgs = {
  workObjectId: string;
  entryPath: string;
  content: string;
  actor?: "core" | "os" | "user" | "system";
  note?: string;
};

type WorkObjectExecutionServiceOptions = {
  storeFile?: string;
  objectRootDir?: string;
  artifactRootDir?: string;
  now?: () => Date;
  idFactory?: () => string;
};

const textContentTypes: Record<string, string> = {
  ".csv": "text/csv",
  ".html": "text/html",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain"
};

function emptyStore(): WorkObjectStoreFile {
  return {
    version: "hydria-work-objects-v1",
    updatedAt: new Date().toISOString(),
    workObjects: [],
    artifacts: [],
    executions: []
  };
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown, maxChars = 1000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trim()}...`;
}

function safeTitle(value: unknown, fallback = "Hydria work object") {
  const text = compact(value, 120)
    .replace(/^(cree|creer|create|generate|genere|fais|make|redige|write|draft)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function safeRelativePath(value: string) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error("Invalid work object path");
  }
  return normalized;
}

function assertWithin(rootDir: string, absolutePath: string) {
  const rel = relative(rootDir, absolutePath);
  if (rel.startsWith("..") || rel === "" || rel.includes("..\\") || rel.includes("../")) {
    throw new Error("Resolved path escapes work object root");
  }
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => compact(entry, 80)).filter(Boolean).slice(0, 24)
    : [];
}

function asStringMatrix(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((cell) => compact(cell, 500)).slice(0, 24))
    .filter((row) => row.some(Boolean))
    .slice(0, 500);
}

function inferKind(value: unknown): WorkObjectKind {
  const normalized = normalizeText(value);
  if (["dataset", "table", "spreadsheet", "sheet", "excel", "xlsx", "csv", "tableur"].includes(normalized)) {
    return "dataset";
  }
  if (["presentation", "slides", "pptx", "powerpoint"].includes(normalized)) {
    return "presentation";
  }
  if (["dashboard", "reporting", "kpi"].includes(normalized)) {
    return "dashboard";
  }
  if (["workflow", "process", "processus"].includes(normalized)) {
    return "workflow";
  }
  if (["project", "app", "application", "site"].includes(normalized)) {
    return "project";
  }
  return "document";
}

function inferWorkspaceFamilyId(action: PublicApiProposedAction) {
  return compact(
    action.payload.workspaceFamilyId ??
      action.payload.workspaceFamily ??
      action.payload.workspaceFamilyLabel,
    80
  ).toLowerCase();
}

function inferEntryPath(kind: WorkObjectKind, format: string, workspaceFamilyId = "") {
  if (kind === "dataset") {
    return "table.csv";
  }
  if (kind === "presentation") {
    return "slides.md";
  }
  if (kind === "dashboard") {
    return "dashboard.json";
  }
  if (kind === "workflow") {
    return "workflow.json";
  }
  if (kind === "project" || format === "html") {
    return "index.html";
  }
  if (kind === "document" && (workspaceFamilyId === "document_knowledge" || format === "docx")) {
    return "document.html";
  }
  return "document.md";
}

function contentTypeForPath(entryPath: string) {
  return textContentTypes[extname(entryPath).toLowerCase()] ?? "text/plain";
}

function entryKindForPath(entryPath: string, fallback: WorkObjectKind): WorkObjectKind {
  if (entryPath === "spec.json") {
    return fallback;
  }
  const extension = extname(entryPath).toLowerCase();
  if ([".csv", ".json", ".xlsx"].includes(extension)) {
    return "dataset";
  }
  if ([".pptx", ".odp"].includes(extension) || entryPath === "slides.md") {
    return "presentation";
  }
  if ([".html", ".js", ".ts", ".tsx", ".css"].includes(extension)) {
    return fallback === "project" ? "project" : "code";
  }
  return fallback;
}

function buildDocumentContent({
  title,
  instruction,
  answerDraft,
  sections
}: {
  title: string;
  instruction: string;
  answerDraft: string;
  sections: string[];
}) {
  if (answerDraft && answerDraft.length > 40) {
    return `# ${title}\n\n${answerDraft.trim()}\n`;
  }

  const headings = sections.length > 0 ? sections : ["Contexte", "Contenu", "Prochaines etapes"];
  return [
    `# ${title}`,
    "",
    `> Demande: ${instruction}`,
    "",
    ...headings.flatMap((section) => [`## ${section}`, "", "- A completer avec les informations validees par Hydria.", ""])
  ].join("\n");
}

function buildPresentationContent(title: string, instruction: string, sections: string[]) {
  const slideTitles = sections.length > 0 ? sections : ["Contexte", "Approche", "Decision"];
  return [
    `# ${title}`,
    "",
    ...slideTitles.flatMap((section, index) => [
      `## Slide ${index + 1} - ${section}`,
      "",
      `- ${index === 0 ? instruction : "Point cle a developper"}`,
      ""
    ])
  ].join("\n");
}

function buildStructuredJsonContent(kind: WorkObjectKind, title: string, instruction: string) {
  return `${JSON.stringify(
    {
      title,
      kind,
      instruction,
      items: []
    },
    null,
    2
  )}\n`;
}

function buildHtmlContent(title: string, instruction: string, answerDraft: string) {
  const body = answerDraft || instruction;
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/[<>]/g, "")}</title>
  </head>
  <body>
    <main>
      <h1>${title.replace(/[<>]/g, "")}</h1>
      <p>${body.replace(/[<>]/g, "")}</p>
    </main>
  </body>
</html>
`;
}

function buildInitialContent(action: PublicApiProposedAction, kind: WorkObjectKind, entryPath: string) {
  const instruction = compact(action.payload.instruction, 4000);
  const answerDraft = compact(action.payload.answerDraft ?? action.payload.initialContent, 12000);
  const title = safeTitle(instruction, action.title || "Hydria work object");
  const sections = asStringArray(action.payload.sections);
  const columns = asStringArray(action.payload.columns);
  const rows = asStringMatrix(action.payload.rows);

  if (kind === "dataset") {
    return serializeHydriaSheetModel(buildHydriaSheetModel({ columns, rows, sheetName: "Sheet 1" }));
  }
  if (kind === "presentation") {
    return buildPresentationContent(title, instruction, sections);
  }
  if (kind === "dashboard" || kind === "workflow") {
    return buildStructuredJsonContent(kind, title, instruction);
  }
  if (entryPath.endsWith(".html")) {
    return buildHtmlContent(title, instruction, answerDraft);
  }
  return buildDocumentContent({ title, instruction, answerDraft, sections });
}

function appendColumnsToCsv(content: string, columns: string[]) {
  if (columns.length === 0) {
    return content;
  }
  const lines = content.split(/\r?\n/);
  const header = (lines[0] || "").split(",").map((value) => value.trim()).filter(Boolean);
  const existing = new Set(header.map(normalizeText));
  const nextColumns = columns.filter((column) => !existing.has(normalizeText(column)));
  if (nextColumns.length === 0) {
    return content;
  }
  lines[0] = [...header, ...nextColumns].join(",");
  return lines.join("\n").replace(/\n*$/, "\n");
}

function updateContentForAction(current: string, action: PublicApiProposedAction) {
  const mode = String(action.payload.mode ?? "append");
  const instruction = compact(action.payload.instruction, 4000);
  const answerDraft = compact(action.payload.answerDraft, 12000);
  const sections = asStringArray(action.payload.sections);
  const columns = asStringArray(action.payload.columns);

  if (columns.length > 0) {
    const nextHydriaSheet = appendColumnsToHydriaSheetContent(current, columns);
    if (nextHydriaSheet) {
      return nextHydriaSheet;
    }
  }

  if (columns.length > 0 && /^[^\n]*(,|;|\t)[^\n]*/.test(current)) {
    return appendColumnsToCsv(current, columns);
  }

  if (/\.html?$/i.test(String(action.target.entryPath ?? "")) || /^\s*<h[1-6]\b|^\s*<p\b/i.test(current)) {
    return appendHtmlUpdate(current, {
      instruction,
      answerDraft,
      sections,
      mode
    });
  }

  const addition = answerDraft && answerDraft.length > 20
    ? answerDraft
    : [
        `## Mise a jour`,
        "",
        `Instruction: ${instruction}`,
        "",
        ...sections.flatMap((section) => [`### ${section}`, "", "- A completer.", ""])
      ].join("\n");

  if (mode === "replace") {
    return `${addition.trim()}\n`;
  }
  return `${current.replace(/\s*$/, "")}\n\n${addition.trim()}\n`;
}

export class WorkObjectExecutionService {
  private writeQueue = Promise.resolve();

  constructor(private readonly options: WorkObjectExecutionServiceOptions = {}) {}

  private get storeFile() {
    return this.options.storeFile ?? env.HYDRIA_OS_WORK_OBJECT_STORE_FILE;
  }

  private get objectRootDir() {
    return resolve(this.options.objectRootDir ?? env.HYDRIA_OS_WORK_OBJECT_ROOT_DIR);
  }

  private get artifactRootDir() {
    return resolve(this.options.artifactRootDir ?? env.HYDRIA_OS_ARTIFACT_ROOT_DIR);
  }

  private now() {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }

  private id() {
    return (this.options.idFactory ?? randomUUID)();
  }

  async ensureReady() {
    await mkdir(dirname(this.storeFile), { recursive: true });
    await mkdir(this.objectRootDir, { recursive: true });
    await mkdir(this.artifactRootDir, { recursive: true });
  }

  async listWorkObjects(options: ListWorkObjectsOptions = {}) {
    const store = await this.readStore();
    const limit = Math.max(1, Math.min(200, Math.round(options.limit ?? 100)));
    return store.workObjects
      .filter((workObject) => !options.sessionId || workObject.sessionId === options.sessionId)
      .filter((workObject) => !options.userId || workObject.userId === options.userId)
      .filter((workObject) => !options.projectId || workObject.projectId === options.projectId)
      .slice(-limit)
      .reverse();
  }

  async listArtifacts(options: ListWorkObjectsOptions = {}) {
    const workObjectIds = new Set((await this.listWorkObjects(options)).map((workObject) => workObject.id));
    const store = await this.readStore();
    return store.artifacts.filter((artifact) => workObjectIds.has(artifact.workObjectId)).reverse();
  }

  async getWorkObject(workObjectId: string) {
    const store = await this.readStore();
    return store.workObjects.find((workObject) => workObject.id === workObjectId) ?? null;
  }

  async getArtifact(artifactId: string) {
    const store = await this.readStore();
    return store.artifacts.find((artifact) => artifact.id === artifactId) ?? null;
  }

  async readArtifactContent(artifactId: string) {
    const artifact = await this.getArtifact(artifactId);
    if (!artifact) {
      return null;
    }
    const artifactDir = resolve(this.artifactRootDir, artifact.id);
    const absolutePath = resolve(artifactDir, safeRelativePath(artifact.filename));
    assertWithin(artifactDir, absolutePath);
    const buffer = await readFile(absolutePath);
    return {
      artifact,
      buffer,
      contentType: artifact.contentType,
      filename: artifact.filename
    };
  }

  async readContent(workObjectId: string, entryPath: string) {
    const workObject = await this.getWorkObject(workObjectId);
    if (!workObject) {
      return null;
    }
    const path = safeRelativePath(entryPath || workObject.activeEntryPath);
    const absolutePath = resolve(this.objectRootDir, workObject.id, path);
    assertWithin(resolve(this.objectRootDir, workObject.id), absolutePath);
    const content = await readFile(absolutePath, "utf8");
    return {
      workObject,
      entryPath: path,
      content,
      contentType: contentTypeForPath(path)
    };
  }

  async updateContent(args: UpdateWorkObjectContentArgs) {
    return this.runExclusive(async () => {
      const store = await this.readStore();
      const index = store.workObjects.findIndex((workObject) => workObject.id === args.workObjectId);
      if (index < 0) {
        return null;
      }
      const workObject = store.workObjects[index]!;
      const entryPath = safeRelativePath(args.entryPath || workObject.activeEntryPath);
      const root = resolve(this.objectRootDir, workObject.id);
      const absolutePath = resolve(root, entryPath);
      assertWithin(root, absolutePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, args.content, "utf8");
      const next = await this.refreshWorkObjectEntry({
        workObject: {
          ...workObject,
          revision: workObject.revision + 1,
          updatedAt: this.now(),
          status: "updated",
          history: [
            ...workObject.history,
            {
              id: this.id(),
              createdAt: this.now(),
              actor: args.actor ?? "user",
              type: "updated",
              actionId: null,
              summary: compact(args.note || `Updated ${entryPath}`, 800),
              payload: null
            }
          ]
        },
        entryPath
      });
      store.workObjects[index] = next;
      await this.writeStore(store);
      return next;
    });
  }

  async executeAction(args: ExecuteWorkObjectActionArgs) {
    return this.runExclusive(async () => {
      await this.ensureReady();
      const createdAt = this.now();

      if (args.action.requiresConfirmation && !args.confirmed) {
        const result = workObjectExecutionResultSchema.parse({
          id: this.id(),
          object: "hydria.work_object_execution",
          createdAt,
          actionId: args.action.id,
          actionType: args.action.type,
          status: "requires_confirmation",
          dryRun: true,
          confirmed: false,
          issues: ["confirmation_required"],
          workObject: null,
          artifact: null,
          summary: "Execution skipped because the OS action requires confirmation."
        });
        const store = await this.readStore();
        store.executions.push(result);
        await this.writeStore(store);
        return result;
      }

      if (args.action.type === "reply") {
        return this.recordSkipped(args, "Reply actions do not create work objects.");
      }

      if (args.action.type === "set_work_object_metadata") {
        return this.executeMetadataUpdate(args);
      }

      if (args.action.type === "update_work_object") {
        return this.executeWorkObjectUpdate(args);
      }

      if (args.action.type === "workspace_tool_call") {
        return this.executeWorkspaceToolCall(args);
      }

      if (args.action.type === "create_artifact" || args.action.type === "create_work_object") {
        return this.executeWorkObjectCreate(args);
      }

      return this.recordSkipped(args, `Unsupported action type: ${args.action.type}`);
    });
  }

  private async recordSkipped(args: ExecuteWorkObjectActionArgs, summary: string) {
    const store = await this.readStore();
    const result = workObjectExecutionResultSchema.parse({
      id: this.id(),
      object: "hydria.work_object_execution",
      createdAt: this.now(),
      actionId: args.action.id,
      actionType: args.action.type,
      status: "skipped",
      dryRun: true,
      confirmed: Boolean(args.confirmed),
      issues: ["not_materialized"],
      workObject: null,
      artifact: null,
      summary
    });
    store.executions.push(result);
    await this.writeStore(store);
    return result;
  }

  private async executeWorkObjectCreate(args: ExecuteWorkObjectActionArgs) {
    const store = await this.readStore();
    const format = compact(args.action.payload.format, 24).toLowerCase() || "md";
    const kind = inferKind(args.action.payload.kind ?? format);
    const workspaceFamilyId = inferWorkspaceFamilyId(args.action);
    const instruction = compact(args.action.payload.instruction, 4000);
    const title = safeTitle(instruction, args.action.title || "Hydria work object");
    const workObjectId = `wo_${this.id()}`;
    const entryPath = inferEntryPath(kind, format, workspaceFamilyId);
    const content = buildInitialContent(args.action, kind, entryPath);
    const root = resolve(this.objectRootDir, workObjectId);
    const sourceFiles = buildWorkspaceSourceFiles({
      kind,
      title,
      entryPath,
      instruction,
      format,
      workspaceFamilyId,
      answerDraft: compact(args.action.payload.answerDraft ?? args.action.payload.initialContent, 12000),
      sections: asStringArray(args.action.payload.sections),
      columns: asStringArray(args.action.payload.columns),
      rows: asStringMatrix(args.action.payload.rows),
      fallbackContent: content
    });
    for (const file of sourceFiles) {
      const absolutePath = resolve(root, safeRelativePath(file.path));
      assertWithin(root, absolutePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content, "utf8");
    }
    const primaryContent = sourceFiles.find((file) => file.path === entryPath)?.content ?? content;

    let workObject = await this.refreshWorkObjectEntry({
      workObject: workObjectSchema.parse({
        id: workObjectId,
        object: "hydria.work_object",
        createdAt: this.now(),
        updatedAt: this.now(),
        revision: 1,
        title,
        kind,
        status: "ready",
        sessionId: args.sessionId ?? null,
        userId: args.userId ?? null,
        projectId: args.projectId ?? null,
        workspacePath: root,
        activeEntryPath: entryPath,
        entries: [],
        artifacts: [],
        summary: compact(`Created from action: ${instruction}`, 1000),
        metadata: {
          source: "public_api_v1",
          requestedFormat: format,
          sourceFormat: entryPath === "document.html" ? "html" : kind === "dataset" ? "csv" : extname(entryPath).replace(/^\./, "") || format,
          workspaceFamilyId: workspaceFamilyId || null,
          actionType: args.action.type
        },
        history: [
          {
            id: this.id(),
            createdAt: this.now(),
            actor: "core",
            type: "created",
            actionId: args.action.id,
            summary: compact(`Created ${kind} work object`, 800),
            payload: {
              instruction,
              format
            }
          }
        ]
      }),
      entryPath
    });

    for (const file of sourceFiles.filter((file) => file.path !== entryPath)) {
      workObject = await this.refreshWorkObjectEntry({
        workObject,
        entryPath: file.path
      });
    }
    if (sourceFiles.some((file) => file.path !== entryPath)) {
      workObject = await this.refreshWorkObjectEntry({
        workObject,
        entryPath
      });
    }

    let artifact: WorkObjectArtifact | null = null;
    if (args.action.type === "create_artifact") {
      artifact = await this.writeArtifact({
        workObject,
        entryPath,
        requestedFormat: format,
        content: primaryContent
      });
      workObject = {
        ...workObject,
        artifacts: [artifact],
        history: [
          ...workObject.history,
          {
            id: this.id(),
            createdAt: this.now(),
            actor: "core",
            type: "artifact_exported",
            actionId: args.action.id,
            summary: compact(`Exported ${artifact.filename}`, 800),
            payload: {
              artifactId: artifact.id,
              format: artifact.format
            }
          }
        ]
      };
      store.artifacts.push(artifact);
    }

    store.workObjects.push(workObject);
    const result = workObjectExecutionResultSchema.parse({
      id: this.id(),
      object: "hydria.work_object_execution",
      createdAt: this.now(),
      actionId: args.action.id,
      actionType: args.action.type,
      status: "executed",
      dryRun: false,
      confirmed: Boolean(args.confirmed),
      issues: [],
      workObject,
      artifact,
      summary: artifact
        ? `Created ${kind} work object and exported ${artifact.filename}.`
        : `Created ${kind} work object.`
    });
    store.executions.push(result);
    await this.writeStore(store);
    return result;
  }

  private async executeWorkObjectUpdate(args: ExecuteWorkObjectActionArgs) {
    const store = await this.readStore();
    const targetId = args.action.target.workObjectId || "";
    let index = store.workObjects.findIndex((workObject) => workObject.id === targetId);
    if (index < 0) {
      const stub = await this.createExternalStub(args);
      store.workObjects.push(stub);
      index = store.workObjects.length - 1;
    }

    const workObject = store.workObjects[index]!;
    const entryPath = safeRelativePath(args.action.target.entryPath || workObject.activeEntryPath);
    const root = resolve(this.objectRootDir, workObject.id);
    const absolutePath = resolve(root, entryPath);
    assertWithin(root, absolutePath);
    let current = "";
    try {
      current = await readFile(absolutePath, "utf8");
    } catch {
      current = compact(args.action.payload.currentPreview, 4000);
    }

    const nextContent = updateContentForAction(current, args.action);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, nextContent, "utf8");
    const nextWorkObject = await this.refreshWorkObjectEntry({
      workObject: {
        ...workObject,
        updatedAt: this.now(),
        revision: workObject.revision + 1,
        status: "updated",
        activeEntryPath: entryPath,
        history: [
          ...workObject.history,
          {
            id: this.id(),
            createdAt: this.now(),
            actor: "core",
            type: "updated",
            actionId: args.action.id,
            summary: compact(`Updated ${entryPath} from public API action`, 800),
            payload: {
              mode: args.action.payload.mode ?? "append",
              instruction: args.action.payload.instruction ?? ""
            }
          }
        ]
      },
      entryPath
    });
    store.workObjects[index] = nextWorkObject;
    const result = workObjectExecutionResultSchema.parse({
      id: this.id(),
      object: "hydria.work_object_execution",
      createdAt: this.now(),
      actionId: args.action.id,
      actionType: args.action.type,
      status: "executed",
      dryRun: false,
      confirmed: Boolean(args.confirmed),
      issues: [],
      workObject: nextWorkObject,
      artifact: null,
      summary: `Updated work object ${nextWorkObject.id}.`
    });
    store.executions.push(result);
    await this.writeStore(store);
    return result;
  }

  private async executeWorkspaceToolCall(args: ExecuteWorkObjectActionArgs) {
    const store = await this.readStore();
    const targetId = args.action.target.workObjectId || "";
    let index = store.workObjects.findIndex((workObject) => workObject.id === targetId);
    if (index < 0) {
      const stub = await this.createExternalStub(args);
      store.workObjects.push(stub);
      index = store.workObjects.length - 1;
    }

    const workObject = store.workObjects[index]!;
    const entryPath = safeRelativePath(args.action.target.entryPath || workObject.activeEntryPath);
    const root = resolve(this.objectRootDir, workObject.id);
    const absolutePath = resolve(root, entryPath);
    assertWithin(root, absolutePath);

    let current = "";
    try {
      current = await readFile(absolutePath, "utf8");
    } catch {
      current = compact(args.action.payload.currentPreview, 4000);
    }

    const operationResult = applyHydriaWorkspaceToolOperationsToContent(
      current,
      args.action.payload.operations ?? args.action.payload.operation
    );
    if (operationResult.applied.length === 0) {
      const result = workObjectExecutionResultSchema.parse({
        id: this.id(),
        object: "hydria.work_object_execution",
        createdAt: this.now(),
        actionId: args.action.id,
        actionType: args.action.type,
        status: "failed",
        dryRun: false,
        confirmed: Boolean(args.confirmed),
        issues: operationResult.issues.length > 0 ? operationResult.issues : ["workspace_operation_not_applied"],
        workObject,
        artifact: null,
        summary: "Workspace tool call was not applied."
      });
      store.executions.push(result);
      await this.writeStore(store);
      return result;
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, operationResult.content, "utf8");
    const nextWorkObject = await this.refreshWorkObjectEntry({
      workObject: {
        ...workObject,
        updatedAt: this.now(),
        revision: workObject.revision + 1,
        status: "updated",
        activeEntryPath: entryPath,
        history: [
          ...workObject.history,
          {
            id: this.id(),
            createdAt: this.now(),
            actor: "core",
            type: "updated",
            actionId: args.action.id,
            summary: compact(`Applied workspace tool operations: ${operationResult.applied.join(", ")}`, 800),
            payload: {
              toolName: args.action.payload.toolName ?? "",
              operations: args.action.payload.operations ?? args.action.payload.operation ?? null,
              issues: operationResult.issues
            }
          }
        ]
      },
      entryPath
    });
    store.workObjects[index] = nextWorkObject;
    const result = workObjectExecutionResultSchema.parse({
      id: this.id(),
      object: "hydria.work_object_execution",
      createdAt: this.now(),
      actionId: args.action.id,
      actionType: args.action.type,
      status: "executed",
      dryRun: false,
      confirmed: Boolean(args.confirmed),
      issues: operationResult.issues,
      workObject: nextWorkObject,
      artifact: null,
      summary: `Applied ${operationResult.applied.length} workspace operation(s) to ${nextWorkObject.id}.`
    });
    store.executions.push(result);
    await this.writeStore(store);
    return result;
  }

  private async executeMetadataUpdate(args: ExecuteWorkObjectActionArgs) {
    const store = await this.readStore();
    const index = store.workObjects.findIndex((workObject) => workObject.id === args.action.target.workObjectId);
    if (index < 0) {
      return this.recordSkipped(args, "Metadata update target was not found.");
    }
    const current = store.workObjects[index]!;
    const instruction = compact(args.action.payload.instruction, 500);
    const nextTitle = compact(args.action.payload.title ?? args.action.payload.newTitle, 240);
    const nextStatus = compact(args.action.payload.status ?? args.action.payload.newStatus, 40);
    const next = workObjectSchema.parse({
      ...current,
      title: nextTitle || current.title,
      status: ["draft", "ready", "updated", "archived"].includes(nextStatus) ? nextStatus : current.status,
      revision: current.revision + 1,
      updatedAt: this.now(),
      history: [
        ...current.history,
        {
          id: this.id(),
          createdAt: this.now(),
          actor: "core",
          type: "metadata_updated",
          actionId: args.action.id,
          summary: instruction || "Metadata updated",
          payload: {
            title: nextTitle,
            status: nextStatus
          }
        }
      ]
    });
    store.workObjects[index] = next;
    const result = workObjectExecutionResultSchema.parse({
      id: this.id(),
      object: "hydria.work_object_execution",
      createdAt: this.now(),
      actionId: args.action.id,
      actionType: args.action.type,
      status: "executed",
      dryRun: false,
      confirmed: Boolean(args.confirmed),
      issues: [],
      workObject: next,
      artifact: null,
      summary: `Updated metadata for ${next.id}.`
    });
    store.executions.push(result);
    await this.writeStore(store);
    return result;
  }

  private async createExternalStub(args: ExecuteWorkObjectActionArgs) {
    const targetId = args.action.target.workObjectId || `wo_${this.id()}`;
    const kind = inferKind(args.action.payload.currentKind ?? "document");
    const workspaceFamilyId = inferWorkspaceFamilyId(args.action);
    const entryPath = safeRelativePath(args.action.target.entryPath || inferEntryPath(kind, "md", workspaceFamilyId));
    const root = resolve(this.objectRootDir, targetId);
    const absolutePath = resolve(root, entryPath);
    assertWithin(root, absolutePath);
    const content =
      compact(args.action.payload.currentPreview, 4000) ||
      (kind === "dataset"
        ? serializeHydriaSheetModel(buildHydriaSheetModel({ columns: asStringArray(args.action.payload.columns) }))
        : "");
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    return this.refreshWorkObjectEntry({
      workObject: workObjectSchema.parse({
        id: targetId,
        object: "hydria.work_object",
        createdAt: this.now(),
        updatedAt: this.now(),
        revision: 1,
        title: safeTitle(args.action.title, "Imported OS work object"),
        kind,
        status: "draft",
        sessionId: args.sessionId ?? null,
        userId: args.userId ?? null,
        projectId: args.projectId ?? null,
        workspacePath: root,
        activeEntryPath: entryPath,
        entries: [],
        artifacts: [],
        summary: "Imported from external OS context for persistent Hydria updates.",
        metadata: {
          importedFromWorkspaceContext: true
        },
        history: [
          {
            id: this.id(),
            createdAt: this.now(),
            actor: "core",
            type: "created",
            actionId: args.action.id,
            summary: "Created local persistent stub for external OS object.",
            payload: null
          }
        ]
      }),
      entryPath
    });
  }

  private async refreshWorkObjectEntry(args: { workObject: WorkObject; entryPath: string }) {
    const entryPath = safeRelativePath(args.entryPath);
    const root = resolve(this.objectRootDir, args.workObject.id);
    const absolutePath = resolve(root, entryPath);
    assertWithin(root, absolutePath);
    const fileStat = await stat(absolutePath);
    const content = await readFile(absolutePath, "utf8");
    const entry: WorkObjectEntry = {
      id: entryPath,
      path: entryPath,
      label: entryPath,
      kind: entryKindForPath(entryPath, args.workObject.kind),
      editable: true,
      primary: true,
      contentType: contentTypeForPath(entryPath),
      preview: compact(content, 600),
      sizeBytes: fileStat.size,
      lastModifiedAt: fileStat.mtime.toISOString()
    };
    return workObjectSchema.parse({
      ...args.workObject,
      activeEntryPath: entryPath,
      workspacePath: root,
      entries: [
        entry,
        ...args.workObject.entries.filter((current) => current.path !== entryPath).map((current) => ({
          ...current,
          primary: false
        }))
      ]
    });
  }

  private async writeArtifact(args: {
    workObject: WorkObject;
    entryPath: string;
    requestedFormat: string;
    content: string;
  }) {
    const artifactId = this.id();
    const artifact = await generateOfficeArtifact({
      title: args.workObject.title,
      kind: args.workObject.kind,
      requestedFormat: args.requestedFormat,
      sourceEntryPath: args.entryPath,
      content: args.content
    });
    const artifactDir = resolve(this.artifactRootDir, artifactId);
    const absolutePath = resolve(artifactDir, safeRelativePath(artifact.filename));
    assertWithin(artifactDir, absolutePath);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(absolutePath, artifact.buffer);
    const fileStat = await stat(absolutePath);
    return workObjectArtifactSchema.parse({
      id: artifactId,
      object: "hydria.artifact",
      workObjectId: args.workObject.id,
      title: args.workObject.title,
      format: artifact.format,
      filename: artifact.filename,
      contentType: artifact.contentType,
      entryPath: args.entryPath,
      downloadUrl: `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download`,
      createdAt: this.now(),
      sizeBytes: fileStat.size,
      status: "ready"
    });
  }

  private async readStore() {
    await this.ensureReady();
    try {
      const raw = await readFile(this.storeFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<WorkObjectStoreFile>;
      return {
        version: "hydria-work-objects-v1",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : this.now(),
        workObjects: Array.isArray(parsed.workObjects)
          ? parsed.workObjects.map((item) => workObjectSchema.parse(item))
          : [],
        artifacts: Array.isArray(parsed.artifacts)
          ? parsed.artifacts.map((item) => workObjectArtifactSchema.parse(item))
          : [],
        executions: Array.isArray(parsed.executions)
          ? parsed.executions.map((item) => workObjectExecutionResultSchema.parse(item))
          : []
      } satisfies WorkObjectStoreFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyStore();
      }
      throw error;
    }
  }

  private async writeStore(store: WorkObjectStoreFile) {
    const next = {
      ...store,
      updatedAt: this.now(),
      workObjects: store.workObjects.slice(-1000),
      artifacts: store.artifacts.slice(-1000),
      executions: store.executions.slice(-2000)
    } satisfies WorkObjectStoreFile;
    await mkdir(dirname(this.storeFile), { recursive: true });
    await writeFile(this.storeFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  private async runExclusive<T>(task: () => Promise<T>) {
    const pending = this.writeQueue.then(task, task);
    this.writeQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }
}

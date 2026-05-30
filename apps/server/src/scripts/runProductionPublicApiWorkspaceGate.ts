import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CheckStatus = "passed" | "failed" | "warning";

type CheckResult = {
  name: string;
  status: CheckStatus;
  message: string;
  details?: unknown;
  durationMs: number;
};

type Args = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  output: string;
};

type PublicApiAskResponse = {
  sessionId?: string;
  answer?: string;
  proposedActions?: Array<Record<string, any>>;
  executedActions?: Array<Record<string, any>>;
  activeWorkObject?: Record<string, any> | null;
  workObjects?: Array<Record<string, any>>;
  artifacts?: Array<Record<string, any>>;
  tools?: Record<string, any>;
  models?: Record<string, any>;
  quality?: Record<string, any>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "hydria-production-public-api-workspace-gate-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  return {
    baseUrl: normalizeBaseUrl(readOption(argv, "--base-url") ?? "https://app.hydria.click"),
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? "",
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? "180000"),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput)
  };
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/g, "");
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(apiKey: string) {
  return {
    "x-hydria-api-key": apiKey
  };
}

async function fetchText(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  return { response, text };
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const { response, text } = await fetchText(url, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T;
}

async function getJson<T>(args: Args, path: string): Promise<T> {
  return fetchJson<T>(
    joinUrl(args.baseUrl, path),
    {
      headers: authHeaders(args.apiKey)
    },
    args.timeoutMs
  );
}

async function postJson<T>(args: Args, path: string, body: unknown): Promise<T> {
  return fetchJson<T>(
    joinUrl(args.baseUrl, path),
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...authHeaders(args.apiKey)
      },
      body: JSON.stringify(body)
    },
    args.timeoutMs
  );
}

async function runCheck(
  checks: CheckResult[],
  name: string,
  fn: () => Promise<Omit<CheckResult, "name" | "durationMs">>
) {
  const startedAt = Date.now();
  try {
    checks.push({
      name,
      durationMs: Date.now() - startedAt,
      ...(await fn())
    });
  } catch (error) {
    checks.push({
      name,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    });
  }
}

function pass(message: string, details?: unknown): Omit<CheckResult, "name" | "durationMs"> {
  return { status: "passed", message, details };
}

function fail(message: string, details?: unknown): Omit<CheckResult, "name" | "durationMs"> {
  return { status: "failed", message, details };
}

function sheetPreview(columns: string[], rows: string[][]) {
  return JSON.stringify({
    kind: "hydria-sheet",
    version: 1,
    activeSheetId: "sheet-1",
    sheets: [{ id: "sheet-1", name: "Sheet 1", columns, rows }]
  });
}

function workspaceCapabilities(tools: string[] = ["sheet.apply_formula", "doc.edit"]) {
  return {
    capabilities: {
      actions: ["create_artifact", "workspace_tool_call", "reply"],
      workspaceTools: tools,
      artifactFormats: ["xlsx", "csv", "docx", "md"],
      workObjectKinds: ["dataset", "document"]
    },
    executionPolicy: {
      mode: "execute_after_confirmation",
      requireConfirmation: false
    }
  };
}

function extractWorkObjectId(response: PublicApiAskResponse) {
  return (
    response.activeWorkObject?.id ??
    response.executedActions?.find((action) => action.workObject?.id)?.workObject?.id ??
    response.workObjects?.[0]?.id ??
    response.artifacts?.[0]?.id ??
    ""
  );
}

async function runProductionPublicApiWorkspaceGate(args = parseArgs()) {
  const checks: CheckResult[] = [];
  let sessionId = "";
  let workObjectId = "";

  if (!args.apiKey.trim()) {
    checks.push({
      name: "api_key_present",
      status: "failed",
      message: "Missing HYDRIA_API_KEY/HYDRIA_PROD_API_KEY or --api-key. Production stores only API key hashes, so this gate needs the plaintext key from the deploy secret store.",
      durationMs: 0
    });
  } else {
    checks.push({
      name: "api_key_present",
      status: "passed",
      message: "API key was provided to the authenticated production gate.",
      durationMs: 0
    });
  }

  await runCheck(checks, "capabilities_include_workspace_and_interactions", async () => {
    const capabilities = await getJson<Record<string, any>>(args, "/api/v1/capabilities");
    const endpoints = capabilities.endpoints ?? [];
    const tools = capabilities.tools ?? [];
    const missing = [
      "POST /api/v1/ask",
      "GET /api/v1/interactions",
      "POST /api/v1/work-objects/:workObjectId/operations"
    ].filter((endpoint) => !endpoints.includes(endpoint));
    if (missing.length > 0) {
      return fail("public API capabilities are missing required endpoints", { missing, endpoints });
    }
    if (!tools.includes("workspace sheet operations") || !tools.includes("workspace document operations")) {
      return fail("public API capabilities are missing workspace tools", { tools });
    }
    return pass("public API exposes workspace and interaction capabilities", { endpoints: endpoints.length, tools });
  });

  await runCheck(checks, "ask_creates_executed_sheet_work_object", async () => {
    const response = await postJson<PublicApiAskResponse>(args, "/api/v1/ask", {
      input: "Presente ces chiffres dans un Excel : Janvier 1200, Fevrier 1600, Mars 1400.",
      userId: "prod-api-gate",
      projectId: "workspace-api-gate",
      workspaceContext: workspaceCapabilities(["sheet.apply_formula"]),
      options: {
        includeProposedActions: true,
        includeSources: false,
        includeDiagnostics: true
      }
    });
    sessionId = response.sessionId ?? "";
    workObjectId = extractWorkObjectId(response);
    const executed = response.executedActions ?? [];
    if (!sessionId) {
      return fail("ask response did not return a sessionId", response);
    }
    if (!workObjectId) {
      return fail("ask response did not create or return a work object", response);
    }
    if (!executed.some((action) => action.status === "executed")) {
      return fail("create_artifact action was not executed by confirmed public API policy", response);
    }
    return pass("public API created an executed sheet work object", {
      sessionId,
      workObjectId,
      executedCount: executed.length,
      proposedCount: response.proposedActions?.length ?? 0
    });
  });

  await runCheck(checks, "active_sheet_commentary_uses_workspace_context", async () => {
    const response = await postJson<PublicApiAskResponse>(args, "/api/v1/ask", {
      sessionId,
      input: "Commente ces chiffres en une phrase.",
      userId: "prod-api-gate",
      projectId: "workspace-api-gate",
      workspaceContext: {
        activeWorkObject: {
          id: workObjectId || "sheet-prod-gate",
          title: "CA mensuel",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Mois", "CA"], [["Janvier", "1200"], ["Fevrier", "1600"], ["Mars", "1400"]])
        },
        ...workspaceCapabilities(["sheet.apply_formula"])
      },
      options: {
        includeProposedActions: true,
        includeDiagnostics: true
      }
    });
    const answer = response.answer ?? "";
    if (!/janvier|fevrier|mars|1200|1600|1400|progress|progresse|baisse|recule/i.test(answer)) {
      return fail("answer did not use active sheet data", { answer, response });
    }
    return pass("public API answer used active sheet data", {
      answer,
      provider: response.models?.provider,
      model: response.models?.model
    });
  });

  await runCheck(checks, "direct_sheet_operation_is_audited", async () => {
    if (!workObjectId) {
      return fail("no workObjectId from previous create step");
    }
    const operation = await postJson<Record<string, any>>(
      args,
      `/api/v1/work-objects/${encodeURIComponent(workObjectId)}/operations`,
      {
        sessionId,
        userId: "prod-api-gate",
        projectId: "workspace-api-gate",
        confirmed: true,
        toolName: "sheet.apply_formula",
        instruction: "Ajouter un total gouverne par operation directe.",
        operations: [
          {
            type: "sheet.set_range",
            range: "C2:C4",
            values: [["=B2"], ["=B3"], ["=B4"]]
          }
        ]
      }
    );
    if (operation.status !== "executed") {
      return fail("direct work object operation did not execute", operation);
    }
    return pass("direct work object operation executed", {
      status: operation.status,
      workObjectId: operation.workObject?.id ?? workObjectId
    });
  });

  await runCheck(checks, "active_sheet_can_create_document", async () => {
    const response = await postJson<PublicApiAskResponse>(args, "/api/v1/ask", {
      sessionId,
      input: "Cree un document Word a partir de ce tableau.",
      userId: "prod-api-gate",
      projectId: "workspace-api-gate",
      workspaceContext: {
        activeWorkObject: {
          id: workObjectId || "sheet-prod-gate",
          title: "CA mensuel",
          kind: "dataset",
          workspaceFamilyId: "data_spreadsheet",
          entryPath: "table.csv",
          contentPreview: sheetPreview(["Mois", "CA"], [["Janvier", "1200"], ["Fevrier", "1600"], ["Mars", "1400"]])
        },
        ...workspaceCapabilities(["sheet.apply_formula"])
      },
      options: {
        includeProposedActions: true,
        includeDiagnostics: true
      }
    });
    const action = response.proposedActions?.[0];
    if (action?.type !== "create_artifact" || action?.payload?.kind !== "document") {
      return fail("active sheet did not produce a document artifact proposal", response);
    }
    if (!JSON.stringify(action.payload?.answerDraft ?? "").includes("1600")) {
      return fail("document draft did not include source sheet data", action);
    }
    if (!response.executedActions?.some((executed) => executed.status === "executed")) {
      return fail("document artifact was not executed under confirmed public API policy", response);
    }
    return pass("active sheet can create a document artifact", {
      workObjectId: response.activeWorkObject?.id,
      actionKind: action.payload.kind
    });
  });

  await runCheck(checks, "active_document_can_create_sheet", async () => {
    const response = await postJson<PublicApiAskResponse>(args, "/api/v1/ask", {
      sessionId,
      input: "Cree un Excel a partir de ce document.",
      userId: "prod-api-gate",
      projectId: "workspace-api-gate",
      workspaceContext: {
        activeWorkObject: {
          id: "doc-prod-gate",
          title: "CA note",
          kind: "document",
          workspaceFamilyId: "document_knowledge",
          entryPath: "content.md",
          contentPreview: "# CA note\n\nJanvier: 1200\nFevrier: 1600\nMars: 1400"
        },
        ...workspaceCapabilities(["doc.edit"])
      },
      options: {
        includeProposedActions: true,
        includeDiagnostics: true
      }
    });
    const action = response.proposedActions?.[0];
    if (action?.type !== "create_artifact" || action?.payload?.kind !== "dataset") {
      return fail("active document did not produce a sheet artifact proposal", response);
    }
    if (!JSON.stringify(action.payload?.rows ?? []).includes("1600")) {
      return fail("sheet rows did not include source document figures", action);
    }
    if (!response.executedActions?.some((executed) => executed.status === "executed")) {
      return fail("sheet artifact was not executed under confirmed public API policy", response);
    }
    return pass("active document can create a sheet artifact", {
      workObjectId: response.activeWorkObject?.id,
      actionKind: action.payload.kind
    });
  });

  await runCheck(checks, "interaction_audit_contains_ask_and_workspace_action", async () => {
    if (!sessionId) {
      return fail("no sessionId from previous ask step");
    }
    const audit = await getJson<Record<string, any>>(
      args,
      `/api/v1/interactions?sessionId=${encodeURIComponent(sessionId)}&limit=20`
    );
    const interactions = Array.isArray(audit.interactions) ? audit.interactions : [];
    const scopes = interactions.map((interaction: Record<string, any>) => interaction.scope);
    if (!scopes.includes("public_api_ask")) {
      return fail("interaction audit is missing public_api_ask", { scopes, interactions });
    }
    if (!scopes.includes("workspace_action")) {
      return fail("interaction audit is missing workspace_action", { scopes, interactions });
    }
    return pass("interaction audit persisted ask and workspace actions", {
      count: interactions.length,
      scopes
    });
  });

  const failedChecks = checks.filter((check) => check.status === "failed").map((check) => check.name);
  const warningChecks = checks.filter((check) => check.status === "warning").map((check) => check.name);
  const report = {
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      authenticated: Boolean(args.apiKey.trim())
    },
    passed: failedChecks.length === 0,
    failedChecks,
    warningChecks,
    checks
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runProductionPublicApiWorkspaceGate()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            failedChecks: report.failedChecks,
            warningChecks: report.warningChecks,
            output: parseArgs().output
          },
          null,
          2
        )
      );
      if (!report.passed) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { runProductionPublicApiWorkspaceGate };

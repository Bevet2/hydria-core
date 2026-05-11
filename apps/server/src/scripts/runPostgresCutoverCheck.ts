import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrateSqliteToPostgres, type SqliteToPostgresMigrationReport } from "./migrateSqliteToPostgres.js";
import { runHydriaCoreRuntimeReleaseGate } from "./runHydriaCoreRuntimeReleaseGate.js";
import { env } from "../utils/env.js";

const { Pool } = pg;

type CutoverStatus = "passed" | "failed";

type CutoverCheckReport = {
  version: "hydria-postgres-cutover-check-v1";
  runId: string;
  createdAt: string;
  completedAt: string;
  passed: boolean;
  status: CutoverStatus;
  target: {
    postgresSchema: string;
    postgresUrlConfigured: boolean;
    sqliteFile: string;
    publicSchemaAllowed: boolean;
    resetSchema: boolean;
  };
  checks: {
    preflight: CheckResult;
    migration: CheckResult & {
      report: SqliteToPostgresMigrationReport | null;
    };
    countParity: CheckResult & {
      counts: Record<string, number>;
    };
    serverHealth: CheckResult & {
      health: unknown;
    };
    releaseGate: CheckResult & {
      output: string;
      summary: unknown;
    };
  };
  rollback: {
    sqliteFallback: string;
    instructions: string[];
  };
};

type CheckResult = {
  passed: boolean;
  issues: string[];
};

type Args = {
  postgresUrl: string;
  postgresSchema: string;
  sqliteFile: string;
  output: string;
  allowPublic: boolean;
  resetSchema: boolean;
  serverPort: string;
};

const currentFile = fileURLToPath(import.meta.url);
const serverRoot = resolve(dirname(currentFile), "../..");
const projectRoot = resolve(serverRoot, "../..");
const tsxCliPath = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-postgres-cutover-check-v1.json"
);

let serverProcess: ChildProcess | null = null;

export async function runPostgresCutoverCheck(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report: CutoverCheckReport = {
    version: "hydria-postgres-cutover-check-v1",
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    completedAt: "",
    passed: false,
    status: "failed",
    target: {
      postgresSchema: args.postgresSchema,
      postgresUrlConfigured: args.postgresUrl.trim().length > 0,
      sqliteFile: args.sqliteFile,
      publicSchemaAllowed: args.allowPublic,
      resetSchema: args.resetSchema
    },
    checks: {
      preflight: check(false, []),
      migration: {
        ...check(false, []),
        report: null
      },
      countParity: {
        ...check(false, []),
        counts: {}
      },
      serverHealth: {
        ...check(false, []),
        health: null
      },
      releaseGate: {
        ...check(false, []),
        output: "",
        summary: null
      }
    },
    rollback: {
      sqliteFallback: "Set PERSISTENCE_ADAPTER=sqlite and restart Hydria.",
      instructions: [
        "Do not delete the SQLite source until PostgreSQL staging has run cleanly.",
        "If PostgreSQL health fails, set PERSISTENCE_ADAPTER=sqlite and restart the API.",
        "Keep the PostgreSQL schema for inspection unless the failure is from a disposable validation run."
      ]
    }
  };

  try {
    process.env.OPENROUTER_API_KEY ??= "ci-placeholder";
    process.env.WEB_ORIGIN ??= `http://localhost:${args.serverPort}`;
    process.env.LOCAL_MODEL_PROVIDER ??= "ollama";
    process.env.LOCAL_MODEL_NAME ??= "ci-missing-model";
    process.env.LOCAL_MODEL_BASE_URL ??= "http://127.0.0.1:65535";
    process.env.LOCAL_MODEL_TIMEOUT_MS ??= "1000";
    process.env.LOCAL_MODEL_OBSERVER_ENABLED ??= "false";
    process.env.LOCAL_STUDENT_FALLBACK_MODEL ??= "openai/gpt-5.4-mini";

    report.checks.preflight = await runPreflight(args);
    if (!report.checks.preflight.passed) {
      return await finalize(report, args.output);
    }

    if (args.resetSchema) {
      await dropSchema(args);
    }

    const migration = await migrateSqliteToPostgres({
      sqliteFile: args.sqliteFile,
      postgresUrl: args.postgresUrl,
      postgresSchema: args.postgresSchema
    });
    report.checks.migration = {
      ...check(true, []),
      report: migration
    };

    const counts = await readPostgresCounts(args);
    const parityIssues = compareCounts(migration, counts);
    report.checks.countParity = {
      ...check(parityIssues.length === 0, parityIssues),
      counts
    };
    if (!report.checks.countParity.passed) {
      return await finalize(report, args.output);
    }

    const health = await runServerHealthCheck(args);
    const healthIssues = validateHealth(health, migration, args);
    report.checks.serverHealth = {
      ...check(healthIssues.length === 0, healthIssues),
      health
    };
    if (!report.checks.serverHealth.passed) {
      return await finalize(report, args.output);
    }

    const releaseGateOutput = resolve(
      projectRoot,
      "storage",
      "training",
      "hydria-postgres-cutover-release-gate-v1.json"
    );
    const releaseGate = await withPostgresEnv(args, () =>
      runHydriaCoreRuntimeReleaseGate(["--smoke", `--output=${releaseGateOutput}`])
    );
    report.checks.releaseGate = {
      ...check(releaseGate.passed, releaseGate.passed ? [] : ["runtime release gate smoke failed"]),
      output: releaseGateOutput,
      summary: releaseGate.summary
    };

    return await finalize(report, args.output);
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    const current = firstUnpassedCheck(report);
    current.issues.push(issue);
    current.passed = false;
    return await finalize(report, args.output);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
      await waitForProcessExit(serverProcess).catch(() => undefined);
    }
  }
}

function parseArgs(argv: string[]): Args {
  return {
    postgresUrl: readOption(argv, "--postgres") ?? env.POSTGRES_URL,
    postgresSchema: readOption(argv, "--schema") ?? env.POSTGRES_SCHEMA,
    sqliteFile: readOption(argv, "--sqlite") ?? env.PERSISTENCE_DB_FILE,
    output: resolve(readOption(argv, "--output") ?? defaultOutput),
    allowPublic: argv.includes("--allow-public"),
    resetSchema: argv.includes("--reset-schema"),
    serverPort: readOption(argv, "--port") ?? "18082"
  };
}

async function runPreflight(args: Args): Promise<CheckResult> {
  const issues: string[] = [];
  if (!args.postgresUrl.trim()) {
    issues.push("POSTGRES_URL is required.");
  }
  if (args.postgresSchema === "public" && !args.allowPublic) {
    issues.push("Refusing schema 'public' without --allow-public.");
  }
  try {
    quoteIdentifier(args.postgresSchema);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (args.resetSchema && args.postgresSchema === "public") {
    issues.push("Refusing --reset-schema against schema 'public'.");
  }
  if (issues.length === 0) {
    const pool = new Pool({ connectionString: args.postgresUrl });
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  return check(issues.length === 0, issues);
}

async function dropSchema(args: Args) {
  const pool = new Pool({ connectionString: args.postgresUrl });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(args.postgresSchema)} CASCADE`);
  } finally {
    await pool.end();
  }
}

async function readPostgresCounts(args: Args) {
  const pool = new Pool({ connectionString: args.postgresUrl });
  const schema = quoteIdentifier(args.postgresSchema);
  const tables = {
    arenaRounds: "arena_rounds",
    studentSessions: "student_sessions",
    skills: "skills",
    toolManifests: "tool_manifests",
    specializedAgents: "specialized_agents",
    localModelVariants: "local_model_variants"
  } as const;

  try {
    const entries = await Promise.all(
      Object.entries(tables).map(async ([key, table]) => {
        const result = await pool.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM ${schema}.${quoteIdentifier(table)}`
        );
        return [key, result.rows[0]?.count ?? 0] as const;
      })
    );
    return Object.fromEntries(entries);
  } finally {
    await pool.end();
  }
}

function compareCounts(migration: SqliteToPostgresMigrationReport, counts: Record<string, number>) {
  const issues: string[] = [];
  for (const [key, expected] of Object.entries(migration.counts)) {
    const actual = counts[key];
    if (actual !== expected) {
      issues.push(`${key}: expected ${expected}, got ${actual ?? "(missing)"}`);
    }
  }
  return issues;
}

async function runServerHealthCheck(args: Args) {
  const baseUrl = `http://127.0.0.1:${args.serverPort}`;
  serverProcess = spawn(process.execPath, [tsxCliPath, "src/index.ts"], {
    cwd: serverRoot,
    env: cleanEnv({
      ...process.env,
      SERVER_PORT: args.serverPort,
      PERSISTENCE_ADAPTER: "postgres",
      POSTGRES_URL: args.postgresUrl,
      POSTGRES_SCHEMA: args.postgresSchema
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health/persistence`);
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for Hydria health.");
}

function validateHealth(
  health: any,
  migration: SqliteToPostgresMigrationReport,
  args: Args
) {
  const issues: string[] = [];
  if (health.status !== "ok") {
    issues.push(`expected persistence status ok, got ${health.status}`);
  }
  if (health.database?.adapter !== "postgres") {
    issues.push(`expected adapter postgres, got ${health.database?.adapter ?? "(missing)"}`);
  }
  if (health.database?.postgresSchema !== args.postgresSchema) {
    issues.push(`expected schema ${args.postgresSchema}, got ${health.database?.postgresSchema}`);
  }
  if (health.database?.arenaRoundCount !== migration.counts.arenaRounds) {
    issues.push("arena round count mismatch in health response");
  }
  if (health.database?.studentSessionCount !== migration.counts.studentSessions) {
    issues.push("student session count mismatch in health response");
  }
  return issues;
}

async function withPostgresEnv<T>(args: Args, task: () => Promise<T>) {
  const previous = {
    PERSISTENCE_ADAPTER: process.env.PERSISTENCE_ADAPTER,
    POSTGRES_URL: process.env.POSTGRES_URL,
    POSTGRES_SCHEMA: process.env.POSTGRES_SCHEMA
  };
  process.env.PERSISTENCE_ADAPTER = "postgres";
  process.env.POSTGRES_URL = args.postgresUrl;
  process.env.POSTGRES_SCHEMA = args.postgresSchema;
  try {
    return await task();
  } finally {
    restoreEnv("PERSISTENCE_ADAPTER", previous.PERSISTENCE_ADAPTER);
    restoreEnv("POSTGRES_URL", previous.POSTGRES_URL);
    restoreEnv("POSTGRES_SCHEMA", previous.POSTGRES_SCHEMA);
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function finalize(report: CutoverCheckReport, output: string) {
  report.completedAt = new Date().toISOString();
  report.passed = Object.values(report.checks).every((entry) => entry.passed);
  report.status = report.passed ? "passed" : "failed";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        output,
        passed: report.passed,
        status: report.status,
        failedChecks: Object.entries(report.checks)
          .filter(([, result]) => !result.passed)
          .map(([name]) => name)
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

function firstUnpassedCheck(report: CutoverCheckReport) {
  return (
    Object.values(report.checks).find((entry) => !entry.passed) ?? report.checks.preflight
  );
}

function check(passed: boolean, issues: string[]): CheckResult {
  return { passed, issues };
}

function readOption(argv: string[], flag: string) {
  const direct = argv.find((entry) => entry.startsWith(`${flag}=`));
  if (direct) {
    return direct.slice(flag.length + 1);
  }
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function cleanEnv(source: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        !entry[0].includes("=") && typeof entry[1] === "string"
    )
  );
}

function delay(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function waitForProcessExit(child: ChildProcess) {
  return new Promise<void>((resolvePromise) => {
    if (child.exitCode !== null || child.killed) {
      resolvePromise();
      return;
    }
    child.once("exit", () => resolvePromise());
    setTimeout(resolvePromise, 5000).unref();
  });
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  runPostgresCutoverCheck().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

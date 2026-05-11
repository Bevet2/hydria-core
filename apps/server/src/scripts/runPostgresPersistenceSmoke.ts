import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

type MigrationReport = {
  counts: {
    arenaRounds: number;
    studentSessions: number;
    skills: number;
    toolManifests: number;
    specializedAgents: number;
    localModelVariants: number;
  };
};

const currentFile = fileURLToPath(import.meta.url);
const serverRoot = resolve(dirname(currentFile), "../..");
const projectRoot = resolve(serverRoot, "../..");
const tsxCliPath = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const postgresUrl = process.env.POSTGRES_URL ?? "postgres://hydria:hydria@127.0.0.1:5432/hydria";
const smokeSchema = process.env.HYDRIA_POSTGRES_SMOKE_SCHEMA ?? "hydria_postgres_smoke";
const keepSchema = process.env.HYDRIA_POSTGRES_SMOKE_KEEP_SCHEMA === "true";
const serverPort = process.env.HYDRIA_POSTGRES_SMOKE_PORT ?? "18081";
const baseUrl = `http://127.0.0.1:${serverPort}`;

process.env.OPENROUTER_API_KEY ??= "ci-placeholder";
process.env.WEB_ORIGIN ??= `http://localhost:${serverPort}`;
process.env.LOCAL_MODEL_PROVIDER ??= "ollama";
process.env.LOCAL_MODEL_NAME ??= "ci-missing-model";
process.env.LOCAL_MODEL_BASE_URL ??= "http://127.0.0.1:65535";
process.env.LOCAL_MODEL_TIMEOUT_MS ??= "1000";
process.env.LOCAL_MODEL_OBSERVER_ENABLED ??= "false";
process.env.LOCAL_STUDENT_FALLBACK_MODEL ??= "openai/gpt-5.4-mini";

let serverProcess: ChildProcess | null = null;

try {
  if (smokeSchema === "public") {
    throw new Error("Refusing to run PostgreSQL smoke against schema 'public'.");
  }

  const { migrateSqliteToPostgres } = await import("./migrateSqliteToPostgres.js");

  console.log(`Waiting for PostgreSQL at ${postgresUrl}`);
  await waitForPostgresAndResetSchema();

  console.log("Running PostgreSQL adapter integration test");
  await runCommand(process.execPath, [tsxCliPath, "--test", "src/tests/persistenceAdapter.test.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      TEST_POSTGRES_URL: postgresUrl
    }
  });

  console.log(`Migrating SQLite source into PostgreSQL schema ${smokeSchema}`);
  const migrationReport = await migrateSqliteToPostgres({
    postgresUrl,
    postgresSchema: smokeSchema
  });
  console.log(JSON.stringify(migrationReport, null, 2));

  console.log("Verifying migrated PostgreSQL counts");
  await verifyCounts(migrationReport);

  console.log(`Starting Hydria server on ${baseUrl} with PostgreSQL persistence`);
  serverProcess = spawn(process.execPath, [tsxCliPath, "src/index.ts"], {
    cwd: serverRoot,
    env: cleanEnv({
      ...process.env,
      SERVER_PORT: serverPort,
      PERSISTENCE_ADAPTER: "postgres",
      POSTGRES_URL: postgresUrl,
      POSTGRES_SCHEMA: smokeSchema
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  console.log("Checking Hydria PostgreSQL health");
  await checkServerHealth(migrationReport);

  console.log(
    "PostgreSQL smoke passed: adapter integration, migration parity, and server health are healthy."
  );
} finally {
  if (serverProcess) {
    serverProcess.kill();
    await waitForProcessExit(serverProcess).catch(() => undefined);
  }

  if (!keepSchema) {
    await dropSchema().catch(() => undefined);
  }
}

async function waitForPostgresAndResetSchema() {
  const pool = new Pool({ connectionString: postgresUrl });
  const deadline = Date.now() + 60_000;

  try {
    while (Date.now() < deadline) {
      try {
        await pool.query("SELECT 1");
        await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(smokeSchema)} CASCADE`);
        return;
      } catch {
        await delay(1000);
      }
    }

    throw new Error("Timed out waiting for PostgreSQL.");
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function verifyCounts(report: MigrationReport) {
  const pool = new Pool({ connectionString: postgresUrl });
  const tables = {
    arenaRounds: "arena_rounds",
    studentSessions: "student_sessions",
    skills: "skills",
    toolManifests: "tool_manifests",
    specializedAgents: "specialized_agents",
    localModelVariants: "local_model_variants"
  } as const;
  const failures: string[] = [];

  try {
    for (const [key, table] of Object.entries(tables)) {
      const result = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(smokeSchema)}.${quoteIdentifier(table)}`
      );
      const actual = result.rows[0]?.count ?? 0;
      const expected = report.counts[key as keyof MigrationReport["counts"]];
      if (actual !== expected) {
        failures.push(`${table}: expected ${expected}, got ${actual}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function checkServerHealth(report: MigrationReport) {
  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health/persistence`);
      if (response.ok) {
        const health = await response.json();
        const failures = validateHealth(health, report);
        if (failures.length === 0) {
          return;
        }
        throw new Error(failures.join("\n"));
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(1000);
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for Hydria health.");
}

function validateHealth(health: any, report: MigrationReport) {
  const failures: string[] = [];
  if (health.status !== "ok") {
    failures.push(`expected persistence status ok, got ${health.status}`);
  }
  if (health.database?.adapter !== "postgres") {
    failures.push(`expected adapter postgres, got ${health.database?.adapter ?? "(missing)"}`);
  }
  if (health.database?.postgresSchema !== smokeSchema) {
    failures.push(`expected schema ${smokeSchema}, got ${health.database?.postgresSchema}`);
  }
  if (health.database?.arenaRoundCount !== report.counts.arenaRounds) {
    failures.push("arena round count mismatch in health response");
  }
  if (health.database?.studentSessionCount !== report.counts.studentSessions) {
    failures.push("student session count mismatch in health response");
  }
  return failures;
}

async function dropSchema() {
  const pool = new Pool({ connectionString: postgresUrl });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(smokeSchema)} CASCADE`);
  } finally {
    await pool.end();
  }
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: cleanEnv(options.env),
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

function cleanEnv(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        !entry[0].includes("=") && typeof entry[1] === "string"
    )
  );
}

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
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

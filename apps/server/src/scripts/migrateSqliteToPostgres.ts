import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { env } from "../utils/env.js";
import { HydriaStateDatabase } from "../services/storage/hydriaStateDatabase.js";
import { PostgresPersistenceAdapter } from "../services/storage/postgresPersistenceAdapter.js";
import { normalizeArenaHistoryFile } from "../services/storage/arenaHistoryNormalizer.js";
import { normalizeStudentSessionHistoryFile } from "../services/storage/studentSessionHistoryNormalizer.js";

export type SqliteToPostgresMigrationOptions = {
  sqliteFile?: string;
  postgresUrl?: string;
  postgresSchema?: string;
  dryRun?: boolean;
};

export type SqliteToPostgresMigrationReport = {
  sqliteFile: string;
  postgresSchema: string;
  dryRun: boolean;
  counts: {
    arenaRounds: number;
    studentSessions: number;
    skills: number;
    toolManifests: number;
    specializedAgents: number;
    localModelVariants: number;
  };
};

export async function migrateSqliteToPostgres(
  options: SqliteToPostgresMigrationOptions = {}
): Promise<SqliteToPostgresMigrationReport> {
  const sqliteFile = options.sqliteFile ?? env.PERSISTENCE_DB_FILE;
  const postgresUrl = options.postgresUrl ?? env.POSTGRES_URL;
  const postgresSchema = options.postgresSchema ?? env.POSTGRES_SCHEMA;
  const dryRun = options.dryRun ?? false;

  if (!postgresUrl.trim() && !dryRun) {
    throw new Error("POSTGRES_URL is required for SQLite to PostgreSQL migration.");
  }

  const sqlite = new HydriaStateDatabase(sqliteFile);
  const postgres = new PostgresPersistenceAdapter({
    connectionString: postgresUrl,
    schema: postgresSchema
  });

  try {
    await sqlite.ensureReady();
    if (sqliteFile === env.PERSISTENCE_DB_FILE) {
      await backfillSqliteFromProjectionFiles(sqlite);
    }

    const [arenaRounds, studentSessions, skills, toolManifests, specializedAgents, localModelVariants] =
      await Promise.all([
        sqlite.listArenaRounds(),
        sqlite.listStudentSessions(),
        sqlite.listSkills(),
        sqlite.listToolManifests(),
        sqlite.listSpecializedAgents(),
        sqlite.listLocalModelVariants()
      ]);

    const report: SqliteToPostgresMigrationReport = {
      sqliteFile,
      postgresSchema,
      dryRun,
      counts: {
        arenaRounds: arenaRounds.length,
        studentSessions: studentSessions.length,
        skills: skills.length,
        toolManifests: toolManifests.length,
        specializedAgents: specializedAgents.length,
        localModelVariants: localModelVariants.length
      }
    };

    if (dryRun) {
      return report;
    }

    await postgres.ensureReady();
    await postgres.replaceArenaRounds(arenaRounds);
    await postgres.replaceStudentSessions(studentSessions);

    for (const skill of skills) {
      await postgres.upsertSkill(skill);
    }
    for (const manifest of toolManifests) {
      await postgres.upsertToolManifest(manifest);
    }
    for (const agent of specializedAgents) {
      await postgres.upsertSpecializedAgent(agent);
    }
    for (const variant of localModelVariants) {
      await postgres.upsertLocalModelVariant(variant);
    }

    return report;
  } finally {
    sqlite.close();
    postgres.close();
  }
}

function parseCliOptions(argv: string[]): SqliteToPostgresMigrationOptions {
  return {
    sqliteFile: readOption(argv, "--sqlite"),
    postgresUrl: readOption(argv, "--postgres"),
    postgresSchema: readOption(argv, "--schema"),
    dryRun: argv.includes("--dry-run")
  };
}

async function backfillSqliteFromProjectionFiles(sqlite: HydriaStateDatabase) {
  const [existingRounds, existingSessions] = await Promise.all([
    sqlite.listArenaRounds(),
    sqlite.listStudentSessions()
  ]);

  if (existingRounds.length === 0) {
    const rawHistory = await readOptionalFile(env.HISTORY_FILE);
    if (rawHistory) {
      const normalized = normalizeArenaHistoryFile(rawHistory);
      if (normalized.rounds.length > 0) {
        await sqlite.replaceArenaRounds(normalized.rounds);
      }
    }
  }

  if (existingSessions.length === 0) {
    const rawSessions = await readOptionalFile(env.STUDENT_SESSION_HISTORY_FILE);
    if (rawSessions) {
      const normalized = normalizeStudentSessionHistoryFile(rawSessions);
      if (normalized.history.sessions.length > 0) {
        await sqlite.replaceStudentSessions(normalized.history.sessions);
      }
    }
  }
}

async function readOptionalFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function readOption(argv: string[], flag: string) {
  const direct = argv.find((entry) => entry.startsWith(`${flag}=`));
  if (direct) {
    return direct.slice(flag.length + 1);
  }

  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateSqliteToPostgres(parseCliOptions(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

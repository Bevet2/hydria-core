import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StudentSession } from "../../types/student.js";
import { env } from "../../utils/env.js";
import { createPersistenceAdapter } from "./persistenceAdapter.js";
import { normalizeStudentSessionHistoryFile } from "./studentSessionHistoryNormalizer.js";

type StudentSessionPersistenceOptions = {
  historyFile?: string;
  databaseFile?: string;
  rewriteProjection?: boolean;
};

export async function listPersistedStudentSessions(
  options: StudentSessionPersistenceOptions = {}
) {
  const historyFile = options.historyFile ?? env.STUDENT_SESSION_HISTORY_FILE;
  const databaseFile = options.databaseFile ?? env.PERSISTENCE_DB_FILE;
  const database = createPersistenceAdapter({ sqliteFile: databaseFile });

  try {
    await mkdir(dirname(historyFile), { recursive: true });
    await database.ensureReady();

    let importedFromLegacy = false;
    if ((await database.countStudentSessions()) === 0) {
      const legacySessions = await readLegacyStudentSessions(historyFile);
      if (legacySessions.length > 0) {
        await database.replaceStudentSessions(legacySessions);
        importedFromLegacy = true;
      }
    }

    const sessions = await database.listStudentSessions();
    if (importedFromLegacy || options.rewriteProjection) {
      await writeStudentSessionProjection(historyFile, sessions);
    }

    return sessions;
  } finally {
    database.close();
  }
}

async function readLegacyStudentSessions(historyFile: string) {
  try {
    const raw = await readFile(historyFile, "utf8");
    const normalized = normalizeStudentSessionHistoryFile(raw);

    if (normalized.needsRewrite) {
      await writeFile(historyFile, normalized.serialized, "utf8");
    }

    return normalized.history.sessions;
  } catch {
    return [] as StudentSession[];
  }
}

async function writeStudentSessionProjection(historyFile: string, sessions: StudentSession[]) {
  await writeFile(
    historyFile,
    `${JSON.stringify({ sessions }, null, 2)}\n`,
    "utf8"
  );
}

export type { StudentSessionPersistenceOptions };

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { arenaRoundSchema, type ArenaRound } from "../../types/arena.js";
import { studentSessionSchema, type StudentSession } from "../../types/student.js";
import { env } from "../../utils/env.js";

type PersistedPayloadRow = {
  payload: string;
};

export class HydriaStateDatabase {
  private db: DatabaseSync | null = null;

  constructor(private readonly filePath = env.PERSISTENCE_DB_FILE) {}

  async ensureReady() {
    if (this.db) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });

    const db = new DatabaseSync(this.filePath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS arena_rounds (
        round_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_arena_rounds_created_at
        ON arena_rounds (created_at DESC);

      CREATE TABLE IF NOT EXISTS student_sessions (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_student_sessions_created_at
        ON student_sessions (created_at DESC);
    `);

    this.db = db;
  }

  async countArenaRounds() {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare("SELECT COUNT(*) AS count FROM arena_rounds")
      .get() as { count: number };
    return row.count;
  }

  async countStudentSessions() {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare("SELECT COUNT(*) AS count FROM student_sessions")
      .get() as { count: number };
    return row.count;
  }

  async listArenaRounds() {
    await this.ensureReady();
    const rows = this.getDatabase()
      .prepare("SELECT payload FROM arena_rounds ORDER BY created_at DESC")
      .all() as PersistedPayloadRow[];
    return rows.map((row) => arenaRoundSchema.parse(JSON.parse(row.payload)));
  }

  async getArenaRound(roundId: string) {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare("SELECT payload FROM arena_rounds WHERE round_id = ?")
      .get(roundId) as PersistedPayloadRow | undefined;
    return row ? arenaRoundSchema.parse(JSON.parse(row.payload)) : null;
  }

  async appendArenaRound(round: ArenaRound) {
    await this.ensureReady();
    const parsed = arenaRoundSchema.parse(round);
    this.getDatabase()
      .prepare(
        `
          INSERT OR REPLACE INTO arena_rounds (round_id, created_at, payload)
          VALUES (?, ?, ?)
        `
      )
      .run(parsed.roundId, parsed.createdAt, JSON.stringify(parsed));
  }

  async replaceArenaRounds(rounds: ArenaRound[]) {
    await this.ensureReady();
    const parsedRounds = rounds.map((round) => arenaRoundSchema.parse(round));
    const database = this.getDatabase();
    try {
      database.exec("BEGIN IMMEDIATE TRANSACTION");
      database.exec("DELETE FROM arena_rounds");
      const statement = database.prepare(
        `
          INSERT INTO arena_rounds (round_id, created_at, payload)
          VALUES (?, ?, ?)
        `
      );
      for (const item of parsedRounds) {
        statement.run(item.roundId, item.createdAt, JSON.stringify(item));
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  async listStudentSessions() {
    await this.ensureReady();
    const rows = this.getDatabase()
      .prepare("SELECT payload FROM student_sessions ORDER BY created_at DESC")
      .all() as PersistedPayloadRow[];
    return rows.map((row) => studentSessionSchema.parse(JSON.parse(row.payload)));
  }

  async getStudentSession(sessionId: string) {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare("SELECT payload FROM student_sessions WHERE session_id = ?")
      .get(sessionId) as PersistedPayloadRow | undefined;
    return row ? studentSessionSchema.parse(JSON.parse(row.payload)) : null;
  }

  async appendStudentSession(session: StudentSession) {
    await this.ensureReady();
    const parsed = studentSessionSchema.parse(session);
    this.getDatabase()
      .prepare(
        `
          INSERT OR REPLACE INTO student_sessions (session_id, created_at, payload)
          VALUES (?, ?, ?)
        `
      )
      .run(parsed.sessionId, parsed.createdAt, JSON.stringify(parsed));
  }

  async replaceStudentSessions(sessions: StudentSession[]) {
    await this.ensureReady();
    const parsedSessions = sessions.map((session) => studentSessionSchema.parse(session));
    const database = this.getDatabase();
    try {
      database.exec("BEGIN IMMEDIATE TRANSACTION");
      database.exec("DELETE FROM student_sessions");
      const statement = database.prepare(
        `
          INSERT INTO student_sessions (session_id, created_at, payload)
          VALUES (?, ?, ?)
        `
      );
      for (const item of parsedSessions) {
        statement.run(item.sessionId, item.createdAt, JSON.stringify(item));
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = null;
  }

  private getDatabase() {
    if (!this.db) {
      throw new Error("HydriaStateDatabase used before ensureReady().");
    }

    return this.db;
  }
}

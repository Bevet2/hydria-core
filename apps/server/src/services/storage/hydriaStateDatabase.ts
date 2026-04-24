import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { arenaRoundSchema, type ArenaRound } from "../../types/arena.js";
import {
  specializedAgentDefinitionSchema,
  type AgentState,
  type SpecializedAgentDefinition
} from "../../types/agents.js";
import {
  skillDefinitionSchema,
  type SkillDefinition,
  type SkillState
} from "../../types/skills.js";
import {
  toolManifestSchema,
  type ToolManifest,
  type ToolState
} from "../../types/tools.js";
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

      CREATE TABLE IF NOT EXISTS skills (
        skill_id TEXT PRIMARY KEY,
        intent TEXT NOT NULL,
        state TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        usage_count INTEGER NOT NULL,
        last_used_at TEXT NULL,
        created_at TEXT NOT NULL,
        version TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_skills_intent_state
        ON skills (intent, state);

      CREATE INDEX IF NOT EXISTS idx_skills_confidence
        ON skills (confidence_score DESC);

      CREATE TABLE IF NOT EXISTS tool_manifests (
        tool_id TEXT PRIMARY KEY,
        intent TEXT NOT NULL,
        state TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_manifests_intent_state
        ON tool_manifests (intent, state);

      CREATE INDEX IF NOT EXISTS idx_tool_manifests_risk_confidence
        ON tool_manifests (risk_level, confidence_score DESC);

      CREATE TABLE IF NOT EXISTS specialized_agents (
        agent_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        state TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        intent_index TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_specialized_agents_domain_state
        ON specialized_agents (domain, state);

      CREATE INDEX IF NOT EXISTS idx_specialized_agents_confidence
        ON specialized_agents (confidence_score DESC);
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

  async listSkills(states?: SkillState[]) {
    await this.ensureReady();
    const database = this.getDatabase();
    const rows =
      states && states.length > 0
        ? (database
            .prepare(
              `SELECT payload FROM skills
               WHERE state IN (${states.map(() => "?").join(",")})
               ORDER BY confidence_score DESC, usage_count DESC, created_at DESC`
            )
            .all(...states) as PersistedPayloadRow[])
        : (database
            .prepare(
              "SELECT payload FROM skills ORDER BY confidence_score DESC, usage_count DESC, created_at DESC"
            )
            .all() as PersistedPayloadRow[]);

    return rows.map((row) => skillDefinitionSchema.parse(JSON.parse(row.payload)));
  }

  async findSkillsByIntent(intent: string, states?: SkillState[]) {
    await this.ensureReady();
    const database = this.getDatabase();
    const rows =
      states && states.length > 0
        ? (database
            .prepare(
              `SELECT payload FROM skills
               WHERE intent = ? AND state IN (${states.map(() => "?").join(",")})
               ORDER BY confidence_score DESC, usage_count DESC, created_at DESC`
            )
            .all(intent, ...states) as PersistedPayloadRow[])
        : (database
            .prepare(
              "SELECT payload FROM skills WHERE intent = ? ORDER BY confidence_score DESC, usage_count DESC, created_at DESC"
            )
            .all(intent) as PersistedPayloadRow[]);

    return rows.map((row) => skillDefinitionSchema.parse(JSON.parse(row.payload)));
  }

  async getSkill(skillId: string) {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare("SELECT payload FROM skills WHERE skill_id = ?")
      .get(skillId) as PersistedPayloadRow | undefined;
    return row ? skillDefinitionSchema.parse(JSON.parse(row.payload)) : null;
  }

  async upsertSkill(skill: SkillDefinition) {
    await this.ensureReady();
    const parsed = skillDefinitionSchema.parse(skill);
    this.getDatabase()
      .prepare(
        `
          INSERT OR REPLACE INTO skills (
            skill_id,
            intent,
            state,
            confidence_score,
            usage_count,
            last_used_at,
            created_at,
            version,
            payload
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        parsed.id,
        parsed.intent,
        parsed.state,
        parsed.confidenceScore,
        parsed.usageCount,
        parsed.lastUsedAt,
        parsed.createdAt,
        parsed.version,
        JSON.stringify(parsed)
      );
  }

  async updateSkillState(skillId: string, state: SkillState) {
    const current = await this.getSkill(skillId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      state
    } satisfies SkillDefinition;
    await this.upsertSkill(updated);
    return updated;
  }

  async incrementSkillUsage(skillId: string, usedAt = new Date().toISOString()) {
    const current = await this.getSkill(skillId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      usageCount: current.usageCount + 1,
      lastUsedAt: usedAt
    } satisfies SkillDefinition;
    await this.upsertSkill(updated);
    return updated;
  }

  async archiveSkill(skillId: string) {
    return this.updateSkillState(skillId, "archived");
  }

  async listToolManifests(states?: ToolState[]) {
    await this.ensureReady();
    const database = this.getDatabase();
    const rows =
      states && states.length > 0
        ? (database
            .prepare(
              `SELECT payload FROM tool_manifests
               WHERE state IN (${states.map(() => "?").join(",")})
               ORDER BY confidence_score DESC, updated_at DESC`
            )
            .all(...states) as PersistedPayloadRow[])
        : (database
            .prepare(
              "SELECT payload FROM tool_manifests ORDER BY confidence_score DESC, updated_at DESC"
            )
            .all() as PersistedPayloadRow[]);

    return rows.map((row) => toolManifestSchema.parse(JSON.parse(row.payload)));
  }

  async findToolManifestsByIntent(intent: string, states?: ToolState[]) {
    await this.ensureReady();
    const database = this.getDatabase();
    const rows =
      states && states.length > 0
        ? (database
            .prepare(
              `SELECT payload FROM tool_manifests
               WHERE intent = ? AND state IN (${states.map(() => "?").join(",")})
               ORDER BY confidence_score DESC, updated_at DESC`
            )
            .all(intent, ...states) as PersistedPayloadRow[])
        : (database
            .prepare(
              "SELECT payload FROM tool_manifests WHERE intent = ? ORDER BY confidence_score DESC, updated_at DESC"
            )
            .all(intent) as PersistedPayloadRow[]);

    return rows.map((row) => toolManifestSchema.parse(JSON.parse(row.payload)));
  }

  async getToolManifest(toolId: string) {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare("SELECT payload FROM tool_manifests WHERE tool_id = ?")
      .get(toolId) as PersistedPayloadRow | undefined;
    return row ? toolManifestSchema.parse(JSON.parse(row.payload)) : null;
  }

  async upsertToolManifest(manifest: ToolManifest) {
    await this.ensureReady();
    const parsed = toolManifestSchema.parse(manifest);
    this.getDatabase()
      .prepare(
        `
          INSERT OR REPLACE INTO tool_manifests (
            tool_id,
            intent,
            state,
            risk_level,
            confidence_score,
            updated_at,
            created_at,
            payload
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        parsed.id,
        parsed.intent,
        parsed.state,
        parsed.riskLevel,
        parsed.confidenceScore,
        parsed.updatedAt,
        parsed.createdAt,
        JSON.stringify(parsed)
      );
  }

  async updateToolManifestState(toolId: string, state: ToolState) {
    const current = await this.getToolManifest(toolId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      state,
      updatedAt: new Date().toISOString()
    } satisfies ToolManifest;
    await this.upsertToolManifest(updated);
    return updated;
  }

  async listSpecializedAgents(states?: AgentState[]) {
    await this.ensureReady();
    const database = this.getDatabase();
    const rows =
      states && states.length > 0
        ? (database
            .prepare(
              `SELECT payload FROM specialized_agents
               WHERE state IN (${states.map(() => "?").join(",")})
               ORDER BY confidence_score DESC, updated_at DESC`
            )
            .all(...states) as PersistedPayloadRow[])
        : (database
            .prepare(
              "SELECT payload FROM specialized_agents ORDER BY confidence_score DESC, updated_at DESC"
            )
            .all() as PersistedPayloadRow[]);

    return rows.map((row) => specializedAgentDefinitionSchema.parse(JSON.parse(row.payload)));
  }

  async findSpecializedAgentsByIntent(intent: string, states?: AgentState[]) {
    await this.ensureReady();
    const database = this.getDatabase();
    const token = `%|${intent.toLowerCase()}|%`;
    const rows =
      states && states.length > 0
        ? (database
            .prepare(
              `SELECT payload FROM specialized_agents
               WHERE intent_index LIKE ? AND state IN (${states.map(() => "?").join(",")})
               ORDER BY confidence_score DESC, updated_at DESC`
            )
            .all(token, ...states) as PersistedPayloadRow[])
        : (database
            .prepare(
              "SELECT payload FROM specialized_agents WHERE intent_index LIKE ? ORDER BY confidence_score DESC, updated_at DESC"
            )
            .all(token) as PersistedPayloadRow[]);

    return rows.map((row) => specializedAgentDefinitionSchema.parse(JSON.parse(row.payload)));
  }

  async findSpecializedAgentsByDomain(domain: string, states?: AgentState[]) {
    await this.ensureReady();
    const database = this.getDatabase();
    const rows =
      states && states.length > 0
        ? (database
            .prepare(
              `SELECT payload FROM specialized_agents
               WHERE domain = ? AND state IN (${states.map(() => "?").join(",")})
               ORDER BY confidence_score DESC, updated_at DESC`
            )
            .all(domain, ...states) as PersistedPayloadRow[])
        : (database
            .prepare(
              "SELECT payload FROM specialized_agents WHERE domain = ? ORDER BY confidence_score DESC, updated_at DESC"
            )
            .all(domain) as PersistedPayloadRow[]);

    return rows.map((row) => specializedAgentDefinitionSchema.parse(JSON.parse(row.payload)));
  }

  async getSpecializedAgent(agentId: string) {
    await this.ensureReady();
    const row = this.getDatabase()
      .prepare("SELECT payload FROM specialized_agents WHERE agent_id = ?")
      .get(agentId) as PersistedPayloadRow | undefined;
    return row ? specializedAgentDefinitionSchema.parse(JSON.parse(row.payload)) : null;
  }

  async upsertSpecializedAgent(agent: SpecializedAgentDefinition) {
    await this.ensureReady();
    const parsed = specializedAgentDefinitionSchema.parse(agent);
    const intentIndex = `|${parsed.allowedIntents.map((intent) => intent.toLowerCase()).join("|")}|`;
    this.getDatabase()
      .prepare(
        `
          INSERT OR REPLACE INTO specialized_agents (
            agent_id,
            domain,
            state,
            confidence_score,
            intent_index,
            updated_at,
            created_at,
            payload
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        parsed.id,
        parsed.domain,
        parsed.state,
        parsed.confidenceScore,
        intentIndex,
        parsed.updatedAt,
        parsed.createdAt,
        JSON.stringify(parsed)
      );
  }

  async updateSpecializedAgentState(agentId: string, state: AgentState) {
    const current = await this.getSpecializedAgent(agentId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      state,
      updatedAt: new Date().toISOString()
    } satisfies SpecializedAgentDefinition;
    await this.upsertSpecializedAgent(updated);
    return updated;
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

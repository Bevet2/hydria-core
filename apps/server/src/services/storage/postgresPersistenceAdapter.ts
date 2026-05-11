import pg, { type Pool, type PoolClient } from "pg";
import type { SpecializedAgentDefinition, AgentState } from "../../types/agents.js";
import { specializedAgentDefinitionSchema } from "../../types/agents.js";
import type { ArenaRound } from "../../types/arena.js";
import { arenaRoundSchema } from "../../types/arena.js";
import type { SkillDefinition, SkillState } from "../../types/skills.js";
import { skillDefinitionSchema } from "../../types/skills.js";
import type { StudentSession } from "../../types/student.js";
import { studentSessionSchema } from "../../types/student.js";
import type {
  LocalStudentModelVariant,
  LocalStudentVariantState
} from "../../types/training.js";
import { localStudentModelVariantSchema } from "../../types/training.js";
import type { ToolManifest, ToolState } from "../../types/tools.js";
import { toolManifestSchema } from "../../types/tools.js";
import type { PersistenceAdapter } from "./persistenceAdapter.js";

const { Pool: PgPool } = pg;

type PayloadRow = {
  payload: unknown;
};

type CountRow = {
  count: string;
};

type PayloadSchema<T> = {
  parse(input: unknown): T;
};

export type PostgresPersistenceAdapterOptions = {
  connectionString: string;
  schema?: string;
  pool?: Pool;
};

export class PostgresPersistenceAdapter implements PersistenceAdapter {
  private pool: Pool | null;
  private readonly ownsPool: boolean;
  private readonly schemaSql: string;
  private ready = false;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly options: PostgresPersistenceAdapterOptions) {
    this.pool = options.pool ?? null;
    this.ownsPool = !options.pool;
    this.schemaSql = quoteIdentifier(options.schema ?? "public");
  }

  async ensureReady() {
    if (this.ready) {
      return;
    }

    this.readyPromise ??= this.initialize();
    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      throw error;
    }
  }

  async countArenaRounds() {
    await this.ensureReady();
    const result = await this.getPool().query<CountRow>(
      `SELECT COUNT(*) AS count FROM ${this.table("arena_rounds")}`
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async countStudentSessions() {
    await this.ensureReady();
    const result = await this.getPool().query<CountRow>(
      `SELECT COUNT(*) AS count FROM ${this.table("student_sessions")}`
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listSkills(states?: SkillState[]) {
    const rows =
      states && states.length > 0
        ? await this.selectPayloads<SkillDefinition>(
            `SELECT payload FROM ${this.table("skills")}
             WHERE state = ANY($1::text[])
             ORDER BY confidence_score DESC, usage_count DESC, created_at DESC`,
            [states],
            skillDefinitionSchema
          )
        : await this.selectPayloads<SkillDefinition>(
            `SELECT payload FROM ${this.table("skills")}
             ORDER BY confidence_score DESC, usage_count DESC, created_at DESC`,
            [],
            skillDefinitionSchema
          );
    return rows;
  }

  async findSkillsByIntent(intent: string, states?: SkillState[]) {
    return states && states.length > 0
      ? this.selectPayloads<SkillDefinition>(
          `SELECT payload FROM ${this.table("skills")}
           WHERE intent = $1 AND state = ANY($2::text[])
           ORDER BY confidence_score DESC, usage_count DESC, created_at DESC`,
          [intent, states],
          skillDefinitionSchema
        )
      : this.selectPayloads<SkillDefinition>(
          `SELECT payload FROM ${this.table("skills")}
           WHERE intent = $1
           ORDER BY confidence_score DESC, usage_count DESC, created_at DESC`,
          [intent],
          skillDefinitionSchema
        );
  }

  async getSkill(skillId: string) {
    const rows = await this.selectPayloads<SkillDefinition>(
      `SELECT payload FROM ${this.table("skills")} WHERE skill_id = $1`,
      [skillId],
      skillDefinitionSchema
    );
    return rows[0] ?? null;
  }

  async upsertSkill(skill: SkillDefinition) {
    await this.ensureReady();
    const parsed = skillDefinitionSchema.parse(skill);
    await this.getPool().query(
      `
        INSERT INTO ${this.table("skills")} (
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (skill_id) DO UPDATE SET
          intent = EXCLUDED.intent,
          state = EXCLUDED.state,
          confidence_score = EXCLUDED.confidence_score,
          usage_count = EXCLUDED.usage_count,
          last_used_at = EXCLUDED.last_used_at,
          created_at = EXCLUDED.created_at,
          version = EXCLUDED.version,
          payload = EXCLUDED.payload
      `,
      [
        parsed.id,
        parsed.intent,
        parsed.state,
        parsed.confidenceScore,
        parsed.usageCount,
        parsed.lastUsedAt,
        parsed.createdAt,
        parsed.version,
        JSON.stringify(parsed)
      ]
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
    return states && states.length > 0
      ? this.selectPayloads<ToolManifest>(
          `SELECT payload FROM ${this.table("tool_manifests")}
           WHERE state = ANY($1::text[])
           ORDER BY confidence_score DESC, updated_at DESC`,
          [states],
          toolManifestSchema
        )
      : this.selectPayloads<ToolManifest>(
          `SELECT payload FROM ${this.table("tool_manifests")}
           ORDER BY confidence_score DESC, updated_at DESC`,
          [],
          toolManifestSchema
        );
  }

  async findToolManifestsByIntent(intent: string, states?: ToolState[]) {
    return states && states.length > 0
      ? this.selectPayloads<ToolManifest>(
          `SELECT payload FROM ${this.table("tool_manifests")}
           WHERE intent = $1 AND state = ANY($2::text[])
           ORDER BY confidence_score DESC, updated_at DESC`,
          [intent, states],
          toolManifestSchema
        )
      : this.selectPayloads<ToolManifest>(
          `SELECT payload FROM ${this.table("tool_manifests")}
           WHERE intent = $1
           ORDER BY confidence_score DESC, updated_at DESC`,
          [intent],
          toolManifestSchema
        );
  }

  async getToolManifest(toolId: string) {
    const rows = await this.selectPayloads<ToolManifest>(
      `SELECT payload FROM ${this.table("tool_manifests")} WHERE tool_id = $1`,
      [toolId],
      toolManifestSchema
    );
    return rows[0] ?? null;
  }

  async upsertToolManifest(manifest: ToolManifest) {
    await this.ensureReady();
    const parsed = toolManifestSchema.parse(manifest);
    await this.getPool().query(
      `
        INSERT INTO ${this.table("tool_manifests")} (
          tool_id,
          intent,
          state,
          risk_level,
          confidence_score,
          updated_at,
          created_at,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (tool_id) DO UPDATE SET
          intent = EXCLUDED.intent,
          state = EXCLUDED.state,
          risk_level = EXCLUDED.risk_level,
          confidence_score = EXCLUDED.confidence_score,
          updated_at = EXCLUDED.updated_at,
          created_at = EXCLUDED.created_at,
          payload = EXCLUDED.payload
      `,
      [
        parsed.id,
        parsed.intent,
        parsed.state,
        parsed.riskLevel,
        parsed.confidenceScore,
        parsed.updatedAt,
        parsed.createdAt,
        JSON.stringify(parsed)
      ]
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
    return states && states.length > 0
      ? this.selectPayloads<SpecializedAgentDefinition>(
          `SELECT payload FROM ${this.table("specialized_agents")}
           WHERE state = ANY($1::text[])
           ORDER BY confidence_score DESC, updated_at DESC`,
          [states],
          specializedAgentDefinitionSchema
        )
      : this.selectPayloads<SpecializedAgentDefinition>(
          `SELECT payload FROM ${this.table("specialized_agents")}
           ORDER BY confidence_score DESC, updated_at DESC`,
          [],
          specializedAgentDefinitionSchema
        );
  }

  async findSpecializedAgentsByIntent(intent: string, states?: AgentState[]) {
    const token = `%|${intent.toLowerCase()}|%`;
    return states && states.length > 0
      ? this.selectPayloads<SpecializedAgentDefinition>(
          `SELECT payload FROM ${this.table("specialized_agents")}
           WHERE intent_index LIKE $1 AND state = ANY($2::text[])
           ORDER BY confidence_score DESC, updated_at DESC`,
          [token, states],
          specializedAgentDefinitionSchema
        )
      : this.selectPayloads<SpecializedAgentDefinition>(
          `SELECT payload FROM ${this.table("specialized_agents")}
           WHERE intent_index LIKE $1
           ORDER BY confidence_score DESC, updated_at DESC`,
          [token],
          specializedAgentDefinitionSchema
        );
  }

  async findSpecializedAgentsByDomain(domain: string, states?: AgentState[]) {
    return states && states.length > 0
      ? this.selectPayloads<SpecializedAgentDefinition>(
          `SELECT payload FROM ${this.table("specialized_agents")}
           WHERE domain = $1 AND state = ANY($2::text[])
           ORDER BY confidence_score DESC, updated_at DESC`,
          [domain, states],
          specializedAgentDefinitionSchema
        )
      : this.selectPayloads<SpecializedAgentDefinition>(
          `SELECT payload FROM ${this.table("specialized_agents")}
           WHERE domain = $1
           ORDER BY confidence_score DESC, updated_at DESC`,
          [domain],
          specializedAgentDefinitionSchema
        );
  }

  async getSpecializedAgent(agentId: string) {
    const rows = await this.selectPayloads<SpecializedAgentDefinition>(
      `SELECT payload FROM ${this.table("specialized_agents")} WHERE agent_id = $1`,
      [agentId],
      specializedAgentDefinitionSchema
    );
    return rows[0] ?? null;
  }

  async upsertSpecializedAgent(agent: SpecializedAgentDefinition) {
    await this.ensureReady();
    const parsed = specializedAgentDefinitionSchema.parse(agent);
    const intentIndex = `|${parsed.allowedIntents.map((intent) => intent.toLowerCase()).join("|")}|`;
    await this.getPool().query(
      `
        INSERT INTO ${this.table("specialized_agents")} (
          agent_id,
          domain,
          state,
          confidence_score,
          intent_index,
          updated_at,
          created_at,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (agent_id) DO UPDATE SET
          domain = EXCLUDED.domain,
          state = EXCLUDED.state,
          confidence_score = EXCLUDED.confidence_score,
          intent_index = EXCLUDED.intent_index,
          updated_at = EXCLUDED.updated_at,
          created_at = EXCLUDED.created_at,
          payload = EXCLUDED.payload
      `,
      [
        parsed.id,
        parsed.domain,
        parsed.state,
        parsed.confidenceScore,
        intentIndex,
        parsed.updatedAt,
        parsed.createdAt,
        JSON.stringify(parsed)
      ]
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

  async listLocalModelVariants(states?: LocalStudentVariantState[]) {
    return states && states.length > 0
      ? this.selectPayloads<LocalStudentModelVariant>(
          `SELECT payload FROM ${this.table("local_model_variants")}
           WHERE state = ANY($1::text[])
           ORDER BY confidence_score DESC, updated_at DESC`,
          [states],
          localStudentModelVariantSchema
        )
      : this.selectPayloads<LocalStudentModelVariant>(
          `SELECT payload FROM ${this.table("local_model_variants")}
           ORDER BY confidence_score DESC, updated_at DESC`,
          [],
          localStudentModelVariantSchema
        );
  }

  async getLocalModelVariant(variantId: string) {
    const rows = await this.selectPayloads<LocalStudentModelVariant>(
      `SELECT payload FROM ${this.table("local_model_variants")} WHERE variant_id = $1`,
      [variantId],
      localStudentModelVariantSchema
    );
    return rows[0] ?? null;
  }

  async upsertLocalModelVariant(variant: LocalStudentModelVariant) {
    await this.ensureReady();
    const parsed = localStudentModelVariantSchema.parse(variant);
    await this.getPool().query(
      `
        INSERT INTO ${this.table("local_model_variants")} (
          variant_id,
          state,
          confidence_score,
          served_model_name,
          updated_at,
          created_at,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (variant_id) DO UPDATE SET
          state = EXCLUDED.state,
          confidence_score = EXCLUDED.confidence_score,
          served_model_name = EXCLUDED.served_model_name,
          updated_at = EXCLUDED.updated_at,
          created_at = EXCLUDED.created_at,
          payload = EXCLUDED.payload
      `,
      [
        parsed.id,
        parsed.state,
        parsed.confidenceScore,
        parsed.servedModelName,
        parsed.updatedAt,
        parsed.createdAt,
        JSON.stringify(parsed)
      ]
    );
  }

  async updateLocalModelVariantState(variantId: string, state: LocalStudentVariantState) {
    const current = await this.getLocalModelVariant(variantId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      state,
      updatedAt: new Date().toISOString()
    } satisfies LocalStudentModelVariant;
    await this.upsertLocalModelVariant(updated);
    return updated;
  }

  async listArenaRounds() {
    return this.selectPayloads<ArenaRound>(
      `SELECT payload FROM ${this.table("arena_rounds")} ORDER BY created_at DESC`,
      [],
      arenaRoundSchema
    );
  }

  async getArenaRound(roundId: string) {
    const rows = await this.selectPayloads<ArenaRound>(
      `SELECT payload FROM ${this.table("arena_rounds")} WHERE round_id = $1`,
      [roundId],
      arenaRoundSchema
    );
    return rows[0] ?? null;
  }

  async appendArenaRound(round: ArenaRound) {
    await this.ensureReady();
    const parsed = arenaRoundSchema.parse(round);
    await this.getPool().query(
      `
        INSERT INTO ${this.table("arena_rounds")} (round_id, created_at, payload)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (round_id) DO UPDATE SET
          created_at = EXCLUDED.created_at,
          payload = EXCLUDED.payload
      `,
      [parsed.roundId, parsed.createdAt, JSON.stringify(parsed)]
    );
  }

  async replaceArenaRounds(rounds: ArenaRound[]) {
    const parsedRounds = rounds.map((round) => arenaRoundSchema.parse(round));
    await this.withTransaction(async (client) => {
      await client.query(`DELETE FROM ${this.table("arena_rounds")}`);
      for (const item of parsedRounds) {
        await client.query(
          `
            INSERT INTO ${this.table("arena_rounds")} (round_id, created_at, payload)
            VALUES ($1, $2, $3::jsonb)
          `,
          [item.roundId, item.createdAt, JSON.stringify(item)]
        );
      }
    });
  }

  async listStudentSessions() {
    return this.selectPayloads<StudentSession>(
      `SELECT payload FROM ${this.table("student_sessions")} ORDER BY created_at DESC`,
      [],
      studentSessionSchema
    );
  }

  async getStudentSession(sessionId: string) {
    const rows = await this.selectPayloads<StudentSession>(
      `SELECT payload FROM ${this.table("student_sessions")} WHERE session_id = $1`,
      [sessionId],
      studentSessionSchema
    );
    return rows[0] ?? null;
  }

  async appendStudentSession(session: StudentSession) {
    await this.ensureReady();
    const parsed = studentSessionSchema.parse(session);
    await this.getPool().query(
      `
        INSERT INTO ${this.table("student_sessions")} (session_id, created_at, payload)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (session_id) DO UPDATE SET
          created_at = EXCLUDED.created_at,
          payload = EXCLUDED.payload
      `,
      [parsed.sessionId, parsed.createdAt, JSON.stringify(parsed)]
    );
  }

  async replaceStudentSessions(sessions: StudentSession[]) {
    const parsedSessions = sessions.map((session) => studentSessionSchema.parse(session));
    await this.withTransaction(async (client) => {
      await client.query(`DELETE FROM ${this.table("student_sessions")}`);
      for (const item of parsedSessions) {
        await client.query(
          `
            INSERT INTO ${this.table("student_sessions")} (session_id, created_at, payload)
            VALUES ($1, $2, $3::jsonb)
          `,
          [item.sessionId, item.createdAt, JSON.stringify(item)]
        );
      }
    });
  }

  close() {
    const pool = this.pool;
    this.pool = null;
    this.ready = false;
    this.readyPromise = null;
    if (pool && this.ownsPool) {
      void pool.end();
    }
  }

  private async initialize() {
    if (!this.options.connectionString.trim()) {
      throw new Error("POSTGRES_URL is required when PERSISTENCE_ADAPTER=postgres.");
    }

    this.pool ??= new PgPool({
      connectionString: this.options.connectionString,
      max: 10
    });

    await this.getPool().query(this.schemaSqlStatement());
    this.ready = true;
  }

  private schemaSqlStatement() {
    const arenaRounds = this.table("arena_rounds");
    const studentSessions = this.table("student_sessions");
    const skills = this.table("skills");
    const toolManifests = this.table("tool_manifests");
    const specializedAgents = this.table("specialized_agents");
    const localModelVariants = this.table("local_model_variants");

    return `
      CREATE SCHEMA IF NOT EXISTS ${this.schemaSql};

      CREATE TABLE IF NOT EXISTS ${arenaRounds} (
        round_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${this.index("idx_arena_rounds_created_at")}
        ON ${arenaRounds} (created_at DESC);

      CREATE TABLE IF NOT EXISTS ${studentSessions} (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${this.index("idx_student_sessions_created_at")}
        ON ${studentSessions} (created_at DESC);

      CREATE TABLE IF NOT EXISTS ${skills} (
        skill_id TEXT PRIMARY KEY,
        intent TEXT NOT NULL,
        state TEXT NOT NULL,
        confidence_score DOUBLE PRECISION NOT NULL,
        usage_count INTEGER NOT NULL,
        last_used_at TEXT NULL,
        created_at TEXT NOT NULL,
        version TEXT NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${this.index("idx_skills_intent_state")}
        ON ${skills} (intent, state);

      CREATE INDEX IF NOT EXISTS ${this.index("idx_skills_confidence")}
        ON ${skills} (confidence_score DESC);

      CREATE TABLE IF NOT EXISTS ${toolManifests} (
        tool_id TEXT PRIMARY KEY,
        intent TEXT NOT NULL,
        state TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        confidence_score DOUBLE PRECISION NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${this.index("idx_tool_manifests_intent_state")}
        ON ${toolManifests} (intent, state);

      CREATE INDEX IF NOT EXISTS ${this.index("idx_tool_manifests_risk_confidence")}
        ON ${toolManifests} (risk_level, confidence_score DESC);

      CREATE TABLE IF NOT EXISTS ${specializedAgents} (
        agent_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        state TEXT NOT NULL,
        confidence_score DOUBLE PRECISION NOT NULL,
        intent_index TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${this.index("idx_specialized_agents_domain_state")}
        ON ${specializedAgents} (domain, state);

      CREATE INDEX IF NOT EXISTS ${this.index("idx_specialized_agents_confidence")}
        ON ${specializedAgents} (confidence_score DESC);

      CREATE TABLE IF NOT EXISTS ${localModelVariants} (
        variant_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        confidence_score DOUBLE PRECISION NOT NULL,
        served_model_name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${this.index("idx_local_model_variants_state")}
        ON ${localModelVariants} (state);

      CREATE INDEX IF NOT EXISTS ${this.index("idx_local_model_variants_confidence")}
        ON ${localModelVariants} (confidence_score DESC);
    `;
  }

  private async selectPayloads<T>(
    sql: string,
    params: unknown[],
    schema: PayloadSchema<T>
  ): Promise<T[]> {
    await this.ensureReady();
    const result = await this.getPool().query<PayloadRow>(sql, params);
    return result.rows.map((row) => schema.parse(normalizePayload(row.payload)));
  }

  private async withTransaction(task: (client: PoolClient) => Promise<void>) {
    await this.ensureReady();
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      await task(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private getPool() {
    if (!this.pool) {
      throw new Error("PostgresPersistenceAdapter used before ensureReady().");
    }

    return this.pool;
  }

  private table(name: string) {
    return `${this.schemaSql}.${quoteIdentifier(name)}`;
  }

  private index(name: string) {
    return quoteIdentifier(name);
  }
}

function normalizePayload(payload: unknown) {
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

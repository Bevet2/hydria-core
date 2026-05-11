import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import {
  createPersistenceAdapter,
  PostgresPersistenceAdapter,
  SqlitePersistenceAdapter
} from "../services/storage/persistenceAdapter.js";
import { migrateSqliteToPostgres } from "../scripts/migrateSqliteToPostgres.js";
import { skillDefinitionSchema } from "../types/skills.js";

const { Pool: PgPool } = pg;

test("persistence adapter defaults to sqlite-compatible storage", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hydria-persistence-adapter-"));
  const adapter = createPersistenceAdapter({
    kind: "sqlite",
    sqliteFile: join(tempDir, "hydria-state.sqlite")
  });

  try {
    assert.ok(adapter instanceof SqlitePersistenceAdapter);
    await adapter.ensureReady();
    assert.equal(await adapter.countArenaRounds(), 0);
    assert.equal(await adapter.countStudentSessions(), 0);
  } finally {
    adapter.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("persistence adapter selects postgres without connecting during construction", () => {
  const adapter = createPersistenceAdapter({
    kind: "postgres",
    postgresUrl: "postgres://hydria:hydria@localhost:5432/hydria",
    postgresSchema: "hydria_test"
  });

  try {
    assert.ok(adapter instanceof PostgresPersistenceAdapter);
  } finally {
    adapter.close();
  }
});

test("postgres adapter requires POSTGRES_URL before initialization", async () => {
  const adapter = createPersistenceAdapter({
    kind: "postgres",
    postgresUrl: "",
    postgresSchema: "hydria_test"
  });

  try {
    await assert.rejects(() => adapter.ensureReady(), /POSTGRES_URL is required/);
  } finally {
    adapter.close();
  }
});

test("sqlite to postgres migration reports source counts in dry-run mode", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hydria-persistence-migration-"));
  const sqliteFile = join(tempDir, "hydria-state.sqlite");
  const adapter = createPersistenceAdapter({
    kind: "sqlite",
    sqliteFile
  });

  try {
    await adapter.upsertSkill(buildSkill());

    const report = await migrateSqliteToPostgres({
      sqliteFile,
      postgresUrl: "",
      dryRun: true
    });

    assert.equal(report.dryRun, true);
    assert.equal(report.counts.skills, 1);
    assert.equal(report.counts.arenaRounds, 0);
  } finally {
    adapter.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test(
  "postgres adapter stores and updates payloads with sqlite-compatible semantics",
  {
    skip: process.env.TEST_POSTGRES_URL
      ? false
      : "Set TEST_POSTGRES_URL to run PostgreSQL adapter integration parity."
  },
  async () => {
    const postgresUrl = process.env.TEST_POSTGRES_URL ?? "";
    const schema = `hydria_test_${Date.now()}`;
    const controlPool = new PgPool({ connectionString: postgresUrl });
    const adapter = createPersistenceAdapter({
      kind: "postgres",
      postgresUrl,
      postgresSchema: schema
    });

    try {
      await adapter.ensureReady();
      assert.equal(await adapter.countArenaRounds(), 0);
      assert.equal(await adapter.countStudentSessions(), 0);

      const skill = buildSkill();
      await adapter.upsertSkill(skill);

      const active = await adapter.findSkillsByIntent("repo_analysis", ["active"]);
      assert.equal(active[0]?.id, skill.id);

      const used = await adapter.incrementSkillUsage(skill.id, "2026-05-11T10:00:00.000Z");
      assert.equal(used?.usageCount, 3);
      assert.equal(used?.lastUsedAt, "2026-05-11T10:00:00.000Z");

      const archived = await adapter.archiveSkill(skill.id);
      assert.equal(archived?.state, "archived");
      assert.equal((await adapter.listSkills(["active"])).length, 0);
      assert.equal((await adapter.listSkills(["archived"]))[0]?.id, skill.id);
    } finally {
      adapter.close();
      await controlPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await controlPool.end();
    }
  }
);

function buildSkill() {
  return skillDefinitionSchema.parse({
    id: "skill::postgres_repo_analysis",
    name: "Postgres Repo Analysis",
    intent: "repo_analysis",
    description: "Checks repository structure with persisted guidance.",
    inputs: [],
    outputs: [],
    requiredTools: ["repo"],
    steps: [
      {
        stepId: "inspect",
        title: "Inspect repository",
        description: "Read the repository structure before answering.",
        toolHint: "repo",
        expectedOutcome: "Relevant files are identified."
      }
    ],
    preconditions: [],
    successCriteria: ["Answer cites repository evidence."],
    failureModes: ["Repository context is missing."],
    safetyConstraints: ["Do not mutate files during inspection."],
    examples: [],
    confidenceScore: 0.91,
    usageCount: 2,
    lastUsedAt: null,
    createdAt: "2026-05-11T09:00:00.000Z",
    version: "hydria-skill-v1",
    state: "active"
  });
}

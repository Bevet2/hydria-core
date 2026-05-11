import { readFile, stat } from "node:fs/promises";
import { env } from "../../utils/env.js";
import type {
  PersistenceDerivedArtifactHealth,
  PersistenceFileStat,
  PersistenceHealthReport,
  PersistenceHealthSummary,
  PersistenceProjectionHealth
} from "../../types/health.js";
import { createPersistenceAdapter } from "./persistenceAdapter.js";
import { normalizeArenaHistoryFile } from "./arenaHistoryNormalizer.js";
import { normalizeStudentSessionHistoryFile } from "./studentSessionHistoryNormalizer.js";

export class PersistenceHealthService {
  constructor(
    private readonly databaseFile = env.PERSISTENCE_DB_FILE,
    private readonly arenaHistoryFile = env.HISTORY_FILE,
    private readonly studentHistoryFile = env.STUDENT_SESSION_HISTORY_FILE,
    private readonly knowledgeMemoryFile = env.KNOWLEDGE_MEMORY_FILE,
    private readonly studentRuleImpactFile = env.STUDENT_RULE_IMPACT_FILE,
    private readonly studentToolImpactFile = env.STUDENT_TOOL_IMPACT_FILE,
    private readonly studentStrategyImpactFile = env.STUDENT_STRATEGY_IMPACT_FILE,
    private readonly studentStrategyDiscoveryFile = env.STUDENT_STRATEGY_DISCOVERY_FILE,
    private readonly studentStrategyAssetsFile = env.STUDENT_STRATEGY_ASSETS_FILE
  ) {}

  async getSummary(): Promise<PersistenceHealthSummary> {
    const report = await this.getReport();
    const projectionIssues = Object.values(report.projections).filter(
      (entry) => entry.status !== "ok"
    ).length;
    const derivedArtifactIssues = Object.values(report.derivedArtifacts).filter(
      (entry) => entry.status !== "ok"
    ).length;

    return {
      status: report.status,
      databaseAdapter: report.database.adapter,
      databaseTarget: report.database.target,
      databaseFile: report.database.path,
      arenaRoundCount: report.database.arenaRoundCount,
      studentSessionCount: report.database.studentSessionCount,
      projectionIssues,
      derivedArtifactIssues
    };
  }

  async getReport(): Promise<PersistenceHealthReport> {
    const adapter = env.PERSISTENCE_ADAPTER;
    const isSqlite = adapter === "sqlite";
    const database = createPersistenceAdapter({ sqliteFile: this.databaseFile });

    try {
      await database.ensureReady();
      const arenaRoundCount = await database.countArenaRounds();
      const studentSessionCount = await database.countStudentSessions();
      const [databaseFile, walFile, shmFile, arenaHistory, studentHistory, knowledgeMemory, studentRuleImpact, studentToolImpact, studentStrategyImpact, studentStrategyDiscovery, studentStrategyAssets] =
        await Promise.all([
          this.inspectFile(this.databaseFile),
          this.inspectFile(this.sidecarFilePath(this.databaseFile, "-wal")),
          this.inspectFile(this.sidecarFilePath(this.databaseFile, "-shm")),
          this.inspectArenaHistoryProjection(arenaRoundCount),
          this.inspectStudentHistoryProjection(studentSessionCount),
          this.inspectDerivedArtifact(this.knowledgeMemoryFile),
          this.inspectDerivedArtifact(this.studentRuleImpactFile),
          this.inspectDerivedArtifact(this.studentToolImpactFile),
          this.inspectDerivedArtifact(this.studentStrategyImpactFile),
          this.inspectDerivedArtifact(this.studentStrategyDiscoveryFile),
          this.inspectDerivedArtifact(this.studentStrategyAssetsFile)
        ]);

      const projectionIssues =
        Number(arenaHistory.status !== "ok") + Number(studentHistory.status !== "ok");
      const reportStatus = projectionIssues > 0 ? "degraded" : "ok";

      return {
        status: reportStatus,
        database: {
          adapter,
          target: isSqlite ? this.databaseFile : `postgres:${env.POSTGRES_SCHEMA}`,
          path: this.databaseFile,
          postgresSchema: isSqlite ? null : env.POSTGRES_SCHEMA,
          exists: isSqlite ? databaseFile.exists : true,
          walExists: isSqlite ? walFile.exists : false,
          shmExists: isSqlite ? shmFile.exists : false,
          arenaRoundCount,
          studentSessionCount
        },
        projections: {
          arenaHistory,
          studentHistory
        },
        derivedArtifacts: {
          knowledgeMemory,
          studentRuleImpact,
          studentToolImpact,
          studentStrategyImpact,
          studentStrategyDiscovery,
          studentStrategyAssets
        }
      };
    } finally {
      database.close();
    }
  }

  private async inspectArenaHistoryProjection(
    expectedCount: number
  ): Promise<PersistenceProjectionHealth> {
    return this.inspectProjection(
      this.arenaHistoryFile,
      expectedCount,
      (raw) => normalizeArenaHistoryFile(raw).rounds.length
    );
  }

  private async inspectStudentHistoryProjection(
    expectedCount: number
  ): Promise<PersistenceProjectionHealth> {
    return this.inspectProjection(
      this.studentHistoryFile,
      expectedCount,
      (raw) => normalizeStudentSessionHistoryFile(raw).history.sessions.length
    );
  }

  private async inspectProjection(
    filePath: string,
    expectedCount: number,
    getEntryCount: (raw: string) => number
  ): Promise<PersistenceProjectionHealth> {
    const file = await this.inspectFile(filePath);
    if (!file.exists) {
      return {
        ...file,
        status: "missing",
        entryCount: null,
        matchesDatabaseCount: null,
        notes: ["Projection file is missing."]
      };
    }

    try {
      const raw = await readFile(filePath, "utf8");
      const entryCount = getEntryCount(raw);
      const matchesDatabaseCount = entryCount === expectedCount;

      return {
        ...file,
        status: matchesDatabaseCount ? "ok" : "count_mismatch",
        entryCount,
        matchesDatabaseCount,
        notes: matchesDatabaseCount
          ? []
          : [`Projection count ${entryCount} differs from database count ${expectedCount}.`]
      };
    } catch (error) {
      return {
        ...file,
        status: "corrupt",
        entryCount: null,
        matchesDatabaseCount: null,
        notes: [String(error)]
      };
    }
  }

  private async inspectDerivedArtifact(
    filePath: string
  ): Promise<PersistenceDerivedArtifactHealth> {
    const file = await this.inspectFile(filePath);
    if (!file.exists) {
      return {
        ...file,
        status: "missing",
        rebuildableFromPersistence: true
      };
    }

    try {
      JSON.parse(await readFile(filePath, "utf8"));
      return {
        ...file,
        status: "ok",
        rebuildableFromPersistence: true
      };
    } catch {
      return {
        ...file,
        status: "invalid_json",
        rebuildableFromPersistence: true
      };
    }
  }

  private async inspectFile(filePath: string): Promise<PersistenceFileStat> {
    try {
      const file = await stat(filePath);
      return {
        path: filePath,
        exists: true,
        sizeBytes: file.size
      };
    } catch {
      return {
        path: filePath,
        exists: false,
        sizeBytes: null
      };
    }
  }

  private sidecarFilePath(filePath: string, suffix: "-wal" | "-shm") {
    return `${filePath}${suffix}`;
  }
}

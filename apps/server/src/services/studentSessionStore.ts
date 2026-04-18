import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  studentCycleDatasetEntrySchema,
  studentSessionSchema,
  type StudentCycleDatasetEntry,
  type StudentProgressSummary,
  type StudentSession
} from "../types/student.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";
import { HydriaStateDatabase } from "./storage/hydriaStateDatabase.js";
import { normalizeStudentSessionHistoryFile } from "./storage/studentSessionHistoryNormalizer.js";
import { StudentRuleImpactTrackerService } from "./studentRuleImpactTrackerService.js";
import { StudentStrategyImpactTrackerService } from "./studentStrategyImpactTrackerService.js";
import { StudentToolImpactTrackerService } from "./studentToolImpactTrackerService.js";
import { buildStudentProgressSummary, enrichStudentSession } from "./studentLearning.js";

export class StudentSessionStore {
  private writeQueue = Promise.resolve();
  private readonly knowledgeMemoryService: KnowledgeMemoryService;
  private readonly studentRuleImpactTrackerService: StudentRuleImpactTrackerService;
  private readonly studentStrategyImpactTrackerService: StudentStrategyImpactTrackerService;
  private readonly studentToolImpactTrackerService: StudentToolImpactTrackerService;
  private readonly database: HydriaStateDatabase;

  constructor(
    private readonly historyFile = env.STUDENT_SESSION_HISTORY_FILE,
    private readonly datasetFile = env.STUDENT_SESSION_DATASET_FILE,
    databaseFile = env.PERSISTENCE_DB_FILE
  ) {
    this.database = new HydriaStateDatabase(databaseFile);
    this.knowledgeMemoryService = new KnowledgeMemoryService(
      env.KNOWLEDGE_MEMORY_FILE,
      historyFile,
      env.KNOWLEDGE_LAYER_FILE,
      databaseFile
    );
    this.studentRuleImpactTrackerService = new StudentRuleImpactTrackerService(
      historyFile,
      env.STUDENT_RULE_IMPACT_FILE,
      databaseFile
    );
    this.studentStrategyImpactTrackerService = new StudentStrategyImpactTrackerService(
      historyFile,
      env.STUDENT_STRATEGY_IMPACT_FILE,
      databaseFile
    );
    this.studentToolImpactTrackerService = new StudentToolImpactTrackerService(
      historyFile,
      env.STUDENT_TOOL_IMPACT_FILE,
      databaseFile
    );
  }

  async ensureReady() {
    await mkdir(dirname(this.historyFile), { recursive: true });
    await mkdir(dirname(this.datasetFile), { recursive: true });
    await this.database.ensureReady();

    const persistedCount = await this.database.countStudentSessions();
    if (persistedCount === 0) {
      const legacySessions = await this.readLegacyHistoryFile();
      if (legacySessions.length > 0) {
        await this.database.replaceStudentSessions(legacySessions);
        await this.writeHistoryProjection(legacySessions);
        await this.rebuildDatasetFile(legacySessions);
        return;
      }
    }

    const sessions = await this.database.listStudentSessions();
    await this.writeHistoryProjection(sessions);

    try {
      await readFile(this.datasetFile, "utf8");
    } catch {
      await this.rebuildDatasetFile(sessions);
    }
  }

  async listSessions() {
    await this.waitForPendingWrites();
    await this.ensureReady();
    return this.database.listStudentSessions();
  }

  async getSession(sessionId: string) {
    await this.waitForPendingWrites();
    await this.ensureReady();
    return this.database.getStudentSession(sessionId);
  }

  async getSummary(): Promise<StudentProgressSummary> {
    const sessions = await this.listSessions();
    return buildStudentProgressSummary(sessions);
  }

  async appendSession(session: StudentSession) {
    await this.runExclusive(async () => {
      const parsed = enrichStudentSession(studentSessionSchema.parse(session));
      await this.ensureReady();
      await this.database.appendStudentSession(parsed);
      const sessions = await this.database.listStudentSessions();
      await this.writeHistoryProjection(sessions);

      const datasetEntry = studentCycleDatasetEntrySchema.parse(this.buildDatasetEntry(parsed));
      await appendFile(this.datasetFile, `${JSON.stringify(datasetEntry)}\n`, "utf8");

      try {
        await this.studentRuleImpactTrackerService.buildAndPersist();
        await this.studentToolImpactTrackerService.buildAndPersist();
        await this.studentStrategyImpactTrackerService.buildAndPersist();
        await this.knowledgeMemoryService.buildAndPersist();
      } catch (error) {
        logger.warn("Student session appended but post-processing refresh failed", {
          error: String(error)
        });
      }
    });
  }

  async close() {
    this.database.close();
  }

  private async waitForPendingWrites() {
    await this.writeQueue;
  }

  private async runExclusive<T>(task: () => Promise<T>) {
    const pending = this.writeQueue.then(task, task);
    this.writeQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private async readLegacyHistoryFile() {
    try {
      const raw = await readFile(this.historyFile, "utf8");
      const normalized = normalizeStudentSessionHistoryFile(raw);

      if (normalized.needsRewrite) {
        await writeFile(this.historyFile, normalized.serialized, "utf8");
      }

      return normalized.history.sessions;
    } catch {
      return [] as StudentSession[];
    }
  }

  private buildDatasetEntry(session: StudentSession): StudentCycleDatasetEntry {
    return {
      datasetVersion: "hydria-student-cycle-v2",
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      question: session.question,
      category: session.category,
      studentAnswer: session.student.final.answer,
      teacherAnswer: session.teacher.improved_answer,
      verdict: session.judge.verdict,
      worthIt: session.judge.worthIt,
      weakPoints: session.weakPoints,
      coachingNotes: session.coachingNotes,
      lessonsLearned: session.lessonsLearned,
      progressionScore: session.progression.sessionScore,
      researchUsed: session.research.used,
      tooling: session.tooling,
      knowledgeStrategy: session.knowledge?.strategyNote ?? "Knowledge layer unavailable.",
      ruleImpact: session.ruleImpact,
      strategyImpact: session.strategyImpact,
      compressedCycle: session.compressedCycle
    };
  }

  private async rebuildDatasetFile(sessions: StudentSession[]) {
    const lines = sessions
      .slice()
      .reverse()
      .map((session) =>
        JSON.stringify(studentCycleDatasetEntrySchema.parse(this.buildDatasetEntry(session)))
      )
      .join("\n");

    await writeFile(this.datasetFile, lines.length > 0 ? `${lines}\n` : "", "utf8");
  }

  private async writeHistoryProjection(sessions: StudentSession[]) {
    const payload = {
      sessions
    };
    await writeFile(this.historyFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

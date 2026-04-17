import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  studentCycleDatasetEntrySchema,
  studentSessionHistorySchema,
  studentSessionSchema,
  type StudentCycleDatasetEntry,
  type StudentProgressSummary,
  type StudentSession
} from "../types/student.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { deepSanitizeStrings } from "../utils/textCleanup.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";
import { StudentRuleImpactTrackerService } from "./studentRuleImpactTrackerService.js";
import { StudentStrategyImpactTrackerService } from "./studentStrategyImpactTrackerService.js";
import { StudentToolImpactTrackerService } from "./studentToolImpactTrackerService.js";
import { buildStudentProgressSummary, enrichStudentSession } from "./studentLearning.js";

const EMPTY_HISTORY = {
  sessions: [] as StudentSession[]
};

export class StudentSessionStore {
  private writeQueue = Promise.resolve();
  private readonly knowledgeMemoryService = new KnowledgeMemoryService();
  private readonly studentRuleImpactTrackerService = new StudentRuleImpactTrackerService();
  private readonly studentStrategyImpactTrackerService = new StudentStrategyImpactTrackerService();
  private readonly studentToolImpactTrackerService = new StudentToolImpactTrackerService();

  constructor(
    private readonly historyFile = env.STUDENT_SESSION_HISTORY_FILE,
    private readonly datasetFile = env.STUDENT_SESSION_DATASET_FILE
  ) {}

  async ensureReady() {
    await mkdir(dirname(this.historyFile), { recursive: true });
    await mkdir(dirname(this.datasetFile), { recursive: true });

    try {
      await readFile(this.historyFile, "utf8");
    } catch {
      await writeFile(this.historyFile, JSON.stringify(EMPTY_HISTORY, null, 2), "utf8");
    }

    try {
      await readFile(this.datasetFile, "utf8");
    } catch {
      await writeFile(this.datasetFile, "", "utf8");
    }
  }

  async listSessions() {
    await this.waitForPendingWrites();
    const history = await this.readHistory();
    return history.sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getSession(sessionId: string) {
    const sessions = await this.listSessions();
    return sessions.find((entry) => entry.sessionId === sessionId) ?? null;
  }

  async getSummary(): Promise<StudentProgressSummary> {
    const sessions = await this.listSessions();
    return buildStudentProgressSummary(sessions);
  }

  async appendSession(session: StudentSession) {
    await this.runExclusive(async () => {
      const history = await this.readHistory();
      const parsed = enrichStudentSession(studentSessionSchema.parse(session));
      const nextHistory = {
        sessions: [parsed, ...history.sessions]
      };
      await writeFile(this.historyFile, JSON.stringify(nextHistory, null, 2), "utf8");

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

  private async readHistory() {
    await this.ensureReady();
    const raw = await readFile(this.historyFile, "utf8");
    const parsed = studentSessionHistorySchema.parse(deepSanitizeStrings(JSON.parse(raw)));
    const sessions = parsed.sessions.map((session) => enrichStudentSession(session));
    const normalizedHistory = { sessions };
    const normalizedRaw = `${JSON.stringify(normalizedHistory, null, 2)}\n`;

    if (raw.trim() !== normalizedRaw.trim()) {
      await writeFile(this.historyFile, normalizedRaw, "utf8");
      await this.rebuildDatasetFile(sessions);
    }

    return normalizedHistory;
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
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StudentRuleImpactContext, StudentSession } from "../types/student.js";
import { env } from "../utils/env.js";
import { listPersistedStudentSessions } from "./storage/studentSessionPersistence.js";

type ToolImpactAggregate = {
  observations: number;
  successes: number;
  positiveImpacts: number;
  judgeDeltaTotal: number;
  gainGlobalTotal: number;
  lengthDeltaTotal: number;
  structureDeltaTotal: number;
  noReliableSourceCount: number;
};

type ToolImpactSummary = {
  observations: number;
  successRate: number;
  positiveImpactRate: number;
  averageJudgeDelta: number;
  averageGainGlobal: number;
  averageLengthDeltaWords: number;
  averageStructureDelta: number;
  noReliableSourceRate: number;
};

type StudentToolImpactContextAggregate = {
  questionType: StudentRuleImpactContext["questionType"];
  promptLength: StudentRuleImpactContext["promptLength"];
  signals: StudentRuleImpactContext["signals"];
  used: ToolImpactSummary;
  unused: ToolImpactSummary;
  averageJudgeDeltaDelta: number;
};

type StudentToolImpactFile = {
  version: "hydria-student-tool-impact-v1";
  builtAt: string;
  sourceStats: {
    studentSessionsAnalyzed: number;
    toolUsedSessions: number;
    toolUnusedSessions: number;
    comparedSessions: number;
  };
  overall: {
    used: ToolImpactSummary;
    unused: ToolImpactSummary;
    averageJudgeDeltaDelta: number;
  };
  contexts: StudentToolImpactContextAggregate[];
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function emptyAggregate(): ToolImpactAggregate {
  return {
    observations: 0,
    successes: 0,
    positiveImpacts: 0,
    judgeDeltaTotal: 0,
    gainGlobalTotal: 0,
    lengthDeltaTotal: 0,
    structureDeltaTotal: 0,
    noReliableSourceCount: 0
  };
}

function summarizeAggregate(entry: ToolImpactAggregate): ToolImpactSummary {
  return {
    observations: entry.observations,
    successRate: round((entry.successes / Math.max(entry.observations, 1)) * 100),
    positiveImpactRate: round((entry.positiveImpacts / Math.max(entry.observations, 1)) * 100),
    averageJudgeDelta: round(entry.judgeDeltaTotal / Math.max(entry.observations, 1)),
    averageGainGlobal: round(entry.gainGlobalTotal / Math.max(entry.observations, 1)),
    averageLengthDeltaWords: round(entry.lengthDeltaTotal / Math.max(entry.observations, 1)),
    averageStructureDelta: round(entry.structureDeltaTotal / Math.max(entry.observations, 1)),
    noReliableSourceRate: round((entry.noReliableSourceCount / Math.max(entry.observations, 1)) * 100)
  };
}

function contextKey(context: StudentRuleImpactContext) {
  return [
    context.questionType,
    context.promptLength,
    [...context.signals].sort().join(",")
  ].join("|");
}

function addToAggregate(aggregate: ToolImpactAggregate, session: StudentSession) {
  aggregate.observations += 1;
  aggregate.successes += session.tooling.metrics.success ? 1 : 0;
  aggregate.positiveImpacts += session.tooling.metrics.gainGlobal > 0 ? 1 : 0;
  aggregate.judgeDeltaTotal += session.tooling.metrics.judgeOverallDelta;
  aggregate.gainGlobalTotal += session.tooling.metrics.gainGlobal;
  aggregate.lengthDeltaTotal += session.tooling.metrics.lengthDeltaWords;
  aggregate.structureDeltaTotal += session.tooling.metrics.structureDelta;
  aggregate.noReliableSourceCount += session.tooling.noReliableSource ? 1 : 0;
}

export class StudentToolImpactTrackerService {
  constructor(
    private readonly historyFile = env.STUDENT_SESSION_HISTORY_FILE,
    private readonly impactFile = env.STUDENT_TOOL_IMPACT_FILE,
    private readonly databaseFile = env.PERSISTENCE_DB_FILE
  ) {}

  async load() {
    try {
      const raw = await readFile(this.impactFile, "utf8");
      return JSON.parse(raw) as StudentToolImpactFile;
    } catch {
      return this.buildAndPersist();
    }
  }

  async buildAndPersist() {
    const sessions = await this.readSessions();
    const compared = sessions.filter((session) => session.tooling.compared);
    const usedOverall = emptyAggregate();
    const unusedOverall = emptyAggregate();
    const byContext = new Map<
      string,
      {
        context: StudentRuleImpactContext;
        used: ToolImpactAggregate;
        unused: ToolImpactAggregate;
      }
    >();

    for (const session of compared) {
      const target = session.tooling.toolUsed ? usedOverall : unusedOverall;
      addToAggregate(target, session);

      const key = contextKey(session.tooling.context);
      const current = byContext.get(key) ?? {
        context: session.tooling.context,
        used: emptyAggregate(),
        unused: emptyAggregate()
      };
      addToAggregate(session.tooling.toolUsed ? current.used : current.unused, session);
      byContext.set(key, current);
    }

    const overallUsed = summarizeAggregate(usedOverall);
    const overallUnused = summarizeAggregate(unusedOverall);
    const contexts: StudentToolImpactContextAggregate[] = [...byContext.values()]
      .map((entry) => {
        const used = summarizeAggregate(entry.used);
        const unused = summarizeAggregate(entry.unused);
        return {
          questionType: entry.context.questionType,
          promptLength: entry.context.promptLength,
          signals: entry.context.signals,
          used,
          unused,
          averageJudgeDeltaDelta: round(used.averageJudgeDelta - unused.averageJudgeDelta)
        };
      })
      .sort(
        (left, right) =>
          right.used.observations - left.used.observations ||
          right.averageJudgeDeltaDelta - left.averageJudgeDeltaDelta
      );

    const payload: StudentToolImpactFile = {
      version: "hydria-student-tool-impact-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        studentSessionsAnalyzed: sessions.length,
        toolUsedSessions: compared.filter((session) => session.tooling.toolUsed).length,
        toolUnusedSessions: compared.filter((session) => !session.tooling.toolUsed).length,
        comparedSessions: compared.length
      },
      overall: {
        used: overallUsed,
        unused: overallUnused,
        averageJudgeDeltaDelta: round(overallUsed.averageJudgeDelta - overallUnused.averageJudgeDelta)
      },
      contexts
    };

    await mkdir(dirname(this.impactFile), { recursive: true });
    await writeFile(this.impactFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  private async readSessions() {
    return listPersistedStudentSessions({
      historyFile: this.historyFile,
      databaseFile: this.databaseFile
    });
  }
}

export type { StudentToolImpactContextAggregate, StudentToolImpactFile, ToolImpactSummary };

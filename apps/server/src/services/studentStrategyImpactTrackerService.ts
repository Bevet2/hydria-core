import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StudentSession, StudentStrategyImpactStatus, StudentStrategyProfile, StudentRuleImpactContext } from "../types/student.js";
import { studentSessionHistorySchema } from "../types/student.js";
import { env } from "../utils/env.js";
import { deepSanitizeStrings } from "../utils/textCleanup.js";
import { enrichStudentSession } from "./studentLearning.js";
import { scoreStudentRuleContextMatch } from "./studentRuleContext.js";

type StudentStrategyImpactContextAggregate = {
  questionType: StudentRuleImpactContext["questionType"];
  promptLength: StudentRuleImpactContext["promptLength"];
  signals: StudentRuleImpactContext["signals"];
  observations: number;
  usageRate: number;
  successRate: number;
  positiveImpactRate: number;
  averageJudgeDelta: number;
  averageGainGlobal: number;
  averageLengthDeltaWords: number;
  averageStructureDelta: number;
  empiricalConfidence: number;
  activation: StudentStrategyImpactStatus;
};

type StudentStrategyImpactAggregate = {
  strategyId: StudentStrategyProfile;
  observations: number;
  usageRate: number;
  successRate: number;
  positiveImpactRate: number;
  averageJudgeDelta: number;
  averageGainGlobal: number;
  averageLengthDeltaWords: number;
  averageStructureDelta: number;
  empiricalConfidence: number;
  activation: StudentStrategyImpactStatus;
  contexts: StudentStrategyImpactContextAggregate[];
};

type StudentStrategyImpactFile = {
  version: "hydria-student-strategy-impact-v1";
  builtAt: string;
  sourceStats: {
    studentSessionsAnalyzed: number;
    comparedSessions: number;
    strategyObservations: number;
  };
  strategies: StudentStrategyImpactAggregate[];
};

type AggregateAccumulator = {
  observations: number;
  successes: number;
  positiveImpacts: number;
  judgeDeltaTotal: number;
  gainGlobalTotal: number;
  lengthDeltaTotal: number;
  structureDeltaTotal: number;
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function contextKey(context: StudentRuleImpactContext) {
  return [
    context.questionType,
    context.promptLength,
    [...context.signals].sort().join(",")
  ].join("|");
}

function summarizeAggregate(
  entry: AggregateAccumulator,
  totalComparedSessions: number
) {
  const successRate = round((entry.successes / Math.max(entry.observations, 1)) * 100);
  const positiveImpactRate = round(
    (entry.positiveImpacts / Math.max(entry.observations, 1)) * 100
  );
  const averageJudgeDelta = round(entry.judgeDeltaTotal / Math.max(entry.observations, 1));
  const averageGainGlobal = round(entry.gainGlobalTotal / Math.max(entry.observations, 1));
  const averageLengthDeltaWords = round(entry.lengthDeltaTotal / Math.max(entry.observations, 1));
  const averageStructureDelta = round(entry.structureDeltaTotal / Math.max(entry.observations, 1));
  const usageRate = round((entry.observations / Math.max(totalComparedSessions, 1)) * 100);
  const empiricalConfidence = round(
    clamp(
      0.35 +
        Math.min(entry.observations, 8) * 0.04 +
        Math.max(0, averageJudgeDelta) / 40 +
        Math.max(0, positiveImpactRate - 50) / 200,
      0.2,
      0.95
    )
  );

  const activation: StudentStrategyImpactStatus =
    entry.observations < 2
      ? averageJudgeDelta < 0
        ? "inactive"
        : "cautious"
      : averageJudgeDelta > 1 && positiveImpactRate >= 50
        ? "active"
        : averageJudgeDelta < 0 || positiveImpactRate < 35
          ? "inactive"
          : "cautious";

  return {
    usageRate,
    successRate,
    positiveImpactRate,
    averageJudgeDelta,
    averageGainGlobal,
    averageLengthDeltaWords,
    averageStructureDelta,
    empiricalConfidence,
    activation
  };
}

export class StudentStrategyImpactTrackerService {
  constructor(
    private readonly historyFile = env.STUDENT_SESSION_HISTORY_FILE,
    private readonly impactFile = env.STUDENT_STRATEGY_IMPACT_FILE
  ) {}

  async load() {
    try {
      const raw = await readFile(this.impactFile, "utf8");
      return JSON.parse(raw) as StudentStrategyImpactFile;
    } catch {
      return null;
    }
  }

  async buildAndPersist() {
    const sessions = await this.readSessions();
    const compared = sessions.filter((session) => session.strategyImpact.compared);
    const byStrategy = new Map<
      StudentStrategyProfile,
      AggregateAccumulator & { strategyId: StudentStrategyProfile }
    >();
    const byStrategyContext = new Map<
      string,
      AggregateAccumulator & {
        strategyId: StudentStrategyProfile;
        context: StudentRuleImpactContext;
      }
    >();

    for (const session of compared) {
      const strategyId = session.strategyImpact.strategyId;
      const metrics = session.strategyImpact.metrics;

      const current = byStrategy.get(strategyId) ?? {
        strategyId,
        observations: 0,
        successes: 0,
        positiveImpacts: 0,
        judgeDeltaTotal: 0,
        gainGlobalTotal: 0,
        lengthDeltaTotal: 0,
        structureDeltaTotal: 0
      };
      current.observations += 1;
      current.successes += metrics.success ? 1 : 0;
      current.positiveImpacts += metrics.gainGlobal > 0 ? 1 : 0;
      current.judgeDeltaTotal += metrics.judgeOverallDelta;
      current.gainGlobalTotal += metrics.gainGlobal;
      current.lengthDeltaTotal += metrics.lengthDeltaWords;
      current.structureDeltaTotal += metrics.structureDelta;
      byStrategy.set(strategyId, current);

      const key = `${strategyId}::${contextKey(session.strategyImpact.context)}`;
      const currentContext = byStrategyContext.get(key) ?? {
        strategyId,
        context: session.strategyImpact.context,
        observations: 0,
        successes: 0,
        positiveImpacts: 0,
        judgeDeltaTotal: 0,
        gainGlobalTotal: 0,
        lengthDeltaTotal: 0,
        structureDeltaTotal: 0
      };
      currentContext.observations += 1;
      currentContext.successes += metrics.success ? 1 : 0;
      currentContext.positiveImpacts += metrics.gainGlobal > 0 ? 1 : 0;
      currentContext.judgeDeltaTotal += metrics.judgeOverallDelta;
      currentContext.gainGlobalTotal += metrics.gainGlobal;
      currentContext.lengthDeltaTotal += metrics.lengthDeltaWords;
      currentContext.structureDeltaTotal += metrics.structureDelta;
      byStrategyContext.set(key, currentContext);
    }

    const strategies: StudentStrategyImpactAggregate[] = [...byStrategy.values()]
      .map((entry) => {
        const summary = summarizeAggregate(entry, compared.length);
        const contexts = [...byStrategyContext.values()]
          .filter((contextEntry) => contextEntry.strategyId === entry.strategyId)
          .map((contextEntry) => ({
            questionType: contextEntry.context.questionType,
            promptLength: contextEntry.context.promptLength,
            signals: contextEntry.context.signals,
            observations: contextEntry.observations,
            ...summarizeAggregate(contextEntry, compared.length)
          }))
          .sort(
            (left, right) =>
              right.observations - left.observations ||
              right.empiricalConfidence - left.empiricalConfidence ||
              right.averageJudgeDelta - left.averageJudgeDelta
          );

        return {
          strategyId: entry.strategyId,
          observations: entry.observations,
          ...summary,
          contexts
        };
      })
      .sort(
        (left, right) =>
          right.empiricalConfidence - left.empiricalConfidence ||
          right.averageJudgeDelta - left.averageJudgeDelta ||
          right.observations - left.observations
      );

    const payload: StudentStrategyImpactFile = {
      version: "hydria-student-strategy-impact-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        studentSessionsAnalyzed: sessions.length,
        comparedSessions: compared.length,
        strategyObservations: strategies.reduce((sum, strategy) => sum + strategy.observations, 0)
      },
      strategies
    };

    await mkdir(dirname(this.impactFile), { recursive: true });
    await writeFile(this.impactFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async findStrategy(strategyId: StudentStrategyProfile) {
    const tracker = await this.load();
    return tracker?.strategies.find((strategy) => strategy.strategyId === strategyId) ?? null;
  }

  findBestContext(
    strategy: StudentStrategyImpactAggregate | null,
    context: StudentRuleImpactContext | null
  ) {
    if (!strategy || !context) {
      return null;
    }

    return (
      (strategy.contexts ?? [])
        .map((entry) => ({
          ...entry,
          matchScore: scoreStudentRuleContextMatch(context, {
            questionType: entry.questionType,
            promptLength: entry.promptLength,
            promptWordCount: context.promptWordCount,
            signals: entry.signals
          })
        }))
        .filter((entry) => entry.matchScore >= 5)
        .sort(
          (left, right) =>
            right.matchScore - left.matchScore ||
            right.observations - left.observations ||
            right.empiricalConfidence - left.empiricalConfidence
        )[0] ?? null
    );
  }

  private async readSessions() {
    try {
      const raw = await readFile(this.historyFile, "utf8");
      return studentSessionHistorySchema
        .parse(deepSanitizeStrings(JSON.parse(raw)))
        .sessions.map((session) => enrichStudentSession(session));
    } catch {
      return [] as StudentSession[];
    }
  }
}

export type {
  StudentStrategyImpactAggregate,
  StudentStrategyImpactContextAggregate,
  StudentStrategyImpactFile
};

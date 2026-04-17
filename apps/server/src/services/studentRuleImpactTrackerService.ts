import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QuestionCategory } from "../types/arena.js";
import type { StudentRuleImpactContext, StudentSession } from "../types/student.js";
import { studentSessionHistorySchema } from "../types/student.js";
import { env } from "../utils/env.js";
import { deepSanitizeStrings } from "../utils/textCleanup.js";
import { enrichStudentSession } from "./studentLearning.js";
import { scoreStudentRuleContextMatch } from "./studentRuleContext.js";

type StudentRuleImpactContextAggregate = {
  questionType: StudentRuleImpactContext["questionType"];
  promptLength: StudentRuleImpactContext["promptLength"];
  signals: StudentRuleImpactContext["signals"];
  observations: number;
  successRate: number;
  positiveImpactRate: number;
  averageJudgeDelta: number;
  averageGainGlobal: number;
  averageLengthDeltaWords: number;
  averageStructureDelta: number;
  empiricalConfidence: number;
  activation: "active" | "cautious" | "inactive";
};

type StudentRuleImpactAggregate = {
  ruleId: string;
  category: QuestionCategory;
  failureType: string;
  rule: string;
  observations: number;
  successRate: number;
  positiveImpactRate: number;
  averageJudgeDelta: number;
  averageGainGlobal: number;
  averageLengthDeltaWords: number;
  averageStructureDelta: number;
  empiricalConfidence: number;
  activation: "active" | "cautious" | "inactive";
  contexts: StudentRuleImpactContextAggregate[];
};

type StudentRuleImpactFile = {
  version: "hydria-student-rule-impact-v1";
  builtAt: string;
  sourceStats: {
    studentSessionsAnalyzed: number;
    comparedSessions: number;
    ruleObservations: number;
  };
  rules: StudentRuleImpactAggregate[];
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

function summarizeAggregate(entry: {
  observations: number;
  successes: number;
  positiveImpacts: number;
  judgeDeltaTotal: number;
  gainGlobalTotal: number;
  lengthDeltaTotal: number;
  structureDeltaTotal: number;
}) {
  const successRate = round((entry.successes / Math.max(entry.observations, 1)) * 100);
  const positiveImpactRate = round(
    (entry.positiveImpacts / Math.max(entry.observations, 1)) * 100
  );
  const averageJudgeDelta = round(entry.judgeDeltaTotal / Math.max(entry.observations, 1));
  const averageGainGlobal = round(entry.gainGlobalTotal / Math.max(entry.observations, 1));
  const averageLengthDeltaWords = round(entry.lengthDeltaTotal / Math.max(entry.observations, 1));
  const averageStructureDelta = round(entry.structureDeltaTotal / Math.max(entry.observations, 1));
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
  const activation: StudentRuleImpactAggregate["activation"] =
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

export class StudentRuleImpactTrackerService {
  constructor(
    private readonly historyFile = env.STUDENT_SESSION_HISTORY_FILE,
    private readonly impactFile = env.STUDENT_RULE_IMPACT_FILE
  ) {}

  async load() {
    try {
      const raw = await readFile(this.impactFile, "utf8");
      return JSON.parse(raw) as StudentRuleImpactFile;
    } catch {
      return null;
    }
  }

  async buildAndPersist() {
    const sessions = await this.readSessions();
    const compared = sessions.filter((session) => session.ruleImpact.compared);
    const byRule = new Map<
      string,
      {
        ruleId: string;
        category: QuestionCategory;
        failureType: string;
        rule: string;
        observations: number;
        successes: number;
        positiveImpacts: number;
        judgeDeltaTotal: number;
        gainGlobalTotal: number;
        lengthDeltaTotal: number;
        structureDeltaTotal: number;
      }
    >();
    const byRuleContext = new Map<
      string,
      {
        ruleId: string;
        context: StudentRuleImpactContext;
        observations: number;
        successes: number;
        positiveImpacts: number;
        judgeDeltaTotal: number;
        gainGlobalTotal: number;
        lengthDeltaTotal: number;
        structureDeltaTotal: number;
      }
    >();

    for (const session of compared) {
      for (const rule of session.ruleImpact.perRule) {
        const current = byRule.get(rule.ruleId) ?? {
          ruleId: rule.ruleId,
          category: session.category,
          failureType: rule.failureType,
          rule: rule.rule,
          observations: 0,
          successes: 0,
          positiveImpacts: 0,
          judgeDeltaTotal: 0,
          gainGlobalTotal: 0,
          lengthDeltaTotal: 0,
          structureDeltaTotal: 0
        };
        current.observations += 1;
        current.successes += rule.metrics.success ? 1 : 0;
        current.positiveImpacts += rule.metrics.gainGlobal > 0 ? 1 : 0;
        current.judgeDeltaTotal += rule.metrics.judgeOverallDelta;
        current.gainGlobalTotal += rule.metrics.gainGlobal;
        current.lengthDeltaTotal += rule.metrics.lengthDeltaWords;
        current.structureDeltaTotal += rule.metrics.structureDelta;
        byRule.set(rule.ruleId, current);

        const key = `${rule.ruleId}::${contextKey(session.ruleImpact.context)}`;
        const currentContext = byRuleContext.get(key) ?? {
          ruleId: rule.ruleId,
          context: session.ruleImpact.context,
          observations: 0,
          successes: 0,
          positiveImpacts: 0,
          judgeDeltaTotal: 0,
          gainGlobalTotal: 0,
          lengthDeltaTotal: 0,
          structureDeltaTotal: 0
        };
        currentContext.observations += 1;
        currentContext.successes += rule.metrics.success ? 1 : 0;
        currentContext.positiveImpacts += rule.metrics.gainGlobal > 0 ? 1 : 0;
        currentContext.judgeDeltaTotal += rule.metrics.judgeOverallDelta;
        currentContext.gainGlobalTotal += rule.metrics.gainGlobal;
        currentContext.lengthDeltaTotal += rule.metrics.lengthDeltaWords;
        currentContext.structureDeltaTotal += rule.metrics.structureDelta;
        byRuleContext.set(key, currentContext);
      }
    }

    const rules: StudentRuleImpactAggregate[] = [...byRule.values()]
      .map((entry) => {
        const summary = summarizeAggregate(entry);
        const contexts = [...byRuleContext.values()]
          .filter((contextEntry) => contextEntry.ruleId === entry.ruleId)
          .map((contextEntry) => ({
            questionType: contextEntry.context.questionType,
            promptLength: contextEntry.context.promptLength,
            signals: contextEntry.context.signals,
            observations: contextEntry.observations,
            ...summarizeAggregate(contextEntry)
          }))
          .sort(
            (left, right) =>
              right.observations - left.observations ||
              right.empiricalConfidence - left.empiricalConfidence ||
              right.averageJudgeDelta - left.averageJudgeDelta
          );

        return {
          ruleId: entry.ruleId,
          category: entry.category,
          failureType: entry.failureType,
          rule: entry.rule,
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

    const payload: StudentRuleImpactFile = {
      version: "hydria-student-rule-impact-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        studentSessionsAnalyzed: sessions.length,
        comparedSessions: compared.length,
        ruleObservations: rules.reduce((sum, rule) => sum + rule.observations, 0)
      },
      rules
    };

    await mkdir(dirname(this.impactFile), { recursive: true });
    await writeFile(this.impactFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async findRule(ruleId: string) {
    const tracker = await this.load();
    return tracker?.rules.find((rule) => rule.ruleId === ruleId) ?? null;
  }

  findBestContext(
    rule: StudentRuleImpactAggregate | null,
    context: StudentRuleImpactContext | null
  ) {
    if (!rule || !context) {
      return null;
    }

    return (
      (rule.contexts ?? [])
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
  StudentRuleImpactAggregate,
  StudentRuleImpactContextAggregate,
  StudentRuleImpactFile
};

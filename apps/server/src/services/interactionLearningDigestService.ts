import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { questionCategorySchema, type QuestionCategory } from "../types/arena.js";
import type { HydriaInteractionRecord } from "../types/interactions.js";
import {
  interactionLearningDigestSchema,
  type InteractionLearningCandidate
} from "../types/interactionLearning.js";
import { env } from "../utils/env.js";
import { classifyQuestion } from "./questionClassifier.js";
import { InteractionLogStore } from "./interactionLogStore.js";

type InteractionLearningDigestServiceOptions = {
  interactionLogStore?: Pick<InteractionLogStore, "listRecent">;
  outputFile?: string;
};

type CandidateGroup = {
  kind: InteractionLearningCandidate["kind"];
  source: HydriaInteractionRecord["source"];
  scope: HydriaInteractionRecord["scope"];
  mode: HydriaInteractionRecord["mode"];
  category: QuestionCategory | null;
  issue: string | null;
  toolUsed: boolean;
  records: HydriaInteractionRecord[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function compact(value: string, maxChars = 320) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function parseCategory(value: unknown) {
  const parsed = questionCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function qualityPassed(record: HydriaInteractionRecord) {
  return record.status === "completed" && record.quality.passed !== false && Boolean(record.answer);
}

function qualityFailed(record: HydriaInteractionRecord) {
  return record.status === "failed" || record.quality.passed === false || record.quality.issues.length > 0;
}

function primaryIssue(record: HydriaInteractionRecord) {
  return record.quality.issues[0] ?? (record.status === "failed" ? "failed_interaction" : null);
}

export class InteractionLearningDigestService {
  private readonly interactionLogStore: Pick<InteractionLogStore, "listRecent">;
  private readonly outputFile: string;

  constructor(options: InteractionLearningDigestServiceOptions = {}) {
    this.interactionLogStore = options.interactionLogStore ?? new InteractionLogStore();
    this.outputFile = options.outputFile ?? env.INTERACTION_LEARNING_FILE;
  }

  async buildAndPersist(args: { limit?: number } = {}) {
    const digest = await this.build(args);
    await mkdir(dirname(this.outputFile), { recursive: true });
    await writeFile(this.outputFile, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
    return digest;
  }

  async build(args: { limit?: number } = {}) {
    const records = await this.interactionLogStore.listRecent(args.limit ?? 1000);
    const digest = interactionLearningDigestSchema.parse({
      version: "hydria-interaction-learning-v1",
      generatedAt: new Date().toISOString(),
      sourceStats: this.buildSourceStats(records),
      candidates: this.buildCandidates(records),
      activeHints: []
    });

    return interactionLearningDigestSchema.parse({
      ...digest,
      activeHints: this.buildActiveHints(digest.candidates)
    });
  }

  async load() {
    try {
      const raw = await readFile(this.outputFile, "utf8");
      return interactionLearningDigestSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private buildSourceStats(records: HydriaInteractionRecord[]) {
    const byScope: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const record of records) {
      increment(byScope, record.scope);
      increment(bySource, record.source);
    }

    return {
      recordsAnalyzed: records.length,
      completedRecords: records.filter((record) => record.status === "completed").length,
      acceptedRecords: records.filter((record) => record.status === "accepted").length,
      failedRecords: records.filter((record) => record.status === "failed").length,
      answeredRecords: records.filter((record) => Boolean(record.answer)).length,
      qualityPassedRecords: records.filter((record) => record.quality.passed === true).length,
      qualityFailedRecords: records.filter(qualityFailed).length,
      byScope,
      bySource
    };
  }

  private buildCandidates(records: HydriaInteractionRecord[]) {
    const groups = new Map<string, CandidateGroup>();

    for (const record of records) {
      const kind = this.kindForRecord(record);
      if (!kind) {
        continue;
      }

      const category = parseCategory(record.routing.category) ?? classifyQuestion(record.question);
      const issue = kind === "repair_signal" ? primaryIssue(record) ?? "quality_risk" : null;
      const key = [
        kind,
        record.source,
        record.scope,
        record.mode ?? "none",
        category ?? "none",
        issue ?? "none",
        record.routing.toolUsed ? "tool" : "no-tool"
      ].join("::");
      const group = groups.get(key) ?? {
        kind,
        source: record.source,
        scope: record.scope,
        mode: record.mode,
        category,
        issue,
        toolUsed: record.routing.toolUsed === true,
        records: []
      };
      group.records.push(record);
      groups.set(key, group);
    }

    return [...groups.values()]
      .map((group) => this.groupToCandidate(group))
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          right.evidenceCount - left.evidenceCount ||
          left.candidateId.localeCompare(right.candidateId)
      )
      .slice(0, 200);
  }

  private kindForRecord(record: HydriaInteractionRecord): InteractionLearningCandidate["kind"] | null {
    if (qualityFailed(record)) {
      return "repair_signal";
    }
    if (!qualityPassed(record)) {
      return null;
    }
    if (record.routing.toolUsed) {
      return "tool_routing_signal";
    }
    if (record.scope === "student_analysis") {
      return "supervised_correction";
    }
    if (record.scope === "workspace_action") {
      return "tool_routing_signal";
    }
    if (record.scope === "playground_round" || record.scope === "benchmark_prompt") {
      return "reasoning_example";
    }
    if (record.scope === "chat_turn" || record.scope === "student_preview" || record.scope === "public_api_ask") {
      return "answer_pattern";
    }

    return null;
  }

  private groupToCandidate(group: CandidateGroup): InteractionLearningCandidate {
    const evidenceCount = group.records.length;
    const passCount = group.records.filter(qualityPassed).length;
    const failCount = group.records.filter(qualityFailed).length;
    const passRate = evidenceCount > 0 ? passCount / evidenceCount : 0;
    const failRate = evidenceCount > 0 ? failCount / evidenceCount : 0;
    const baseConfidence =
      group.kind === "repair_signal"
        ? 0.48
        : group.kind === "supervised_correction"
          ? 0.68
          : group.kind === "reasoning_example"
            ? 0.64
            : group.kind === "tool_routing_signal"
              ? 0.66
              : 0.58;
    const confidence = Number(
      clamp(
        baseConfidence +
          Math.min(evidenceCount, 12) * 0.025 +
          passRate * 0.12 -
          failRate * 0.18,
        0,
        0.96
      ).toFixed(3)
    );
    const state =
      group.kind === "repair_signal"
        ? confidence >= 0.6 && evidenceCount >= 2
          ? "guarded"
          : "validating"
        : confidence >= 0.82 && evidenceCount >= 3
          ? "active"
          : confidence >= 0.62
            ? "validating"
            : "raw";
    const target = [
      group.kind,
      group.source,
      group.scope,
      group.mode ?? "none",
      group.category ?? "none",
      group.issue ?? "none",
      group.toolUsed ? "tool" : "no-tool"
    ].join("::");

    return {
      candidateId: `interaction::${stableShortHash(target)}`,
      kind: group.kind,
      state,
      source: group.source,
      scope: group.scope,
      mode: group.mode,
      category: group.category,
      learned: this.learnedText(group),
      conditions: this.conditions(group),
      evidenceRecordIds: group.records.slice(0, 12).map((record) => record.id),
      evidenceCount,
      confidence,
      riskLevel: group.kind === "repair_signal" ? "high" : group.kind === "answer_pattern" ? "medium" : "low",
      recommendedAction: this.recommendedAction(group),
      createdAt: new Date().toISOString()
    };
  }

  private learnedText(group: CandidateGroup) {
    const category = group.category?.replaceAll("_", " ") ?? "general";
    switch (group.kind) {
      case "repair_signal":
        return compact(`Reduce recurring ${group.issue ?? "quality"} failures in ${category} interactions before promotion.`);
      case "tool_routing_signal":
        return compact(`When ${category} interactions require a verified tool, preserve the tool result and answer in the user's language.`);
      case "supervised_correction":
        return compact(`Use teacher-analyzed Student Lab answers as supervised validation examples for ${category}.`);
      case "reasoning_example":
        return compact(`Use successful Playground and benchmark outputs as reasoning validation examples for ${category}.`);
      default:
        return compact(`Reuse successful ${group.source} answer patterns for ${category} only as contextual guidance, not memorized answers.`);
    }
  }

  private conditions(group: CandidateGroup) {
    return [
      `source:${group.source}`,
      `scope:${group.scope}`,
      group.mode ? `mode:${group.mode}` : null,
      group.category ? `category:${group.category}` : null,
      group.toolUsed ? "tool_used:true" : null,
      group.issue ? `issue:${group.issue}` : null
    ].filter((value): value is string => Boolean(value)).slice(0, 8);
  }

  private recommendedAction(group: CandidateGroup) {
    if (group.kind === "repair_signal") {
      return "Keep as guarded repair signal; require repeated evidence before changing policy.";
    }
    if (group.kind === "supervised_correction") {
      return "Prefer in Student Lab learning loop and validate before promotion.";
    }
    if (group.kind === "tool_routing_signal") {
      return "Use as routing evidence when the same tool/category condition repeats.";
    }
    if (group.kind === "reasoning_example") {
      return "Use as benchmark-backed reasoning example, not as a memorized answer.";
    }
    return "Use as weak contextual guidance only when the category and source match.";
  }

  private buildActiveHints(candidates: InteractionLearningCandidate[]) {
    return candidates
      .filter((candidate) => candidate.state === "active" || candidate.confidence >= 0.66)
      .filter((candidate) => candidate.kind !== "repair_signal" || candidate.evidenceCount >= 2)
      .sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidence - left.confidence ||
          right.evidenceCount - left.evidenceCount
      )
      .slice(0, 48)
      .map((candidate) => ({
        candidateId: candidate.candidateId,
        category: candidate.category,
        priority:
          candidate.state === "active" && candidate.confidence >= 0.82
            ? "high"
            : candidate.confidence >= 0.72
              ? "medium"
              : "low",
        hint: candidate.learned,
        conditions: candidate.conditions.slice(0, 6),
        confidence: candidate.confidence
      }));
  }
}

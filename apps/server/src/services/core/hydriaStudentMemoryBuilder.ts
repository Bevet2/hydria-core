import { randomUUID } from "node:crypto";
import type {
  QuestionCategory,
  ResearchToolLog
} from "../../types/arena.js";
import {
  hydriaMemorySnapshotSchema,
  type HydriaMemorySnapshot
} from "../../types/core.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type { StudentResponseStrategy } from "../../types/student.js";
import {
  buildItem,
  buildRetrieval,
  compactText,
  uniqueStrings
} from "./hydriaMemoryShared.js";

export type HydriaStudentMemorySnapshotArgs = {
  question: string;
  category: QuestionCategory;
  knowledge: KnowledgeInjection | null;
  strategy: StudentResponseStrategy;
  research?: ResearchToolLog | null;
  extraEpisodicItems?: string[];
};

export function buildStudentMemorySnapshot(
  args: HydriaStudentMemorySnapshotArgs
): HydriaMemorySnapshot {
  const { knowledge, research, strategy } = args;

  const core = knowledge
    ? [
        buildItem({
          layer: "core",
          priority: "high",
          title: "Strategy note",
          content: knowledge.strategyNote,
          tags: [strategy.strategyId, "strategy"]
        }),
        buildItem({
          layer: "core",
          priority: "medium",
          title: "Routing recommendation",
          content: `Route: ${knowledge.routingRecommendation}. Tool policy: ${knowledge.toolRecommendation}.`,
          tags: ["routing", "tooling"]
        }),
        buildItem({
          layer: "core",
          priority: "medium",
          title: "Memory summary",
          content: knowledge.memorySummary,
          tags: ["memory"]
        })
      ]
    : [
        buildItem({
          layer: "core",
          priority: "medium",
          title: "Fallback strategy",
          content: `No injected knowledge was available. Use ${strategy.strategyId} with disciplined local answering.`,
          tags: [strategy.strategyId, "fallback"]
        })
      ];

  const episodic = uniqueStrings([
    ...(knowledge?.coachingHints ?? []),
    ...(args.extraEpisodicItems ?? [])
  ])
    .slice(0, 6)
    .map((entry, index) =>
      buildItem({
        layer: "episodic",
        priority: index < 2 ? "high" : "medium",
        title: `Coaching hint ${index + 1}`,
        content: entry,
        tags: ["coaching"]
      })
    );

  const semantic = uniqueStrings([
    ...(knowledge?.memoryRules.map(
      (rule) => `${rule.domain}: ${rule.lesson} Recommended: ${rule.recommendedStrategy}`
    ) ?? []),
    ...(knowledge?.studentMemoryRules.map(
      (rule) => `${rule.failureType}: ${rule.rule} Conditions: ${rule.conditions.join(", ") || "general"}`
    ) ?? [])
  ])
    .slice(0, 8)
    .map((entry, index) =>
      buildItem({
        layer: "semantic",
        priority: index < 3 ? "high" : "medium",
        title: `Rule ${index + 1}`,
        content: entry,
        tags: ["rule"]
      })
    );

  const archival = uniqueStrings([
    ...(knowledge?.winningPatterns.map((pattern) => `Winning pattern: ${pattern}`) ?? []),
    ...(knowledge?.bestRoundReferences.map(
      (reference) => `Reference ${reference.roundId}: ${reference.note}`
    ) ?? [])
  ])
    .slice(0, 6)
    .map((entry, index) =>
      buildItem({
        layer: "archival",
        priority: index === 0 ? "high" : "low",
        title: `Reference ${index + 1}`,
        content: entry,
        tags: ["reference"]
      })
    );

  const summary = knowledge
    ? compactText(
        `Hydria memory loaded ${core.length} core items, ${semantic.length} semantic rules, and strategy ${strategy.strategyId} for ${args.category}.`,
        320
      )
    : compactText(
        `Hydria memory is operating in fallback mode with strategy ${strategy.strategyId} for ${args.category}.`,
        320
      );

  return hydriaMemorySnapshotSchema.parse({
    snapshotId: randomUUID(),
    question: args.question,
    category: args.category,
    summary,
    core,
    episodic,
    semantic,
    archival,
    retrieval: buildRetrieval({
      strategyId: strategy.strategyId,
      research,
      knowledge
    })
  });
}

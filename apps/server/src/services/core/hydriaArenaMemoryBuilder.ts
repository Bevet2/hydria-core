import { randomUUID } from "node:crypto";
import type {
  OrchestrationPolicyDetails,
  QuestionCategory,
  RefineRouterDecisionDetails,
  ResearchToolLog
} from "../../types/arena.js";
import {
  hydriaMemorySnapshotSchema,
  type HydriaMemorySnapshot
} from "../../types/core.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import {
  buildItem,
  buildRetrieval,
  compactText,
  uniqueStrings
} from "./hydriaMemoryShared.js";

export type HydriaArenaMemorySnapshotArgs = {
  question: string;
  category: QuestionCategory;
  knowledge: KnowledgeInjection | null;
  orchestration: OrchestrationPolicyDetails;
  router: RefineRouterDecisionDetails;
  research: ResearchToolLog;
  extraEpisodicItems?: string[];
};

export function buildArenaMemorySnapshot(
  args: HydriaArenaMemorySnapshotArgs
): HydriaMemorySnapshot {
  const { knowledge, orchestration, router, research } = args;
  const strategyId = `arena:${router.globalStrategy}`;

  const core = [
    buildItem({
      layer: "core",
      priority: "high",
      title: "Arena orchestration",
      content: `Focus ${orchestration.focus}. Refine policy ${orchestration.refinePolicy}. Research policy ${orchestration.researchPolicy}.`,
      tags: ["orchestration", router.globalStrategy]
    }),
    buildItem({
      layer: "core",
      priority: "medium",
      title: "Arena router strategy",
      content: `${router.reasoning.join(" ")} A=${router.estimatedValue.A} B=${router.estimatedValue.B}.`,
      tags: ["router", router.globalStrategy]
    }),
    buildItem({
      layer: "core",
      priority: "medium",
      title: "Research posture",
      content: research.decision.reasoning,
      tags: ["research", research.queryPlan.intent]
    }),
    ...(knowledge
      ? [
          buildItem({
            layer: "core",
            priority: "medium",
            title: "Knowledge strategy note",
            content: knowledge.strategyNote,
            tags: ["knowledge"]
          })
        ]
      : [])
  ].slice(0, 6);

  const episodic = uniqueStrings([
    ...orchestration.targetOutcomes,
    ...orchestration.prioritySignals,
    ...router.reasoning,
    ...(args.extraEpisodicItems ?? [])
  ])
    .slice(0, 8)
    .map((entry, index) =>
      buildItem({
        layer: "episodic",
        priority: index < 3 ? "high" : "medium",
        title: `Arena signal ${index + 1}`,
        content: entry,
        tags: ["arena"]
      })
    );

  const semantic = uniqueStrings([
    ...(knowledge?.memoryRules.map(
      (rule) => `${rule.domain}: ${rule.lesson} Recommended: ${rule.recommendedStrategy}`
    ) ?? []),
    ...(knowledge?.studentMemoryRules.map(
      (rule) => `${rule.failureType}: ${rule.rule} Conditions: ${rule.conditions.join(", ") || "general"}`
    ) ?? []),
    ...orchestration.reasoning
  ])
    .slice(0, 10)
    .map((entry, index) =>
      buildItem({
        layer: "semantic",
        priority: index < 4 ? "high" : "medium",
        title: `Arena rule ${index + 1}`,
        content: entry,
        tags: ["arena_rule"]
      })
    );

  const archival = uniqueStrings([
    ...(knowledge?.winningPatterns.map((pattern) => `Winning pattern: ${pattern}`) ?? []),
    ...(knowledge?.bestRoundReferences.map(
      (reference) => `Reference ${reference.roundId}: ${reference.note}`
    ) ?? []),
    ...research.summary
  ])
    .slice(0, 8)
    .map((entry, index) =>
      buildItem({
        layer: "archival",
        priority: index < 2 ? "high" : "low",
        title: `Arena reference ${index + 1}`,
        content: entry,
        tags: ["reference"]
      })
    );

  const summary = compactText(
    `Hydria arena memory loaded ${core.length} core items, router ${router.globalStrategy}, and research intent ${research.queryPlan.intent} for ${args.category}.`,
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
      strategyId,
      research,
      knowledge
    })
  });
}

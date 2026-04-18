import { randomUUID } from "node:crypto";
import type { ResearchToolLog } from "../../types/arena.js";
import type {
  HydriaMemoryItem,
  HydriaMemoryLayer,
  HydriaMemoryPriority,
  HydriaMemorySnapshot
} from "../../types/core.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function compactText(value: string, max = 320) {
  return value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`;
}

export function buildItem(args: {
  layer: HydriaMemoryLayer;
  priority: HydriaMemoryPriority;
  title: string;
  content: string;
  tags?: string[];
}): HydriaMemoryItem {
  return {
    itemId: randomUUID(),
    layer: args.layer,
    priority: args.priority,
    title: compactText(args.title, 140),
    content: compactText(args.content, 320),
    tags: uniqueStrings(args.tags ?? []).slice(0, 8)
  };
}

export function buildRetrieval(args: {
  strategyId: string;
  research?: ResearchToolLog | null;
  knowledge?: KnowledgeInjection | null;
}): HydriaMemorySnapshot["retrieval"] {
  const research = args.research ?? null;
  return {
    strategyId: args.strategyId,
    researchIntent: research?.decision.shouldUse ? research.queryPlan.intent : null,
    temporalQueryType:
      research?.decision.shouldUse && research.queryPlan.temporalProfile.isTemporal
        ? research.queryPlan.temporalProfile.queryType
        : null,
    preferredDomains: research?.queryPlan.preferredDomains ?? [],
    studentRuleIds:
      args.knowledge?.studentMemoryRules.map((rule) => rule.ruleId).slice(0, 8) ?? []
  };
}

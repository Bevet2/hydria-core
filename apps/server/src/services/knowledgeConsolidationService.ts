import type { QuestionCategory } from "../types/arena.js";
import type {
  InteractionLearningCandidate,
  InteractionLearningDigest
} from "../types/interactionLearning.js";
import type {
  KnowledgeObject,
  KnowledgeObjectClass,
  KnowledgeObjectState,
  KnowledgeObjectType
} from "../types/knowledgeObjects.js";
import { InteractionLearningDigestService } from "./interactionLearningDigestService.js";
import { KnowledgeObjectStore } from "./knowledgeObjectStore.js";

type KnowledgeConsolidationServiceOptions = {
  interactionLearningDigestService?: Pick<InteractionLearningDigestService, "load" | "buildAndPersist">;
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "upsertMany" | "load">;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function compact(value: string, maxChars = 320) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function titleFor(candidate: InteractionLearningCandidate) {
  const category = candidate.category?.replaceAll("_", " ") ?? "general";
  const kind = candidate.kind.replaceAll("_", " ");
  return `${kind} for ${category}`;
}

function objectTypeFor(candidate: InteractionLearningCandidate): KnowledgeObjectType {
  switch (candidate.kind) {
    case "tool_routing_signal":
      return "tool_rule";
    case "repair_signal":
      return "failure_pattern";
    case "supervised_correction":
      return "decision_rule";
    case "reasoning_example":
      return "reasoning_example";
    default:
      return "pattern";
  }
}

function objectClassFor(candidate: InteractionLearningCandidate): KnowledgeObjectClass {
  if (candidate.kind === "repair_signal" || candidate.riskLevel === "high") {
    return "guarded";
  }
  if (candidate.state === "active" && candidate.evidenceCount >= 3) {
    return "stable";
  }
  return "experimental";
}

function objectStateFor(candidate: InteractionLearningCandidate): KnowledgeObjectState {
  if (candidate.kind === "repair_signal") {
    return candidate.evidenceCount >= 2 ? "guarded" : "candidate";
  }
  if (candidate.state === "active" && candidate.confidence >= 0.82) {
    return "active";
  }
  if (candidate.confidence >= 0.68) {
    return "validated";
  }
  return "candidate";
}

function decayFor(knowledgeClass: KnowledgeObjectClass, now: string) {
  if (knowledgeClass === "stable") {
    return {
      policy: "slow" as const,
      validFrom: now,
      expiresAt: null,
      rationale: "Stable interaction-derived pattern; monitor through future learning cycles."
    };
  }
  if (knowledgeClass === "guarded") {
    return {
      policy: "standard" as const,
      validFrom: now,
      expiresAt: null,
      rationale: "Guarded signal must be revalidated before active promotion."
    };
  }
  return {
    policy: "standard" as const,
    validFrom: now,
    expiresAt: null,
    rationale: "Experimental memory should decay unless repeated evidence confirms it."
  };
}

function domainFor(category: QuestionCategory | null) {
  return category ?? "general";
}

function tagsFor(candidate: InteractionLearningCandidate, type: KnowledgeObjectType) {
  return [
    "interaction-learning",
    candidate.source,
    candidate.scope,
    candidate.mode ?? null,
    candidate.category ?? null,
    type,
    candidate.riskLevel === "high" ? "guarded" : null
  ].filter((value): value is string => Boolean(value)).slice(0, 16);
}

export class KnowledgeConsolidationService {
  private readonly interactionLearningDigestService: Pick<
    InteractionLearningDigestService,
    "load" | "buildAndPersist"
  >;
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "upsertMany" | "load">;

  constructor(options: KnowledgeConsolidationServiceOptions = {}) {
    this.interactionLearningDigestService =
      options.interactionLearningDigestService ?? new InteractionLearningDigestService();
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
  }

  async buildAndPersist(args: { rebuildInteractionDigest?: boolean; limit?: number } = {}) {
    const digest = args.rebuildInteractionDigest
      ? await this.interactionLearningDigestService.buildAndPersist({ limit: args.limit })
      : (await this.interactionLearningDigestService.load()) ??
        (await this.interactionLearningDigestService.buildAndPersist({ limit: args.limit }));
    const objects = this.buildObjects(digest);
    const file = await this.knowledgeObjectStore.upsertMany(objects);

    return {
      digest,
      file,
      objects
    };
  }

  async loadObjects() {
    return this.knowledgeObjectStore.load();
  }

  private buildObjects(digest: InteractionLearningDigest) {
    const now = new Date().toISOString();
    return digest.candidates.map((candidate) => this.candidateToObject(candidate, now));
  }

  private candidateToObject(candidate: InteractionLearningCandidate, now: string): KnowledgeObject {
    const type = objectTypeFor(candidate);
    const knowledgeClass = objectClassFor(candidate);
    const state = objectStateFor(candidate);
    const objectId = `ko::interaction::${stableShortHash(candidate.candidateId)}`;
    const confidence = Number(
      clamp(candidate.confidence * (candidate.evidenceCount >= 2 ? 1 : 0.92), 0, 0.96).toFixed(3)
    );

    return {
      objectId,
      title: titleFor(candidate),
      type,
      knowledgeClass,
      state,
      domain: domainFor(candidate.category),
      category: candidate.category,
      content: compact(`${candidate.learned} Recommended action: ${candidate.recommendedAction}`, 1200),
      summary: compact(candidate.learned),
      tags: tagsFor(candidate, type),
      confidence,
      riskLevel: candidate.riskLevel,
      evidenceCount: candidate.evidenceCount,
      sources: [
        {
          sourceType: "interaction_learning",
          sourceId: candidate.candidateId,
          sourceUri: "storage/learning/hydria-interaction-learning-v1.json",
          evidenceRecordIds: candidate.evidenceRecordIds
        }
      ],
      relations: [],
      decay: decayFor(knowledgeClass, now),
      createdAt: candidate.createdAt,
      updatedAt: now
    };
  }
}

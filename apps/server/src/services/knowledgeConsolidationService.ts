import type { QuestionCategory } from "../types/arena.js";
import type {
  InteractionLearningCandidate,
  InteractionLearningDigest
} from "../types/interactionLearning.js";
import type {
  KnowledgeQualityGateDecision,
  KnowledgeQualityGateReport
} from "../types/knowledgeQualityGate.js";
import type {
  KnowledgeObject,
  KnowledgeObjectClass,
  KnowledgeObjectState,
  KnowledgeObjectType
} from "../types/knowledgeObjects.js";
import type {
  SourceAcquisitionFile,
  SourceAcquisitionItem
} from "../types/sourceAcquisition.js";
import type { WatcherKnowledgeCandidate, WatcherState } from "../types/watchers.js";
import { InteractionLearningDigestService } from "./interactionLearningDigestService.js";
import { KnowledgeObjectStore } from "./knowledgeObjectStore.js";
import { KnowledgeQualityGateService } from "./knowledgeQualityGateService.js";
import { SourceAcquisitionStore } from "./sourceAcquisitionStore.js";
import { WatcherStore } from "./watchers/watcherStore.js";

type KnowledgeConsolidationServiceOptions = {
  interactionLearningDigestService?: Pick<InteractionLearningDigestService, "load" | "buildAndPersist">;
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "upsertMany" | "load">;
  watcherStore?: Pick<WatcherStore, "load">;
  sourceAcquisitionStore?: Pick<SourceAcquisitionStore, "load">;
  knowledgeQualityGateService?: Pick<KnowledgeQualityGateService, "loadReport">;
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
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return normalized.slice(0, maxChars);
  }

  return `${normalized.slice(0, maxChars - 3).trim()}...`;
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
  if (knowledgeClass === "dynamic") {
    return {
      policy: "fast" as const,
      validFrom: now,
      expiresAt: null,
      rationale: "Dynamic watcher-derived knowledge must be refreshed before promotion."
    };
  }
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

function watcherObjectTypeFor(candidate: WatcherKnowledgeCandidate): KnowledgeObjectType {
  switch (candidate.candidateType) {
    case "gap_repair":
      return "failure_pattern";
    case "stable_knowledge":
      return "pattern";
    case "source_profile":
      return "pattern";
    case "trend_signal":
      return "fact";
    default:
      return "fact";
  }
}

function watcherObjectClassFor(candidate: WatcherKnowledgeCandidate): KnowledgeObjectClass {
  if (candidate.candidateType === "gap_repair" || candidate.riskLevel === "high") {
    return "guarded";
  }
  if (candidate.candidateType === "stable_knowledge" || candidate.freshness === "stable") {
    return "stable";
  }
  if (
    candidate.candidateType === "dynamic_knowledge" ||
    candidate.candidateType === "trend_signal" ||
    (candidate.candidateType === "source_profile" &&
      (candidate.freshness === "live" || candidate.freshness === "recent"))
  ) {
    return "dynamic";
  }
  return "experimental";
}

function watcherObjectStateFor(candidate: WatcherKnowledgeCandidate): KnowledgeObjectState {
  if (candidate.state === "guarded" || candidate.candidateType === "gap_repair") {
    return "guarded";
  }
  if (candidate.state === "rejected" || candidate.state === "archived") {
    return "archived";
  }
  if (candidate.state === "validated" || candidate.state === "active") {
    return "validated";
  }
  return "candidate";
}

function watcherTagsFor(candidate: WatcherKnowledgeCandidate, type: KnowledgeObjectType) {
  return [
    "watcher",
    `${candidate.watcherKind}-watcher`,
    candidate.watcherId,
    candidate.candidateType,
    candidate.freshness,
    candidate.category ?? null,
    type,
    candidate.riskLevel === "high" ? "guarded" : null,
    ...candidate.tags
  ].filter((value): value is string => Boolean(value)).slice(0, 16);
}

function sourceAcquisitionClassFor(
  item: SourceAcquisitionItem,
  decision: KnowledgeQualityGateDecision | null
): KnowledgeObjectClass {
  if (decision?.decision === "guarded" || item.riskLevel === "high") {
    return "guarded";
  }
  if (item.freshness === "live" || item.freshness === "recent") {
    return "dynamic";
  }
  if (item.freshness === "stable") {
    return "stable";
  }
  return "experimental";
}

function sourceAcquisitionStateFor(
  item: SourceAcquisitionItem,
  decision: KnowledgeQualityGateDecision | null
): KnowledgeObjectState {
  if (item.state === "expired") {
    return "archived";
  }
  if (decision?.decision === "guarded") {
    return "guarded";
  }
  if (decision?.decision === "candidate") {
    return "candidate";
  }
  if (decision?.decision === "promotable") {
    return "validated";
  }
  if (item.state === "corroborated" && item.riskLevel !== "high") {
    return "validated";
  }
  return "candidate";
}

function sourceAcquisitionTagsFor(item: SourceAcquisitionItem, decision: KnowledgeQualityGateDecision | null) {
  return [
    "source-acquisition",
    decision ? "quality-gated" : null,
    decision ? `quality-${decision.decision}` : null,
    item.packId,
    item.freshness,
    item.category ?? null,
    item.state,
    item.riskLevel === "high" ? "guarded" : null,
    ...item.tags
  ].filter((value): value is string => Boolean(value)).slice(0, 16);
}

function sourceQualityDecisionMap(report: KnowledgeQualityGateReport | null) {
  return new Map((report?.decisions ?? []).map((decision) => [decision.itemId, decision]));
}

function sourceAcquisitionSourceId(object: KnowledgeObject) {
  return object.sources.find((source) => source.sourceType === "source_acquisition")?.sourceId ?? null;
}

export class KnowledgeConsolidationService {
  private readonly interactionLearningDigestService: Pick<
    InteractionLearningDigestService,
    "load" | "buildAndPersist"
  >;
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "upsertMany" | "load">;
  private readonly watcherStore: Pick<WatcherStore, "load">;
  private readonly sourceAcquisitionStore: Pick<SourceAcquisitionStore, "load">;
  private readonly knowledgeQualityGateService: Pick<KnowledgeQualityGateService, "loadReport">;

  constructor(options: KnowledgeConsolidationServiceOptions = {}) {
    this.interactionLearningDigestService =
      options.interactionLearningDigestService ?? new InteractionLearningDigestService();
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
    this.watcherStore = options.watcherStore ?? new WatcherStore();
    this.sourceAcquisitionStore = options.sourceAcquisitionStore ?? new SourceAcquisitionStore();
    this.knowledgeQualityGateService =
      options.knowledgeQualityGateService ?? new KnowledgeQualityGateService();
  }

  async buildAndPersist(args: { rebuildInteractionDigest?: boolean; limit?: number } = {}) {
    const digest = args.rebuildInteractionDigest
      ? await this.interactionLearningDigestService.buildAndPersist({ limit: args.limit })
      : (await this.interactionLearningDigestService.load()) ??
        (await this.interactionLearningDigestService.buildAndPersist({ limit: args.limit }));
    const watcherState = await this.watcherStore.load();
    const sourceAcquisition = await this.sourceAcquisitionStore.load();
    const knowledgeQualityGate = await this.knowledgeQualityGateService.loadReport();
    const existingObjects = await this.knowledgeObjectStore.load();
    const objects = this.buildObjects(
      digest,
      watcherState,
      sourceAcquisition,
      knowledgeQualityGate,
      existingObjects?.objects ?? []
    );
    const file = await this.knowledgeObjectStore.upsertMany(objects);

    return {
      digest,
      watcherState,
      sourceAcquisition,
      knowledgeQualityGate,
      file,
      objects
    };
  }

  async loadObjects() {
    return this.knowledgeObjectStore.load();
  }

  private buildObjects(
    digest: InteractionLearningDigest,
    watcherState: WatcherState | null,
    sourceAcquisition: SourceAcquisitionFile | null,
    knowledgeQualityGate: KnowledgeQualityGateReport | null,
    existingObjects: KnowledgeObject[]
  ) {
    const now = new Date().toISOString();
    const qualityByItem = sourceQualityDecisionMap(knowledgeQualityGate);
    const currentSourceIds = new Set((sourceAcquisition?.items ?? []).map((item) => item.itemId));
    return [
      ...digest.candidates.map((candidate) => this.candidateToObject(candidate, now)),
      ...(watcherState?.candidates ?? []).map((candidate) =>
        this.watcherCandidateToObject(candidate, now)
      ),
      ...(sourceAcquisition?.items ?? []).flatMap((item) => {
        const qualityDecision = qualityByItem.get(item.itemId) ?? null;
        if (qualityDecision?.decision === "rejected") {
          return [];
        }

        return [this.sourceAcquisitionItemToObject(item, now, qualityDecision)];
      }),
      ...this.archiveStaleSourceObjects({
        existingObjects,
        currentSourceIds,
        qualityByItem,
        sourceAcquisitionLoaded: sourceAcquisition !== null,
        now
      })
    ];
  }

  private archiveStaleSourceObjects(args: {
    existingObjects: KnowledgeObject[];
    currentSourceIds: Set<string>;
    qualityByItem: Map<string, KnowledgeQualityGateDecision>;
    sourceAcquisitionLoaded: boolean;
    now: string;
  }) {
    if (!args.sourceAcquisitionLoaded) {
      return [];
    }

    return args.existingObjects.flatMap((object) => {
      const sourceId = sourceAcquisitionSourceId(object);
      if (!sourceId || object.state === "archived") {
        return [];
      }
      const qualityDecision = args.qualityByItem.get(sourceId);
      const shouldArchive =
        !args.currentSourceIds.has(sourceId) || qualityDecision?.decision === "rejected";
      if (!shouldArchive) {
        return [];
      }

      return [{
        ...object,
        state: "archived" as const,
        confidence: Number(clamp(object.confidence * 0.5, 0, 0.5).toFixed(3)),
        tags: [...new Set([...object.tags, "quality-archived"])].slice(0, 16),
        updatedAt: args.now
      }];
    });
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

  private watcherCandidateToObject(
    candidate: WatcherKnowledgeCandidate,
    now: string
  ): KnowledgeObject {
    const type = watcherObjectTypeFor(candidate);
    const knowledgeClass = watcherObjectClassFor(candidate);
    const state = watcherObjectStateFor(candidate);
    const objectId = `ko::watcher::${stableShortHash(candidate.candidateId)}`;
    const confidence = Number(
      clamp(
        candidate.confidence * (candidate.corroborationCount >= 2 ? 1 : 0.9),
        0,
        0.88
      ).toFixed(3)
    );

    return {
      objectId,
      title: candidate.title,
      type,
      knowledgeClass,
      state,
      domain: candidate.domain,
      category: candidate.category,
      content: compact(candidate.claim, 1200),
      summary: compact(candidate.summary),
      tags: watcherTagsFor(candidate, type),
      confidence,
      riskLevel: candidate.riskLevel,
      evidenceCount: candidate.corroborationCount + candidate.evidenceRecordIds.length,
      sources: [
        {
          sourceType: "watcher",
          sourceId: candidate.candidateId,
          sourceUri: "storage/learning/hydria-watchers-v1.json",
          evidenceRecordIds: candidate.evidenceRecordIds
        }
      ],
      relations: [],
      decay: decayFor(knowledgeClass, now),
      createdAt: candidate.createdAt,
      updatedAt: now
    };
  }

  private sourceAcquisitionItemToObject(
    item: SourceAcquisitionItem,
    now: string,
    qualityDecision: KnowledgeQualityGateDecision | null
  ): KnowledgeObject {
    const knowledgeClass = sourceAcquisitionClassFor(item, qualityDecision);
    const state = sourceAcquisitionStateFor(item, qualityDecision);
    const objectId = `ko::source-acquisition::${stableShortHash(item.itemId)}`;
    const confidence = Number(
      clamp(
        (qualityDecision?.adjustedConfidence ?? item.confidence) *
          (item.corroboratedSourceCount >= 2 ? 1 : 0.88),
        0,
        0.9
      ).toFixed(3)
    );

    return {
      objectId,
      title: item.title,
      type: "fact",
      knowledgeClass,
      state,
      domain: item.domain,
      category: item.category,
      content: compact(item.content, 1200),
      summary: compact(item.summary),
      tags: sourceAcquisitionTagsFor(item, qualityDecision),
      confidence,
      riskLevel: item.riskLevel,
      evidenceCount: item.corroboratedSourceCount,
      sources: [
        {
          sourceType: "source_acquisition",
          sourceId: item.itemId,
          sourceUri: item.sourceUrl,
          evidenceRecordIds: []
        }
      ],
      relations: [],
      decay: {
        policy: item.decay.policy,
        validFrom: item.decay.retrievedAt,
        expiresAt: item.decay.expiresAt,
        rationale: compact(item.decay.rationale, 240)
      },
      createdAt: item.retrievedAt,
      updatedAt: now
    };
  }
}

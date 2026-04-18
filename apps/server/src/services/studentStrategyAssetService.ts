import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QuestionCategory } from "../types/arena.js";
import type { StudentStrategyProfile, StudentRuleImpactContext } from "../types/student.js";
import { env } from "../utils/env.js";
import { scoreStudentRuleContextMatch } from "./studentRuleContext.js";
import type { StrategyDiscoveryFile } from "./studentStrategyDiscoveryService.js";

type StrategyAssetGuard = {
  passed: boolean;
  noiseOk: boolean;
  lengthOk: boolean;
  clarityOk: boolean;
  reasons: string[];
};

type StudentStrategyAsset = {
  assetId: string;
  assetVersion: number;
  status: "active";
  category: QuestionCategory;
  baseStrategyId: StudentStrategyProfile;
  adoptedStrategyId: StudentStrategyProfile;
  context: {
    questionType: StudentRuleImpactContext["questionType"];
    promptLength: StudentRuleImpactContext["promptLength"];
    signals: StudentRuleImpactContext["signals"];
  };
  trace: {
    proposalReason: string;
    adoptionReason: string;
    discoveryBuiltAt: string;
    sampleQuestions: string[];
  };
  evidence: {
    observations: number;
    winRate: number;
    averageJudgeDelta: number;
    averageGainGlobal: number;
    averageLengthDeltaWords: number;
    averageNoiseDelta: number;
    averageClarityDelta: number;
    productGuard: StrategyAssetGuard;
  };
  learning: {
    summary: string;
    promptHint: string;
    usageNote: string;
  };
};

type StudentStrategyAssetFile = {
  version: "hydria-student-strategy-assets-v1";
  builtAt: string;
  sourceStats: {
    discoveryBuiltAt: string | null;
    adoptedAssets: number;
  };
  assets: StudentStrategyAsset[];
};

function contextKey(context: {
  questionType: StudentRuleImpactContext["questionType"];
  promptLength: StudentRuleImpactContext["promptLength"];
  signals: StudentRuleImpactContext["signals"];
}) {
  return [
    context.questionType,
    context.promptLength,
    [...context.signals].sort().join(",")
  ].join("|");
}

function truncate(value: string, max = 180) {
  return value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`;
}

function buildAssetSummary(asset: Pick<StudentStrategyAsset, "context" | "baseStrategyId" | "adoptedStrategyId">) {
  return `When the question is ${asset.context.questionType}/${asset.context.promptLength} with signals ${asset.context.signals.join(", ") || "none"}, prefer ${asset.adoptedStrategyId} over ${asset.baseStrategyId}.`;
}

function buildPromptHint(asset: Pick<StudentStrategyAsset, "adoptedStrategyId">) {
  switch (asset.adoptedStrategyId) {
    case "factual_verify_first":
      return "Lead with uncertainty, verify before asserting, and keep the answer concise if facts remain unsettled.";
    case "explanatory_compact_example":
      return "Define briefly, then anchor immediately with one concrete example and one limit.";
    case "reasoning_bridge_medium":
      return "Bridge abstract reasoning to one concrete implication, and separate verified claims from interpretation.";
    case "open_scope_anchor":
      return "Anchor the answer with one concrete frame before widening the scope.";
    default:
      return `Prefer ${asset.adoptedStrategyId} when this context reappears.`;
  }
}

function defaultProductGuard(): StrategyAssetGuard {
  return {
    passed: true,
    noiseOk: true,
    lengthOk: true,
    clarityOk: true,
    reasons: []
  };
}

export class StudentStrategyAssetService {
  constructor(
    private readonly assetFile = env.STUDENT_STRATEGY_ASSETS_FILE,
    private readonly discoveryFile = env.STUDENT_STRATEGY_DISCOVERY_FILE
  ) {}

  async load() {
    const current = await this.readRawAssetFile();
    if (current) {
      return current;
    }

    const discovery = await this.readRawDiscoveryFile();
    if (!discovery) {
      return null;
    }

    return this.buildAndPersist(discovery);
  }

  async buildAndPersist(discovery: StrategyDiscoveryFile) {
    const current = await this.readRawAssetFile();
    const currentVersions = new Map(current?.assets.map((asset) => [asset.assetId, asset.assetVersion]) ?? []);
    const proposalIndex = new Map(
      discovery.proposals.map((proposal) => [
        `${proposal.baseStrategyId}::${proposal.candidateStrategyId}::${contextKey(proposal.context)}`,
        proposal
      ])
    );
    const assets: StudentStrategyAsset[] = discovery.adoptions
      .filter((adoption) => adoption.adoption === "adopted")
      .map((adoption) => {
        const key = `${adoption.baseStrategyId}::${adoption.candidateStrategyId}::${contextKey(adoption.context)}`;
        const proposal = proposalIndex.get(key);
        const assetId = `strategy:${adoption.baseStrategyId}->${adoption.candidateStrategyId}:${contextKey(adoption.context)}`;
        const sampleQuestions = discovery.evaluations
          .filter(
            (evaluation) =>
              evaluation.baseStrategyId === adoption.baseStrategyId &&
              evaluation.candidateStrategyId === adoption.candidateStrategyId &&
              contextKey(evaluation.context) === contextKey(adoption.context)
          )
          .map((evaluation) => evaluation.question)
          .slice(0, 4);

        return {
          assetId,
          assetVersion: currentVersions.get(assetId) ?? 1,
          status: "active" as const,
          category: adoption.category,
          baseStrategyId: adoption.baseStrategyId,
          adoptedStrategyId: adoption.candidateStrategyId,
          context: adoption.context,
          trace: {
            proposalReason:
              proposal?.reason ?? `Discovery loop proposed ${adoption.candidateStrategyId} for this context.`,
            adoptionReason: adoption.reason,
            discoveryBuiltAt: discovery.builtAt,
            sampleQuestions
          },
          evidence: {
            observations: adoption.observations,
            winRate: adoption.winRate,
            averageJudgeDelta: adoption.averageJudgeDelta,
            averageGainGlobal: adoption.averageGainGlobal,
            averageLengthDeltaWords: adoption.averageLengthDeltaWords,
            averageNoiseDelta: adoption.averageNoiseDelta ?? 0,
            averageClarityDelta: adoption.averageClarityDelta ?? 0,
            productGuard: adoption.productGuard ?? defaultProductGuard()
          },
          learning: {
            summary: buildAssetSummary({
              context: adoption.context,
              baseStrategyId: adoption.baseStrategyId,
              adoptedStrategyId: adoption.candidateStrategyId
            }),
            promptHint: buildPromptHint({ adoptedStrategyId: adoption.candidateStrategyId }),
            usageNote: truncate(adoption.reason, 220)
          }
        };
      })
      .sort((left, right) => right.evidence.averageJudgeDelta - left.evidence.averageJudgeDelta);

    const payload: StudentStrategyAssetFile = {
      version: "hydria-student-strategy-assets-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        discoveryBuiltAt: discovery.builtAt,
        adoptedAssets: assets.length
      },
      assets
    };

    await mkdir(dirname(this.assetFile), { recursive: true });
    await writeFile(this.assetFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async resolve(
    baseStrategyId: StudentStrategyProfile,
    context: StudentRuleImpactContext | null
  ) {
    if (!context) {
      return null;
    }

    const assets = await this.load();
    if (!assets) {
      return null;
    }

    return (
      assets.assets
        .filter((asset) => asset.status === "active" && asset.baseStrategyId === baseStrategyId)
        .map((asset) => ({
          ...asset,
          matchScore: scoreStudentRuleContextMatch(context, {
            questionType: asset.context.questionType,
            promptLength: asset.context.promptLength,
            promptWordCount: context.promptWordCount,
            signals: asset.context.signals
          })
        }))
        .filter((asset) => asset.matchScore >= 5)
        .sort(
          (left, right) =>
            right.matchScore - left.matchScore ||
            right.evidence.observations - left.evidence.observations ||
            right.evidence.averageJudgeDelta - left.evidence.averageJudgeDelta
        )[0] ?? null
    );
  }

  async listByCategory(category: QuestionCategory) {
    const assets = await this.load();
    return (assets?.assets ?? []).filter((asset) => asset.category === category);
  }

  private async readRawAssetFile() {
    try {
      const raw = await readFile(this.assetFile, "utf8");
      return JSON.parse(raw) as StudentStrategyAssetFile;
    } catch {
      return null;
    }
  }

  private async readRawDiscoveryFile() {
    try {
      const raw = await readFile(this.discoveryFile, "utf8");
      return JSON.parse(raw) as StrategyDiscoveryFile;
    } catch {
      return null;
    }
  }
}

export type {
  StudentStrategyAsset,
  StudentStrategyAssetFile,
  StrategyAssetGuard
};

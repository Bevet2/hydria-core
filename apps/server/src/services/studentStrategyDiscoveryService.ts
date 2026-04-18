import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { QuestionCategory } from "../types/arena.js";
import type { StudentStrategyProfile, StudentRuleImpactContext } from "../types/student.js";
import { env } from "../utils/env.js";
import { scoreStudentRuleContextMatch } from "./studentRuleContext.js";
import { StudentStrategyAssetService, type StrategyAssetGuard } from "./studentStrategyAssetService.js";
import {
  StudentStrategyImpactTrackerService,
  type StudentStrategyImpactAggregate,
  type StudentStrategyImpactContextAggregate
} from "./studentStrategyImpactTrackerService.js";

type DiscoveryProposal = {
  baseStrategyId: StudentStrategyProfile;
  candidateStrategyId: StudentStrategyProfile;
  category: QuestionCategory;
  context: {
    questionType: StudentRuleImpactContext["questionType"];
    promptLength: StudentRuleImpactContext["promptLength"];
    signals: StudentRuleImpactContext["signals"];
  };
  currentActivation: "active" | "cautious" | "inactive";
  currentAverageJudgeDelta: number;
  reason: string;
};

type DiscoveryEvaluation = {
  question: string;
  category: QuestionCategory;
  baseStrategyId: StudentStrategyProfile;
  candidateStrategyId: StudentStrategyProfile;
  context: {
    questionType: StudentRuleImpactContext["questionType"];
    promptLength: StudentRuleImpactContext["promptLength"];
    signals: StudentRuleImpactContext["signals"];
  };
  judgeDelta: number;
  gainGlobal: number;
  success: boolean;
  lengthDeltaWords: number;
  structureDelta: number;
  noiseDelta: number;
  clarityDelta: number;
};

type DiscoveryAdoption = {
  baseStrategyId: StudentStrategyProfile;
  candidateStrategyId: StudentStrategyProfile;
  category: QuestionCategory;
  context: {
    questionType: StudentRuleImpactContext["questionType"];
    promptLength: StudentRuleImpactContext["promptLength"];
    signals: StudentRuleImpactContext["signals"];
  };
  observations: number;
  winRate: number;
  averageJudgeDelta: number;
  averageGainGlobal: number;
  averageLengthDeltaWords: number;
  averageAbsoluteLengthDeltaWords: number;
  averageStructureDelta: number;
  averageNoiseDelta: number;
  averageClarityDelta: number;
  productGuard: StrategyAssetGuard;
  adoption: "adopted" | "pending" | "rejected";
  reason: string;
};

type StrategyDiscoveryFile = {
  version: "hydria-student-strategy-discovery-v1";
  builtAt: string;
  sourceStats: {
    proposals: number;
    evaluations: number;
    adoptedReplacements: number;
  };
  proposals: DiscoveryProposal[];
  evaluations: DiscoveryEvaluation[];
  adoptions: DiscoveryAdoption[];
};

type CandidateMapping = {
  candidateStrategyId: StudentStrategyProfile;
  reason: string;
};

type DiscoverySummary = {
  observations: number;
  winRate: number;
  averageJudgeDelta: number;
  averageGainGlobal: number;
  averageLengthDeltaWords: number;
  averageAbsoluteLengthDeltaWords: number;
  averageStructureDelta: number;
  averageNoiseDelta: number;
  averageClarityDelta: number;
};

type SeedTarget = {
  baseStrategyId: StudentStrategyProfile;
  candidateStrategyId: StudentStrategyProfile;
  category: QuestionCategory;
  context: DiscoveryProposal["context"];
  reason: string;
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function contextKey(context: DiscoveryProposal["context"]) {
  return [
    context.questionType,
    context.promptLength,
    [...context.signals].sort().join(",")
  ].join("|");
}

function evaluationKey(evaluation: DiscoveryEvaluation) {
  return [
    evaluation.baseStrategyId,
    evaluation.candidateStrategyId,
    contextKey(evaluation.context),
    evaluation.question.trim().toLowerCase()
  ].join("::");
}

function summarize(values: DiscoveryEvaluation[]): DiscoverySummary {
  const observations = values.length;
  const wins = values.filter((value) => value.gainGlobal > 0).length;
  return {
    observations,
    winRate: round((wins / Math.max(observations, 1)) * 100),
    averageJudgeDelta: round(
      values.reduce((sum, value) => sum + value.judgeDelta, 0) / Math.max(observations, 1)
    ),
    averageGainGlobal: round(
      values.reduce((sum, value) => sum + value.gainGlobal, 0) / Math.max(observations, 1)
    ),
    averageLengthDeltaWords: round(
      values.reduce((sum, value) => sum + value.lengthDeltaWords, 0) / Math.max(observations, 1)
    ),
    averageAbsoluteLengthDeltaWords: round(
      values.reduce((sum, value) => sum + Math.abs(value.lengthDeltaWords ?? 0), 0) / Math.max(observations, 1)
    ),
    averageStructureDelta: round(
      values.reduce((sum, value) => sum + value.structureDelta, 0) / Math.max(observations, 1)
    ),
    averageNoiseDelta: round(
      values.reduce((sum, value) => sum + (value.noiseDelta ?? 0), 0) / Math.max(observations, 1)
    ),
    averageClarityDelta: round(
      values.reduce((sum, value) => sum + (value.clarityDelta ?? 0), 0) / Math.max(observations, 1)
    )
  };
}

function getLengthGuardThreshold(promptLength: StudentRuleImpactContext["promptLength"]) {
  switch (promptLength) {
    case "short":
      return 26;
    case "medium":
      return 40;
    case "long":
      return 65;
  }
}

function evaluateProductGuard(
  context: DiscoveryProposal["context"],
  summary: DiscoverySummary
): StrategyAssetGuard {
  const noiseOk = summary.averageNoiseDelta <= 1.25;
  const lengthOk = summary.averageAbsoluteLengthDeltaWords <= getLengthGuardThreshold(context.promptLength);
  const clarityOk = summary.averageClarityDelta >= -0.25;
  const reasons: string[] = [];

  if (!noiseOk) {
    reasons.push(`Noise delta too high (${summary.averageNoiseDelta}).`);
  }
  if (!lengthOk) {
    reasons.push(
      `Length drift too high for ${context.promptLength} prompts (${summary.averageAbsoluteLengthDeltaWords} words).`
    );
  }
  if (!clarityOk) {
    reasons.push(`Clarity regressed on average (${summary.averageClarityDelta}).`);
  }

  return {
    passed: noiseOk && lengthOk && clarityOk,
    noiseOk,
    lengthOk,
    clarityOk,
    reasons
  };
}

function buildSeedTargets(category: QuestionCategory): SeedTarget[] {
  const targets = [
    {
      baseStrategyId: "explanatory_short",
      candidateStrategyId: "explanatory_compact_example",
      context: {
        questionType: "explanatory",
        promptLength: "short",
        signals: []
      },
      reason:
        "Short explanatory prompts often need a compact definition plus one concrete example, not a thin abstract answer."
    },
    {
      baseStrategyId: "explanatory_medium",
      candidateStrategyId: "reasoning_bridge_medium",
      context: {
        questionType: "explanatory",
        promptLength: "medium",
        signals: ["claims", "abstraction"]
      },
      reason:
        "Ambiguous mixed-reasoning prompts need a bridge between externally claimed facts and broader implications."
    },
    {
      baseStrategyId: "open_medium",
      candidateStrategyId: "reasoning_bridge_medium",
      context: {
        questionType: "open",
        promptLength: "medium",
        signals: ["uncertainty", "abstraction"]
      },
      reason:
        "Open ambiguous prompts benefit from one concrete implication and one explicit boundary instead of a diffuse overview."
    },
    {
      baseStrategyId: "open_short",
      candidateStrategyId: "open_scope_anchor",
      context: {
        questionType: "open",
        promptLength: "short",
        signals: ["abstraction"]
      },
      reason:
        "Short open prompts with abstract scope often stay too vague unless the answer is anchored with one concrete frame."
    }
  ] satisfies Array<Omit<SeedTarget, "category">>;

  return targets.map((entry) => ({
    ...entry,
    category
  }));
}

export class StudentStrategyDiscoveryService {
  private readonly strategyImpactTrackerService = new StudentStrategyImpactTrackerService();
  private readonly strategyAssetService: StudentStrategyAssetService;

  constructor(
    private readonly discoveryFile = env.STUDENT_STRATEGY_DISCOVERY_FILE
  ) {
    this.strategyAssetService = new StudentStrategyAssetService(
      env.STUDENT_STRATEGY_ASSETS_FILE,
      discoveryFile
    );
  }

  async load() {
    const current = await this.readRawDiscoveryFile();
    if (current) {
      return current;
    }

    return this.buildFallbackDiscovery();
  }

  async identifyWeakContexts(category: QuestionCategory = "other"): Promise<DiscoveryProposal[]> {
    const tracker = await this.strategyImpactTrackerService.load();
    const discovery = await this.load();
    if (!tracker) {
      return buildSeedTargets(category).map((seed) => ({
        baseStrategyId: seed.baseStrategyId,
        candidateStrategyId: seed.candidateStrategyId,
        category,
        context: seed.context,
        currentActivation: "cautious",
        currentAverageJudgeDelta: 0,
        reason: seed.reason
      }));
    }

    const proposals: DiscoveryProposal[] = [];
    for (const strategy of tracker.strategies) {
      for (const context of strategy.contexts) {
        if (context.activation === "active" && context.averageJudgeDelta > 1) {
          continue;
        }

        const alreadyAdopted = (discovery?.adoptions ?? []).some(
          (adoption) =>
            adoption.adoption === "adopted" &&
            adoption.baseStrategyId === strategy.strategyId &&
            contextKey(adoption.context) === contextKey(context)
        );
        if (alreadyAdopted) {
          continue;
        }

        const mapping = this.proposeCandidate(strategy, context);
        if (!mapping) {
          continue;
        }

        proposals.push({
          baseStrategyId: strategy.strategyId,
          candidateStrategyId: mapping.candidateStrategyId,
          category,
          context: {
            questionType: context.questionType,
            promptLength: context.promptLength,
            signals: context.signals
          },
          currentActivation: context.activation,
          currentAverageJudgeDelta: context.averageJudgeDelta,
          reason: mapping.reason
        });
      }
    }

    for (const seed of buildSeedTargets(category)) {
      const alreadyAdopted = (discovery?.adoptions ?? []).some(
        (adoption) =>
          adoption.adoption === "adopted" &&
          adoption.baseStrategyId === seed.baseStrategyId &&
          adoption.candidateStrategyId === seed.candidateStrategyId &&
          contextKey(adoption.context) === contextKey(seed.context)
      );
      if (alreadyAdopted) {
        continue;
      }

      const strategy = tracker.strategies.find((entry) => entry.strategyId === seed.baseStrategyId);
      const matchedContext =
        strategy?.contexts.find((entry) => contextKey(entry) === contextKey(seed.context)) ?? null;
      if (matchedContext && matchedContext.activation === "active" && matchedContext.averageJudgeDelta > 1) {
        continue;
      }

      proposals.push({
        baseStrategyId: seed.baseStrategyId,
        candidateStrategyId: seed.candidateStrategyId,
        category,
        context: seed.context,
        currentActivation: matchedContext?.activation ?? strategy?.activation ?? "cautious",
        currentAverageJudgeDelta: matchedContext?.averageJudgeDelta ?? strategy?.averageJudgeDelta ?? 0,
        reason: seed.reason
      });
    }

    return this.dedupeProposals(proposals);
  }

  async resolveAdoptedStrategy(
    baseStrategyId: StudentStrategyProfile,
    context: StudentRuleImpactContext | null
  ): Promise<
    | {
        baseStrategyId: StudentStrategyProfile;
        candidateStrategyId: StudentStrategyProfile;
        category: QuestionCategory;
        context: DiscoveryProposal["context"];
        observations: number;
        averageJudgeDelta: number;
        reason: string;
      }
    | null
  > {
    if (!context) {
      return null;
    }

    const asset = await this.strategyAssetService.resolve(baseStrategyId, context);
    if (asset) {
      return {
        baseStrategyId: asset.baseStrategyId,
        candidateStrategyId: asset.adoptedStrategyId,
        category: asset.category,
        context: asset.context,
        observations: asset.evidence.observations,
        averageJudgeDelta: asset.evidence.averageJudgeDelta,
        reason: asset.trace.adoptionReason
      };
    }

    const discovery = await this.load();
    if (!discovery) {
      return null;
    }

    return (
      discovery.adoptions
        .filter(
          (adoption) =>
            adoption.adoption === "adopted" && adoption.baseStrategyId === baseStrategyId
        )
        .map((adoption) => ({
          ...adoption,
          matchScore: scoreStudentRuleContextMatch(context, {
            questionType: adoption.context.questionType,
            promptLength: adoption.context.promptLength,
            promptWordCount: context.promptWordCount,
            signals: adoption.context.signals
          })
        }))
        .filter((adoption) => adoption.matchScore >= 5)
        .sort(
          (left, right) =>
            right.matchScore - left.matchScore ||
            right.observations - left.observations ||
            right.averageJudgeDelta - left.averageJudgeDelta
        )[0] ?? null
    );
  }

  async recordEvaluations(args: {
    proposals?: DiscoveryProposal[];
    evaluations: DiscoveryEvaluation[];
  }) {
    const current = await this.load();
    const proposals = this.dedupeProposals([
      ...(current?.proposals ?? []),
      ...(args.proposals ?? [])
    ]);
    const evaluations = this.dedupeEvaluations([
      ...(current?.evaluations ?? []),
      ...args.evaluations
    ]);
    const grouped = new Map<string, DiscoveryEvaluation[]>();

    for (const evaluation of evaluations) {
      const key = `${evaluation.baseStrategyId}::${evaluation.candidateStrategyId}::${contextKey(
        evaluation.context
      )}`;
      const currentValues = grouped.get(key) ?? [];
      currentValues.push(evaluation);
      grouped.set(key, currentValues);
    }

    const adoptions: DiscoveryAdoption[] = [...grouped.entries()].map(([key, values]) => {
      const [baseStrategyId, candidateStrategyId] = key.split("::") as [
        StudentStrategyProfile,
        StudentStrategyProfile,
        string
      ];
      const first = values[0]!;
      const summary = summarize(values);
      const productGuard = evaluateProductGuard(first.context, summary);
      const positivePerformance =
        summary.observations >= 2 && summary.averageJudgeDelta > 1 && summary.winRate >= 60;
      const adoption: DiscoveryAdoption["adoption"] =
        positivePerformance && productGuard.passed
          ? "adopted"
          : summary.observations >= 2 &&
              (!positivePerformance ||
                !productGuard.clarityOk ||
                !productGuard.noiseOk ||
                (!productGuard.lengthOk && summary.observations >= 3))
            ? "rejected"
            : "pending";

      return {
        baseStrategyId,
        candidateStrategyId,
        category: first.category,
        context: first.context,
        ...summary,
        productGuard,
        adoption,
        reason:
          adoption === "adopted"
            ? `Candidate ${candidateStrategyId} beats ${baseStrategyId} in this context and passes the product guard.`
            : adoption === "rejected"
              ? `Candidate ${candidateStrategyId} failed to beat ${baseStrategyId} or violated the product guard in this context.${productGuard.reasons.length > 0 ? ` ${productGuard.reasons.join(" ")}` : ""}`
              : `Candidate ${candidateStrategyId} needs more observations before replacing ${baseStrategyId}.${productGuard.reasons.length > 0 ? ` Guard notes: ${productGuard.reasons.join(" ")}` : ""}`
      };
    });

    const payload: StrategyDiscoveryFile = {
      version: "hydria-student-strategy-discovery-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        proposals: proposals.length,
        evaluations: evaluations.length,
        adoptedReplacements: adoptions.filter((adoption) => adoption.adoption === "adopted").length
      },
      proposals,
      evaluations,
      adoptions: adoptions.sort(
        (left, right) =>
          Number(right.adoption === "adopted") - Number(left.adoption === "adopted") ||
          right.averageJudgeDelta - left.averageJudgeDelta ||
          right.observations - left.observations
      )
    };

    await mkdir(dirname(this.discoveryFile), { recursive: true });
    await writeFile(this.discoveryFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await this.strategyAssetService.buildAndPersist(payload);
    return payload;
  }

  private async buildFallbackDiscovery() {
    const tracker = await this.strategyImpactTrackerService.load();
    const assets = await this.strategyAssetService.load();
    const adoptedAdoptions: DiscoveryAdoption[] = (assets?.assets ?? []).map((asset) => ({
      baseStrategyId: asset.baseStrategyId,
      candidateStrategyId: asset.adoptedStrategyId,
      category: asset.category,
      context: asset.context,
      observations: asset.evidence.observations,
      winRate: asset.evidence.winRate,
      averageJudgeDelta: asset.evidence.averageJudgeDelta,
      averageGainGlobal: asset.evidence.averageGainGlobal,
      averageLengthDeltaWords: asset.evidence.averageLengthDeltaWords,
      averageAbsoluteLengthDeltaWords: Math.abs(asset.evidence.averageLengthDeltaWords),
      averageStructureDelta: 0,
      averageNoiseDelta: asset.evidence.averageNoiseDelta,
      averageClarityDelta: asset.evidence.averageClarityDelta,
      productGuard: asset.evidence.productGuard,
      adoption: "adopted",
      reason: asset.trace.adoptionReason
    }));
    const proposalMap = new Map<string, DiscoveryProposal>();

    for (const adoption of adoptedAdoptions) {
      const key = `${adoption.baseStrategyId}::${adoption.candidateStrategyId}::${contextKey(adoption.context)}`;
      proposalMap.set(key, {
        baseStrategyId: adoption.baseStrategyId,
        candidateStrategyId: adoption.candidateStrategyId,
        category: adoption.category,
        context: adoption.context,
        currentActivation: "active",
        currentAverageJudgeDelta: adoption.averageJudgeDelta,
        reason: adoption.reason
      });
    }

    for (const seed of buildSeedTargets("other")) {
      const key = `${seed.baseStrategyId}::${seed.candidateStrategyId}::${contextKey(seed.context)}`;
      if (!proposalMap.has(key)) {
        proposalMap.set(key, {
          baseStrategyId: seed.baseStrategyId,
          candidateStrategyId: seed.candidateStrategyId,
          category: seed.category,
          context: seed.context,
          currentActivation: "cautious",
          currentAverageJudgeDelta: 0,
          reason: seed.reason
        });
      }
    }

    if (tracker) {
      for (const strategy of tracker.strategies) {
        for (const context of strategy.contexts) {
          const candidate = this.proposeCandidate(strategy, context);
          if (!candidate) {
            continue;
          }

          const key = `${strategy.strategyId}::${candidate.candidateStrategyId}::${contextKey(context)}`;
          if (!proposalMap.has(key)) {
            proposalMap.set(key, {
              baseStrategyId: strategy.strategyId,
              candidateStrategyId: candidate.candidateStrategyId,
              category: "other",
              context: {
                questionType: context.questionType,
                promptLength: context.promptLength,
                signals: context.signals
              },
              currentActivation: context.activation,
              currentAverageJudgeDelta: context.averageJudgeDelta,
              reason: candidate.reason
            });
          }
        }
      }
    }

    const payload: StrategyDiscoveryFile = {
      version: "hydria-student-strategy-discovery-v1",
      builtAt: new Date().toISOString(),
      sourceStats: {
        proposals: proposalMap.size,
        evaluations: 0,
        adoptedReplacements: adoptedAdoptions.length
      },
      proposals: [...proposalMap.values()],
      evaluations: [],
      adoptions: adoptedAdoptions.sort(
        (left, right) =>
          right.averageJudgeDelta - left.averageJudgeDelta || right.observations - left.observations
      )
    };

    await mkdir(dirname(this.discoveryFile), { recursive: true });
    await writeFile(this.discoveryFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  private async readRawDiscoveryFile() {
    try {
      const raw = await readFile(this.discoveryFile, "utf8");
      return JSON.parse(raw) as StrategyDiscoveryFile;
    } catch {
      return null;
    }
  }

  private dedupeProposals(proposals: DiscoveryProposal[]) {
    const seen = new Set<string>();
    return proposals.filter((proposal) => {
      const key = `${proposal.baseStrategyId}::${proposal.candidateStrategyId}::${contextKey(proposal.context)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private dedupeEvaluations(evaluations: DiscoveryEvaluation[]) {
    const seen = new Set<string>();
    return evaluations.filter((evaluation) => {
      const key = evaluationKey(evaluation);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private proposeCandidate(
    strategy: StudentStrategyImpactAggregate,
    context: StudentStrategyImpactContextAggregate
  ): CandidateMapping | null {
    if (
      strategy.strategyId === "factual_medium" &&
      context.promptLength === "medium" &&
      (context.signals.includes("claims") || context.signals.includes("uncertainty"))
    ) {
      return {
        candidateStrategyId: "factual_verify_first",
        reason:
          "Factual medium contexts with uncertainty or claims benefit from a verify-first strategy instead of a fuller factual answer template."
      };
    }

    if (strategy.strategyId === "explanatory_short" && context.promptLength === "short") {
      return {
        candidateStrategyId: "explanatory_compact_example",
        reason:
          "Short explanatory prompts often need a concrete example and one limit instead of a bare compact definition."
      };
    }

    if (
      ["explanatory_medium", "open_medium"].includes(strategy.strategyId) &&
      context.promptLength === "medium" &&
      context.signals.includes("abstraction") &&
      (context.signals.includes("claims") || context.signals.includes("uncertainty"))
    ) {
      return {
        candidateStrategyId: "reasoning_bridge_medium",
        reason:
          "Mixed-reasoning prompts need a bridge between abstract framing and one concrete implication."
      };
    }

    if (
      strategy.strategyId === "open_short" &&
      context.promptLength === "short" &&
      context.signals.includes("abstraction")
    ) {
      return {
        candidateStrategyId: "open_scope_anchor",
        reason:
          "Short abstract open prompts need a concrete anchor before widening the scope."
      };
    }

    return null;
  }
}

export type {
  DiscoveryAdoption,
  DiscoveryEvaluation,
  DiscoveryProposal,
  StrategyDiscoveryFile
};

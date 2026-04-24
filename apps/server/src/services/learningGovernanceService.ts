import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArenaRound } from "../types/arena.js";
import type { ArenaQualityAnalyticsReport } from "../types/analytics.js";
import {
  learningActiveMemorySchema,
  learningGovernanceReportSchema,
  type LearningActiveMemory,
  type LearningActiveMemoryItem,
  type LearningGovernanceReport,
  type LearningHotspot,
  type LearningLiveMonitoringStatus,
  type LearningPolicyDecision,
  type LearningPolicyItem,
  type LearningPolicyScope,
  type LearningPolicyState,
  type LearningPolicyTarget,
  type LearningValidationSummary
} from "../types/learning.js";
import type { KnowledgeLayer } from "../types/knowledge.js";
import type {
  AgentCandidate,
  AgentState,
  AgentValidationResult,
  SpecializedAgentDefinition
} from "../types/agents.js";
import { specializedAgentDefinitionSchema } from "../types/agents.js";
import type {
  SkillCandidate,
  SkillDefinition,
  SkillValidationResult
} from "../types/skills.js";
import { skillDefinitionSchema } from "../types/skills.js";
import type {
  ToolCandidate,
  ToolCreationRequest,
  ToolGapSignal,
  ToolManifest,
  ToolValidationResult
} from "../types/tools.js";
import { toolManifestSchema } from "../types/tools.js";
import type { StudentSession } from "../types/student.js";
import { env } from "../utils/env.js";
import {
  DEFAULT_LEARNING_IMPROVEMENT_WEIGHTS,
  LearningImprovementScoreService
} from "./learningImprovementScoreService.js";
import { HYDRIA_LEARNING_CONSTITUTION } from "./learningConstitution.js";
import { LearningHotspotService } from "./learningHotspotService.js";
import type { DiscoveryAdoption, StrategyDiscoveryFile } from "./studentStrategyDiscoveryService.js";
import type { StudentRuleImpactFile } from "./studentRuleImpactTrackerService.js";
import type { StudentStrategyImpactFile } from "./studentStrategyImpactTrackerService.js";
import type { StudentToolImpactFile } from "./studentToolImpactTrackerService.js";

type BuildGovernanceArgs = {
  rounds: ArenaRound[];
  sessions: StudentSession[];
  knowledgeLayer: KnowledgeLayer | null;
  arenaQuality: ArenaQualityAnalyticsReport;
  ruleImpact: StudentRuleImpactFile | null;
  strategyImpact: StudentStrategyImpactFile | null;
  toolImpact: StudentToolImpactFile | null;
  strategyDiscovery: StrategyDiscoveryFile | null;
  skills?: SkillDefinition[];
  skillCandidates?: SkillCandidate[];
  skillValidations?: SkillValidationResult[];
  agents?: SpecializedAgentDefinition[];
  agentCandidates?: AgentCandidate[];
  agentValidations?: AgentValidationResult[];
  tools?: ToolManifest[];
  toolGaps?: ToolGapSignal[];
  toolCandidates?: ToolCandidate[];
  toolValidations?: ToolValidationResult[];
  toolRequests?: ToolCreationRequest[];
  previousReport?: LearningGovernanceReport | null;
  validation?: LearningValidationSummary;
};

type LearningGovernanceServiceOptions = {
  governanceFile?: string;
  activeMemoryFile?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function averageJudgeDeltaFromRound(round: ArenaRound) {
  const winner = round.outputs.judge.winner;
  if (winner === "tie") {
    return round.metrics.refineGain.global;
  }

  return (
    round.outputs.judge.scores[winner].overall -
    round.outputs.judge.initial_scores[winner].overall
  );
}

function percentage(matches: number, total: number) {
  if (total <= 0) {
    return null;
  }

  return Number(((matches / total) * 100).toFixed(1));
}

function buildScope(args: {
  category?: LearningPolicyScope["category"];
  questionType?: LearningPolicyScope["questionType"];
  promptLength?: LearningPolicyScope["promptLength"];
  signals?: LearningPolicyScope["signals"];
} = {}): LearningPolicyScope {
  return {
    category: args.category ?? null,
    questionType: args.questionType ?? null,
    promptLength: args.promptLength ?? null,
    signals: args.signals ?? []
  };
}

function isGlobalScope(scope: LearningPolicyScope) {
  return (
    scope.category === null &&
    scope.questionType === null &&
    scope.promptLength === null &&
    scope.signals.length === 0
  );
}

function stateToDecision(state: LearningPolicyState): LearningPolicyDecision {
  switch (state) {
    case "active":
      return "promote";
    case "guarded":
      return "guard";
    case "rejected":
      return "reject";
    case "archived":
      return "archive";
    default:
      return "keep_validating";
  }
}

function buildRollbackTriggers(target: LearningPolicyTarget) {
  const common = [
    "Live judge delta falls below zero over the monitoring window.",
    "Observed regression exceeds the configured regression trigger.",
    "No-op rate exceeds the constitution guardrail."
  ];

  if (target === "research_policy" || target === "tool_policy") {
    return [
      ...common,
      "No reliable source rate exceeds the constitution guardrail.",
      "Research cost rises without a measurable live gain."
    ].slice(0, 6);
  }

  if (target === "respondent_policy" || target === "local_student_policy") {
    return [
      ...common,
      "Critical fallback frequency stays elevated in live rounds."
    ].slice(0, 6);
  }

  return common;
}

function stateToMemoryState(state: LearningPolicyState) {
  switch (state) {
    case "active":
      return "active" as const;
    case "guarded":
      return "risky" as const;
    case "archived":
      return "archived" as const;
    case "rejected":
      return "archived" as const;
    default:
      return "analyzed" as const;
  }
}

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function buildPolicyId(target: LearningPolicyTarget, targetId: string, scope: LearningPolicyScope) {
  const base = [
    target,
    targetId,
    scope.category ?? "global",
    scope.questionType ?? "any",
    scope.promptLength ?? "any",
    [...scope.signals].sort().join(",") || "none"
  ].join("::");

  if (base.length <= 120) {
    return base;
  }

  const hash = stableShortHash(base);
  return `${base.slice(0, 120 - hash.length - 2).trimEnd()}::${hash}`;
}

function buildSkillId(candidate: SkillCandidate) {
  return [
    "skill",
    candidate.intent,
    candidate.scope.category ?? "global",
    candidate.scope.toolType ?? "none"
  ].join("::");
}

function skillMatchesCandidate(skill: SkillDefinition, candidate: SkillCandidate) {
  return (
    skill.intent === candidate.intent &&
    skill.scope.category === candidate.scope.category &&
    skill.scope.toolType === candidate.scope.toolType
  );
}

export class LearningGovernanceService {
  private readonly scoreService = new LearningImprovementScoreService();
  private readonly hotspotService = new LearningHotspotService();

  constructor(
    private readonly options: LearningGovernanceServiceOptions = {}
  ) {}

  buildReport(args: BuildGovernanceArgs): LearningGovernanceReport {
    const { weights, score } = this.scoreService.buildScore({
      rounds: args.rounds,
      sessions: args.sessions,
      knowledgeLayer: args.knowledgeLayer,
      toolImpact: args.toolImpact,
      arenaQuality: args.arenaQuality,
      weights: DEFAULT_LEARNING_IMPROVEMENT_WEIGHTS
    });
    const hotspots = this.hotspotService.buildHotspots({
      arenaQuality: args.arenaQuality,
      sessions: args.sessions,
      ruleImpact: args.ruleImpact,
      strategyImpact: args.strategyImpact,
      toolImpact: args.toolImpact
    });
    const draftPolicies = this.buildPolicies({
      hotspots,
      ruleImpact: args.ruleImpact,
      strategyImpact: args.strategyImpact,
      toolImpact: args.toolImpact,
      strategyDiscovery: args.strategyDiscovery,
      skills: args.skills ?? [],
      agents: args.agents ?? [],
      tools: args.tools ?? []
    });
    const boundedPolicies = this.applyActivationBoundaries(
      draftPolicies,
      args.validation ?? { mode: "none", summary: {} }
    );
    const rawMonitoringItems = this.buildLiveMonitoringItems({
      policies: boundedPolicies,
      previousReport: args.previousReport ?? null,
      rounds: args.rounds,
      sessions: args.sessions
    });
    const policies = this.applyLiveMonitoring(
      boundedPolicies,
      rawMonitoringItems,
      args.previousReport ?? null
    );
    const liveMonitoring = this.buildLiveMonitoringSummary(policies, rawMonitoringItems);
    const lifecycle = {
      rawObservations: args.rounds.length + args.sessions.length,
      analyzedItems: hotspots.length + policies.length,
      activeItems: policies.filter((policy) => policy.state === "active").length,
      riskyItems: policies.filter((policy) => policy.state === "guarded").length,
      archivedItems: policies.filter((policy) =>
        policy.state === "archived" || policy.state === "rejected"
      ).length
    };

    return learningGovernanceReportSchema.parse({
      version: "hydria-learning-governance-v1",
      generatedAt: new Date().toISOString(),
      constitution: HYDRIA_LEARNING_CONSTITUTION,
      sourceStats: {
        arenaRoundsAnalyzed: args.rounds.length,
        studentSessionsAnalyzed: args.sessions.length,
        ruleObservationsAnalyzed: args.ruleImpact?.sourceStats.ruleObservations ?? 0,
        strategyObservationsAnalyzed: args.strategyImpact?.sourceStats.strategyObservations ?? 0,
        toolComparedSessionsAnalyzed: args.toolImpact?.sourceStats.comparedSessions ?? 0
      },
      weights,
      score,
      hotspots,
      policies,
      skills: this.buildSkillsSummary({
        candidates: args.skillCandidates ?? [],
        skills: args.skills ?? [],
        validations: args.skillValidations ?? []
      }),
      agents: this.buildAgentsSummary({
        candidates: args.agentCandidates ?? [],
        agents: args.agents ?? [],
        validations: args.agentValidations ?? []
      }),
      tools: this.buildToolsSummary({
        gaps: args.toolGaps ?? [],
        candidates: args.toolCandidates ?? [],
        tools: args.tools ?? [],
        validations: args.toolValidations ?? [],
        activationRequests: args.toolRequests ?? []
      }),
      liveMonitoring,
      lifecycle,
      validation: args.validation ?? { mode: "none", summary: {} }
    });
  }

  buildActiveMemory(report: LearningGovernanceReport): LearningActiveMemory {
    const items: LearningActiveMemoryItem[] = report.policies
      .filter((policy) => policy.state === "active" || policy.state === "guarded")
      .sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidence - left.confidence ||
          (right.validation.averageJudgeDelta ?? 0) - (left.validation.averageJudgeDelta ?? 0)
      )
      .slice(0, 18)
      .map((policy) => ({
        itemId: policy.policyId,
        target: policy.target,
        state: policy.state,
        category: policy.scope.category,
        priority:
          policy.state === "active" && policy.confidence >= 0.8
            ? "high"
            : policy.state === "active"
              ? "medium"
              : "low",
        learned: policy.learned,
        modifies: policy.modifies,
        conditions: policy.conditions.slice(0, 4),
        confidence: policy.confidence,
        rationale: policy.rationale
      }));

    return learningActiveMemorySchema.parse({
      version: "hydria-learning-active-memory-v1",
      generatedAt: report.generatedAt,
      items
    });
  }

  async persistReport(report: LearningGovernanceReport) {
    const filePath = this.options.governanceFile ?? env.LEARNING_GOVERNANCE_FILE;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  async persistActiveMemory(memory: LearningActiveMemory) {
    const filePath = this.options.activeMemoryFile ?? env.LEARNING_ACTIVE_MEMORY_FILE;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  }

  async loadActiveMemory() {
    const filePath = this.options.activeMemoryFile ?? env.LEARNING_ACTIVE_MEMORY_FILE;

    try {
      const raw = await readFile(filePath, "utf8");
      return learningActiveMemorySchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async loadReport() {
    const filePath = this.options.governanceFile ?? env.LEARNING_GOVERNANCE_FILE;

    try {
      const raw = await readFile(filePath, "utf8");
      return learningGovernanceReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  evaluateSkills(args: {
    candidates: SkillCandidate[];
    existingSkills: SkillDefinition[];
    rounds: ArenaRound[];
    sessions: StudentSession[];
  }) {
    const byId = new Map(args.existingSkills.map((skill) => [skill.id, skill]));
    const touched = new Set<string>();
    const validations: SkillValidationResult[] = [];

    for (const candidate of args.candidates) {
      const current =
        args.existingSkills.find((skill) => skillMatchesCandidate(skill, candidate)) ?? null;
      const skillId = current?.id ?? buildSkillId(candidate);
      const live = this.collectSkillLiveMetrics(skillId, args.rounds, args.sessions);
      const confidenceScore = clamp(
        candidate.confidenceScore * 0.5 +
          candidate.usefulnessScore / 100 * 0.25 +
          candidate.generalizationScore / 100 * 0.25 -
          candidate.riskScore / 100 * 0.15,
        0,
        1
      );
      let state: SkillDefinition["state"] =
        candidate.repeatable &&
        candidate.usefulnessScore >= 68 &&
        candidate.riskScore <= 35 &&
        candidate.generalizationScore >= 65 &&
        confidenceScore >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minConfidence
          ? "active"
          : candidate.repeatable &&
              candidate.usefulnessScore >= 52 &&
              candidate.riskScore <= 55
            ? "guarded"
            : "rejected";
      let reason =
        state === "active"
          ? "Candidate cleared usefulness, risk, and generalization thresholds."
          : state === "guarded"
            ? "Candidate looks reusable but still needs tighter live confirmation."
            : "Candidate stayed too risky, too narrow, or too weak to activate.";
      let rollbackRecommended = false;

      if (
        current?.state === "active" &&
        live.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
        live.averageJudgeDelta !== null &&
        live.averageJudgeDelta < HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.minAverageJudgeDelta
      ) {
        state = "guarded";
        rollbackRecommended = true;
        reason =
          "Live rounds routed through this skill regressed relative to the promotion bar, so the skill was guarded.";
      } else if (
        current?.state === "guarded" &&
        live.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
        live.averageJudgeDelta !== null &&
        live.averageJudgeDelta < 0
      ) {
        state = "archived";
        rollbackRecommended = true;
        reason =
          "Guarded skill kept regressing in live use, so it was archived.";
      }

      const skill: SkillDefinition = skillDefinitionSchema.parse({
        id: skillId,
        name: candidate.name,
        intent: candidate.intent,
        description: candidate.description,
        inputs: candidate.inputs,
        outputs: candidate.outputs,
        requiredTools: candidate.requiredTools,
        steps: candidate.steps,
        preconditions: candidate.preconditions,
        successCriteria: candidate.successCriteria,
        failureModes: candidate.failureModes,
        safetyConstraints: candidate.safetyConstraints,
        examples: candidate.examples,
        confidenceScore: Number(confidenceScore.toFixed(3)),
        usageCount: current?.usageCount ?? 0,
        lastUsedAt: current?.lastUsedAt ?? null,
        createdAt: current?.createdAt ?? candidate.createdAt,
        version: current?.version ?? "hydria-skill-v1",
        state,
        scope: candidate.scope,
        validation: {
          usefulnessScore: candidate.usefulnessScore,
          riskScore: candidate.riskScore,
          generalizationScore: candidate.generalizationScore,
          confidenceScore: Number(confidenceScore.toFixed(3)),
          observedJudgeDelta:
            live.observations > 0 ? live.averageJudgeDelta : candidate.observedJudgeDelta,
          observedSuccessRate:
            live.observations > 0 ? live.successRate : candidate.observedSuccessRate
        }
      });

      byId.set(skill.id, skill);
      touched.add(skill.id);
      validations.push({
        candidateId: candidate.candidateId,
        skillId,
        usefulnessScore: candidate.usefulnessScore,
        riskScore: candidate.riskScore,
        generalizationScore: candidate.generalizationScore,
        confidenceScore: Number(confidenceScore.toFixed(3)),
        state,
        accepted: state === "active" || state === "guarded",
        rollbackRecommended,
        reason
      });
    }

    for (const existing of args.existingSkills) {
      if (touched.has(existing.id)) {
        continue;
      }

      const live = this.collectSkillLiveMetrics(existing.id, args.rounds, args.sessions);
      if (
        existing.state === "active" &&
        live.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
        live.averageJudgeDelta !== null &&
        live.averageJudgeDelta < HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.minAverageJudgeDelta
      ) {
        byId.set(existing.id, {
          ...existing,
          state: "guarded"
        });
        validations.push({
          candidateId: `existing::${existing.id}`,
          skillId: existing.id,
          usefulnessScore: existing.validation.usefulnessScore,
          riskScore: existing.validation.riskScore,
          generalizationScore: existing.validation.generalizationScore,
          confidenceScore: existing.confidenceScore,
          state: "guarded",
          accepted: true,
          rollbackRecommended: true,
          reason:
            "Existing active skill regressed in live use and was moved to guarded."
        });
      }
    }

    const skills = [...byId.values()];
    const activeSkills = skills
      .filter((skill) => skill.state === "active")
      .sort(
        (left, right) =>
          right.confidenceScore - left.confidenceScore ||
          right.validation.usefulnessScore - left.validation.usefulnessScore
      );
    const maxActiveSkills = HYDRIA_LEARNING_CONSTITUTION.activationBoundaries.maxActiveSkills;
    for (const skill of activeSkills.slice(maxActiveSkills)) {
      byId.set(skill.id, {
        ...skill,
        state: "guarded"
      });
      validations.push({
        candidateId: `boundary::${skill.id}`,
        skillId: skill.id,
        usefulnessScore: skill.validation.usefulnessScore,
        riskScore: skill.validation.riskScore,
        generalizationScore: skill.validation.generalizationScore,
        confidenceScore: skill.confidenceScore,
        state: "guarded",
        accepted: true,
        rollbackRecommended: false,
        reason:
          "Skill was demoted to guarded to stay within the active-skill budget."
      });
    }

    return {
      skills: [...byId.values()].sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidenceScore - left.confidenceScore ||
          right.usageCount - left.usageCount
      ),
      validations
    };
  }

  evaluateTools(args: {
    candidates: ToolCandidate[];
    existingTools: ToolManifest[];
    rounds: ArenaRound[];
    sessions: StudentSession[];
  }) {
    const byId = new Map(args.existingTools.map((tool) => [tool.id, tool]));
    const validations: ToolValidationResult[] = [];
    const requests: ToolCreationRequest[] = [];

    for (const candidate of args.candidates) {
      const current =
        args.existingTools.find((tool) => tool.intent === candidate.manifest.intent) ?? null;
      const usefulnessScore = clamp(candidate.gapSignal.frequency * 18 + 30, 0, 100);
      const reliabilityScore = clamp(
        candidate.contract.proposedTests.length * 18 +
          candidate.manifest.benchmarkCases.length * 10,
        0,
        100
      );
      const safetyScore =
        candidate.manifest.riskLevel === "low"
          ? 90
          : candidate.manifest.riskLevel === "medium"
            ? 65
            : 35;
      const adoptionScore = clamp(candidate.gapSignal.frequency * 20, 0, 100);
      const regressionRiskScore = clamp(
        100 -
          safetyScore +
          (candidate.gapSignal.gapType === "weak_tool"
            ? 20
            : candidate.gapSignal.gapType === "repeated_failure"
              ? 15
              : 0),
        0,
        100
      );

      let state: ToolManifest["state"];
      let requestedAction: ToolCreationRequest["requestedAction"] | null = null;
      let accepted = false;
      let reason = "";

      if (current?.state === "active" && regressionRiskScore >= 70) {
        state = "guarded";
        requestedAction = "sandbox_validate";
        accepted = true;
        reason = "Active tool showed too much regression risk and was moved to guarded.";
      } else if (current?.state === "guarded" && regressionRiskScore >= 80) {
        state = "deprecated";
        requestedAction = null;
        accepted = false;
        reason = "Guarded tool kept looking too risky and was deprecated.";
      } else if (candidate.manifest.riskLevel === "high") {
        state = current?.state === "tested" ? "guarded" : "generated";
        requestedAction = current?.state === "generated" ? "run_tests" : "generate_adapter";
        accepted = false;
        reason = "High-risk tools cannot be activated automatically and stay under governed review.";
      } else if (
        current?.state === "tested" &&
        usefulnessScore >= 70 &&
        reliabilityScore >= 70 &&
        safetyScore >= 60 &&
        adoptionScore >= 40 &&
        regressionRiskScore <= 45
      ) {
        state = "active";
        requestedAction = "activate";
        accepted = true;
        reason = "Tool passed the promotion bar and can be activated by the executor.";
      } else if (
        current?.state === "generated" &&
        candidate.contract.proposedTests.length > 0 &&
        usefulnessScore >= 55 &&
        reliabilityScore >= 55
      ) {
        state = "tested";
        requestedAction = "run_tests";
        accepted = true;
        reason = "Tool manifest is complete enough to move into governed test execution.";
      } else if (usefulnessScore >= 45 && reliabilityScore >= 45) {
        state = current?.state === "proposed" || current?.state === "generated" ? "generated" : "guarded";
        requestedAction = state === "generated" ? "generate_adapter" : "sandbox_validate";
        accepted = true;
        reason = "Tool candidate is useful enough to keep under governed validation.";
      } else {
        state = current?.state === "active" ? "deprecated" : "rejected";
        requestedAction = null;
        accepted = false;
        reason = "Tool candidate stayed too weak or too risky to justify activation.";
      }

      const validation: ToolValidationResult = {
        toolCandidateId: candidate.candidateId,
        manifestId: current?.id ?? candidate.manifest.id,
        usefulnessScore: Number(usefulnessScore.toFixed(1)),
        reliabilityScore: Number(reliabilityScore.toFixed(1)),
        safetyScore: Number(safetyScore.toFixed(1)),
        adoptionScore: Number(adoptionScore.toFixed(1)),
        regressionRiskScore: Number(regressionRiskScore.toFixed(1)),
        state,
        accepted,
        requestedAction,
        reason
      };

      const manifest = toolManifestSchema.parse({
        ...(current ?? candidate.manifest),
        ...candidate.manifest,
        id: current?.id ?? candidate.manifest.id,
        candidateId: candidate.candidateId,
        confidenceScore: Number(
          clamp(
            candidate.confidenceScore * 0.5 +
              usefulnessScore / 100 * 0.2 +
              reliabilityScore / 100 * 0.15 +
              safetyScore / 100 * 0.15,
            0,
            1
          ).toFixed(3)
        ),
        state,
        updatedAt: new Date().toISOString(),
        toolContract: candidate.contract,
        activationPolicy: candidate.activationPolicy,
        validation
      });

      byId.set(manifest.id, manifest);
      validations.push(validation);

      if (requestedAction) {
        requests.push({
          type: "tool_creation_request",
          toolCandidateId: candidate.candidateId,
          manifest,
          requestedAction,
          reason
        });
      }
    }

    return {
      tools: [...byId.values()].sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidenceScore - left.confidenceScore
      ),
      validations,
      requests
    };
  }

  evaluateAgents(args: {
    candidates: AgentCandidate[];
    existingAgents: SpecializedAgentDefinition[];
    skills: SkillDefinition[];
    rounds: ArenaRound[];
    sessions: StudentSession[];
  }) {
    const byId = new Map(args.existingAgents.map((agent) => [agent.id, agent]));
    const validations: AgentValidationResult[] = [];

    for (const candidate of args.candidates) {
      const current =
        args.existingAgents.find((agent) => agent.domain === candidate.definition.domain) ?? null;
      const requiredSkills = candidate.definition.requiredSkills
        .map((binding) => args.skills.find((skill) => skill.id === binding.skillId) ?? null)
        .filter((skill): skill is SkillDefinition => Boolean(skill));
      const activeRequiredSkills = requiredSkills.filter((skill) => skill.state === "active");
      const rejectedRequiredSkill = requiredSkills.find((skill) => skill.state === "rejected") ?? null;
      const guardedRequiredSkill = requiredSkills.find((skill) => skill.state === "guarded") ?? null;
      const live = this.collectAgentLiveMetrics(
        current?.id ?? candidate.definition.id,
        args.rounds,
        args.sessions
      );
      const strongSingleSkill =
        activeRequiredSkills.length === 1 &&
        activeRequiredSkills[0]!.confidenceScore >= 0.9 &&
        (activeRequiredSkills[0]!.validation.observedJudgeDelta ?? 0) >= 4 &&
        live.observations >= 2;
      const minSkillsSatisfied =
        activeRequiredSkills.length >= 2 ||
        (!candidate.definition.activationPolicy.requireAtLeastTwoActiveSkills && activeRequiredSkills.length >= 1) ||
        strongSingleSkill;
      const intentsTooBroad =
        candidate.definition.allowedIntents.length > 6 ||
        candidate.definition.allowedIntents.includes("none");
      const specializationScore = clamp(
        candidate.specializationScore * 0.55 +
          activeRequiredSkills.length * 12 +
          clamp(candidate.definition.allowedIntents.length / 6, 0, 1) * 15,
        0,
        100
      );
      const stabilityScore = clamp(
        candidate.stabilityScore * 0.6 +
          clamp((live.averageJudgeDelta ?? 0) / 6, 0, 1) * 20 +
          clamp((live.successRatePct ?? 0) / 100, 0, 1) * 20,
        0,
        100
      );
      const riskScore = clamp(
        candidate.riskScore * 0.6 +
          Number(rejectedRequiredSkill !== null) * 28 +
          Number(guardedRequiredSkill !== null) * 12 +
          Number(intentsTooBroad) * 22 +
          (live.regressionRiskScore ?? 0) * 0.18,
        0,
        100
      );

      let state: AgentState;
      let reason = "";
      let rollbackRecommended = false;

      if (intentsTooBroad) {
        state = "rejected";
        reason = "Agent candidate was rejected because its allowed intent perimeter is too broad.";
      } else if (rejectedRequiredSkill) {
        state = current?.state === "active" ? "guarded" : "rejected";
        rollbackRecommended = current?.state === "active";
        reason =
          "A key supporting skill is rejected, so the specialized agent cannot stay fully promoted.";
      } else if (
        current?.state === "active" &&
        (live.regressionRiskScore ?? 0) >= 65
      ) {
        state = "guarded";
        rollbackRecommended = true;
        reason = "Active specialized agent regressed in live monitoring and was moved to guarded.";
      } else if (
        minSkillsSatisfied &&
        candidate.confidenceScore >= candidate.definition.activationPolicy.minConfidence &&
        specializationScore >= 70 &&
        stabilityScore >= 68 &&
        riskScore <= 42 &&
        (live.averageJudgeDelta ?? candidate.definition.evaluationMetrics.targetJudgeDeltaLift) >=
          candidate.definition.activationPolicy.minBenchmarkLift
      ) {
        state = "active";
        reason = "Specialized agent met the promotion bar with stable supporting skills and domain lift.";
      } else if (
        minSkillsSatisfied &&
        candidate.confidenceScore >= 0.68 &&
        specializationScore >= 58 &&
        riskScore <= 58
      ) {
        state = "guarded";
        reason = "Specialized agent is promising but still needs narrower or more stable live confirmation.";
      } else {
        state = "validating";
        reason = "Specialized agent remains in validation while the domain evidence is still sparse.";
      }

      const definition = specializedAgentDefinitionSchema.parse({
        ...(current ?? candidate.definition),
        ...candidate.definition,
        id: current?.id ?? candidate.definition.id,
        confidenceScore: Number(
          clamp(
            candidate.confidenceScore * 0.45 +
              specializationScore / 100 * 0.2 +
              stabilityScore / 100 * 0.2 +
              (1 - riskScore / 100) * 0.15,
            0,
            1
          ).toFixed(3)
        ),
        state,
        updatedAt: new Date().toISOString(),
        performance: {
          agentId: current?.id ?? candidate.definition.id,
          observations: live.observations,
          averageJudgeDelta: live.averageJudgeDelta,
          successRatePct: live.successRatePct,
          failureRatePct: live.failureRatePct,
          activationPrecisionPct: live.activationPrecisionPct,
          regressionRiskScore: Number(riskScore.toFixed(1)),
          lastEvaluatedAt: new Date().toISOString(),
          summary: reason
        }
      });

      byId.set(definition.id, definition);
      validations.push({
        agentCandidateId: candidate.candidateId,
        agentId: definition.id,
        specializationScore: Number(specializationScore.toFixed(1)),
        stabilityScore: Number(stabilityScore.toFixed(1)),
        riskScore: Number(riskScore.toFixed(1)),
        state,
        accepted: state === "active" || state === "guarded" || state === "validating",
        rollbackRecommended,
        reason
      });
    }

    for (const existing of args.existingAgents) {
      const requiredSkills = existing.requiredSkills
        .map((binding) => args.skills.find((skill) => skill.id === binding.skillId) ?? null)
        .filter((skill): skill is SkillDefinition => Boolean(skill));
      const rejectedKeySkill = requiredSkills.find(
        (skill, index) => existing.requiredSkills[index]?.isKeySkill && skill.state === "rejected"
      );
      if (!rejectedKeySkill || !["active", "guarded"].includes(existing.state)) {
        continue;
      }

      byId.set(existing.id, {
        ...existing,
        state: "guarded",
        updatedAt: new Date().toISOString(),
        performance: {
          agentId: existing.id,
          observations: existing.performance?.observations ?? 0,
          averageJudgeDelta: existing.performance?.averageJudgeDelta ?? null,
          successRatePct: existing.performance?.successRatePct ?? null,
          failureRatePct: existing.performance?.failureRatePct ?? null,
          activationPrecisionPct: existing.performance?.activationPrecisionPct ?? null,
          regressionRiskScore: 72,
          lastEvaluatedAt: new Date().toISOString(),
          summary: "A key supporting skill was rejected, so the agent was guarded."
        }
      });
      validations.push({
        agentCandidateId: `existing::${existing.id}`,
        agentId: existing.id,
        specializationScore: 0,
        stabilityScore: 0,
        riskScore: 72,
        state: "guarded",
        accepted: true,
        rollbackRecommended: true,
        reason: "A key supporting skill was rejected, so the agent was moved to guarded."
      });
    }

    const agents = [...byId.values()].sort(
      (left, right) =>
        Number(right.state === "active") - Number(left.state === "active") ||
        right.confidenceScore - left.confidenceScore
    );
    const activeAgents = agents.filter((agent) => agent.state === "active");
    for (const agent of activeAgents.slice(HYDRIA_LEARNING_CONSTITUTION.activationBoundaries.maxActiveAgents)) {
      byId.set(agent.id, {
        ...agent,
        state: "guarded",
        updatedAt: new Date().toISOString()
      });
      validations.push({
        agentCandidateId: `boundary::${agent.id}`,
        agentId: agent.id,
        specializationScore: 0,
        stabilityScore: 0,
        riskScore: 40,
        state: "guarded",
        accepted: true,
        rollbackRecommended: false,
        reason: "Specialized agent was moved to guarded to stay within the active agent budget."
      });
    }

    return {
      agents: [...byId.values()].sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidenceScore - left.confidenceScore
      ),
      validations
    };
  }

  private buildPolicies(args: {
    hotspots: LearningHotspot[];
    ruleImpact: StudentRuleImpactFile | null;
    strategyImpact: StudentStrategyImpactFile | null;
    toolImpact: StudentToolImpactFile | null;
    strategyDiscovery: StrategyDiscoveryFile | null;
    skills: SkillDefinition[];
    agents: SpecializedAgentDefinition[];
    tools: ToolManifest[];
  }): LearningPolicyItem[] {
    const policies: LearningPolicyItem[] = [];
    const hotspotIdsByTarget = new Map<string, string[]>();

    for (const hotspot of args.hotspots) {
      const key = `${hotspot.target}:${hotspot.targetId ?? hotspot.role ?? hotspot.kind}`;
      const current = hotspotIdsByTarget.get(key) ?? [];
      current.push(hotspot.hotspotId);
      hotspotIdsByTarget.set(key, current);
    }

    for (const rule of args.ruleImpact?.rules ?? []) {
      const state: LearningPolicyState =
        rule.activation === "active"
          ? "active"
          : rule.activation === "inactive"
            ? "rejected"
            : "guarded";
      const scope = buildScope({ category: rule.category });
      const policyId = buildPolicyId("student_rule", rule.ruleId, scope);
      const key = `student_rule:${rule.ruleId}`;
      policies.push({
        policyId,
        target: "student_rule",
        targetId: rule.ruleId,
        state,
        decision: stateToDecision(state),
        decisionReason:
          state === "active"
            ? "Rule met the current promotion bar and stays active."
            : state === "rejected"
              ? "Rule stayed empirically weak and is rejected from active learning."
              : "Rule remains under watch because the evidence is mixed.",
        memoryState: stateToMemoryState(state),
        scope,
        learned: rule.rule,
        modifies: "student memory injection and answer-shaping hints",
        conditions: uniqueStrings([rule.failureType.replaceAll("_", " "), ...rule.contexts.flatMap((context) => context.signals)]).slice(0, 6),
        rollbackTriggers: buildRollbackTriggers("student_rule"),
        confidence: rule.empiricalConfidence,
        stability: clamp(rule.observations / 6, 0, 1),
        sourceHotspotIds: hotspotIdsByTarget.get(key) ?? [],
        rationale:
          state === "active"
            ? `Observed positive judge delta ${rule.averageJudgeDelta} over ${rule.observations} rule comparison(s).`
            : `Rule is not consistently helping (${rule.averageJudgeDelta} average judge delta over ${rule.observations} observation(s)).`,
        validation: {
          observations: rule.observations,
          successRate: rule.successRate,
          positiveImpactRate: rule.positiveImpactRate,
          averageJudgeDelta: rule.averageJudgeDelta,
          averageGainGlobal: rule.averageGainGlobal,
          noReliableSourceRate: null,
          noOpRate: null,
          recencyWeight: clamp(rule.observations / 8, 0, 1),
          stabilityWeight: clamp(rule.positiveImpactRate / 100, 0, 1)
        },
        weights: {
          impactWeight: clamp(Math.max(rule.averageJudgeDelta, 0) / 6, 0, 1),
          confidenceWeight: rule.empiricalConfidence,
          stabilityWeight: clamp(rule.positiveImpactRate / 100, 0, 1),
          recencyWeight: clamp(rule.observations / 8, 0, 1)
        }
      });
    }

    for (const strategy of args.strategyImpact?.strategies ?? []) {
      const scope = buildScope();
      const policyId = buildPolicyId("student_strategy", strategy.strategyId, scope);
      const state: LearningPolicyState =
        strategy.activation === "active"
          ? "active"
          : strategy.activation === "inactive"
            ? "rejected"
            : "guarded";
      const key = `student_strategy:${strategy.strategyId}`;
      policies.push({
        policyId,
        target: "student_strategy",
        targetId: strategy.strategyId,
        state,
        decision: stateToDecision(state),
        decisionReason:
          state === "active"
            ? "Strategy is helping often enough to remain active."
            : state === "rejected"
              ? "Strategy stayed regressive or too weak to keep."
              : "Strategy remains governed until it proves stable enough.",
        memoryState: stateToMemoryState(state),
        scope,
        learned:
          state === "active"
            ? `Strategy ${strategy.strategyId} is empirically helpful in its observed contexts.`
            : `Strategy ${strategy.strategyId} is not yet stable enough to stay broadly active.`,
        modifies: "student strategy selection and fallback posture",
        conditions: uniqueStrings(strategy.contexts.flatMap((context) => context.signals)).slice(0, 6),
        rollbackTriggers: buildRollbackTriggers("student_strategy"),
        confidence: strategy.empiricalConfidence,
        stability: clamp(strategy.observations / 8, 0, 1),
        sourceHotspotIds: hotspotIdsByTarget.get(key) ?? [],
        rationale:
          state === "active"
            ? `Average judge delta ${strategy.averageJudgeDelta} with positive impact rate ${strategy.positiveImpactRate}%.`
            : `Average judge delta ${strategy.averageJudgeDelta} with activation ${strategy.activation}.`,
        validation: {
          observations: strategy.observations,
          successRate: strategy.successRate,
          positiveImpactRate: strategy.positiveImpactRate,
          averageJudgeDelta: strategy.averageJudgeDelta,
          averageGainGlobal: strategy.averageGainGlobal,
          noReliableSourceRate: null,
          noOpRate: null,
          recencyWeight: clamp(strategy.observations / 8, 0, 1),
          stabilityWeight: clamp(strategy.positiveImpactRate / 100, 0, 1)
        },
        weights: {
          impactWeight: clamp(Math.max(strategy.averageJudgeDelta, 0) / 6, 0, 1),
          confidenceWeight: strategy.empiricalConfidence,
          stabilityWeight: clamp(strategy.positiveImpactRate / 100, 0, 1),
          recencyWeight: clamp(strategy.observations / 8, 0, 1)
        }
      });
    }

    for (const adoption of args.strategyDiscovery?.adoptions ?? []) {
      policies.push(this.buildDiscoveryPolicy(adoption));
    }

    for (const skill of args.skills) {
      policies.push(this.buildSkillPolicy(skill));
    }

    for (const agent of args.agents) {
      policies.push(this.buildAgentPolicy(agent));
    }

    for (const tool of args.tools) {
      policies.push(this.buildToolManifestPolicy(tool));
    }

    if (args.toolImpact) {
      const noReliableSourceRate = args.toolImpact.overall.used.noReliableSourceRate;
      const judgeDelta = args.toolImpact.overall.averageJudgeDeltaDelta;
      const positiveImpactRate = args.toolImpact.overall.used.positiveImpactRate;
      const meetsPromotionBar =
        args.toolImpact.sourceStats.comparedSessions >=
          HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations + 1 &&
        judgeDelta >= HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.minAverageJudgeDelta &&
        positiveImpactRate >= 55 &&
        noReliableSourceRate <=
          HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.maxNoReliableSourceRate;
      const state: LearningPolicyState =
        noReliableSourceRate >= 50
          ? "guarded"
          : meetsPromotionBar
            ? "active"
            : "validating";
      const scope = buildScope({
        questionType: "factual",
        signals: ["claims", "uncertainty"]
      });
      const policyId = buildPolicyId("research_policy", "targeted_grounding", scope);
      policies.push({
        policyId,
        target: "research_policy",
        targetId: "targeted_grounding",
        state,
        decision: stateToDecision(state),
        decisionReason:
          state === "active"
            ? "Research policy met the stricter promotion bar for live factual grounding."
            : state === "guarded"
              ? "Research policy stays guarded because reliability is still too uneven."
              : "Research policy remains validating until replay and live signals converge.",
        memoryState: stateToMemoryState(state),
        scope,
        learned:
          state === "active"
            ? "Targeted research improves factual accuracy enough to stay active."
            : noReliableSourceRate >= 50
              ? "Targeted research remains useful, but too many runs still fail to find reliable sources."
              : "Research is promising but needs more validation before broader activation.",
        modifies: "research trigger posture and grounding trust",
        conditions: [
          "externally checkable claims",
          "temporal freshness queries",
          "provider-specific facts"
        ],
        rollbackTriggers: buildRollbackTriggers("research_policy"),
        confidence: clamp(
          (Math.max(positiveImpactRate, 0) / 100) * 0.6 +
            clamp(args.toolImpact.sourceStats.comparedSessions / 8, 0, 1) * 0.4,
          0,
          1
        ),
        stability: clamp(1 - noReliableSourceRate / 100, 0, 1),
        sourceHotspotIds: [
          ...(hotspotIdsByTarget.get("research_policy:research") ?? []),
          ...(hotspotIdsByTarget.get("tool_policy:tool:weak-impact") ?? [])
        ].slice(0, 8),
        rationale:
          state === "active"
            ? `Average judge delta gain ${judgeDelta} with no-reliable-source rate ${noReliableSourceRate}%.`
            : state === "guarded"
              ? `Guard research because no-reliable-source rate is ${noReliableSourceRate}% over ${args.toolImpact.sourceStats.comparedSessions} compared session(s).`
              : `Validation continues because positive impact is ${positiveImpactRate}% and no-reliable-source rate is ${noReliableSourceRate}%.`,
        validation: {
          observations: args.toolImpact.sourceStats.comparedSessions,
          successRate: args.toolImpact.overall.used.successRate,
          positiveImpactRate,
          averageJudgeDelta: judgeDelta,
          averageGainGlobal: args.toolImpact.overall.averageJudgeDeltaDelta,
          noReliableSourceRate,
          noOpRate: null,
          recencyWeight: clamp(args.toolImpact.sourceStats.comparedSessions / 8, 0, 1),
          stabilityWeight: clamp(1 - noReliableSourceRate / 100, 0, 1)
        },
        weights: {
          impactWeight: clamp(Math.max(judgeDelta, 0) / 6, 0, 1),
          confidenceWeight: clamp(args.toolImpact.overall.used.positiveImpactRate / 100, 0, 1),
          stabilityWeight: clamp(1 - noReliableSourceRate / 100, 0, 1),
          recencyWeight: clamp(args.toolImpact.sourceStats.comparedSessions / 8, 0, 1)
        }
      });
    }

    return policies
      .sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidence - left.confidence ||
          right.validation.observations - left.validation.observations
      )
      .slice(0, 48);
  }

  private applyActivationBoundaries(
    policies: LearningPolicyItem[],
    validation: LearningValidationSummary
  ) {
    const restrictedTargets = new Set(
      HYDRIA_LEARNING_CONSTITUTION.activationBoundaries.restrictedGlobalTargets
    );
    const adjusted = policies.map((policy) => {
      if (policy.state !== "active") {
        return policy;
      }

      const isRestrictedGlobal =
        restrictedTargets.has(policy.target) && isGlobalScope(policy.scope);
      const hasStrongEnoughEvidence =
        policy.validation.observations >=
          HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations + 1 &&
        policy.confidence >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minConfidence + 0.04 &&
        policy.stability >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minStability;
      const hasValidationEvidence =
        validation.mode === "temporal_replay" &&
        typeof validation.summary.queryTypeMatchRate === "number" &&
        validation.summary.queryTypeMatchRate >= 70;

      if (
        isRestrictedGlobal &&
        (!hasStrongEnoughEvidence ||
          (HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.requireValidationForGlobalPromotion &&
            !hasValidationEvidence))
      ) {
        return {
          ...policy,
          state: "validating" as const,
          decision: "keep_validating" as const,
          decisionReason:
            "Global activation is blocked until replay validation and stronger evidence both hold.",
          memoryState: stateToMemoryState("validating"),
          rationale: `${policy.rationale} Global activation boundary held this policy in validating state.`
        };
      }

      return policy;
    });

    const activeGlobalPolicies = adjusted
      .filter((policy) => policy.state === "active" && isGlobalScope(policy.scope))
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          right.validation.observations - left.validation.observations
      );
    const allowedGlobalIds = new Set(
      activeGlobalPolicies
        .slice(0, HYDRIA_LEARNING_CONSTITUTION.activationBoundaries.maxActiveGlobalPolicies)
        .map((policy) => policy.policyId)
    );
    const activePolicies = adjusted
      .filter((policy) => policy.state === "active")
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          right.validation.observations - left.validation.observations
      );
    const allowedActiveIds = new Set(
      activePolicies
        .slice(0, HYDRIA_LEARNING_CONSTITUTION.activationBoundaries.maxActivePolicies)
        .map((policy) => policy.policyId)
    );

    return adjusted.map((policy) => {
      const overflowedGlobal = isGlobalScope(policy.scope) && policy.state === "active" && !allowedGlobalIds.has(policy.policyId);
      const overflowedActive = policy.state === "active" && !allowedActiveIds.has(policy.policyId);

      if (!overflowedGlobal && !overflowedActive) {
        return policy;
      }

      return {
        ...policy,
        state: "guarded" as const,
        decision: "guard" as const,
        decisionReason: overflowedGlobal
          ? "Policy exceeded the active global-policy budget and was moved to guarded."
          : "Policy exceeded the active-policy budget and was moved to guarded.",
        memoryState: "risky" as const,
        rationale: `${policy.rationale} Governance budget moved this policy to guarded state.`
      };
    });
  }

  private buildLiveMonitoringItems(args: {
    policies: LearningPolicyItem[];
    previousReport: LearningGovernanceReport | null;
    rounds: ArenaRound[];
    sessions: StudentSession[];
  }) {
    const windowStart = args.previousReport?.generatedAt ?? null;
    if (!windowStart) {
      return args.policies.map((policy) => ({
        policyId: policy.policyId,
        target: policy.target,
        targetId: policy.targetId,
        state: policy.state,
        status: "insufficient_data" as LearningLiveMonitoringStatus,
        windowStart: null,
        observations: 0,
        averageJudgeDelta: null,
        averageGainGlobal: null,
        positiveImpactRate: null,
        noOpRate: null,
        noReliableSourceRate: null,
        partialRate: null,
        regressionDelta: null,
        profitabilityScore: 0,
        riskScore: 0,
        summary: "No previous governance report exists yet, so live post-promotion monitoring has not started."
      }));
    }

    const startMs = new Date(windowStart).getTime();
    const recentSessions = args.sessions.filter(
      (session) => new Date(session.createdAt).getTime() >= startMs
    );
    const recentRounds = args.rounds.filter(
      (round) => new Date(round.createdAt).getTime() >= startMs
    );

    return args.policies.map((policy) => {
      const metrics = this.collectLiveMetrics(policy, recentSessions, recentRounds);
      const regressionDelta =
        metrics.averageJudgeDelta !== null && policy.validation.averageJudgeDelta !== null
          ? Number((metrics.averageJudgeDelta - policy.validation.averageJudgeDelta).toFixed(1))
          : null;
      const profitabilityScore = clamp(
        (Math.max(metrics.averageJudgeDelta ?? 0, 0) / 10) * 45 +
          ((metrics.positiveImpactRate ?? 0) / 100) * 35 +
          clamp(metrics.observations / 6, 0, 1) * 20,
        0,
        100
      );
      const riskScore = clamp(
        (Math.max(-(metrics.averageJudgeDelta ?? 0), 0) / 6) * 38 +
          ((metrics.noReliableSourceRate ?? 0) / 100) * 26 +
          ((metrics.noOpRate ?? 0) / 100) * 18 +
          ((metrics.partialRate ?? 0) / 100) * 18,
        0,
        100
      );
      const falsePositiveRisk =
        policy.state === "active" &&
        metrics.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
        ((metrics.averageJudgeDelta ?? 0) <= 0 ||
          (regressionDelta ?? 0) <=
            -HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.regressionTriggerDelta ||
          riskScore >= 60);
      let status: LearningLiveMonitoringStatus = "stable";
      let summary = "Policy stayed within its expected live behavior window.";

      if (metrics.observations === 0) {
        status = "insufficient_data";
        summary = "No live round or session has matched this policy since the previous learning cycle.";
      } else if (falsePositiveRisk) {
        status = "false_positive_risk";
        summary =
          "Live behavior is materially worse than validation suggested; keep this policy under watch.";
      } else if (
        regressionDelta !== null &&
        regressionDelta <= -HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.regressionTriggerDelta
      ) {
        status = "regressing";
        summary = "Live impact regressed versus the validation baseline for this policy.";
      } else if ((metrics.averageJudgeDelta ?? 0) >= Math.max(policy.validation.averageJudgeDelta ?? 0, 0)) {
        status = "improving";
        summary = "Live rounds confirm or exceed the validated improvement for this policy.";
      }

      return {
        policyId: policy.policyId,
        target: policy.target,
        targetId: policy.targetId,
        state: policy.state,
        status,
        windowStart,
        observations: metrics.observations,
        averageJudgeDelta: metrics.averageJudgeDelta,
        averageGainGlobal: metrics.averageGainGlobal,
        positiveImpactRate: metrics.positiveImpactRate,
        noOpRate: metrics.noOpRate,
        noReliableSourceRate: metrics.noReliableSourceRate,
        partialRate: metrics.partialRate,
        regressionDelta,
        profitabilityScore: Number(profitabilityScore.toFixed(1)),
        riskScore: Number(riskScore.toFixed(1)),
        summary
      };
    });
  }

  private buildSkillsSummary(args: {
    candidates: SkillCandidate[];
    skills: SkillDefinition[];
    validations: SkillValidationResult[];
  }) {
    const stateDistribution = {
      active: args.skills.filter((skill) => skill.state === "active").length,
      guarded: args.skills.filter((skill) => skill.state === "guarded").length,
      rejected: args.skills.filter((skill) => skill.state === "rejected").length,
      archived: args.skills.filter((skill) => skill.state === "archived").length
    };

    return {
      candidateCount: args.candidates.length,
      activeCount: stateDistribution.active,
      guardedCount: stateDistribution.guarded,
      rejectedCount: stateDistribution.rejected,
      archivedCount: stateDistribution.archived,
      validations: args.validations.slice(0, 96),
      stateDistribution,
      topActive: [...args.skills]
        .filter((skill) => skill.state === "active")
        .sort(
          (left, right) =>
            right.confidenceScore - left.confidenceScore ||
            right.usageCount - left.usageCount
        )
        .slice(0, 8)
        .map((skill) => ({
          skillId: skill.id,
          intent: skill.intent,
          state: skill.state,
          confidenceScore: skill.confidenceScore,
          usageCount: skill.usageCount,
          summary: skill.description
      }))
    };
  }

  private buildAgentsSummary(args: {
    candidates: AgentCandidate[];
    agents: SpecializedAgentDefinition[];
    validations: AgentValidationResult[];
  }) {
    const stateDistribution = {
      candidate: args.agents.filter((agent) => agent.state === "candidate").length,
      validating: args.agents.filter((agent) => agent.state === "validating").length,
      guarded: args.agents.filter((agent) => agent.state === "guarded").length,
      active: args.agents.filter((agent) => agent.state === "active").length,
      deprecated: args.agents.filter((agent) => agent.state === "deprecated").length,
      rejected: args.agents.filter((agent) => agent.state === "rejected").length
    };

    return {
      candidateCount: args.candidates.length,
      validatingCount: stateDistribution.validating,
      guardedCount: stateDistribution.guarded,
      activeCount: stateDistribution.active,
      deprecatedCount: stateDistribution.deprecated,
      rejectedCount: stateDistribution.rejected,
      validations: args.validations.slice(0, 96),
      stateDistribution,
      topActive: [...args.agents]
        .filter((agent) => agent.state === "active")
        .sort((left, right) => right.confidenceScore - left.confidenceScore || right.usageCount - left.usageCount)
        .slice(0, 8)
        .map((agent) => ({
          agentId: agent.id,
          domain: agent.domain,
          state: agent.state,
          confidenceScore: agent.confidenceScore,
          usageCount: agent.usageCount,
          summary: agent.description
        }))
    };
  }

  private buildToolsSummary(args: {
    gaps: ToolGapSignal[];
    candidates: ToolCandidate[];
    tools: ToolManifest[];
    validations: ToolValidationResult[];
    activationRequests: ToolCreationRequest[];
  }) {
    const stateDistribution = {
      generated: args.tools.filter((tool) => tool.state === "generated").length,
      tested: args.tools.filter((tool) => tool.state === "tested").length,
      guarded: args.tools.filter((tool) => tool.state === "guarded").length,
      active: args.tools.filter((tool) => tool.state === "active").length,
      deprecated: args.tools.filter((tool) => tool.state === "deprecated").length,
      rejected: args.tools.filter((tool) => tool.state === "rejected").length
    };

    return {
      gapCount: args.gaps.length,
      candidateCount: args.candidates.length,
      generatedCount: stateDistribution.generated,
      testedCount: stateDistribution.tested,
      guardedCount: stateDistribution.guarded,
      activeCount: stateDistribution.active,
      deprecatedCount: stateDistribution.deprecated,
      rejectedCount: stateDistribution.rejected,
      validations: args.validations.slice(0, 96),
      activationRequests: args.activationRequests.slice(0, 48),
      stateDistribution,
      topActive: [...args.tools]
        .filter((tool) => tool.state === "active")
        .sort((left, right) => right.confidenceScore - left.confidenceScore)
        .slice(0, 8)
        .map((tool) => ({
          toolId: tool.id,
          intent: tool.intent,
          state: tool.state,
          confidenceScore: tool.confidenceScore,
          riskLevel: tool.riskLevel,
          summary: tool.description
        }))
    };
  }

  private buildSkillPolicy(skill: SkillDefinition): LearningPolicyItem {
    const state =
      skill.state === "active"
        ? "active"
        : skill.state === "guarded"
          ? "guarded"
          : skill.state === "archived"
            ? "archived"
            : "rejected";
    const scope = buildScope({
      category: skill.scope.category
    });

    return {
      policyId: buildPolicyId("skill", skill.id, scope),
      target: "skill",
      targetId: skill.id,
      state,
      decision: stateToDecision(state),
      decisionReason:
        state === "active"
          ? "Procedural skill is active and eligible for recommendation."
          : state === "guarded"
            ? "Procedural skill is available but still under watch."
            : state === "archived"
              ? "Procedural skill was archived after sustained weakness or rollback."
              : "Procedural skill was rejected and is not eligible for recommendation.",
      memoryState: stateToMemoryState(state),
      scope,
      learned: skill.description,
      modifies: "procedural skill recommendation and reuse hints",
      conditions: [
        skill.intent,
        ...(skill.scope.taskPattern ? [skill.scope.taskPattern] : []),
        ...skill.preconditions
      ].slice(0, 8),
      rollbackTriggers: [
        "Live rounds routed through the skill regress below the promotion bar.",
        "The skill causes unsafe over-generalization or stale tool use.",
        "A narrower or more stable skill supersedes this one."
      ],
      confidence: skill.confidenceScore,
      stability: clamp(1 - skill.validation.riskScore / 100, 0, 1),
      sourceHotspotIds: [],
      rationale: `Skill ${skill.name} is tracked as ${skill.state} with confidence ${Math.round(skill.confidenceScore * 100)}%.`,
      validation: {
        observations: Math.max(skill.usageCount, 1),
        successRate: skill.validation.observedSuccessRate,
        positiveImpactRate: skill.validation.observedSuccessRate,
        averageJudgeDelta: skill.validation.observedJudgeDelta,
        averageGainGlobal: skill.validation.observedJudgeDelta,
        noReliableSourceRate: null,
        noOpRate: null,
        recencyWeight: clamp(skill.usageCount / 8, 0, 1),
        stabilityWeight: clamp(1 - skill.validation.riskScore / 100, 0, 1)
      },
      weights: {
        impactWeight: clamp(skill.validation.usefulnessScore / 100, 0, 1),
        confidenceWeight: skill.confidenceScore,
        stabilityWeight: clamp(1 - skill.validation.riskScore / 100, 0, 1),
        recencyWeight: clamp(skill.usageCount / 8, 0, 1)
      }
    };
  }

  private buildAgentPolicy(agent: SpecializedAgentDefinition): LearningPolicyItem {
    const state =
      agent.state === "active"
        ? "active"
        : agent.state === "guarded"
          ? "guarded"
          : agent.state === "deprecated"
            ? "archived"
            : agent.state === "rejected"
              ? "rejected"
              : "validating";
    const scope = buildScope({
      category: agent.primaryCategory
    });

    return {
      policyId: buildPolicyId("specialized_agent", agent.id, scope),
      target: "specialized_agent",
      targetId: agent.id,
      state,
      decision: stateToDecision(state),
      decisionReason:
        state === "active"
          ? "Specialized agent is active and eligible for routed recommendation."
          : state === "guarded"
            ? "Specialized agent remains available but under domain and regression watch."
            : state === "archived"
              ? "Specialized agent was deprecated after weak or risky live behavior."
              : state === "rejected"
                ? "Specialized agent was rejected by governance."
                : "Specialized agent is still validating against the core baseline.",
      memoryState: stateToMemoryState(state),
      scope,
      learned: agent.description,
      modifies: "specialized agent routing recommendation and domain-local memory posture",
      conditions: [
        agent.domain,
        ...agent.allowedIntents,
        ...agent.activationConditions
      ].slice(0, 8),
      rollbackTriggers: [
        "A key required skill regresses or becomes rejected.",
        "Off-domain activations increase beyond the allowed precision budget.",
        "Live judge delta falls below the domain promotion bar."
      ],
      confidence: agent.confidenceScore,
      stability: clamp(1 - ((agent.performance?.regressionRiskScore ?? 35) / 100), 0, 1),
      sourceHotspotIds: [],
      rationale: `Specialized agent ${agent.name} is ${agent.state} for the ${agent.domain} domain at ${Math.round(agent.confidenceScore * 100)}% confidence.`,
      validation: {
        observations: agent.performance?.observations ?? Math.max(agent.usageCount, 1),
        successRate: agent.performance?.successRatePct ?? null,
        positiveImpactRate: agent.performance?.activationPrecisionPct ?? null,
        averageJudgeDelta: agent.performance?.averageJudgeDelta ?? null,
        averageGainGlobal: agent.performance?.averageJudgeDelta ?? null,
        noReliableSourceRate: null,
        noOpRate: agent.performance?.failureRatePct ?? null,
        recencyWeight: clamp(agent.usageCount / 6, 0, 1),
        stabilityWeight: clamp(1 - ((agent.performance?.regressionRiskScore ?? 35) / 100), 0, 1)
      },
      weights: {
        impactWeight: clamp(Math.max(agent.performance?.averageJudgeDelta ?? 0, 0) / 6, 0, 1),
        confidenceWeight: agent.confidenceScore,
        stabilityWeight: clamp(1 - ((agent.performance?.regressionRiskScore ?? 35) / 100), 0, 1),
        recencyWeight: clamp(agent.usageCount / 6, 0, 1)
      }
    };
  }

  private buildToolManifestPolicy(tool: ToolManifest): LearningPolicyItem {
    const state =
      tool.state === "active"
        ? "active"
        : tool.state === "guarded"
          ? "guarded"
          : tool.state === "deprecated"
            ? "archived"
            : tool.state === "rejected"
              ? "rejected"
              : "validating";

    const riskWeight =
      tool.riskLevel === "low" ? 0.2 : tool.riskLevel === "medium" ? 0.45 : 0.7;

    return {
      policyId: buildPolicyId("tool_policy", tool.id, buildScope()),
      target: "tool_policy",
      targetId: tool.id,
      state,
      decision: stateToDecision(state),
      decisionReason:
        state === "active"
          ? "Governed tool manifest is active and can be requested from Hydria OS."
          : state === "guarded"
            ? "Governed tool manifest is available but still under safety or regression watch."
            : state === "validating"
              ? "Governed tool manifest exists but still needs OS-side generation or testing."
              : state === "archived"
                ? "Governed tool manifest was deprecated after weak or risky live behavior."
                : "Governed tool manifest was rejected by governance.",
      memoryState: stateToMemoryState(state),
      scope: buildScope(),
      learned: tool.description,
      modifies: "tool capability surface and routing escalation toward Hydria OS",
      conditions: [tool.intent, tool.allowedExecutionContext, ...tool.requiredPermissions].slice(0, 8),
      rollbackTriggers: [
        "Regression risk rises above the activation policy budget.",
        "Safety score drops below the required threshold.",
        "Executor-side tests fail or become unstable."
      ],
      confidence: tool.confidenceScore,
      stability: clamp(1 - riskWeight, 0, 1),
      sourceHotspotIds: [],
      rationale: `Tool manifest ${tool.name} is ${tool.state} with ${tool.riskLevel} risk and ${Math.round(tool.confidenceScore * 100)}% confidence.`,
      validation: {
        observations: Math.max(tool.validation?.adoptionScore ?? 0, 1),
        successRate: tool.validation?.reliabilityScore ?? null,
        positiveImpactRate: tool.validation?.usefulnessScore ?? null,
        averageJudgeDelta: null,
        averageGainGlobal: null,
        noReliableSourceRate: null,
        noOpRate: null,
        recencyWeight: 1,
        stabilityWeight: clamp(1 - riskWeight, 0, 1)
      },
      weights: {
        impactWeight: clamp((tool.validation?.usefulnessScore ?? 0) / 100, 0, 1),
        confidenceWeight: tool.confidenceScore,
        stabilityWeight: clamp(1 - riskWeight, 0, 1),
        recencyWeight: 1
      }
    };
  }

  private collectAgentLiveMetrics(
    agentId: string,
    rounds: ArenaRound[],
    sessions: StudentSession[]
  ) {
    const deltas: number[] = [];
    let observations = 0;
    let successes = 0;
    let failures = 0;
    let preciseActivations = 0;

    for (const round of rounds) {
      if (round.research.agentRouting.agentId !== agentId) {
        continue;
      }

      observations += 1;
      const delta = averageJudgeDeltaFromRound(round);
      deltas.push(delta);
      successes += Number(delta > 0);
      failures += Number(delta <= 0 || round.workflow.status === "partial");
      preciseActivations += Number(round.research.agentRouting.agentFound);
    }

    for (const session of sessions) {
      if (session.research.agentRouting.agentId !== agentId) {
        continue;
      }

      observations += 1;
      deltas.push(session.progression.deltaOverall);
      successes += Number(session.progression.deltaOverall > 0);
      failures += Number(session.progression.deltaOverall <= 0);
      preciseActivations += Number(session.research.agentRouting.agentFound);
    }

    const failureRatePct = percentage(failures, observations);

    return {
      observations,
      averageJudgeDelta: average(deltas),
      successRatePct: percentage(successes, observations),
      failureRatePct,
      activationPrecisionPct: percentage(preciseActivations, observations),
      regressionRiskScore: clamp(
        (Math.max(-(average(deltas) ?? 0), 0) / 6) * 50 +
          ((failureRatePct ?? 0) / 100) * 50,
        0,
        100
      )
    };
  }

  private collectSkillLiveMetrics(
    skillId: string,
    rounds: ArenaRound[],
    sessions: StudentSession[]
  ) {
    const deltas: number[] = [];
    let successes = 0;
    let observations = 0;

    for (const round of rounds) {
      if (round.research.skillRouting.skillId !== skillId) {
        continue;
      }

      observations += 1;
      const delta = averageJudgeDeltaFromRound(round);
      deltas.push(delta);
      successes += Number(delta > 0 && round.workflow.status === "completed");
    }

    for (const session of sessions) {
      if (session.research.skillRouting.skillId !== skillId) {
        continue;
      }

      observations += 1;
      deltas.push(session.progression.deltaOverall);
      successes += Number(session.judge.verdict === "improved" || session.judge.verdict === "minor");
    }

    return {
      observations,
      averageJudgeDelta: average(deltas),
      successRate: percentage(successes, observations)
    };
  }

  private collectLiveMetrics(
    policy: LearningPolicyItem,
    sessions: StudentSession[],
    rounds: ArenaRound[]
  ) {
    const judgeDeltas: number[] = [];
    const gains: number[] = [];
    let positiveCount = 0;
    let noOpCount = 0;
    let noReliableSourceCount = 0;
    let partialCount = 0;
    let observations = 0;

    if (policy.target === "student_rule") {
      for (const session of sessions) {
        if (!session.ruleImpact.compared) {
          continue;
        }

        const perRuleMatches = session.ruleImpact.perRule.filter(
          (entry) => entry.ruleId === policy.targetId
        );
        for (const entry of perRuleMatches) {
          observations += 1;
          judgeDeltas.push(entry.metrics.judgeOverallDelta);
          gains.push(entry.metrics.gainGlobal);
          positiveCount += Number(entry.metrics.success && entry.metrics.judgeOverallDelta > 0);
          noOpCount += Number(Math.abs(entry.metrics.judgeOverallDelta) < 1);
        }
      }
    } else if (policy.target === "student_strategy") {
      for (const session of sessions) {
        if (!session.strategyImpact.compared || session.strategyImpact.strategyId !== policy.targetId) {
          continue;
        }

        observations += 1;
        judgeDeltas.push(session.strategyImpact.metrics.judgeOverallDelta);
        gains.push(session.strategyImpact.metrics.gainGlobal);
        positiveCount += Number(
          session.strategyImpact.metrics.success && session.strategyImpact.metrics.judgeOverallDelta > 0
        );
        noOpCount += Number(Math.abs(session.strategyImpact.metrics.judgeOverallDelta) < 1);
      }
    } else if (policy.target === "research_policy" || policy.target === "tool_policy") {
      for (const session of sessions) {
        if (!session.tooling.compared || !session.tooling.toolUsed) {
          continue;
        }

        observations += 1;
        judgeDeltas.push(session.tooling.metrics.judgeOverallDelta);
        gains.push(session.tooling.metrics.gainGlobal);
        positiveCount += Number(
          session.tooling.metrics.success && session.tooling.metrics.judgeOverallDelta > 0
        );
        noOpCount += Number(Math.abs(session.tooling.metrics.judgeOverallDelta) < 1);
        noReliableSourceCount += Number(session.tooling.noReliableSource);
      }
    } else if (policy.target === "local_student_policy") {
      for (const round of rounds) {
        observations += 1;
        const localReasons = round.workflow.degradationReasons.filter(
          (reason) => reason.role === "local_student"
        );
        partialCount += Number(localReasons.length > 0);
        positiveCount += Number(localReasons.length === 0);
      }
    } else if (policy.target === "specialized_agent") {
      for (const round of rounds) {
        if (round.research.agentRouting.agentId !== policy.targetId) {
          continue;
        }

        observations += 1;
        const delta = averageJudgeDeltaFromRound(round);
        judgeDeltas.push(delta);
        gains.push(round.metrics.refineGain.global);
        positiveCount += Number(delta > 0);
        noOpCount += Number(Math.abs(delta) < 1);
        partialCount += Number(round.workflow.status === "partial");
      }

      for (const session of sessions) {
        if (session.research.agentRouting.agentId !== policy.targetId) {
          continue;
        }

        observations += 1;
        judgeDeltas.push(session.progression.deltaOverall);
        gains.push(session.progression.deltaOverall);
        positiveCount += Number(session.progression.deltaOverall > 0);
        noOpCount += Number(Math.abs(session.progression.deltaOverall) < 1);
      }
    }

    return {
      observations,
      averageJudgeDelta: average(judgeDeltas),
      averageGainGlobal: average(gains),
      positiveImpactRate: percentage(positiveCount, observations),
      noOpRate: percentage(noOpCount, observations),
      noReliableSourceRate:
        policy.target === "research_policy" || policy.target === "tool_policy"
          ? percentage(noReliableSourceCount, observations)
          : null,
      partialRate: policy.target === "local_student_policy" ? percentage(partialCount, observations) : null
    };
  }

  private applyLiveMonitoring(
    policies: LearningPolicyItem[],
    items: Array<{
      policyId: string;
      status: LearningLiveMonitoringStatus;
      summary: string;
      observations: number;
    }>,
    previousReport: LearningGovernanceReport | null
  ) {
    const itemById = new Map(items.map((item) => [item.policyId, item]));
    const previousPolicyById = new Map(
      (previousReport?.policies ?? []).map((policy) => [policy.policyId, policy])
    );

    return policies.map((policy) => {
      const monitoring = itemById.get(policy.policyId);
      if (!monitoring) {
        return policy;
      }

      const previousState = previousPolicyById.get(policy.policyId)?.state ?? null;

      if (
        monitoring.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
        (monitoring.status === "false_positive_risk" || monitoring.status === "regressing") &&
        previousState === "guarded"
      ) {
        return {
          ...policy,
          state: "archived" as const,
          decision: "archive" as const,
          decisionReason:
            "Policy stayed regressive while already guarded, so it was archived for safety.",
          memoryState: "archived" as const,
          rationale: `${policy.rationale} Live monitoring escalation: ${monitoring.summary}`
        };
      }

      if (monitoring.status === "false_positive_risk" && policy.state === "active") {
        return {
          ...policy,
          state: "guarded" as const,
          decision: "guard" as const,
          decisionReason:
            "Live monitoring found a false-positive learning signal, so the policy was demoted to guarded.",
          memoryState: "risky" as const,
          rationale: `${policy.rationale} Live monitoring alert: ${monitoring.summary}`
        };
      }

      return policy;
    });
  }

  private buildLiveMonitoringSummary(
    policies: LearningPolicyItem[],
    rawItems: Array<{
      policyId: string;
      target: LearningPolicyTarget;
      targetId: string;
      state: LearningPolicyState;
      status: LearningLiveMonitoringStatus;
      windowStart: string | null;
      observations: number;
      averageJudgeDelta: number | null;
      averageGainGlobal: number | null;
      positiveImpactRate: number | null;
      noOpRate: number | null;
      noReliableSourceRate: number | null;
      partialRate: number | null;
      regressionDelta: number | null;
      profitabilityScore: number;
      riskScore: number;
      summary: string;
    }>
  ) {
    const policyById = new Map(policies.map((policy) => [policy.policyId, policy]));
    const items = rawItems.map((item) => ({
      ...item,
      state: policyById.get(item.policyId)?.state ?? item.state
    }));
    const withLiveData = items.filter((item) => item.observations > 0);
    const activeItems = items.filter((item) => item.state === "active" || item.state === "guarded");
    const topGains = [...withLiveData]
      .sort(
        (left, right) =>
          (right.averageJudgeDelta ?? -Infinity) - (left.averageJudgeDelta ?? -Infinity) ||
          right.profitabilityScore - left.profitabilityScore
      )
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.profitabilityScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));
    const topRegressions = [...withLiveData]
      .sort(
        (left, right) =>
          (left.regressionDelta ?? Infinity) - (right.regressionDelta ?? Infinity) ||
          (left.averageJudgeDelta ?? Infinity) - (right.averageJudgeDelta ?? Infinity)
      )
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.riskScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));
    const mostProfitableActive = [...activeItems]
      .sort((left, right) => right.profitabilityScore - left.profitabilityScore)
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.profitabilityScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));
    const mostRiskyActive = [...activeItems]
      .sort((left, right) => right.riskScore - left.riskScore)
      .slice(0, 5)
      .map((item) => ({
        policyId: item.policyId,
        targetId: item.targetId,
        state: item.state,
        score: item.riskScore,
        averageJudgeDelta: item.averageJudgeDelta,
        observations: item.observations,
        summary: item.summary
      }));

    return {
      windowStart: rawItems[0]?.windowStart ?? null,
      monitoredPolicies: items.length,
      policiesWithLiveData: withLiveData.length,
      falsePositiveAlerts: items.filter((item) => item.status === "false_positive_risk").length,
      items,
      topGains,
      topRegressions,
      mostProfitableActive,
      mostRiskyActive
    };
  }

  private buildDiscoveryPolicy(adoption: DiscoveryAdoption): LearningPolicyItem {
    const meetsPromotionBar =
      adoption.observations >= HYDRIA_LEARNING_CONSTITUTION.promotionCriteria.minObservations &&
      adoption.averageJudgeDelta >= HYDRIA_LEARNING_CONSTITUTION.demotionCriteria.minAverageJudgeDelta;
    const state: LearningPolicyState =
      adoption.adoption === "adopted"
        ? meetsPromotionBar
          ? "active"
          : "validating"
        : adoption.adoption === "pending"
          ? "validating"
          : "rejected";
    const scope = buildScope({
      category: adoption.category,
      questionType: adoption.context.questionType,
      promptLength: adoption.context.promptLength,
      signals: adoption.context.signals
    });

    return {
      policyId: buildPolicyId(
        "student_strategy",
        `${adoption.baseStrategyId}->${adoption.candidateStrategyId}`,
        scope
      ),
      target: "student_strategy",
      targetId: adoption.candidateStrategyId,
      state,
      decision: stateToDecision(state),
      decisionReason:
        state === "active"
          ? "Discovery replacement validated strongly enough to be promoted."
          : state === "validating"
            ? "Discovery replacement is promising but still under validation."
            : "Discovery replacement did not clear the current governance bar.",
      memoryState: stateToMemoryState(state),
      scope,
      learned: `Use ${adoption.candidateStrategyId} instead of ${adoption.baseStrategyId}.`,
      modifies: "contextual student strategy replacement",
      conditions: uniqueStrings([
        adoption.context.questionType,
        adoption.context.promptLength,
        ...adoption.context.signals
      ]).slice(0, 6),
      rollbackTriggers: buildRollbackTriggers("student_strategy"),
      confidence: clamp(
        adoption.averageJudgeDelta / 8 * 0.4 +
          adoption.winRate / 100 * 0.3 +
          (adoption.productGuard.passed ? 0.3 : 0.15),
        0,
        1
      ),
      stability: clamp(adoption.observations / 6, 0, 1),
      sourceHotspotIds: [],
      rationale: adoption.reason,
      validation: {
        observations: adoption.observations,
        successRate: adoption.winRate,
        positiveImpactRate: adoption.winRate,
        averageJudgeDelta: adoption.averageJudgeDelta,
        averageGainGlobal: adoption.averageGainGlobal,
        noReliableSourceRate: null,
        noOpRate: null,
        recencyWeight: clamp(adoption.observations / 6, 0, 1),
        stabilityWeight: clamp(adoption.winRate / 100, 0, 1)
      },
      weights: {
        impactWeight: clamp(Math.max(adoption.averageJudgeDelta, 0) / 6, 0, 1),
        confidenceWeight: clamp(adoption.winRate / 100, 0, 1),
        stabilityWeight: adoption.productGuard.passed ? 0.9 : 0.4,
        recencyWeight: clamp(adoption.observations / 6, 0, 1)
      }
    };
  }
}

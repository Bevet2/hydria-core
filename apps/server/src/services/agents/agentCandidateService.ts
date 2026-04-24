import { createHash } from "node:crypto";
import type { SkillDefinition } from "../../types/skills.js";
import type {
  AgentCandidate,
  AgentCandidateDetection,
  AgentSkillBinding,
  SpecializedAgentDefinition
} from "../../types/agents.js";
import { agentCandidateSchema } from "../../types/agents.js";
import { buildAgentName, buildForbiddenIntents, inferAgentDomain, sortSkillsForDomain } from "./agentDomain.js";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function shortHash(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildSkillBinding(skill: SkillDefinition, required: boolean, isKeySkill: boolean): AgentSkillBinding {
  return {
    skillId: skill.id,
    intent: skill.intent,
    required,
    isKeySkill,
    state: skill.state,
    confidenceScore: skill.confidenceScore
  };
}

export class AgentCandidateService {
  buildCandidates(args: {
    detections: AgentCandidateDetection[];
    skills: SkillDefinition[];
  }) {
    return args.detections
      .map((signal) => this.buildCandidate(signal, args.skills))
      .filter((candidate): candidate is AgentCandidate => candidate !== null);
  }

  buildCandidate(signal: AgentCandidateDetection, skills: SkillDefinition[]) {
    if (!signal.detected) {
      return null;
    }

    const scopedSkills = sortSkillsForDomain(
      skills.filter((skill) => signal.supportingSkillIds.includes(skill.id))
    );
    if (scopedSkills.length === 0) {
      return null;
    }

    const requiredSkills = scopedSkills.slice(0, 2).map((skill, index) =>
      buildSkillBinding(skill, true, index === 0)
    );
    const optionalSkills = scopedSkills.slice(2, 5).map((skill) =>
      buildSkillBinding(skill, false, false)
    );
    const allowedIntents = uniqueStrings(scopedSkills.map((skill) => skill.intent)).slice(0, 8);
    const domain = signal.domain || inferAgentDomain({
      intent: allowedIntents[0] ?? "general_procedural",
      toolType: scopedSkills[0]?.scope.toolType,
      category: scopedSkills[0]?.scope.category
    });
    const requiredTools = uniqueStrings(
      scopedSkills.flatMap((skill) => skill.requiredTools).filter((tool) => tool !== "none")
    ).slice(0, 8);
    const averageSkillConfidence =
      scopedSkills.reduce((sum, skill) => sum + skill.confidenceScore, 0) / scopedSkills.length;
    const specializationScore = clamp(
      allowedIntents.length * 12 +
        requiredSkills.length * 18 +
        averageSkillConfidence * 35,
      0,
      100
    );
    const stabilityScore = clamp(
      averageSkillConfidence * 55 +
        clamp(scopedSkills.reduce((sum, skill) => sum + skill.usageCount, 0) / 20, 0, 1) * 45,
      0,
      100
    );
    const riskScore = clamp(
      (signal.riskLevel === "high" ? 72 : signal.riskLevel === "medium" ? 46 : 24) +
        Math.max(0, allowedIntents.length - 4) * 8,
      0,
      100
    );
    const confidenceScore = clamp(
      signal.confidence * 0.5 +
        averageSkillConfidence * 0.35 +
        clamp(requiredSkills.length / 2, 0, 1) * 0.15,
      0,
      1
    );
    const now = new Date().toISOString();
    const candidateId = `agent-candidate::${domain}::${shortHash(`${domain}:${allowedIntents.join("|")}`)}`;
    const agentId = `agent::${domain}::${shortHash(allowedIntents.join("|"))}`;
    const definition: SpecializedAgentDefinition = {
      id: agentId,
      name: buildAgentName(domain),
      domain,
      description: `Specialized agent for the ${domain} domain, built from validated procedural skills.`,
      responsibilities: [
        `Handle ${domain.replaceAll("_", " ")} tasks when the intent matches validated skills.`,
        "Recommend a specialized domain route while keeping the core generalist as a safe fallback.",
        "Stay within the tool and safety boundaries defined by the core governance."
      ].slice(0, 8),
      allowedIntents,
      forbiddenIntents: buildForbiddenIntents(domain),
      requiredSkills,
      optionalSkills,
      requiredTools,
      memoryScope: {
        memoryScope:
          domain === "code_analysis" || domain === "knowledge_lookup"
            ? "domain_local"
            : domain === "live_lookup"
              ? "task_local"
              : "category_local",
        retention: domain === "live_lookup" ? "ephemeral" : "rolling",
        keys: ["domain_facts", "successful_patterns", "recent_failures"].slice(0, 6),
        rationale: `The ${domain} domain needs a bounded local memory instead of broad global carry-over.`
      },
      activationConditions: [
        "The request intent matches the allowed domain intents.",
        "Required skills remain active or guarded under governance.",
        "Routing confidence is above the domain-specific threshold."
      ].slice(0, 8),
      successCriteria: [
        "Routing to this specialist improves or preserves judge quality relative to the core baseline.",
        "Off-domain activations stay rare.",
        "The specialist does not increase fallback or safety failures materially."
      ].slice(0, 8),
      failureModes: [
        "A key skill regresses or becomes rejected.",
        "The agent activates outside its domain too often.",
        "Cost rises without a measurable quality gain."
      ].slice(0, 8),
      safetyConstraints: [
        "Do not bypass core governance.",
        "Do not route outside the allowed intent perimeter.",
        "Fall back to the core generalist if confidence is weak or guarded conditions are not met."
      ].slice(0, 8),
      evaluationMetrics: {
        benchmarkCases: [
          `Domain benchmark for ${domain} intent family.`,
          ...allowedIntents.slice(0, 2).map((intent) => `Intent benchmark: ${intent}`)
        ].slice(0, 8),
        evaluationMetrics: [
          "averageJudgeDelta",
          "successRate",
          "activationPrecision",
          "regressionRisk"
        ],
        baseline: "core_generalist",
        targetJudgeDeltaLift: 1.5,
        maxFailureRatePct: 20,
        maxCostOverheadPct: 25
      },
      activationPolicy: {
        minConfidence: 0.78,
        minUsageCount: 3,
        minBenchmarkLift: 1.5,
        requireCoreBaselineComparison: true,
        requireAtLeastTwoActiveSkills: true,
        allowGuardedRouting: true,
        maxActiveAgentsPerDomain: 2
      },
      confidenceScore: Number(confidenceScore.toFixed(3)),
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      state: "candidate",
      version: "hydria-specialized-agent-v1",
      performance: null,
      primaryCategory: scopedSkills[0]?.scope.category ?? null
    };

    return agentCandidateSchema.parse({
      candidateId,
      sourceSignal: signal,
      definition,
      confidenceScore: Number(confidenceScore.toFixed(3)),
      specializationScore: Number(specializationScore.toFixed(1)),
      stabilityScore: Number(stabilityScore.toFixed(1)),
      riskScore: Number(riskScore.toFixed(1)),
      createdAt: now,
      state: "candidate"
    });
  }
}

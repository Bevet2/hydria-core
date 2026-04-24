import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import type { SkillRoutingDecision } from "../../types/skills.js";
import type { AgentRoutingDecision, SpecializedAgentDefinition } from "../../types/agents.js";
import {
  agentRoutingDecisionSchema,
  defaultAgentRoutingDecision
} from "../../types/agents.js";
import { AgentRegistry } from "./agentRegistry.js";
import { inferAgentDomain } from "./agentDomain.js";

type AgentRoutingServiceOptions = {
  registry?: Pick<
    AgentRegistry,
    "findAgentsByIntent" | "findAgentsByDomain"
  >;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTokens(value: string) {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  )];
}

function overlapScore(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  const matches = left.filter((token) => rightSet.has(token)).length;
  return matches / Math.max(left.length, right.length);
}

function inferIntent(question: string, toolRouting?: ToolRoutingDecision | null, skillRouting?: SkillRoutingDecision | null) {
  if (skillRouting?.intent) {
    return skillRouting.intent;
  }
  if (toolRouting?.intent && toolRouting.intent !== "none") {
    return toolRouting.intent;
  }

  const normalized = question.toLowerCase();
  if (/\brepo\b|\bdebug\b|\btest\b/.test(normalized)) {
    return "repo_analysis";
  }
  if (/\bweather\b|\bmeteo\b|\bmétéo\b/.test(normalized)) {
    return "current_weather";
  }
  if (/\bgithub\b/.test(normalized)) {
    return "github_repo_lookup";
  }
  return null;
}

export class AgentRoutingService {
  private readonly registry: Pick<
    AgentRegistry,
    "findAgentsByIntent" | "findAgentsByDomain"
  >;

  constructor(options: AgentRoutingServiceOptions = {}) {
    this.registry = options.registry ?? new AgentRegistry();
  }

  async route(args: {
    question: string;
    category?: QuestionCategory | null;
    toolRouting?: ToolRoutingDecision | null;
    skillRouting?: SkillRoutingDecision | null;
  }): Promise<AgentRoutingDecision> {
    const intent = inferIntent(args.question, args.toolRouting, args.skillRouting);
    const domain = inferAgentDomain({
      intent: intent ?? "general_procedural",
      toolType: args.toolRouting?.toolType ?? null,
      category: args.category ?? null
    });

    const candidates =
      intent !== null
        ? await this.registry.findAgentsByIntent(intent, ["active", "guarded"])
        : await this.registry.findAgentsByDomain(domain, ["active", "guarded"]);
    const ranked = candidates
      .map((agent) => this.rankAgent(agent, args.question, domain, intent, args.skillRouting?.skillId ?? null))
      .sort((left, right) => right.score - left.score || right.agent.confidenceScore - left.agent.confidenceScore);
    const top = ranked[0];

    if (!top || top.score < 0.74) {
      return agentRoutingDecisionSchema.parse({
        ...defaultAgentRoutingDecision,
        reason: top
          ? `An agent candidate exists, but confidence ${Math.round(top.score * 100)}% is still too weak for recommendation.`
          : "No specialized agent matched this request strongly enough."
      });
    }

    const guardedLowConfidence =
      top.agent.state === "guarded" &&
      top.score < Math.max(top.agent.activationPolicy.minConfidence, 0.84);
    if (guardedLowConfidence) {
      return agentRoutingDecisionSchema.parse({
        considered: true,
        agentFound: false,
        agentId: top.agent.id,
        domain: top.agent.domain,
        confidence: top.score,
        reason: `Agent ${top.agent.name} is guarded and the current routing confidence is too weak, so Hydria falls back to the core generalist.`,
        requiredSkills: top.agent.requiredSkills.map((binding) => binding.skillId).slice(0, 6),
        fallbackToCore: true,
        recommendation: null
      });
    }

    return agentRoutingDecisionSchema.parse({
      considered: true,
      agentFound: true,
      agentId: top.agent.id,
      domain: top.agent.domain,
      confidence: top.score,
      reason: top.reason,
      requiredSkills: top.agent.requiredSkills.map((binding) => binding.skillId).slice(0, 6),
      fallbackToCore: true,
      recommendation: {
        type: "agent_routing_recommendation",
        agentId: top.agent.id,
        domain: top.agent.domain,
        confidence: top.score,
        requiredSkills: top.agent.requiredSkills.map((binding) => binding.skillId).slice(0, 6),
        requiredTools: top.agent.requiredTools.slice(0, 8),
        reason: top.reason,
        fallbackPlan: "core_generalist"
      }
    });
  }

  private rankAgent(
    agent: SpecializedAgentDefinition,
    question: string,
    expectedDomain: string,
    intent: string | null,
    routedSkillId: string | null
  ) {
    const intentScore =
      intent && agent.allowedIntents.includes(intent)
        ? 0.45
        : intent && agent.allowedIntents.some((allowed) => allowed.includes(intent))
          ? 0.24
          : 0;
    const domainScore = agent.domain === expectedDomain ? 0.2 : 0;
    const skillBindingScore =
      routedSkillId && agent.requiredSkills.some((binding) => binding.skillId === routedSkillId)
        ? 0.16
        : routedSkillId && agent.optionalSkills.some((binding) => binding.skillId === routedSkillId)
          ? 0.08
          : 0;
    const stateScore =
      agent.state === "active"
        ? 0.12
        : agent.state === "guarded" && agent.activationPolicy.allowGuardedRouting
          ? 0.06
          : 0;
    const textScore = overlapScore(
      normalizeTokens(question),
      normalizeTokens(
        `${agent.name} ${agent.description} ${agent.responsibilities.join(" ")} ${agent.allowedIntents.join(" ")}`
      )
    ) * 0.15;
    const score = clamp(
      intentScore + domainScore + skillBindingScore + stateScore + textScore + agent.confidenceScore * 0.1,
      0,
      1
    );
    const reason =
      score >= 0.82
        ? `Specialized agent ${agent.name} matches the ${agent.domain} domain and covers the routed intent.`
        : `Specialized agent ${agent.name} partially matches the request but still relies on the core fallback.`;

    return {
      agent,
      score: Number(score.toFixed(3)),
      reason
    };
  }
}

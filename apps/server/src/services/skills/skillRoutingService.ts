import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import {
  defaultSkillRoutingDecision,
  skillRoutingDecisionSchema,
  type SkillRoutingDecision
} from "../../types/skills.js";
import { SkillRegistry } from "./skillRegistry.js";

type SkillRoutingServiceOptions = {
  registry?: SkillRegistry;
};

function inferIntentFromQuestion(question: string) {
  const normalized = question.toLowerCase();
  if (/\bweather|météo|meteo|temps\b/.test(normalized)) {
    return "current_weather";
  }
  if (/\bprice|btc|bitcoin|eth|ethereum|stock|crypto\b/.test(normalized)) {
    return "current_price";
  }
  if (/\bceo|president|current\b/.test(normalized)) {
    return "current_status";
  }
  if (/\blatest\b|\bversion\b|\brelease\b/.test(normalized)) {
    return "latest_release";
  }
  if (/\bgithub\b|\brepo\b|\brepository\b/.test(normalized)) {
    return "github_repo_lookup";
  }
  if (/\bconvert\b|\bdollars?\b|\beuros?\b|\bcurrency\b/.test(normalized)) {
    return "currency_conversion";
  }
  if (/\bdocs?\b|\bdocumentation\b|\breference\b/.test(normalized)) {
    return "documentation_lookup";
  }
  return null;
}

export class SkillRoutingService {
  private readonly registry: SkillRegistry;

  constructor(options: SkillRoutingServiceOptions = {}) {
    this.registry = options.registry ?? new SkillRegistry();
  }

  async route(args: {
    question: string;
    category?: QuestionCategory | null;
    toolRouting?: ToolRoutingDecision | null;
  }): Promise<SkillRoutingDecision> {
    const intent =
      args.toolRouting?.intent && args.toolRouting.intent !== "none"
        ? args.toolRouting.intent
        : inferIntentFromQuestion(args.question);

    if (!intent) {
      return skillRoutingDecisionSchema.parse({
        ...defaultSkillRoutingDecision,
        reason: "No stable procedural intent was detected for this request."
      });
    }

    const ranked = await this.registry.rankSkillsForTask({
      question: args.question,
      intent,
      category: args.category ?? null,
      toolRouting: args.toolRouting ?? null
    });

    const top = ranked[0];
    if (!top || top.score < 0.72) {
      const archivedOrRejected = await this.registry.findSkillsByIntent(intent, [
        "rejected",
        "archived"
      ]);
      return skillRoutingDecisionSchema.parse({
        considered: true,
        skillFound: false,
        skillId: null,
        skillName: null,
        intent,
        confidence: top?.score ?? 0,
        reason:
          archivedOrRejected.length > 0
            ? "Only rejected or archived skills matched this intent, so Hydria falls back to the default planner."
            : "No active or guarded skill matched this intent strongly enough.",
        state: null,
        recommendedSteps: []
      });
    }

    return skillRoutingDecisionSchema.parse({
      considered: true,
      skillFound: true,
      skillId: top.skill.id,
      skillName: top.skill.name,
      intent: top.skill.intent,
      confidence: top.score,
      reason: top.reason,
      state: top.skill.state,
      recommendedSteps: top.skill.steps.map((step) => step.title).slice(0, 6)
    });
  }
}

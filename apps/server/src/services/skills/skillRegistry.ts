import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import type {
  SkillDefinition,
  SkillRoutingDecision,
  SkillState
} from "../../types/skills.js";
import { skillDefinitionSchema } from "../../types/skills.js";
import { HydriaStateDatabase } from "../storage/hydriaStateDatabase.js";

type SkillRegistryOptions = {
  database?: HydriaStateDatabase;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractTokens(value: string) {
  return [...new Set(
    normalizeToken(value)
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

export class SkillRegistry {
  private readonly database: HydriaStateDatabase;

  constructor(options: SkillRegistryOptions = {}) {
    this.database = options.database ?? new HydriaStateDatabase();
  }

  async registerSkill(skill: SkillDefinition) {
    const parsed = skillDefinitionSchema.parse(skill);
    await this.database.upsertSkill(parsed);
    return parsed;
  }

  async updateSkillState(skillId: string, state: SkillState) {
    return this.database.updateSkillState(skillId, state);
  }

  async getSkillById(skillId: string) {
    return this.database.getSkill(skillId);
  }

  async listSkills(states?: SkillState[]) {
    return this.database.listSkills(states);
  }

  async findSkillsByIntent(intent: string, states: SkillState[] = ["active", "guarded"]) {
    return this.database.findSkillsByIntent(intent, states);
  }

  async rankSkillsForTask(args: {
    question: string;
    intent: string | null;
    category?: QuestionCategory | null;
    toolRouting?: ToolRoutingDecision | null;
    states?: SkillState[];
  }): Promise<Array<{ skill: SkillDefinition; score: number; reason: string }>> {
    const states = args.states ?? ["active", "guarded"];
    const candidates =
      args.intent && args.intent !== "none"
        ? await this.findSkillsByIntent(args.intent, states)
        : await this.listSkills(states);
    const questionTokens = extractTokens(args.question);

    return candidates
      .map((skill) => {
        const intentScore =
          args.intent && skill.intent === args.intent
            ? 0.55
            : args.intent && skill.intent.includes(args.intent)
              ? 0.35
              : 0.05;
        const toolScore =
          args.toolRouting?.toolType && args.toolRouting.toolType !== "none"
            ? Number(skill.requiredTools.includes(args.toolRouting.toolType)) * 0.15
            : 0;
        const categoryScore =
          args.category && skill.scope.category === args.category
            ? 0.1
            : skill.scope.category === null
              ? 0.05
              : 0;
        const stateScore = skill.state === "active" ? 0.15 : 0.08;
        const confidenceScore = skill.confidenceScore * 0.1;
        const textScore =
          overlapScore(
            questionTokens,
            extractTokens(
              `${skill.name} ${skill.description} ${skill.examples.map((example) => example.input).join(" ")}`
            )
          ) * 0.2;
        const score = clamp(
          intentScore + toolScore + categoryScore + stateScore + confidenceScore + textScore,
          0,
          1
        );

        return {
          skill,
          score: Number(score.toFixed(3)),
          reason:
            score >= 0.72
              ? `Matched ${skill.intent} with ${Math.round(score * 100)}% confidence.`
              : `Weak match for ${skill.intent}; confidence ${Math.round(score * 100)}%.`
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.skill.confidenceScore - left.skill.confidenceScore ||
          right.skill.usageCount - left.skill.usageCount
      );
  }

  async incrementUsage(skillId: string) {
    return this.database.incrementSkillUsage(skillId);
  }

  async archiveSkill(skillId: string) {
    return this.database.archiveSkill(skillId);
  }

  async buildFallbackDecision(reason: string): Promise<SkillRoutingDecision> {
    return {
      considered: true,
      skillFound: false,
      skillId: null,
      skillName: null,
      intent: null,
      confidence: 0,
      reason,
      state: null,
      recommendedSteps: []
    };
  }
}

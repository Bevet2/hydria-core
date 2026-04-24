import type { ArenaRound } from "../../types/arena.js";
import type { SkillDefinition } from "../../types/skills.js";
import type { StudentSession } from "../../types/student.js";
import type { AgentCandidateDetection } from "../../types/agents.js";
import { agentCandidateDetectionSchema } from "../../types/agents.js";
import { inferAgentDomain } from "./agentDomain.js";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundJudgeDelta(round: ArenaRound) {
  const winner = round.outputs.judge.winner;
  if (winner === "tie") {
    return round.metrics.refineGain.global;
  }

  return round.outputs.judge.scores[winner].overall - round.outputs.judge.initial_scores[winner].overall;
}

export class AgentCandidateDetectorService {
  detect(args: {
    skills: SkillDefinition[];
    rounds: ArenaRound[];
    sessions: StudentSession[];
  }) {
    const eligibleSkills = args.skills.filter(
      (skill) => skill.state === "active" || skill.state === "guarded"
    );
    const byDomain = new Map<string, SkillDefinition[]>();

    for (const skill of eligibleSkills) {
      const domain = inferAgentDomain({
        intent: skill.intent,
        toolType: skill.scope.toolType,
        category: skill.scope.category
      });
      const current = byDomain.get(domain) ?? [];
      current.push(skill);
      byDomain.set(domain, current);
    }

    const detections: AgentCandidateDetection[] = [];

    for (const [domain, skills] of byDomain.entries()) {
      const activeSkills = skills.filter((skill) => skill.state === "active");
      const hasStrongSingleSkill =
        activeSkills.length === 1 &&
        activeSkills[0]!.confidenceScore >= 0.88 &&
        activeSkills[0]!.validation.observedJudgeDelta !== null &&
        (activeSkills[0]!.validation.observedJudgeDelta ?? 0) >= 4;
      const enoughSkillCoverage = activeSkills.length >= 2 || hasStrongSingleSkill;
      if (!enoughSkillCoverage) {
        continue;
      }

      const supportingSkillIds = skills.map((skill) => skill.id);
      const supportingRoundIds = args.rounds
        .filter((round) => {
          const skillId = round.research.skillRouting.skillId;
          return (
            (skillId !== null && supportingSkillIds.includes(skillId)) ||
            inferAgentDomain({
              intent:
                round.research.skillRouting.intent ??
                round.research.toolRouting.intent ??
                round.research.queryPlan.intent,
              toolType: round.research.toolRouting.toolType,
              category: round.category
            }) === domain
          );
        })
        .map((round) => round.roundId)
        .slice(0, 24);
      const supportingSessionCount = args.sessions.filter((session) => {
        const skillId = session.research.skillRouting.skillId;
        return (
          (skillId !== null && supportingSkillIds.includes(skillId)) ||
          inferAgentDomain({
            intent:
              session.research.skillRouting.intent ??
              session.research.toolRouting.intent ??
              session.research.queryPlan.intent,
            toolType: session.research.toolRouting.toolType,
            category: session.category
          }) === domain
        );
      }).length;
      const judgeDeltas = [
        ...args.rounds
          .filter((round) => supportingRoundIds.includes(round.roundId))
          .map((round) => roundJudgeDelta(round)),
        ...args.sessions
          .filter((session) => {
            const skillId = session.research.skillRouting.skillId;
            return skillId !== null && supportingSkillIds.includes(skillId);
          })
          .map((session) => session.progression.deltaOverall)
      ];
      const averageJudgeLift = average(judgeDeltas);
      const skillConfidence = average(skills.map((skill) => skill.confidenceScore));
      const confidence = clamp(
        skillConfidence * 0.45 +
          clamp(activeSkills.length / 3, 0, 1) * 0.2 +
          clamp((supportingRoundIds.length + supportingSessionCount) / 8, 0, 1) * 0.2 +
          clamp(Math.max(averageJudgeLift, 0) / 8, 0, 1) * 0.15,
        0,
        1
      );
      const breadthRisk = skills.length >= 5 ? 0.7 : skills.length >= 4 ? 0.45 : 0.2;
      const riskLevel =
        breadthRisk >= 0.7 || averageJudgeLift < 1
          ? "high"
          : breadthRisk >= 0.45 || averageJudgeLift < 2
            ? "medium"
            : "low";

      detections.push(
        agentCandidateDetectionSchema.parse({
          detected: true,
          domain,
          reason:
            activeSkills.length >= 2
              ? `Multiple validated skills cluster around the ${domain} domain and are used repeatedly.`
              : `A highly reliable skill is repeatedly successful in the ${domain} domain and may justify specialization.`,
          supportingSkillIds,
          supportingRoundIds,
          confidence: Number(confidence.toFixed(3)),
          riskLevel
        })
      );
    }

    return detections.sort(
      (left, right) => right.confidence - left.confidence || right.supportingSkillIds.length - left.supportingSkillIds.length
    );
  }
}

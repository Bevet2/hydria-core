import { randomUUID } from "node:crypto";
import type {
  JudgeOutput,
  OrchestrationPolicyDetails,
  QuestionCategory,
  RefineRouterDecisionDetails,
  ResearchToolLog,
  RedTeamOutput,
  SynthesizerOutput
} from "../../types/arena.js";
import {
  hydriaMemorySnapshotSchema,
  type HydriaMemorySnapshot
} from "../../types/core.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type { LocalStudentOutput } from "../../types/localModel.js";
import {
  buildItem,
  buildRetrieval,
  compactText,
  uniqueStrings
} from "./hydriaMemoryShared.js";

export type HydriaArenaMemorySnapshotArgs = {
  question: string;
  category: QuestionCategory;
  knowledge: KnowledgeInjection | null;
  orchestration: OrchestrationPolicyDetails;
  router: RefineRouterDecisionDetails;
  research: ResearchToolLog;
  redTeam: RedTeamOutput;
  judge: JudgeOutput;
  synthesizer: SynthesizerOutput;
  localStudent: LocalStudentOutput;
  extraEpisodicItems?: string[];
};

export function buildArenaMemorySnapshot(
  args: HydriaArenaMemorySnapshotArgs
): HydriaMemorySnapshot {
  const { knowledge, orchestration, router, research } = args;
  const strategyId = `arena:${router.globalStrategy}`;
  const orchestrationReasoning = orchestration.reasoning ?? [];
  const orchestrationTargetOutcomes = orchestration.targetOutcomes ?? [];
  const orchestrationPrioritySignals = orchestration.prioritySignals ?? [];
  const routerReasoning = router.reasoning ?? [];
  const estimatedValueA = router.estimatedValue?.A ?? "medium";
  const estimatedValueB = router.estimatedValue?.B ?? "medium";
  const redTeamSharedRisks = args.redTeam.shared_risks ?? [];
  const redTeamFailureScenarios = args.redTeam.failure_scenarios ?? [];
  const redTeamHiddenAssumptions = args.redTeam.hidden_assumptions ?? [];
  const localStudentNotes = args.localStudent.learning_notes ?? [];
  const synthImprovements = args.synthesizer.improvements_added ?? [];
  const researchSummary = research.summary ?? [];

  const core = [
    buildItem({
      layer: "core",
      priority: "high",
      title: "Arena orchestration",
      content: `Focus ${orchestration.focus}. Refine policy ${orchestration.refinePolicy}. Research policy ${orchestration.researchPolicy}.`,
      tags: ["orchestration", router.globalStrategy]
    }),
    buildItem({
      layer: "core",
      priority: "high",
      title: "Arena router strategy",
      content: [
        ...routerReasoning.slice(0, 2),
        `A=${estimatedValueA}.`,
        `B=${estimatedValueB}.`,
        `Refine A=${router.shouldRefineA}.`,
        `Refine B=${router.shouldRefineB}.`
      ].join(" "),
      tags: ["router", router.globalStrategy]
    }),
    buildItem({
      layer: "core",
      priority: "medium",
      title: "Research posture",
      content: research.decision.shouldUse
        ? `${research.decision.reasoning} Intent ${research.queryPlan.intent}.`
        : "Research stayed off because the planner did not expect enough external-value gain.",
      tags: ["research", research.queryPlan.intent]
    }),
    buildItem({
      layer: "core",
      priority: "high",
      title: "Arena round outcome",
      content: `Winner ${args.judge.winner}. Red team winner-so-far ${args.redTeam.winner_so_far}. Synth target ${args.synthesizer.based_on_winner}.`,
      tags: ["outcome"]
    }),
    buildItem({
      layer: "core",
      priority: "medium",
      title: "Local learning summary",
      content: args.localStudent.student_summary,
      tags: ["learning", "local_student"]
    }),
    ...(knowledge
      ? [
          buildItem({
            layer: "core",
            priority: "medium",
            title: "Knowledge strategy note",
            content: knowledge.strategyNote,
            tags: ["knowledge"]
          })
        ]
      : [])
  ].slice(0, 6);

  const episodic = uniqueStrings([
    args.localStudent.student_summary,
    ...(args.extraEpisodicItems ?? []),
    ...orchestrationTargetOutcomes,
    ...orchestrationPrioritySignals,
    ...routerReasoning,
    ...redTeamSharedRisks,
    ...redTeamFailureScenarios,
    ...redTeamHiddenAssumptions
  ])
    .slice(0, 8)
    .map((entry, index) =>
      buildItem({
        layer: "episodic",
        priority: index < 3 ? "high" : "medium",
        title: `Arena signal ${index + 1}`,
        content: entry,
        tags: ["arena"]
      })
    );

  const semantic = uniqueStrings([
    ...(knowledge?.memoryRules.map(
      (rule) => `${rule.domain}: ${rule.lesson} Recommended: ${rule.recommendedStrategy}`
    ) ?? []),
    ...(knowledge?.studentMemoryRules.map(
      (rule) => `${rule.failureType}: ${rule.rule} Conditions: ${rule.conditions.join(", ") || "general"}`
    ) ?? []),
    ...orchestrationReasoning,
    ...localStudentNotes,
    ...synthImprovements.map((entry) => `Synthesis pattern: ${entry}`)
  ])
    .slice(0, 10)
    .map((entry, index) =>
      buildItem({
        layer: "semantic",
        priority: index < 4 ? "high" : "medium",
        title: `Arena rule ${index + 1}`,
        content: entry,
        tags: ["arena_rule"]
      })
    );

  const archival = uniqueStrings([
    ...(knowledge?.winningPatterns.map((pattern) => `Winning pattern: ${pattern}`) ?? []),
    ...(knowledge?.bestRoundReferences.map(
      (reference) => `Reference ${reference.roundId}: ${reference.note}`
    ) ?? []),
    ...researchSummary,
    `Judge reasoning: ${args.judge.reasoning}`,
    `Synthesis rationale: ${args.synthesizer.why_this_answer}`
  ])
    .slice(0, 8)
    .map((entry, index) =>
      buildItem({
        layer: "archival",
        priority: index < 2 ? "high" : "low",
        title: `Arena reference ${index + 1}`,
        content: entry,
        tags: ["reference"]
      })
    );

  const summary = compactText(
    `Hydria arena memory captured winner ${args.judge.winner}, router ${router.globalStrategy}, and research intent ${research.decision.shouldUse ? research.queryPlan.intent : "off"} for ${args.category}.`,
    320
  );

  return hydriaMemorySnapshotSchema.parse({
    snapshotId: randomUUID(),
    question: args.question,
    category: args.category,
    summary,
    core,
    episodic,
    semantic,
    archival,
    retrieval: buildRetrieval({
      strategyId,
      research,
      knowledge
    })
  });
}

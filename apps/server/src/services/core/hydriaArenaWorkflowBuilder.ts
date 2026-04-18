import type {
  ExecutionTrace,
  JudgeOutput,
  ModelSelection,
  OrchestrationPolicyDetails,
  QuestionCategory,
  RefineRouterDecisionDetails,
  RefinerOutput,
  ResearchToolLog,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../../types/arena.js";
import { hydriaWorkflowRunSchema, type HydriaWorkflowRun } from "../../types/core.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type { LocalStudentOutput } from "../../types/localModel.js";
import {
  buildHandoff,
  buildMessage,
  buildTask,
  buildTraceNote,
  completionTimestamp,
  describeResearchOutcome,
  researchTaskStatus,
  uniqueStrings
} from "./hydriaWorkflowShared.js";

export type HydriaArenaRoundWorkflowArgs = {
  roundId: string;
  question: string;
  category: QuestionCategory;
  createdAt: string;
  durationMs: number;
  models: ModelSelection;
  knowledge: KnowledgeInjection | null;
  orchestration: OrchestrationPolicyDetails;
  router: RefineRouterDecisionDetails;
  research: ResearchToolLog;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  respondentATrace: ExecutionTrace;
  respondentBTrace: ExecutionTrace;
  redTeam: RedTeamOutput;
  refineA: RefinerOutput;
  refineB: RefinerOutput;
  judge: JudgeOutput;
  synthesizer: SynthesizerOutput;
  localStudent: LocalStudentOutput;
  localStudentTrace: ExecutionTrace;
};

export function buildArenaRoundWorkflowRun(
  args: HydriaArenaRoundWorkflowArgs
): HydriaWorkflowRun {
  const messages = [
    buildMessage({
      role: "orchestrator",
      kind: "question",
      summary: "Arena round started with an orchestrated question.",
      content: args.question,
      service: "arenaRunner"
    }),
    buildMessage({
      role: "orchestrator",
      kind: "decision",
      summary: "Arena orchestration selected focus and refine policy.",
      content: `Focus ${args.orchestration.focus}. Refine policy ${args.orchestration.refinePolicy}. Research policy ${args.orchestration.researchPolicy}. Router strategy ${args.router.globalStrategy}.`,
      service: "orchestrationPolicyService",
      tags: [args.router.globalStrategy, args.orchestration.focus]
    }),
    buildMessage({
      role: "respondent",
      kind: "draft",
      summary: "Respondent A produced an initial answer.",
      content: `${buildTraceNote(args.respondentATrace)} ${args.respondentA.answer}`,
      service: "openRouter",
      model: args.models.respondentA,
      tags: ["respondentA"]
    }),
    buildMessage({
      role: "respondent",
      kind: "draft",
      summary: "Respondent B produced an initial answer.",
      content: `${buildTraceNote(args.respondentBTrace)} ${args.respondentB.answer}`,
      service: "openRouter",
      model: args.models.respondentB,
      tags: ["respondentB"]
    }),
    buildMessage({
      role: "red_team",
      kind: "critique",
      summary: "Red team challenged both respondents.",
      content: uniqueStrings([
        ...args.redTeam.attacks_on_a,
        ...args.redTeam.attacks_on_b,
        ...args.redTeam.shared_risks,
        ...args.redTeam.hidden_assumptions
      ])
        .slice(0, 10)
        .join(" "),
      service: "openRouter",
      model: args.models.redTeam
    }),
    buildMessage({
      role: "teacher",
      kind: "answer",
      summary: "Refine A improved respondent A.",
      content: args.refineA.improved_answer,
      service: "openRouterStructuredStep",
      model: args.models.respondentA,
      tags: ["refineA"]
    }),
    buildMessage({
      role: "teacher",
      kind: "answer",
      summary: "Refine B improved respondent B.",
      content: args.refineB.improved_answer,
      service: "openRouterStructuredStep",
      model: args.models.respondentB,
      tags: ["refineB"]
    }),
    buildMessage({
      role: "judge",
      kind: "evaluation",
      summary: `Judge selected ${args.judge.winner}.`,
      content: args.judge.reasoning,
      service: "openRouterStructuredStep",
      model: args.models.judge
    }),
    buildMessage({
      role: "synthesizer",
      kind: "answer",
      summary: "Synthesizer merged the strongest answer.",
      content: args.synthesizer.final_answer,
      service: "openRouterStructuredStep",
      model: args.models.synthesizer
    }),
    buildMessage({
      role: "local_student",
      kind: "evaluation",
      summary: "Local student extracted learning notes from the round.",
      content: uniqueStrings(args.localStudent.learning_notes).slice(0, 8).join(" "),
      service: "localModel",
      model: args.localStudentTrace.requestedModel
    }),
    buildMessage({
      role: "history_store",
      kind: "persistence",
      summary: "Arena round was persisted to history storage.",
      content: `Round ${args.roundId} stored with researchUsed=${args.research.used}.`,
      service: "historyStore"
    })
  ];

  if (args.knowledge) {
    messages.splice(
      2,
      0,
      buildMessage({
        role: "knowledge_memory",
        kind: "memory",
        summary: "Knowledge injection informed the arena refinements.",
        content: `${args.knowledge.strategyNote} Memory: ${args.knowledge.memorySummary}`,
        service: "knowledgeInjectionService",
        tags: ["knowledge"]
      })
    );
  }

  if (args.research.considered) {
    messages.splice(
      args.knowledge ? 6 : 5,
      0,
      buildMessage({
        role: "research_planner",
        kind: "decision",
        summary: "Truth engine planned the arena grounding pass.",
        content: `Intent ${args.research.queryPlan.intent}. Selected query: ${args.research.queryPlan.selectedQuery ?? "none"}. ${args.research.decision.reasoning}`,
        service: "researchToolService",
        tags: ["research", args.research.queryPlan.intent]
      }),
      buildMessage({
        role: "research_verifier",
        kind: "evidence",
        summary: args.research.truth.no_reliable_source
          ? "Arena research stayed inconclusive."
          : "Arena research delivered grounded evidence.",
        content: `${describeResearchOutcome(args.research)} ${args.research.summary.join(" ")}`.trim(),
        service: "researchVerifier",
        tags: ["research", args.research.route]
      })
    );
  }

  const handoffs = [
    buildHandoff({
      from: "orchestrator",
      to: "respondent",
      reason: "Produce independent first-pass answers before critique.",
      artifacts: ["question", args.models.respondentA, args.models.respondentB]
    }),
    buildHandoff({
      from: "respondent",
      to: "red_team",
      reason: "Stress-test both initial answers before refinement.",
      artifacts: ["respondentA", "respondentB"]
    }),
    buildHandoff({
      from: "red_team",
      to: "teacher",
      reason: "Turn the critique into targeted refinements for both sides.",
      artifacts: ["red_team_output"]
    }),
    buildHandoff({
      from: "teacher",
      to: "judge",
      reason: "Score the refined answers and pick the winner.",
      artifacts: ["refineA", "refineB"]
    }),
    buildHandoff({
      from: "judge",
      to: "synthesizer",
      reason: "Use the judged winner to synthesize the final answer.",
      artifacts: ["judge_output"]
    }),
    buildHandoff({
      from: "synthesizer",
      to: "local_student",
      reason: "Extract reusable lessons from the completed round.",
      artifacts: ["final_answer", "judge_output"]
    }),
    buildHandoff({
      from: "local_student",
      to: "history_store",
      reason: "Persist the round with its learning signals.",
      artifacts: ["learning_notes", "round"]
    })
  ];

  if (args.knowledge) {
    handoffs.splice(
      1,
      0,
      buildHandoff({
        from: "orchestrator",
        to: "knowledge_memory",
        reason: "Load benchmark and memory guidance before refinement routing.",
        artifacts: ["knowledge_injection"]
      }),
      buildHandoff({
        from: "knowledge_memory",
        to: "teacher",
        reason: "Pass strategy note, winning patterns, and memory rules into the refinement stage.",
        artifacts: ["knowledge_injection"]
      })
    );
  }

  if (args.research.considered) {
    handoffs.splice(
      args.knowledge ? 4 : 2,
      0,
      buildHandoff({
        from: "red_team",
        to: "research_planner",
        reason: "Ground external or temporal claims surfaced by red-team critique.",
        artifacts: ["target_claims"]
      }),
      buildHandoff({
        from: "research_verifier",
        to: "teacher",
        reason: args.research.used
          ? "Feed grounded evidence into both refinement passes."
          : "Feed abstention guidance because the truth engine stayed inconclusive.",
        artifacts: ["research_log"]
      })
    );
  }

  const tasks = [
    buildTask({
      kind: "plan_work",
      owner: "orchestrator",
      objective: "Run an arena round with routing, refinement, and synthesis.",
      status: "completed",
      notes: [
        `Focus ${args.orchestration.focus}.`,
        `Router ${args.router.globalStrategy}.`,
        `Models ${args.models.respondentA} / ${args.models.respondentB}.`
      ]
    }),
    buildTask({
      kind: "load_memory",
      owner: "knowledge_memory",
      objective: "Load benchmark and memory context for the round.",
      status: args.knowledge ? "completed" : "skipped",
      notes: [
        args.knowledge
          ? args.knowledge.strategyNote
          : "No knowledge injection was available for this arena round."
      ]
    }),
    buildTask({
      kind: "draft_answer",
      owner: "respondent",
      objective: "Produce two independent respondent drafts.",
      status: "completed",
      notes: [buildTraceNote(args.respondentATrace), buildTraceNote(args.respondentBTrace)]
    }),
    buildTask({
      kind: "critique_answer",
      owner: "red_team",
      objective: "Attack both drafts and surface factual or reasoning risks.",
      status: "completed",
      notes: uniqueStrings(args.redTeam.shared_risks).slice(0, 4)
    }),
    buildTask({
      kind: "ground_claims",
      owner: "research_verifier",
      objective: "Ground factual or temporal claims before the refine stage.",
      status: researchTaskStatus(args.research),
      notes: [describeResearchOutcome(args.research)]
    }),
    buildTask({
      kind: "refine_answer",
      owner: "teacher",
      objective: "Refine both respondent drafts with critique and research input.",
      status: "completed",
      notes: uniqueStrings([
        ...args.refineA.fixes_applied,
        ...args.refineB.fixes_applied
      ]).slice(0, 4)
    }),
    buildTask({
      kind: "evaluate_answer",
      owner: "judge",
      objective: "Evaluate refined answers and select the best one.",
      status: "completed",
      notes: [args.judge.reasoning]
    }),
    buildTask({
      kind: "synthesize_answer",
      owner: "synthesizer",
      objective: "Synthesize the final answer from the judged winner.",
      status: "completed",
      notes: uniqueStrings(args.synthesizer.improvements_added).slice(0, 4)
    }),
    buildTask({
      kind: "observe_learning",
      owner: "local_student",
      objective: "Extract reusable learning notes from the arena round.",
      status: "completed",
      notes: uniqueStrings(args.localStudent.learning_notes).slice(0, 4)
    }),
    buildTask({
      kind: "persist_learning",
      owner: "history_store",
      objective: "Persist the arena round and append the derived dataset entry.",
      status: "completed",
      notes: [`Round ${args.roundId}.`, `Research used=${args.research.used}.`]
    })
  ];

  return hydriaWorkflowRunSchema.parse({
    runId: args.roundId,
    scope: "arena_round",
    status: args.research.route === "failed" ? "partial" : "completed",
    question: args.question,
    category: args.category,
    startedAt: args.createdAt,
    completedAt: completionTimestamp(args.createdAt, args.durationMs),
    messages,
    handoffs,
    tasks,
    outcome: `Arena round completed with winner ${args.judge.winner} and synthesize target ${args.synthesizer.based_on_winner}.`
  });
}

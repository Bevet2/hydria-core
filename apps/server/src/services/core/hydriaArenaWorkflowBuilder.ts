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
  redTeamTrace: ExecutionTrace;
  refineA: RefinerOutput;
  refineATrace: ExecutionTrace;
  refineB: RefinerOutput;
  refineBTrace: ExecutionTrace;
  judge: JudgeOutput;
  judgeTrace: ExecutionTrace;
  synthesizer: SynthesizerOutput;
  synthesizerTrace: ExecutionTrace;
  localStudent: LocalStudentOutput;
  localStudentTrace: ExecutionTrace;
};

function describeRefineLane(
  slot: "A" | "B",
  shouldRefine: boolean,
  estimatedValue: RefineRouterDecisionDetails["estimatedValue"]["A"],
  output: RefinerOutput,
  trace: ExecutionTrace
) {
  if (!shouldRefine) {
    return `${slot}: skipped by router at estimated value ${estimatedValue}. ${buildTraceNote(trace)}`;
  }

  const route = output.routerSkipped ? "preserved original answer" : "ran active refinement";
  return `${slot}: ${route}. Estimated value ${estimatedValue}. ${buildTraceNote(trace)}`;
}

function summarizeResearchAcquisition(research: ResearchToolLog) {
  if (!research.decision.shouldUse) {
    return "Research acquisition was skipped because the planner stayed off.";
  }
  if (research.route === "failed") {
    return "Research acquisition failed before a stable evidence set was assembled.";
  }

  const channels = uniqueStrings(
    research.sources.flatMap((source) =>
      source.retrievalChannel ? [source.retrievalChannel] : []
    )
  );
  const origins = uniqueStrings(
    research.sources.flatMap((source) =>
      source.retrievalOrigin ? [source.retrievalOrigin] : []
    )
  );
  const dateSources = uniqueStrings(
    research.sources.flatMap((source) =>
      source.dateSource ? [source.dateSource] : []
    )
  );

  return [
    `Accepted ${research.sources.length} source(s).`,
    channels.length > 0 ? `Channels: ${channels.join(", ")}.` : null,
    origins.length > 0 ? `Origins: ${origins.join(", ")}.` : null,
    dateSources.length > 0 ? `Date signals: ${dateSources.join(", ")}.` : null
  ]
    .filter(Boolean)
    .join(" ");
}

function overallDelta(judge: JudgeOutput, slot: "A" | "B") {
  return judge.scores[slot].overall - judge.initial_scores[slot].overall;
}

function buildArenaWorkflowStatus(args: {
  research: ResearchToolLog;
  traces: ExecutionTrace[];
}) {
  if (args.research.route === "failed") {
    return "partial" as const;
  }

  return args.traces.some((trace) =>
    ["fallback_success", "static_fallback", "failure"].includes(trace.outcome)
  )
    ? ("partial" as const)
    : ("completed" as const);
}

export function buildArenaRoundWorkflowRun(
  args: HydriaArenaRoundWorkflowArgs
): HydriaWorkflowRun {
  const orchestrationReasoning = args.orchestration.reasoning ?? [];
  const estimatedValueA = args.router.estimatedValue?.A ?? "medium";
  const estimatedValueB = args.router.estimatedValue?.B ?? "medium";
  const redTeamAttacksOnA = args.redTeam.attacks_on_a ?? [];
  const redTeamAttacksOnB = args.redTeam.attacks_on_b ?? [];
  const redTeamSharedRisks = args.redTeam.shared_risks ?? [];
  const redTeamHiddenAssumptions = args.redTeam.hidden_assumptions ?? [];
  const redTeamPotentiallyFalseClaims = args.redTeam.potentially_false_claims ?? [];
  const localStudentNotes = args.localStudent.learning_notes ?? [];
  const synthImprovements = args.synthesizer.improvements_added ?? [];

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
      summary: "Arena orchestration selected focus, refine policy, and research posture.",
      content: [
        `Focus ${args.orchestration.focus}.`,
        `Refine policy ${args.orchestration.refinePolicy}.`,
        `Research policy ${args.orchestration.researchPolicy}.`,
        `Router strategy ${args.router.globalStrategy}.`,
        ...orchestrationReasoning.slice(0, 2)
      ].join(" "),
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
      content: `${buildTraceNote(args.redTeamTrace)} ${uniqueStrings([
        ...redTeamAttacksOnA,
        ...redTeamAttacksOnB,
        ...redTeamSharedRisks,
        ...redTeamHiddenAssumptions,
        ...redTeamPotentiallyFalseClaims
      ])
        .slice(0, 10)
        .join(" ")}`,
      service: "openRouter",
      model: args.models.redTeam
    }),
    buildMessage({
      role: "teacher",
      kind: "decision",
      summary: "Router decided which sides were worth refining.",
      content: [
        describeRefineLane(
          "A",
          args.router.shouldRefineA,
          estimatedValueA,
          args.refineA,
          args.refineATrace
        ),
        describeRefineLane(
          "B",
          args.router.shouldRefineB,
          estimatedValueB,
          args.refineB,
          args.refineBTrace
        )
      ].join(" "),
      service: "refineRouterService",
      tags: [args.router.globalStrategy]
    }),
    buildMessage({
      role: "teacher",
      kind: "answer",
      summary: "Refine A improved respondent A.",
      content: `${buildTraceNote(args.refineATrace)} ${args.refineA.improved_answer}`,
      service: "openRouterStructuredStep",
      model: args.models.respondentA,
      tags: ["refineA"]
    }),
    buildMessage({
      role: "teacher",
      kind: "answer",
      summary: "Refine B improved respondent B.",
      content: `${buildTraceNote(args.refineBTrace)} ${args.refineB.improved_answer}`,
      service: "openRouterStructuredStep",
      model: args.models.respondentB,
      tags: ["refineB"]
    }),
    buildMessage({
      role: "judge",
      kind: "evaluation",
      summary: `Judge selected ${args.judge.winner}.`,
      content: [
        buildTraceNote(args.judgeTrace),
        args.judge.reasoning,
        `Overall delta A=${overallDelta(args.judge, "A")}.`,
        `Overall delta B=${overallDelta(args.judge, "B")}.`
      ].join(" "),
      service: "openRouterStructuredStep",
      model: args.models.judge
    }),
    buildMessage({
      role: "synthesizer",
      kind: "answer",
      summary: "Synthesizer merged the strongest answer.",
      content: `${buildTraceNote(args.synthesizerTrace)} ${args.synthesizer.why_this_answer} Final: ${args.synthesizer.final_answer}`,
      service: "openRouterStructuredStep",
      model: args.models.synthesizer
    }),
    buildMessage({
      role: "local_student",
      kind: "answer",
      summary: "Local student summarized the round in student-facing terms.",
      content: `${buildTraceNote(args.localStudentTrace)} ${args.localStudent.student_summary} ${args.localStudent.student_answer}`,
      service: "localModel",
      model: args.localStudentTrace.requestedModel
    }),
    buildMessage({
      role: "local_student",
      kind: "evaluation",
      summary: "Local student extracted reusable learning notes from the round.",
      content: uniqueStrings(localStudentNotes).slice(0, 8).join(" "),
      service: "localModel",
      model: args.localStudentTrace.requestedModel
    }),
    buildMessage({
      role: "history_store",
      kind: "persistence",
      summary: "Arena round was persisted to history storage.",
      content: `Round ${args.roundId} stored with winner ${args.judge.winner}, synth target ${args.synthesizer.based_on_winner}, researchUsed=${args.research.used}.`,
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
        summary: "Knowledge injection informed the arena round.",
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
        role: "research_retriever",
        kind: "evidence",
        summary: "Research acquisition assembled the arena evidence set.",
        content: summarizeResearchAcquisition(args.research),
        service: "researchAcquisitionService",
        tags: ["research", args.research.route]
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
        reason: "Ground external or temporal claims surfaced by critique before refinement.",
        artifacts: ["target_claims"]
      }),
      buildHandoff({
        from: "research_planner",
        to: "research_retriever",
        reason: "Acquire candidate sources for the arena grounding pass.",
        artifacts: ["query_plan"]
      }),
      buildHandoff({
        from: "research_retriever",
        to: "research_verifier",
        reason: "Verify freshness and support before refinement uses any evidence.",
        artifacts: ["candidate_sources"]
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
        `Category ${args.category}.`,
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
      notes: [
        `Winner so far ${args.redTeam.winner_so_far}.`,
        `Factual risk ${args.redTeam.factual_risk_level}.`,
        `Reasoning risk ${args.redTeam.reasoning_risk_level}.`,
        ...uniqueStrings(redTeamSharedRisks).slice(0, 2)
      ]
    }),
    buildTask({
      kind: "ground_claims",
      owner: "research_verifier",
      objective: "Ground factual or temporal claims before the refine stage.",
      status: researchTaskStatus(args.research),
      notes: [
        describeResearchOutcome(args.research),
        summarizeResearchAcquisition(args.research)
      ]
    }),
    buildTask({
      kind: "refine_answer",
      owner: "teacher",
      objective: "Refine both respondent drafts with critique and research input.",
      status: "completed",
      notes: [
        describeRefineLane(
          "A",
          args.router.shouldRefineA,
          estimatedValueA,
          args.refineA,
          args.refineATrace
        ),
        describeRefineLane(
          "B",
          args.router.shouldRefineB,
          estimatedValueB,
          args.refineB,
          args.refineBTrace
        )
      ]
    }),
    buildTask({
      kind: "evaluate_answer",
      owner: "judge",
      objective: "Evaluate refined answers and select the best one.",
      status: "completed",
      notes: [
        `Winner ${args.judge.winner}.`,
        `Overall delta A=${overallDelta(args.judge, "A")}.`,
        `Overall delta B=${overallDelta(args.judge, "B")}.`,
        args.judge.reasoning
      ]
    }),
    buildTask({
      kind: "synthesize_answer",
      owner: "synthesizer",
      objective: "Synthesize the final answer from the judged winner.",
      status: "completed",
      notes: [
        `Based on ${args.synthesizer.based_on_winner}.`,
        args.synthesizer.why_this_answer,
        ...uniqueStrings(synthImprovements).slice(0, 2)
      ]
    }),
    buildTask({
      kind: "observe_learning",
      owner: "local_student",
      objective: "Extract reusable learning notes from the arena round.",
      status: "completed",
      notes: [
        args.localStudent.student_summary,
        ...uniqueStrings(localStudentNotes).slice(0, 3)
      ]
    }),
    buildTask({
      kind: "persist_learning",
      owner: "history_store",
      objective: "Persist the arena round and append the derived dataset entry.",
      status: "completed",
      notes: [
        `Round ${args.roundId}.`,
        `Winner ${args.judge.winner}.`,
        `Research used=${args.research.used}.`
      ]
    })
  ];

  return hydriaWorkflowRunSchema.parse({
    runId: args.roundId,
    scope: "arena_round",
    status: buildArenaWorkflowStatus({
      research: args.research,
      traces: [
        args.respondentATrace,
        args.respondentBTrace,
        args.redTeamTrace,
        args.refineATrace,
        args.refineBTrace,
        args.judgeTrace,
        args.synthesizerTrace,
        args.localStudentTrace
      ]
    }),
    question: args.question,
    category: args.category,
    startedAt: args.createdAt,
    completedAt: completionTimestamp(args.createdAt, args.durationMs),
    messages,
    handoffs,
    tasks,
    outcome: `Arena round completed with winner ${args.judge.winner}, synth target ${args.synthesizer.based_on_winner}, and local learning summary captured.`
  });
}

import type {
  ExecutionTrace,
  QuestionCategory,
  ResearchToolLog,
  RedTeamOutput
} from "../../types/arena.js";
import { hydriaWorkflowRunSchema, type HydriaWorkflowRun } from "../../types/core.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type {
  StudentAnswer,
  StudentJudgeOutput,
  StudentResponseStrategy
} from "../../types/student.js";
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

export type HydriaStudentPreviewWorkflowArgs = {
  previewId: string;
  question: string;
  category: QuestionCategory;
  startedAt: string;
  durationMs: number;
  knowledge: KnowledgeInjection | null;
  strategy: StudentResponseStrategy;
  research: ResearchToolLog;
  rawDraft: StudentAnswer;
  previewDraft: StudentAnswer;
  toolApplied: boolean;
  trace: ExecutionTrace;
};

export function buildStudentPreviewWorkflowRun(
  args: HydriaStudentPreviewWorkflowArgs
): HydriaWorkflowRun {
  const messages = [
    buildMessage({
      role: "orchestrator",
      kind: "question",
      summary: "Student preview received a question.",
      content: args.question,
      service: "studentService"
    }),
    buildMessage({
      role: "orchestrator",
      kind: "decision",
      summary: "Student preview selected a response strategy.",
      content: `Category ${args.category}. Strategy ${args.strategy.strategyId}. ${args.strategy.impactReason}`,
      service: "studentStrategySelector"
    }),
    buildMessage({
      role: "student",
      kind: "draft",
      summary: "Local student produced a raw draft.",
      content: `${buildTraceNote(args.trace)} ${args.rawDraft.answer}`,
      service: "localModel",
      model: args.trace.requestedModel,
      tags: [args.strategy.strategyId]
    })
  ];

  const handoffs = [];

  if (args.knowledge) {
    messages.push(
      buildMessage({
        role: "knowledge_memory",
        kind: "memory",
        summary: "Knowledge injection provided reusable guidance.",
        content: `${args.knowledge.strategyNote} Student memory: ${args.knowledge.studentMemorySummary}`,
        service: "knowledgeInjectionService",
        tags: ["knowledge"]
      })
    );
    handoffs.push(
      buildHandoff({
        from: "orchestrator",
        to: "knowledge_memory",
        reason: "Load benchmark and student memory before drafting.",
        artifacts: ["knowledge_injection"]
      }),
      buildHandoff({
        from: "knowledge_memory",
        to: "student",
        reason: "Pass strategy note, coaching hints, and student-memory rules to the local student.",
        artifacts: ["knowledge_injection", args.strategy.strategyId]
      })
    );
  }

  if (args.research.considered) {
    messages.push(
      buildMessage({
        role: "research_planner",
        kind: "decision",
        summary: "Truth engine decided how to ground the preview.",
        content: `Intent ${args.research.queryPlan.intent}. Selected query: ${args.research.queryPlan.selectedQuery ?? "none"}. ${args.research.decision.reasoning}`,
        service: "researchToolService",
        tags: ["research", args.research.queryPlan.intent]
      }),
      buildMessage({
        role: "research_verifier",
        kind: "evidence",
        summary: args.research.truth.no_reliable_source
          ? "Truth engine stayed in abstention mode."
          : "Truth engine returned grounded evidence.",
        content: `${describeResearchOutcome(args.research)} ${args.research.summary.join(" ")}`.trim(),
        service: "researchVerifier",
        tags: ["research", args.research.route]
      })
    );
    handoffs.push(
      buildHandoff({
        from: "student",
        to: "research_planner",
        reason: "Escalate external claims or temporal freshness checks before freezing the preview.",
        artifacts: ["raw_draft"]
      }),
      buildHandoff({
        from: "research_verifier",
        to: "student",
        reason: args.toolApplied
          ? "Inject grounded evidence back into the preview answer."
          : "Keep the preview cautious because grounding stayed inconclusive.",
        artifacts: ["research_log"]
      })
    );
  }

  messages.push(
    buildMessage({
      role: "student",
      kind: "answer",
      summary: args.toolApplied
        ? "Preview answer was updated after research."
        : "Preview answer stayed on the local draft path.",
      content: args.previewDraft.answer,
      service: "localModel",
      model: args.trace.requestedModel,
      tags: ["preview"]
    })
  );

  const tasks = [
    buildTask({
      kind: "plan_work",
      owner: "orchestrator",
      objective: "Classify the question and choose a student response strategy.",
      status: "completed",
      notes: [`Category ${args.category}.`, `Strategy ${args.strategy.strategyId}.`]
    }),
    buildTask({
      kind: "load_memory",
      owner: "knowledge_memory",
      objective: "Load benchmark and student memory before the local draft.",
      status: args.knowledge ? "completed" : "skipped",
      notes: [
        args.knowledge
          ? args.knowledge.studentMemorySummary
          : "No knowledge injection was available for this preview."
      ]
    }),
    buildTask({
      kind: "draft_answer",
      owner: "student",
      objective: "Produce the local student draft.",
      status: "completed",
      notes: [buildTraceNote(args.trace)]
    }),
    buildTask({
      kind: "ground_claims",
      owner: "research_verifier",
      objective: "Ground external or temporal claims before preview handoff.",
      status: researchTaskStatus(args.research),
      notes: [describeResearchOutcome(args.research)]
    })
  ];

  return hydriaWorkflowRunSchema.parse({
    runId: args.previewId,
    scope: "student_preview",
    status: args.research.route === "failed" ? "partial" : "completed",
    question: args.question,
    category: args.category,
    startedAt: args.startedAt,
    completedAt: completionTimestamp(args.startedAt, args.durationMs),
    messages,
    handoffs,
    tasks,
    outcome: args.toolApplied
      ? "Preview completed with student-plus-tool grounding."
      : "Preview completed on the student draft path."
  });
}

export type HydriaStudentSessionWorkflowArgs = {
  sessionId: string;
  question: string;
  category: QuestionCategory;
  createdAt: string;
  durationMs: number;
  strategy: StudentResponseStrategy;
  knowledge: KnowledgeInjection | null;
  research: ResearchToolLog;
  rawDraft: StudentAnswer;
  finalStudentAnswer: StudentAnswer;
  studentTrace: ExecutionTrace;
  redTeam: RedTeamOutput;
  teacher: { improved_answer: string; fixes_applied: string[] };
  judge: StudentJudgeOutput;
  toolApplied: boolean;
  weakPoints: string[];
  coachingNotes: string[];
};

export function buildStudentSessionWorkflowRun(
  args: HydriaStudentSessionWorkflowArgs
): HydriaWorkflowRun {
  const messages = [
    buildMessage({
      role: "orchestrator",
      kind: "question",
      summary: "Student session entered full evaluation mode.",
      content: args.question,
      service: "studentService"
    }),
    buildMessage({
      role: "student",
      kind: "draft",
      summary: "Student draft entered the learning loop.",
      content: `${buildTraceNote(args.studentTrace)} ${args.rawDraft.answer}`,
      service: "localModel",
      model: args.studentTrace.requestedModel,
      tags: ["raw_draft"]
    }),
    buildMessage({
      role: "red_team",
      kind: "critique",
      summary: "Red team challenged the student answer.",
      content: uniqueStrings([
        ...args.redTeam.attacks_on_a,
        ...args.redTeam.shared_risks,
        ...args.redTeam.hidden_assumptions
      ])
        .slice(0, 8)
        .join(" "),
      service: "studentService"
    }),
    buildMessage({
      role: "teacher",
      kind: "answer",
      summary: "Teacher produced the improved answer.",
      content: args.teacher.improved_answer,
      service: "openRouterStructuredStep"
    }),
    buildMessage({
      role: "judge",
      kind: "evaluation",
      summary: `Judge verdict: ${args.judge.verdict}.`,
      content: `${args.judge.reasoning} Weak points: ${args.weakPoints.join(" ")}`.trim(),
      service: "openRouterStructuredStep"
    }),
    buildMessage({
      role: "session_store",
      kind: "persistence",
      summary: "Session was persisted into learning storage.",
      content: uniqueStrings(args.coachingNotes).slice(0, 6).join(" "),
      service: "studentSessionStore"
    })
  ];

  if (args.knowledge) {
    messages.splice(
      1,
      0,
      buildMessage({
        role: "knowledge_memory",
        kind: "memory",
        summary: "Knowledge and student memory were injected into the session.",
        content: `${args.knowledge.strategyNote} Student memory: ${args.knowledge.studentMemorySummary}`,
        service: "knowledgeInjectionService",
        tags: ["knowledge"]
      })
    );
  }

  if (args.research.considered) {
    messages.splice(
      2,
      0,
      buildMessage({
        role: "research_verifier",
        kind: "evidence",
        summary: args.research.truth.no_reliable_source
          ? "Research could not fully ground the session."
          : "Research supplied evidence to the session.",
        content: `${describeResearchOutcome(args.research)} ${args.research.summary.join(" ")}`.trim(),
        service: "researchVerifier",
        tags: ["research", args.research.route]
      })
    );
  }

  if (args.toolApplied) {
    messages.splice(
      3,
      0,
      buildMessage({
        role: "student",
        kind: "answer",
        summary: "Student produced a grounded final answer before teacher review.",
        content: args.finalStudentAnswer.answer,
        service: "localModel",
        model: args.studentTrace.requestedModel,
        tags: ["grounded_draft"]
      })
    );
  }

  const handoffs = [
    buildHandoff({
      from: "student",
      to: "red_team",
      reason: "Challenge the local answer before teacher intervention.",
      artifacts: ["student_draft"]
    }),
    buildHandoff({
      from: "red_team",
      to: "teacher",
      reason: "Use critique and hidden assumptions to improve the answer.",
      artifacts: ["red_team_output"]
    }),
    buildHandoff({
      from: "teacher",
      to: "judge",
      reason: "Score the improved answer against the original student draft.",
      artifacts: ["teacher_answer", "student_draft"]
    }),
    buildHandoff({
      from: "judge",
      to: "session_store",
      reason: "Persist the learning signal and refresh downstream trackers.",
      artifacts: ["judge_output", "coaching_notes"]
    })
  ];

  if (args.knowledge) {
    handoffs.unshift(
      buildHandoff({
        from: "orchestrator",
        to: "knowledge_memory",
        reason: "Load reusable strategy and student-memory context before the session loop.",
        artifacts: ["knowledge_injection"]
      }),
      buildHandoff({
        from: "knowledge_memory",
        to: "student",
        reason: "Provide strategy and memory context to the local student.",
        artifacts: ["knowledge_injection", args.strategy.strategyId]
      })
    );
  }

  if (args.research.considered) {
    handoffs.splice(
      args.knowledge ? 3 : 1,
      0,
      buildHandoff({
        from: "student",
        to: "research_planner",
        reason: "Ground external or temporal claims before teacher review.",
        artifacts: ["student_draft"]
      }),
      buildHandoff({
        from: "research_verifier",
        to: "student",
        reason: args.toolApplied
          ? "Return grounded evidence to the student draft."
          : "Return abstention guidance because evidence stayed insufficient.",
        artifacts: ["research_log"]
      })
    );
  }

  const tasks = [
    buildTask({
      kind: "plan_work",
      owner: "orchestrator",
      objective: "Run the student learning loop on one question.",
      status: "completed",
      notes: [`Strategy ${args.strategy.strategyId}.`, `Category ${args.category}.`]
    }),
    buildTask({
      kind: "load_memory",
      owner: "knowledge_memory",
      objective: "Load benchmark and student memory before the session run.",
      status: args.knowledge ? "completed" : "skipped",
      notes: [
        args.knowledge
          ? args.knowledge.studentMemorySummary
          : "No knowledge injection was available for this session."
      ]
    }),
    buildTask({
      kind: "draft_answer",
      owner: "student",
      objective: "Produce the local student answer that enters review.",
      status: "completed",
      notes: [buildTraceNote(args.studentTrace)]
    }),
    buildTask({
      kind: "ground_claims",
      owner: "research_verifier",
      objective: "Ground factual or temporal claims before teacher review.",
      status: researchTaskStatus(args.research),
      notes: [describeResearchOutcome(args.research)]
    }),
    buildTask({
      kind: "critique_answer",
      owner: "red_team",
      objective: "Surface hidden assumptions, false claims, and attack angles.",
      status: "completed",
      notes: uniqueStrings(args.weakPoints).slice(0, 4)
    }),
    buildTask({
      kind: "refine_answer",
      owner: "teacher",
      objective: "Improve the answer using critique, research, and knowledge.",
      status: "completed",
      notes: uniqueStrings(args.teacher.fixes_applied).slice(0, 4)
    }),
    buildTask({
      kind: "evaluate_answer",
      owner: "judge",
      objective: "Judge whether the teacher pass improved the student answer.",
      status: "completed",
      notes: [args.judge.reasoning]
    }),
    buildTask({
      kind: "persist_learning",
      owner: "session_store",
      objective: "Persist the session and refresh downstream learning artifacts.",
      status: "completed",
      notes: uniqueStrings(args.coachingNotes).slice(0, 4)
    })
  ];

  return hydriaWorkflowRunSchema.parse({
    runId: args.sessionId,
    scope: "student_session",
    status: args.research.route === "failed" ? "partial" : "completed",
    question: args.question,
    category: args.category,
    startedAt: args.createdAt,
    completedAt: completionTimestamp(args.createdAt, args.durationMs),
    messages,
    handoffs,
    tasks,
    outcome: `Session completed with judge verdict ${args.judge.verdict} and toolApplied=${args.toolApplied}.`
  });
}

import { createHash } from "node:crypto";
import type { ArenaRound, QuestionCategory, ResearchToolLog } from "../../types/arena.js";
import type { StudentSession } from "../../types/student.js";
import type {
  SkillCandidate,
  SkillExecutionTrace,
  SkillIoField,
  SkillStep,
  SkillToolType
} from "../../types/skills.js";
import { skillCandidateSchema } from "../../types/skills.js";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hashId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function averageJudgeDeltaFromRound(round: ArenaRound) {
  const winner = round.outputs.judge.winner;
  if (winner === "tie") {
    return round.metrics.refineGain.global;
  }
  return round.outputs.judge.scores[winner].overall - round.outputs.judge.initial_scores[winner].overall;
}

function deriveTaskPattern(research: ResearchToolLog) {
  if (research.toolRouting.toolType !== "none") {
    return `${research.toolRouting.toolType}:${research.toolRouting.intent}`;
  }

  return `research:${research.queryPlan.intent}`;
}

function isOneShotQuestion(question: string) {
  const normalized = question.toLowerCase();
  const volatileSignals =
    Number(/\b\d{4,}\b/.test(normalized)) +
    Number(/\bline\s+\d+\b/.test(normalized)) +
    Number(/[A-Fa-f0-9]{8,}/.test(normalized)) +
    Number(/\bthis exact\b|\bmy file\b|\bmy screenshot\b/.test(normalized));
  return volatileSignals >= 2;
}

function isRepeatableProcedure(question: string, research: ResearchToolLog) {
  if (research.toolRouting.toolType !== "none" && research.toolRouting.intent !== "none") {
    return true;
  }

  return (
    research.decision.shouldUse &&
    !isOneShotQuestion(question) &&
    ["current_status", "recent_updates", "release_freshness", "definition", "diagnostic_docs"].includes(
      research.queryPlan.intent
    )
  );
}

function buildInputs(research: ResearchToolLog): SkillIoField[] {
  const fields: SkillIoField[] = [
    {
      name: "question",
      type: "string",
      required: true,
      description: "Original user request to classify and route."
    }
  ];

  if (typeof research.toolRouting.extractedArgs.location === "string") {
    fields.push({
      name: "location",
      type: "string",
      required: true,
      description: "Resolved location or place name for the lookup."
    });
  }

  if (typeof research.toolRouting.extractedArgs.asset === "string") {
    fields.push({
      name: "asset",
      type: "string",
      required: true,
      description: "Resolved ticker or asset identifier."
    });
  }

  if (typeof research.toolRouting.extractedArgs.subject === "string") {
    fields.push({
      name: "subject",
      type: "string",
      required: true,
      description: "Resolved entity or subject to verify."
    });
  }

  return fields.slice(0, 8);
}

function buildOutputs(): SkillIoField[] {
  return [
    {
      name: "verified_result",
      type: "string",
      required: true,
      description: "Verified result, grounded answer, or explicit failure explanation."
    },
    {
      name: "evidence_summary",
      type: "array",
      required: false,
      description: "Short summary of sources, claims, or reasoning used."
    },
    {
      name: "failure_reason",
      type: "string",
      required: false,
      description: "Explicit reason when the procedure cannot complete safely."
    }
  ];
}

function buildProcedureSteps(research: ResearchToolLog): SkillStep[] {
  const toolType = research.toolRouting.toolType;
  const intent = research.toolRouting.intent;

  const steps: SkillStep[] = [
    {
      stepId: "classify_request",
      title: "Classify the request",
      description: `Identify the request as ${intent === "none" ? research.queryPlan.intent : intent}.`,
      toolHint: null,
      expectedOutcome: "A stable procedural route is selected."
    }
  ];

  if (toolType !== "none") {
    steps.push({
      stepId: "prepare_tool_args",
      title: "Prepare tool arguments",
      description: "Extract the minimal structured arguments needed by the target tool.",
      toolHint: toolType,
      expectedOutcome: "Structured tool arguments are ready."
    });
  }

  if (research.decision.shouldUse) {
    steps.push({
      stepId: "collect_external_signal",
      title: "Collect external evidence",
      description:
        toolType === "none"
          ? "Run the research retrieval plan and gather the strongest available sources."
          : `Call the ${toolType} tool or its research-backed equivalent and collect the result.`,
      toolHint: toolType === "none" ? "research" : toolType,
      expectedOutcome: "A tool result or grounded source set is available."
    });
  }

  steps.push({
    stepId: "validate_or_abstain",
    title: "Validate or abstain",
    description:
      "Use the result only if it is reliable enough; otherwise surface a clear failure instead of improvising.",
    toolHint: null,
    expectedOutcome: "The final answer is either grounded or explicitly abstains."
  });

  return steps.slice(0, 8);
}

function buildSafetyConstraints(research: ResearchToolLog) {
  const constraints = [
    "Do not invent live, current, or externally verifiable data.",
    "If the tool or lookup fails, state the failure explicitly.",
    "Do not redirect the user to an app or site when the procedure is available."
  ];

  if (!research.toolRouting.fallbackAllowed) {
    constraints.push("Do not answer from memory when the required tool path is unavailable.");
  }

  return constraints.slice(0, 6);
}

function buildFailureModes(research: ResearchToolLog) {
  const failures = [
    research.toolRouting.reason,
    ...research.truth.uncertain_claims,
    ...research.impactNotes
  ]
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  return [...new Set(failures)].slice(0, 6);
}

function buildSuccessCriteria(research: ResearchToolLog) {
  const criteria = [
    research.truth.no_reliable_source
      ? "Return an explicit safe failure when no reliable source is available."
      : "Return a grounded answer with verified facts.",
    "Keep the response aligned with the tool result or accepted sources.",
    "Avoid unsupported claims and stale data."
  ];

  return criteria.slice(0, 6);
}

function buildSkillName(intent: string, toolType: SkillToolType) {
  const readableIntent = intent.replaceAll("_", " ");
  if (toolType !== "none") {
    return `Handle ${readableIntent} with ${toolType} routing`;
  }

  return `Handle ${readableIntent} with grounded research`;
}

function buildDescription(intent: string, category: QuestionCategory, toolType: SkillToolType) {
  const readableIntent = intent.replaceAll("_", " ");
  const readableCategory = category.replaceAll("_", " ");
  return toolType !== "none"
    ? `Reusable procedure for ${readableCategory} questions that need ${readableIntent} through ${toolType}.`
    : `Reusable grounded research procedure for ${readableCategory} questions that map to ${readableIntent}.`;
}

function deriveIntent(research: ResearchToolLog) {
  if (research.toolRouting.intent !== "none") {
    return research.toolRouting.intent;
  }

  return `research_${research.queryPlan.intent}`;
}

export class SkillCandidateService {
  extractFromArenaRound(round: ArenaRound) {
    return this.buildCandidate({
      source: "arena_round",
      sourceId: round.roundId,
      question: round.question,
      category: round.category,
      research: round.research,
      finalAnswer:
        round.outputs.synthesizer.final_answer ||
        round.outputs.respondentA.answer,
      success:
        round.outputs.judge.winner !== "tie" &&
        !round.research.truth.no_reliable_source &&
        round.workflow.status !== "partial",
      judgeDelta: averageJudgeDeltaFromRound(round),
      successRate: round.outputs.judge.winner === "tie" ? 50 : 100
    });
  }

  extractFromStudentSession(session: StudentSession) {
    return this.buildCandidate({
      source: "student_session",
      sourceId: session.sessionId,
      question: session.question,
      category: session.category,
      research: session.research,
      finalAnswer: session.student.final.answer,
      success:
        session.judge.verdict !== "regressed" &&
        !session.tooling.noReliableSource,
      judgeDelta: session.progression.deltaOverall,
      successRate: session.judge.verdict === "improved" ? 100 : session.judge.verdict === "minor" ? 75 : 40
    });
  }

  extractFromExecutionTrace(trace: SkillExecutionTrace): SkillCandidate | null {
    if (!trace.success) {
      return null;
    }

    const intent = trace.intent;
    const taskPattern = `${trace.toolType}:${intent}`;
    const candidateId = `skill-candidate::${taskPattern}::${hashId(`${trace.traceId}:${intent}`)}`;
    return skillCandidateSchema.parse({
      candidateId,
      source: "execution_trace",
      sourceId: trace.traceId,
      name: buildSkillName(intent, trace.toolType),
      intent,
      description: `Recovered procedural skill candidate for ${intent}.`,
      inputs: [
        {
          name: "question",
          type: "string",
          required: true,
          description: "Original user request."
        }
      ],
      outputs: [
        {
          name: "result",
          type: "string",
          required: true,
          description: "Grounded result or explicit failure."
        }
      ],
      requiredTools: trace.toolType === "none" ? [] : [trace.toolType],
      steps: trace.steps,
      preconditions: ["The request matches the same intent family."],
      successCriteria: ["The procedure yields a grounded answer or explicit safe failure."],
      failureModes: ["The external dependency fails or returns insufficient data."],
      safetyConstraints: ["Do not improvise unsupported data."],
      examples: [
        {
          input: trace.question,
          outcome: trace.finalAnswerSummary
        }
      ],
      scope: {
        category: trace.category,
        toolType: trace.toolType,
        taskPattern
      },
      repeatable: true,
      repeatabilityReason: "The execution trace maps to a stable procedural intent.",
      usefulnessScore: clamp((Math.max(trace.judgeDelta ?? 0, 0) / 10) * 100, 45, 90),
      riskScore: 25,
      generalizationScore: 80,
      confidenceScore: 0.72,
      observedJudgeDelta: trace.judgeDelta,
      observedSuccessRate: 100,
      createdAt: trace.createdAt
    });
  }

  extractFromCorpus(args: {
    rounds: ArenaRound[];
    sessions: StudentSession[];
  }) {
    const candidates = [
      ...args.rounds.map((round) => this.extractFromArenaRound(round)),
      ...args.sessions.map((session) => this.extractFromStudentSession(session))
    ].filter((candidate): candidate is SkillCandidate => candidate !== null);

    const deduped = new Map<string, SkillCandidate>();
    for (const candidate of candidates) {
      const key = `${candidate.intent}::${candidate.scope.category ?? "global"}::${candidate.scope.toolType ?? "none"}`;
      const current = deduped.get(key);
      if (!current || candidate.usefulnessScore > current.usefulnessScore) {
        deduped.set(key, candidate);
      }
    }

    return [...deduped.values()];
  }

  private buildCandidate(args: {
    source: SkillCandidate["source"];
    sourceId: string;
    question: string;
    category: QuestionCategory;
    research: ResearchToolLog;
    finalAnswer: string;
    success: boolean;
    judgeDelta: number | null;
    successRate: number;
  }): SkillCandidate | null {
    if (!args.success || !isRepeatableProcedure(args.question, args.research)) {
      return null;
    }

    const intent = deriveIntent(args.research);
    const toolType = args.research.toolRouting.toolType;
    const taskPattern = deriveTaskPattern(args.research);
    const usefulnessScore = clamp(
      (Math.max(args.judgeDelta ?? 0, 0) / 12) * 55 +
        (args.successRate / 100) * 45,
      0,
      100
    );
    const riskScore = clamp(
      Number(args.research.truth.no_reliable_source) * 45 +
        Number(args.research.route === "failed") * 35 +
        Number(args.research.impact.netImpact === "negative") * 30,
      0,
      100
    );
    const generalizationScore = clamp(
      (toolType !== "none" ? 75 : 60) +
        Number(!isOneShotQuestion(args.question)) * 15,
      0,
      100
    );
    const confidenceScore = clamp(
      usefulnessScore / 100 * 0.45 +
        (1 - riskScore / 100) * 0.25 +
        generalizationScore / 100 * 0.3,
      0,
      1
    );
    const candidateId = `skill-candidate::${intent}::${hashId(`${args.source}:${args.sourceId}:${taskPattern}`)}`;

    return skillCandidateSchema.parse({
      candidateId,
      source: args.source,
      sourceId: args.sourceId,
      name: buildSkillName(intent, toolType),
      intent,
      description: buildDescription(intent, args.category, toolType),
      inputs: buildInputs(args.research),
      outputs: buildOutputs(),
      requiredTools: toolType === "none" ? [] : [toolType],
      steps: buildProcedureSteps(args.research),
      preconditions: [
        "The request matches the same tool or research intent family.",
        "The procedure remains within Hydria Core recommendation boundaries."
      ],
      successCriteria: buildSuccessCriteria(args.research),
      failureModes: buildFailureModes(args.research),
      safetyConstraints: buildSafetyConstraints(args.research),
      examples: [
        {
          input: args.question,
          outcome: normalizeText(args.finalAnswer).slice(0, 600)
        }
      ],
      scope: {
        category: args.category,
        toolType,
        taskPattern
      },
      repeatable: true,
      repeatabilityReason:
        "The task maps to a reusable intent and can be applied to future requests with the same procedural shape.",
      usefulnessScore: Number(usefulnessScore.toFixed(1)),
      riskScore: Number(riskScore.toFixed(1)),
      generalizationScore: Number(generalizationScore.toFixed(1)),
      confidenceScore: Number(confidenceScore.toFixed(3)),
      observedJudgeDelta: args.judgeDelta,
      observedSuccessRate: args.successRate,
      createdAt: new Date().toISOString()
    });
  }
}

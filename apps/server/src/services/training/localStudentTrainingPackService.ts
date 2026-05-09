import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  studentContrastiveExampleSchema,
  studentCuratedExampleSchema,
  type StudentContrastiveExample,
  type StudentCuratedExample
} from "../../types/knowledge.js";
import {
  localStudentTrainingExampleSchema,
  localStudentTrainingPackSummarySchema,
  localStudentTrainingRejectedExampleSchema,
  type LocalStudentTrainingExample,
  type LocalStudentTrainingMetadata,
  type LocalStudentTrainingPackSummary,
  type LocalStudentTrainingRejectedExample,
  type LocalStudentTrainingRejectedReason,
  type LocalStudentTrainingSource,
  type LocalStudentTrainingTaskType,
  type LocalStudentTrainingTier
} from "../../types/training.js";
import {
  studentAnswerSchema,
  type StudentAnswer,
  type StudentSession,
  type StudentToolImpactLabel
} from "../../types/student.js";
import { env, projectRoot } from "../../utils/env.js";
import { LOCAL_STUDENT_FAILURE_RECOVERY_TRAINING_EXAMPLES } from "../../data/localStudentFailureRecoveryTrainingExamples.js";
import { LOCAL_STUDENT_TOOL_BENCH_TRAINING_EXAMPLES } from "../../data/localStudentToolBenchTrainingExamples.js";
import { KnowledgeLayerService } from "../knowledgeLayerService.js";
import { listPersistedStudentSessions } from "../storage/studentSessionPersistence.js";
import { localStudentTrainingConstitution } from "./localStudentTrainingConstitution.js";

type BuildTrainingPackData = {
  curatedExamples: StudentCuratedExample[];
  contrastiveExamples: StudentContrastiveExample[];
  sessions: StudentSession[];
  syntheticExamples?: LocalStudentTrainingExample[];
};

type BuildTrainingPackResult = {
  accepted: LocalStudentTrainingExample[];
  rejected: LocalStudentTrainingRejectedExample[];
  summary: LocalStudentTrainingPackSummary;
};

type LocalStudentTrainingPackServiceOptions = {
  curatedFile?: string;
  contrastiveFile?: string;
  sessionLoader?: () => Promise<StudentSession[]>;
  knowledgeLayerService?: Pick<KnowledgeLayerService, "buildAndPersist">;
  acceptedFile?: string;
  rejectedFile?: string;
  summaryFile?: string;
};

type ExampleDecision =
  | { accepted: LocalStudentTrainingExample }
  | { rejected: LocalStudentTrainingRejectedExample };

const defaultAcceptedFile = resolve(
  projectRoot,
  "storage",
  "datasets",
  "student-local-sft-v1.jsonl"
);
const defaultRejectedFile = resolve(
  projectRoot,
  "storage",
  "datasets",
  "student-local-sft-rejected-v1.jsonl"
);
const defaultSummaryFile = resolve(
  projectRoot,
  "storage",
  "datasets",
  "student-local-sft-summary-v1.json"
);

const zeroSourceBreakdown = () => ({
  curated_round: 0,
  contrastive_round: 0,
  student_session: 0,
  synthetic_tool_bench: 0,
  synthetic_failure_recovery: 0
});

const zeroTaskBreakdown = () => ({
  direct_answer: 0,
  rewrite_answer: 0,
  tool_safe_answer: 0
});

const zeroTierBreakdown = () => ({
  gold: 0,
  silver: 0,
  bronze: 0
});

const zeroRejectionBreakdown = () => ({
  low_selection_score: 0,
  insufficient_delta: 0,
  negative_outcome: 0,
  negative_tool_impact: 0,
  target_too_short: 0,
  target_too_long: 0,
  duplicate_target: 0,
  low_session_score: 0,
  worth_it_no: 0
});

const zeroCategoryBreakdown = () => ({
  technical_explanation: 0,
  architecture_design: 0,
  product_strategy: 0,
  mixed_reasoning: 0,
  operational_writing: 0,
  incident_response: 0,
  debug_diagnostic: 0,
  other: 0
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateAtBoundary(value: string, maxChars: number) {
  const normalized = normalizeSpace(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const candidate = normalized.slice(0, maxChars);
  const sentenceBoundary = Math.max(
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("?")
  );
  const cut = sentenceBoundary >= Math.floor(maxChars * 0.55) ? sentenceBoundary + 1 : maxChars;
  return candidate.slice(0, cut).trim();
}

function splitAnswerItems(value: string) {
  const bulletItems = value
    .split(/\r?\n|;|\u2022/)
    .map((entry) => entry.replace(/^[\s*-]+/, "").trim())
    .filter((entry) => entry.length >= 8);

  if (bulletItems.length > 1) {
    return bulletItems;
  }

  return value
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 8);
}

function toKeyPointLabel(value: string) {
  const withoutMarkdown = value
    .replace(/[`*_#>]/g, "")
    .replace(/^\s*(?:\d+[.)]|[-*])\s*/, "")
    .trim();
  const prefix = withoutMarkdown.split(":")[0]?.trim() ?? withoutMarkdown;
  const compact =
    prefix.length <= 90 && prefix.split(/\s+/).length <= 9
      ? prefix
      : withoutMarkdown.split(/[,;.!?]|\s+\b(?:before|after|while|so that|because)\b\s+/i)[0]?.trim() ??
        withoutMarkdown;
  const words = compact
    .replace(/\s+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  const label = words.join(" ").replace(/[.:;,!?]+$/, "").trim();
  return label || truncateAtBoundary(withoutMarkdown, 72).replace(/[.:;,!?]+$/, "").trim();
}

function deriveKeyPoints(answerText: string) {
  const items = splitAnswerItems(answerText)
    .map(toKeyPointLabel)
    .filter((entry) => entry.length >= 3)
    .slice(0, 5);
  const unique = [...new Set(items)];
  return unique.length > 0 ? unique : [toKeyPointLabel(answerText)];
}

function deriveAssumptions(answerText: string) {
  const assumptions = splitAnswerItems(answerText)
    .filter((entry) => /\b(?:if|assuming|unless|depends|cannot verify|missing|unavailable)\b/i.test(entry))
    .map((entry) => truncateAtBoundary(entry, 180))
    .slice(0, 3);

  return [...new Set(assumptions)];
}

function normalizeTargetConfidence(answerText: string, confidence: number) {
  const rounded = Math.round(clamp(confidence, 0, 100));
  if (rounded > 0) {
    return rounded;
  }

  if (/\b(?:cannot|can't|could not)\s+(?:verify|confirm)\b|\bno reliable source\b|\bmissing\b|\bunavailable\b/i.test(answerText)) {
    return 30;
  }

  return 68;
}

function stringifyStudentAnswer(answer: StudentAnswer) {
  return JSON.stringify(studentAnswerSchema.parse(answer), null, 2);
}

function buildStudentAnswerTarget(answerText: string, confidence: number) {
  const compactAnswer = truncateAtBoundary(answerText, 1600);
  const targetConfidence = normalizeTargetConfidence(compactAnswer, confidence);
  return stringifyStudentAnswer({
    modelRole: "student",
    answer: compactAnswer,
    key_points: deriveKeyPoints(compactAnswer),
    assumptions: deriveAssumptions(compactAnswer),
    confidence: targetConfidence
  });
}

function detectTrainingLanguage(question: string) {
  return /\b(?:je|tu|vous|quel|quelle|pourquoi|comment|explique|donne|peux|est-ce|aujourd|meteo|temps|francais)\b|[\u00e0-\u00ff]/i.test(
    question
  )
    ? "French (fr)"
    : "English or unspecified";
}

function countQuestionWords(question: string) {
  return question
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function buildTrainingStrategy(
  category: LocalStudentTrainingMetadata["category"],
  taskType: LocalStudentTrainingTaskType,
  question: string
 ) {
  const lowerQuestion = question.toLowerCase();
  const factual =
    taskType === "tool_safe_answer" ||
    /\b(?:latest|current|today|weather|price|release|version|who is|convert)\b/i.test(
      lowerQuestion
    );
  const explanatory = category === "technical_explanation";
  const promptWordCount = countQuestionWords(question);

  return {
    strategy_id: factual
      ? "factual_short"
      : explanatory
        ? "explanatory_short"
        : "open_medium",
    context: {
      questionType: factual ? "factual" : explanatory ? "explanatory" : "open",
      promptLength:
        promptWordCount <= 12 ? "short" : promptWordCount <= 40 ? "medium" : "long",
      promptWordCount,
      signals: [
        ...(factual ? ["uncertainty"] : []),
        ...(explanatory ? ["abstraction"] : [])
      ].slice(0, 3)
    },
    impact_status: factual ? "cautious" : "active",
    activation_mode: factual ? "fallback" : "contextual",
    impact_confidence: factual ? 0.5 : 0.7,
    impact_reason:
      "Training prompt includes strategy context so the model learns to use it without copying it.",
    target_length_words: factual ? { min: 35, max: 80 } : { min: 60, max: 130 },
    directives: [
      "Answer the user's question directly.",
      "Use the strategy as guidance only; do not copy this strategy object.",
      "Return the StudentAnswer JSON schema exactly."
    ],
    avoidances: [
      "Do not output strategy_id, context, impact_status, or activation_mode.",
      "Do not include text outside the JSON object."
    ],
    influenced_by: {
      signals: factual ? ["tool-safe factual answer"] : ["validated student answer"],
      studentRuleIds: [],
      memoryDomains: [],
      winningPatterns: []
    },
    reasoning: [
      "The training target is the runtime StudentAnswer schema.",
      "The strategy block is context, not the output schema."
    ]
  };
}

function formatTrainingList(title: string, values: string[], maxItems = 4) {
  const items = values
    .map((entry) => truncateAtBoundary(entry, 220))
    .filter(Boolean)
    .slice(0, maxItems);

  return items.length > 0 ? `${title}:\n${items.map((item) => `- ${item}`).join("\n")}` : "";
}

function formatTrainingStrategy(strategy: ReturnType<typeof buildTrainingStrategy>) {
  return [
    `Id: ${strategy.strategy_id}`,
    `Status: ${strategy.impact_status}; mode: ${strategy.activation_mode}; confidence: ${strategy.impact_confidence}`,
    `Target length: ${strategy.target_length_words.min}-${strategy.target_length_words.max} words`,
    truncateAtBoundary(strategy.impact_reason, 220),
    formatTrainingList("Directives", strategy.directives, 5),
    formatTrainingList("Avoid", strategy.avoidances, 5),
    "Use this guidance only; never copy these labels into the output."
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRuntimeLikeTrainingPrompt(args: {
  question: string;
  category: LocalStudentTrainingMetadata["category"];
  taskType: LocalStudentTrainingTaskType;
  weakAnswer?: string;
  truthSummary?: string | null;
}) {
  const strategy = buildTrainingStrategy(args.category, args.taskType, args.question);
  return [
    "Answer the user question as the Hydria local student.",
    "",
    "Question:",
    args.question,
    "",
    "Detected answer language:",
    detectTrainingLanguage(args.question),
    "",
    "Detected category:",
    args.category,
    "",
    "Student strategy guidance:",
    formatTrainingStrategy(strategy),
    args.weakAnswer
      ? ["", "Weak answer to improve:", truncateAtBoundary(args.weakAnswer, 1200)].join("\n")
      : "",
    args.truthSummary
      ? ["", "Truth engine findings:", truncateAtBoundary(args.truthSummary, 1600)].join("\n")
      : "",
    "",
    "Answering rules:",
    "- return only one valid JSON object",
    "- output the StudentAnswer schema only: modelRole, answer, key_points, assumptions, confidence",
    "- do not output strategy metadata such as Id, Status, mode, directives, or avoidances",
    "- answer in the same language as the user's question",
    "- answer must contain the useful response body; key_points must be 2 to 5 short labels",
    "- assumptions must be concise and must not repeat the answer",
    "- use verified facts when provided, and do not invent current facts",
    "- if the question asks for latest/current/today/live data and no verified facts are provided, say it cannot be verified from the prompt",
    "- if no reliable source or required input is missing, say that plainly or ask one clarifying question",
    "- do not use placeholder values such as \"...\", \"string\", \"todo\", or \"tbd\"",
    "- do not use markdown bullets, bold markers, headings, code snippets, HTML, or XML inside JSON string values"
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function buildSessionTruthSummary(session: StudentSession) {
  if (!session.research.used && !session.tooling.toolUsed) {
    return null;
  }

  const truth = session.research.truth;
  const verification = session.research.verification;
  const toolRouting = session.research.toolRouting;

  return [
    `Tool: ${toolRouting.toolType}; intent: ${toolRouting.intent}; required: ${toolRouting.toolRequired ? "yes" : "no"}`,
    `Tool result used: ${toolRouting.toolResultUsed ? "yes" : "no"}`,
    `Freshness satisfied: ${verification.freshnessSatisfied ? "yes" : "no"}`,
    `No reliable source: ${truth.no_reliable_source ? "yes" : "no"}`,
    formatTrainingList("Verified facts", truth.verified_facts, 5),
    formatTrainingList("Uncertain claims", truth.uncertain_claims, 4),
    formatTrainingList("Conflicting info", truth.conflicting_info, 3),
    formatTrainingList("Summary", session.research.summary, 3),
    session.tooling.toolImpact ? `Tool impact: ${session.tooling.toolImpact}` : "",
    session.tooling.toolReason ? `Tool reason: ${truncateAtBoundary(session.tooling.toolReason, 240)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export class LocalStudentTrainingPackService {
  private readonly sessionLoader: () => Promise<StudentSession[]>;
  private readonly knowledgeLayerService: Pick<KnowledgeLayerService, "buildAndPersist">;

  constructor(
    private readonly options: LocalStudentTrainingPackServiceOptions = {}
  ) {
    this.sessionLoader =
      options.sessionLoader ??
      (() =>
        listPersistedStudentSessions({
          historyFile: env.STUDENT_SESSION_HISTORY_FILE,
          databaseFile: env.PERSISTENCE_DB_FILE
        }));
    this.knowledgeLayerService = options.knowledgeLayerService ?? new KnowledgeLayerService();
  }

  async buildAndPersist() {
    const data = await this.loadData();
    const result = this.buildFromData(data);

    await mkdir(dirname(this.acceptedFile), { recursive: true });
    await writeFile(
      this.acceptedFile,
      result.accepted.map((entry) => JSON.stringify(entry)).join("\n") +
        (result.accepted.length > 0 ? "\n" : ""),
      "utf8"
    );

    await mkdir(dirname(this.rejectedFile), { recursive: true });
    await writeFile(
      this.rejectedFile,
      result.rejected.map((entry) => JSON.stringify(entry)).join("\n") +
        (result.rejected.length > 0 ? "\n" : ""),
      "utf8"
    );

    await mkdir(dirname(this.summaryFile), { recursive: true });
    await writeFile(this.summaryFile, `${JSON.stringify(result.summary, null, 2)}\n`, "utf8");

    return result;
  }

  buildFromData(data: BuildTrainingPackData): BuildTrainingPackResult {
    const acceptedRaw: LocalStudentTrainingExample[] = [];
    const rejected: LocalStudentTrainingRejectedExample[] = [];

    for (const curated of data.curatedExamples) {
      const decision = this.buildFromCurated(curated);
      if ("accepted" in decision && decision.accepted) {
        acceptedRaw.push(decision.accepted);
      } else {
        rejected.push((decision as { rejected: LocalStudentTrainingRejectedExample }).rejected);
      }
    }

    for (const contrastive of data.contrastiveExamples) {
      const decision = this.buildFromContrastive(contrastive);
      if ("accepted" in decision && decision.accepted) {
        acceptedRaw.push(decision.accepted);
      } else {
        rejected.push((decision as { rejected: LocalStudentTrainingRejectedExample }).rejected);
      }
    }

    for (const session of data.sessions) {
      const decision = this.buildFromSession(session);
      if ("accepted" in decision && decision.accepted) {
        acceptedRaw.push(decision.accepted);
      } else {
        rejected.push((decision as { rejected: LocalStudentTrainingRejectedExample }).rejected);
      }
    }

    for (const synthetic of data.syntheticExamples ?? []) {
      acceptedRaw.push(synthetic);
    }

    const deduped = new Map<string, LocalStudentTrainingExample>();
    let duplicateCount = 0;
    for (const example of acceptedRaw) {
      const key = `${example.taskType}::${example.metadata.category}::${example.messages[1]?.content ?? ""}::${example.targetAnswer}`;
      const current = deduped.get(key);
      if (!current || current.weight < example.weight) {
        if (current) {
          duplicateCount += 1;
        }
        deduped.set(key, example);
      } else {
        duplicateCount += 1;
      }
    }

    const accepted = [...deduped.values()]
      .map((entry) => localStudentTrainingExampleSchema.parse(entry))
      .sort((left, right) => right.weight - left.weight);
    const parsedRejected = rejected.map((entry) => localStudentTrainingRejectedExampleSchema.parse(entry));

    const summary = localStudentTrainingPackSummarySchema.parse({
      version: "hydria-local-student-training-pack-v1",
      builtAt: new Date().toISOString(),
      acceptedCount: accepted.length,
      rejectedCount: parsedRejected.length,
      duplicateCount,
      averageWeight:
        accepted.length > 0
          ? Number(
              (
                accepted.reduce((sum, entry) => sum + entry.weight, 0) / accepted.length
              ).toFixed(3)
            )
          : 0,
      sourceBreakdown: accepted.reduce((acc, entry) => {
        acc[entry.sourceType] += 1;
        return acc;
      }, zeroSourceBreakdown()),
      taskBreakdown: accepted.reduce((acc, entry) => {
        acc[entry.taskType] += 1;
        return acc;
      }, zeroTaskBreakdown()),
      qualityBreakdown: accepted.reduce((acc, entry) => {
        acc[entry.qualityTier] += 1;
        return acc;
      }, zeroTierBreakdown()),
      rejectionBreakdown: parsedRejected.reduce((acc, entry) => {
        acc[entry.reason] += 1;
        return acc;
      }, zeroRejectionBreakdown()),
      categoryBreakdown: accepted.reduce((acc, entry) => {
        acc[entry.metadata.category] += 1;
        return acc;
      }, zeroCategoryBreakdown()),
      toolSafeExamples: accepted.filter((entry) => entry.taskType === "tool_safe_answer").length,
      recommendedPreTrainChecks: localStudentTrainingConstitution.recommendedPreTrainChecks,
      recommendedPostTrainChecks: localStudentTrainingConstitution.recommendedPostTrainChecks,
      recommendedTrainingRecipe: localStudentTrainingConstitution.recommendedTrainingRecipe,
      recommendation: {
        trainNow: accepted.length >= 24,
        reason:
          accepted.length >= 24
            ? "The pack is large enough for a first short LoRA SFT run on the local student."
            : "Collect more validated sessions and curated rounds before training."
      }
    });

    return { accepted, rejected: parsedRejected, summary };
  }

  private async loadData(): Promise<BuildTrainingPackData> {
    let curatedExamples = await this.readJsonl(
      this.options.curatedFile ?? env.STUDENT_CURATED_DATASET_FILE,
      studentCuratedExampleSchema
    );
    let contrastiveExamples = await this.readJsonl(
      this.options.contrastiveFile ?? env.STUDENT_CONTRASTIVE_DATASET_FILE,
      studentContrastiveExampleSchema
    );

    if (curatedExamples.length === 0 || contrastiveExamples.length === 0) {
      const rebuilt = await this.knowledgeLayerService.buildAndPersist();
      curatedExamples = rebuilt.curatedStudentExamples;
      contrastiveExamples = rebuilt.contrastiveStudentExamples;
    }

    const sessions = await this.sessionLoader();
    return {
      curatedExamples,
      contrastiveExamples,
      sessions,
      syntheticExamples: [
        ...LOCAL_STUDENT_TOOL_BENCH_TRAINING_EXAMPLES,
        ...LOCAL_STUDENT_FAILURE_RECOVERY_TRAINING_EXAMPLES
      ]
    };
  }

  private async readJsonl<T>(filePath: string, schema: z.ZodType<T>) {
    try {
      const raw = await readFile(filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => schema.parse(JSON.parse(line)));
    } catch {
      return [] as T[];
    }
  }

  private buildFromCurated(curated: StudentCuratedExample): ExampleDecision {
    const metadata: LocalStudentTrainingMetadata = {
      sourceId: curated.roundId,
      category: curated.category,
      researchUsed: curated.researchUsed,
      toolUsed: curated.researchUsed,
      toolImpact: curated.researchUsed ? "reduced_uncertainty" : null,
      strategyId: null,
      verdict: null,
      worthIt: null,
      selectionScore: curated.selectionScore,
      improvedDelta: curated.globalGain,
      sessionScore: curated.refinedAverageScore
    };

    if (curated.selectionScore < localStudentTrainingConstitution.minCuratedSelectionScore) {
      return {
        rejected: this.buildRejected(
          `curated::${curated.roundId}`,
          "curated_round",
          curated.category,
          "low_selection_score",
          `Curated round scored ${curated.selectionScore}, below the minimum curated threshold.`,
          metadata
        )
      };
    }

    if (curated.targetAnswer.length < localStudentTrainingConstitution.minDirectTargetChars) {
      return {
        rejected: this.buildRejected(
          `curated::${curated.roundId}`,
          "curated_round",
          curated.category,
          "target_too_short",
          "Curated target answer is too short to supervise the local student well.",
          metadata
        )
      };
    }

    if (curated.targetAnswer.length > localStudentTrainingConstitution.maxTargetChars) {
      return {
        rejected: this.buildRejected(
          `curated::${curated.roundId}`,
          "curated_round",
          curated.category,
          "target_too_long",
          "Curated target answer is too long for the first compact local student pack.",
          metadata
        )
      };
    }

    const qualityTier = curated.selectionTier as LocalStudentTrainingTier;
    const targetAnswer = buildStudentAnswerTarget(curated.targetAnswer, curated.selectionScore);
    const weight = clamp(
      (qualityTier === "gold" ? 1.35 : qualityTier === "silver" ? 1.18 : 0.96) +
        (curated.researchUsed ? 0.08 : 0) +
        clamp((curated.selectionScore - 65) / 100, 0, 0.2),
      0.1,
      3
    );

    return {
      accepted: localStudentTrainingExampleSchema.parse({
        datasetVersion: "hydria-local-student-sft-v1",
        exampleId: `curated::${curated.roundId}`,
        sourceType: "curated_round",
        taskType: "direct_answer",
        qualityTier,
        weight: Number(weight.toFixed(3)),
        keepReason: `Curated ${qualityTier} round with selection score ${curated.selectionScore} and positive refine gain.`,
        messages: [
          {
            role: "system",
            content: localStudentTrainingConstitution.directAnswerSystemPrompt
          },
          {
            role: "user",
            content: buildRuntimeLikeTrainingPrompt({
              question: curated.prompt,
              category: curated.category,
              taskType: "direct_answer"
            })
          },
          {
            role: "assistant",
            content: targetAnswer
          }
        ],
        targetAnswer,
        metadata
      })
    };
  }

  private buildFromContrastive(contrastive: StudentContrastiveExample): ExampleDecision {
    const metadata: LocalStudentTrainingMetadata = {
      sourceId: contrastive.roundId,
      category: contrastive.category,
      researchUsed: contrastive.researchUsed,
      toolUsed: contrastive.researchUsed,
      toolImpact: contrastive.researchUsed ? "reduced_uncertainty" : null,
      strategyId: null,
      verdict: null,
      worthIt: null,
      selectionScore: contrastive.selectionScore,
      improvedDelta: contrastive.improvedDelta,
      sessionScore: null
    };

    if (contrastive.selectionScore < localStudentTrainingConstitution.minContrastiveSelectionScore) {
      return {
        rejected: this.buildRejected(
          `contrastive::${contrastive.roundId}`,
          "contrastive_round",
          contrastive.category,
          "low_selection_score",
          `Contrastive example scored ${contrastive.selectionScore}, below the minimum threshold.`,
          metadata
        )
      };
    }

    if (
      contrastive.improvedDelta < localStudentTrainingConstitution.minContrastiveImprovedDelta
    ) {
      return {
        rejected: this.buildRejected(
          `contrastive::${contrastive.roundId}`,
          "contrastive_round",
          contrastive.category,
          "insufficient_delta",
          `Contrastive example only improves by ${contrastive.improvedDelta}, which is too weak for the first training pack.`,
          metadata
        )
      };
    }

    if (contrastive.sourceAnswer.trim() === contrastive.targetAnswer.trim()) {
      return {
        rejected: this.buildRejected(
          `contrastive::${contrastive.roundId}`,
          "contrastive_round",
          contrastive.category,
          "duplicate_target",
          "Source and target answers are effectively identical.",
          metadata
        )
      };
    }

    if (contrastive.targetAnswer.length < localStudentTrainingConstitution.minRewriteTargetChars) {
      return {
        rejected: this.buildRejected(
          `contrastive::${contrastive.roundId}`,
          "contrastive_round",
          contrastive.category,
          "target_too_short",
          "Contrastive target answer is too short.",
          metadata
        )
      };
    }

    if (contrastive.targetAnswer.length > localStudentTrainingConstitution.maxTargetChars) {
      return {
        rejected: this.buildRejected(
          `contrastive::${contrastive.roundId}`,
          "contrastive_round",
          contrastive.category,
          "target_too_long",
          "Contrastive target answer is too long.",
          metadata
        )
      };
    }

    const qualityTier = contrastive.selectionTier as LocalStudentTrainingTier;
    const targetAnswer = buildStudentAnswerTarget(
      contrastive.targetAnswer,
      Math.max(60, contrastive.selectionScore)
    );
    const weight = clamp(
      1.12 +
        clamp(contrastive.improvedDelta / 40, 0, 0.45) +
        (qualityTier === "gold" ? 0.12 : qualityTier === "silver" ? 0.05 : 0) +
        (contrastive.researchUsed ? 0.05 : 0),
      0.1,
      3
    );

    return {
      accepted: localStudentTrainingExampleSchema.parse({
        datasetVersion: "hydria-local-student-sft-v1",
        exampleId: `contrastive::${contrastive.roundId}`,
        sourceType: "contrastive_round",
        taskType: "rewrite_answer",
        qualityTier,
        weight: Number(weight.toFixed(3)),
        keepReason: `Contrastive ${qualityTier} example with improvement delta ${contrastive.improvedDelta}.`,
        messages: [
          {
            role: "system",
            content: localStudentTrainingConstitution.rewriteAnswerSystemPrompt
          },
          {
            role: "user",
            content: buildRuntimeLikeTrainingPrompt({
              question: contrastive.prompt,
              category: contrastive.category,
              taskType: "rewrite_answer",
              weakAnswer: contrastive.sourceAnswer
            })
          },
          {
            role: "assistant",
            content: targetAnswer
          }
        ],
        targetAnswer,
        metadata
      })
    };
  }

  private buildFromSession(session: StudentSession): ExampleDecision {
    const metadata: LocalStudentTrainingMetadata = {
      sourceId: session.sessionId,
      category: session.category,
      researchUsed: session.research.used,
      toolUsed: session.tooling.toolUsed,
      toolImpact: session.tooling.toolImpact,
      strategyId: session.strategy.strategyId,
      verdict: session.judge.verdict,
      worthIt: session.judge.worthIt,
      selectionScore: null,
      improvedDelta: session.progression.deltaOverall,
      sessionScore: session.progression.sessionScore
    };

    if (
      session.judge.verdict !== "improved" &&
      session.judge.verdict !== "minor"
    ) {
      return {
        rejected: this.buildRejected(
          `session::${session.sessionId}`,
          "student_session",
          session.category,
          "negative_outcome",
          `Session verdict ${session.judge.verdict} is not stable enough for supervised training.`,
          metadata
        )
      };
    }

    if (session.judge.worthIt === "NO") {
      return {
        rejected: this.buildRejected(
          `session::${session.sessionId}`,
          "student_session",
          session.category,
          "worth_it_no",
          "Judge marked the revision as not worth keeping.",
          metadata
        )
      };
    }

    if (session.progression.sessionScore < localStudentTrainingConstitution.minSessionScore) {
      return {
        rejected: this.buildRejected(
          `session::${session.sessionId}`,
          "student_session",
          session.category,
          "low_session_score",
          `Session score ${session.progression.sessionScore} is too low for the first training pack.`,
          metadata
        )
      };
    }

    if (session.tooling.toolImpact === "negative") {
      return {
        rejected: this.buildRejected(
          `session::${session.sessionId}`,
          "student_session",
          session.category,
          "negative_tool_impact",
          "Tool use was judged harmful for this session.",
          metadata
        )
      };
    }

    const targetAnswerText = session.student.final.answer;
    if (targetAnswerText.length < localStudentTrainingConstitution.minDirectTargetChars) {
      return {
        rejected: this.buildRejected(
          `session::${session.sessionId}`,
          "student_session",
          session.category,
          "target_too_short",
          "Student final answer is too short to supervise well.",
          metadata
        )
      };
    }

    if (targetAnswerText.length > localStudentTrainingConstitution.maxTargetChars) {
      return {
        rejected: this.buildRejected(
          `session::${session.sessionId}`,
          "student_session",
          session.category,
          "target_too_long",
          "Student final answer is too long for the first local training pack.",
          metadata
        )
      };
    }

    const taskType: LocalStudentTrainingTaskType =
      session.tooling.toolUsed || session.research.used ? "tool_safe_answer" : "direct_answer";
    const qualityTier: LocalStudentTrainingTier =
      session.progression.sessionScore >= 85 || session.progression.deltaOverall >= 20
        ? "gold"
        : session.progression.sessionScore >= 74
          ? "silver"
          : "bronze";
    const toolBonus = this.toolBonus(session.tooling.toolImpact);
    const targetAnswer = buildStudentAnswerTarget(
      session.student.final.answer,
      session.student.final.confidence
    );
    const weight = clamp(
      1 +
        clamp(session.progression.deltaOverall / 25, 0, 0.35) +
        (session.research.used ? 0.05 : 0) +
        toolBonus +
        (qualityTier === "gold" ? 0.08 : qualityTier === "silver" ? 0.03 : 0),
      0.1,
      3
    );

    return {
      accepted: localStudentTrainingExampleSchema.parse({
        datasetVersion: "hydria-local-student-sft-v1",
        exampleId: `session::${session.sessionId}`,
        sourceType: "student_session",
        taskType,
        qualityTier,
        weight: Number(weight.toFixed(3)),
        keepReason:
          taskType === "tool_safe_answer"
            ? `Validated student session with ${session.tooling.toolImpact} tool behavior and session score ${session.progression.sessionScore}.`
            : `Validated student session with session score ${session.progression.sessionScore} and verdict ${session.judge.verdict}.`,
        messages: [
          {
            role: "system",
            content:
              taskType === "tool_safe_answer"
                ? localStudentTrainingConstitution.toolSafeSystemPrompt
                : localStudentTrainingConstitution.directAnswerSystemPrompt
          },
          {
            role: "user",
            content: buildRuntimeLikeTrainingPrompt({
              question: session.question,
              category: session.category,
              taskType,
              truthSummary: buildSessionTruthSummary(session)
            })
          },
          {
            role: "assistant",
            content: targetAnswer
          }
        ],
        targetAnswer,
        metadata
      })
    };
  }

  private toolBonus(toolImpact: StudentToolImpactLabel) {
    switch (toolImpact) {
      case "improved_factual_accuracy":
        return 0.15;
      case "reduced_uncertainty":
        return 0.12;
      case "no_reliable_source":
        return 0.1;
      case "no_impact":
        return 0;
      case "negative":
        return -0.1;
      default:
        return 0;
    }
  }

  private buildRejected(
    exampleId: string,
    sourceType: LocalStudentTrainingSource,
    category: LocalStudentTrainingMetadata["category"],
    reason: LocalStudentTrainingRejectedReason,
    detail: string,
    metadata: LocalStudentTrainingMetadata
  ) {
    return localStudentTrainingRejectedExampleSchema.parse({
      datasetVersion: "hydria-local-student-sft-rejected-v1",
      exampleId,
      sourceType,
      category,
      reason,
      detail,
      metadata
    });
  }

  private get acceptedFile() {
    return this.options.acceptedFile ?? defaultAcceptedFile;
  }

  private get rejectedFile() {
    return this.options.rejectedFile ?? defaultRejectedFile;
  }

  private get summaryFile() {
    return this.options.summaryFile ?? defaultSummaryFile;
  }
}

export type { BuildTrainingPackData, BuildTrainingPackResult };

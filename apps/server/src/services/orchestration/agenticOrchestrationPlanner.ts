import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import type { ChatKnowledgeRetrievalMetadata } from "../../types/knowledgeRetrieval.js";
import type { ChatToolMetadata } from "../../types/chat.js";
import type { EvidenceCapsule, EvidenceRequirementPlan } from "../answerability/answerabilityPlanner.js";
import {
  semanticFrameFromRouting,
  type SemanticDomain,
  type SemanticFrame
} from "./semanticMissionPlanner.js";

export type AgenticMissionExecution =
  | "runtime_signal"
  | "tool_result"
  | "knowledge_result"
  | "selected_model"
  | "budgeted_specialist"
  | "post_answer_gate";

export type AgenticMissionStatus =
  | "satisfied"
  | "required_before_answer"
  | "planned"
  | "budget_deferred"
  | "skipped";

export type AgenticMission = {
  id: string;
  component: string;
  role: string;
  objective: string;
  required: boolean;
  execution: AgenticMissionExecution;
  status: AgenticMissionStatus;
  inputSignals: string[];
  outputContract: string;
  contribution: string | null;
  evidenceRefs: string[];
};

export type AgenticOrchestrationMode =
  | "tool_first"
  | "evidence_first"
  | "knowledge_first"
  | "decision_synthesis"
  | "specialist_direct";

export type AgenticOrchestrationPlan = {
  version: "agentic_orchestration_plan_v1";
  mode: AgenticOrchestrationMode;
  subject: string | null;
  domain: SemanticDomain;
  intent: string;
  missions: AgenticMission[];
  criticalChecks: string[];
  finalSynthesisGuidance: string;
  blocked: boolean;
  issues: string[];
};

export type AgenticOrchestrationPlannerInput = {
  question: string;
  category: QuestionCategory;
  toolRouting: ToolRoutingDecision;
  tooling: ChatToolMetadata;
  knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
  evidenceRequirement: EvidenceRequirementPlan;
  evidenceCapsule: EvidenceCapsule;
};

function sourceRefs(tooling: ChatToolMetadata) {
  return tooling.sources
    .slice(0, 5)
    .map((source) => source.url || source.title)
    .filter((value): value is string => Boolean(value));
}

function knowledgeRefs(knowledge: ChatKnowledgeRetrievalMetadata) {
  return knowledge.hits
    .slice(0, 5)
    .map((hit) => hit.objectId)
    .filter(Boolean);
}

function mission(args: AgenticMission): AgenticMission {
  return args;
}

function modeFrom(args: AgenticOrchestrationPlannerInput): AgenticOrchestrationMode {
  if (args.evidenceRequirement.requiredEvidence.includes("tool_live")) {
    return "tool_first";
  }
  if (args.evidenceRequirement.requiredEvidence.includes("source_research")) {
    return "evidence_first";
  }
  if (args.evidenceRequirement.requiredEvidence.includes("governed_knowledge")) {
    return "knowledge_first";
  }
  if (args.evidenceRequirement.requiredEvidence.includes("multi_specialist_synthesis")) {
    return "decision_synthesis";
  }
  return "specialist_direct";
}

function sourceMissionStatus(args: AgenticOrchestrationPlannerInput): AgenticMissionStatus {
  if (args.tooling.used) {
    return "satisfied";
  }
  return args.evidenceRequirement.requiresResearch ? "required_before_answer" : "skipped";
}

function knowledgeMissionStatus(args: AgenticOrchestrationPlannerInput): AgenticMissionStatus {
  if (args.knowledgeRetrieval.used) {
    return "satisfied";
  }
  return args.evidenceRequirement.requiresKnowledge ? "required_before_answer" : "skipped";
}

function specialistMissionStatus(required: boolean, sourceBound: boolean): AgenticMissionStatus {
  if (!required) {
    return "skipped";
  }
  return sourceBound ? "budget_deferred" : "planned";
}

function criticalChecksFor(frame: SemanticFrame, input: AgenticOrchestrationPlannerInput) {
  const checks = [
    "subject_matches_user_question",
    "answer_language_matches_user_language",
    "no_private_chain_of_thought"
  ];

  if (input.evidenceCapsule.sourceBound || input.tooling.used) {
    checks.push("answer_claims_are_supported_by_verified_sources");
    checks.push("sources_match_subject_and_domain");
    checks.push("reject_same_word_wrong_sense_sources");
  }

  if (input.evidenceRequirement.riskFlags.includes("freshness_required")) {
    checks.push("freshness_and_date_are_explicit");
  }

  if (frame.ambiguityLevel !== "low") {
    checks.push("entity_type_matches_expected_subject");
  }

  if (input.evidenceRequirement.requiresSynthesis) {
    checks.push("constraints_and_tradeoffs_are_arbitrated");
  }

  return [...new Set(checks)];
}

function finalGuidance(args: {
  frame: SemanticFrame;
  input: AgenticOrchestrationPlannerInput;
  mode: AgenticOrchestrationMode;
}) {
  const lines = [
    `Mode ${args.mode}: synthesize from accepted mission outputs only.`,
    "Use verified tool or source facts before model memory when available.",
    "If evidence is weak or off-topic, repair by retrying the evidence path or abstain cleanly.",
    "Do not mention internal missions or model routing in the final user answer."
  ];

  if (args.frame.subject) {
    lines.push(`Preserve the resolved subject: ${args.frame.subject}.`);
  }

  if (args.input.evidenceRequirement.requiresSynthesis) {
    lines.push("For decisions, state the recommendation first and tie it to active constraints.");
  }

  return lines.join(" ");
}

export class AgenticOrchestrationPlanner {
  buildPlan(input: AgenticOrchestrationPlannerInput): AgenticOrchestrationPlan {
    const frame = semanticFrameFromRouting({
      routing: input.toolRouting,
      question: input.question,
      category: input.category
    });
    const mode = modeFrom(input);
    const sourceStatus = sourceMissionStatus(input);
    const knowledgeStatus = knowledgeMissionStatus(input);
    const sourceEvidenceRefs = sourceRefs(input.tooling);
    const knowledgeEvidenceRefs = knowledgeRefs(input.knowledgeRetrieval);
    const sourceRequired = input.evidenceRequirement.requiresResearch || input.tooling.routing.toolRequired;
    const knowledgeRequired = input.evidenceRequirement.requiresKnowledge;
    const codeOrExtractionRelevant = frame.domain === "software_technology" || frame.domain === "code_debug";
    const deepCriticRelevant =
      input.evidenceRequirement.requiresSynthesis || frame.domain === "strategy_decision";
    const missions: AgenticMission[] = [
      mission({
        id: "intent_router",
        component: "qwen2.5:3b",
        role: "fast_router",
        objective: "Classify intent, language, domain, and tool need before any answer is drafted.",
        required: true,
        execution: "runtime_signal",
        status: "satisfied",
        inputSignals: [input.category, input.toolRouting.toolType, input.toolRouting.intent],
        outputContract: "category + language + tool route + confidence",
        contribution: input.toolRouting.reason,
        evidenceRefs: []
      }),
      mission({
        id: "entity_resolver",
        component: "runtime/entity-resolver",
        role: "subject_resolver",
        objective: "Resolve the exact subject and reject same-word wrong-sense interpretations.",
        required: sourceRequired || frame.subject !== null,
        execution: "runtime_signal",
        status: frame.subject ? "satisfied" : sourceRequired ? "required_before_answer" : "planned",
        inputSignals: [input.question, frame.domain, frame.intent],
        outputContract: "canonical subject + domain + expected/rejected sense terms",
        contribution: frame.subject
          ? `${frame.subject} / ${frame.domain}`
          : "No stable subject resolved yet.",
        evidenceRefs: []
      }),
      mission({
        id: "governed_memory_retrieval",
        component: "bge-m3 + bge-reranker",
        role: "knowledge_retrieval",
        objective: "Retrieve governed memory and knowledge objects that match the subject, domain, and intent.",
        required: knowledgeRequired,
        execution: "knowledge_result",
        status: knowledgeStatus,
        inputSignals: [input.knowledgeRetrieval.query, input.knowledgeRetrieval.route],
        outputContract: "ranked knowledge hits with state, confidence, provenance, and matched terms",
        contribution: input.knowledgeRetrieval.used
          ? `${input.knowledgeRetrieval.hitCount} governed knowledge hit(s) accepted.`
          : "No governed knowledge hit accepted for this turn.",
        evidenceRefs: knowledgeEvidenceRefs
      }),
      mission({
        id: "external_source_research",
        component: "research tools",
        role: "source_research",
        objective: "Collect public evidence from reliable sources, then reject off-topic or weak matches.",
        required: sourceRequired,
        execution: "tool_result",
        status: sourceStatus,
        inputSignals: [input.toolRouting.toolType, input.toolRouting.intent, String(input.tooling.sources.length)],
        outputContract: "verified facts + accepted source list + corroboration signal",
        contribution: input.tooling.used
          ? `${input.tooling.verifiedFacts.length} verified fact(s), ${input.tooling.sources.length} source(s).`
          : input.tooling.failureReason ?? "No accepted external source result.",
        evidenceRefs: sourceEvidenceRefs
      }),
      mission({
        id: "technical_extractor",
        component: "qwen2.5-coder:7b",
        role: "source_extraction_or_code_specialist",
        objective:
          "For technical/code tasks, extract precise implementation facts, docs signals, or scraping/parsing cues; do not override evidence.",
        required: frame.domain === "code_debug",
        execution: "budgeted_specialist",
        status: specialistMissionStatus(codeOrExtractionRelevant, input.evidenceCapsule.sourceBound),
        inputSignals: [frame.domain, frame.intent],
        outputContract: "technical contribution or extraction checklist grounded in accepted evidence",
        contribution: codeOrExtractionRelevant
          ? "Available as technical extraction specialist; invoked only when the budget and task justify it."
          : null,
        evidenceRefs: sourceEvidenceRefs
      }),
      mission({
        id: "deep_critic",
        component: "deepseek-r1:14b / qwen2.5:14b",
        role: "critic_verifier",
        objective: "Stress-test reasoning, contradictions, causality, dates, figures, and constraint tradeoffs.",
        required: deepCriticRelevant,
        execution: "budgeted_specialist",
        status: specialistMissionStatus(deepCriticRelevant, input.evidenceCapsule.sourceBound),
        inputSignals: [frame.domain, frame.intent, input.evidenceCapsule.synthesisStrategy],
        outputContract: "critique notes and risk flags; no private chain-of-thought",
        contribution: deepCriticRelevant
          ? "Critic mission required by synthesis complexity; may be budget-deferred when verified evidence is sufficient."
          : null,
        evidenceRefs: [...sourceEvidenceRefs, ...knowledgeEvidenceRefs]
      }),
      mission({
        id: "final_synthesis",
        component: "selected local specialist",
        role: "final_synthesizer",
        objective: "Produce the user-facing answer from accepted evidence, active context, and relevant specialist guidance.",
        required: true,
        execution: "selected_model",
        status: "planned",
        inputSignals: [input.evidenceCapsule.answerabilityMode, input.evidenceCapsule.reliabilityLevel],
        outputContract: "concise final answer in user language, with no internal routing disclosure",
        contribution: null,
        evidenceRefs: [...sourceEvidenceRefs, ...knowledgeEvidenceRefs]
      }),
      mission({
        id: "post_answer_verifier",
        component: "runtime/post-answer-verifier",
        role: "grounding_gate",
        objective: "Compare final answer, expected subject, domain, sources, dates, figures, and language.",
        required: true,
        execution: "post_answer_gate",
        status: "planned",
        inputSignals: [frame.subject ?? "unknown_subject", frame.domain, String(input.tooling.used)],
        outputContract: "accept, repair from verified sources, retry better sources, or abstain",
        contribution: null,
        evidenceRefs: [...sourceEvidenceRefs, ...knowledgeEvidenceRefs]
      })
    ];
    const issues = missions
      .filter((item) => item.required && item.status === "required_before_answer")
      .map((item) => `${item.id}_missing`);

    return {
      version: "agentic_orchestration_plan_v1",
      mode,
      subject: frame.subject,
      domain: frame.domain,
      intent: frame.intent,
      missions,
      criticalChecks: criticalChecksFor(frame, input),
      finalSynthesisGuidance: finalGuidance({ frame, input, mode }),
      blocked: issues.length > 0 && input.evidenceRequirement.abstainIfMissing,
      issues
    };
  }
}

export const defaultAgenticOrchestrationPlanner = new AgenticOrchestrationPlanner();

export function formatAgenticOrchestrationPlanForPrompt(plan: AgenticOrchestrationPlan) {
  const missionLines = plan.missions.slice(0, 8).map((missionItem) => {
    const required = missionItem.required ? "required" : "optional";
    return `- ${missionItem.id}: ${missionItem.component}/${missionItem.role}; ${required}; ${missionItem.status}; ${missionItem.objective}`;
  });

  return [
    `mode: ${plan.mode}`,
    `subject: ${plan.subject ?? "unknown"}`,
    `domain: ${plan.domain}`,
    `intent: ${plan.intent}`,
    `blocked: ${plan.blocked ? "yes" : "no"}`,
    `issues: ${plan.issues.length > 0 ? plan.issues.join(", ") : "none"}`,
    "missions:",
    ...missionLines,
    `criticalChecks: ${plan.criticalChecks.join(", ")}`,
    `finalGuidance: ${plan.finalSynthesisGuidance}`
  ].join("\n");
}

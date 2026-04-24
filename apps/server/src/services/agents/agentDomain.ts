import type { QuestionCategory } from "../../types/arena.js";
import type { SkillDefinition, SkillToolType } from "../../types/skills.js";

function normalizeIntent(intent: string) {
  return intent.toLowerCase();
}

export function inferAgentDomain(args: {
  intent: string;
  toolType?: SkillToolType | null;
  category?: QuestionCategory | null;
}) {
  const intent = normalizeIntent(args.intent);
  const toolType = args.toolType ?? null;

  if (
    /\brepo\b|\bdebug\b|\btest\b|\bbenchmark\b|\bfile_analysis\b|\brepo_analysis\b/.test(intent)
  ) {
    return "code_analysis";
  }

  if (
    /\bcurrent_status\b|\bcurrent_price\b|\bcurrent_weather\b|\blive_score\b|\blatest_release\b|\brelease\b/.test(
      intent
    )
  ) {
    return "live_lookup";
  }

  if (
    /\bgithub_repo_lookup\b|\bdocumentation_lookup\b|\bdiagnostic_docs\b|\bproduct_docs\b/.test(intent) ||
    intent.startsWith("research_")
  ) {
    return "knowledge_lookup";
  }

  if (toolType === "calculator") {
    return "calculation";
  }

  if (toolType === "web" || toolType === "research") {
    return "external_lookup";
  }

  if (args.category === "technical_explanation" || args.category === "debug_diagnostic") {
    return "technical_reasoning";
  }

  if (args.category === "operational_writing") {
    return "writing";
  }

  return "general_procedural";
}

export function buildAgentName(domain: string) {
  switch (domain) {
    case "code_analysis":
      return "CodeAnalysisAgent";
    case "live_lookup":
      return "LiveLookupAgent";
    case "knowledge_lookup":
      return "KnowledgeLookupAgent";
    case "calculation":
      return "CalculationAgent";
    case "technical_reasoning":
      return "TechnicalReasoningAgent";
    case "writing":
      return "WritingSupportAgent";
    default:
      return "ProceduralSpecialistAgent";
  }
}

export function buildForbiddenIntents(domain: string) {
  switch (domain) {
    case "code_analysis":
      return ["current_weather", "current_price", "operational_writing", "current_status"];
    case "live_lookup":
      return ["repo_analysis", "file_analysis", "run_tests", "operational_writing"];
    case "knowledge_lookup":
      return ["current_weather", "current_price", "run_tests"];
    case "calculation":
      return ["github_repo_lookup", "repo_analysis", "current_status"];
    case "technical_reasoning":
      return ["operational_writing", "current_weather"];
    case "writing":
      return ["repo_analysis", "run_tests", "current_status"];
    default:
      return ["run_tests"];
  }
}

export function sortSkillsForDomain(skills: SkillDefinition[]) {
  return [...skills].sort(
    (left, right) =>
      Number(right.state === "active") - Number(left.state === "active") ||
      right.confidenceScore - left.confidenceScore ||
      right.validation.usefulnessScore - left.validation.usefulnessScore
  );
}

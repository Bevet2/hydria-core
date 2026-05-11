import type { QuestionCategory } from "../../types/arena.js";
import type { StrategicTradeoffPolicy } from "./constraintConflictResolver.js";
import type { ActiveConstraintCapsule } from "./contextStateTracker.js";

export type StrategicDecisionPosture =
  | "none"
  | "guardrail_first"
  | "bounded_default"
  | "frugal_slice"
  | "evidence_first"
  | "environment_fit"
  | "human_control"
  | "scope_limited";

export type StrategicCoherencePolicy = {
  hasStrategicCoherenceRequirement: boolean;
  decisionPosture: StrategicDecisionPosture;
  requiresRevisionCondition: boolean;
  revisionTrigger: string | null;
  flexibilityGuardrail: string | null;
  mustInclude: string[];
  mustAvoid: string[];
  guidance: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string | null | undefined, maxChars = 150) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function languageFor(capsule: ActiveConstraintCapsule) {
  return capsule.language === "fr" ? "fr" : "en";
}

function hasAny(text: string, pattern: RegExp) {
  return pattern.test(normalizeText(text));
}

function isFormatPreferenceConstraint(value: string) {
  return /^user preference:/i.test(value) && /\b(?:answer|reponse|réponse|short|court|courte|mots?|words?)\b/i.test(value);
}

function hasStrategicPressure(args: {
  capsule: ActiveConstraintCapsule;
  currentUserMessage: string;
  category: QuestionCategory;
}) {
  const strategicCategories = ["architecture_design", "incident_response", "product_strategy", "mixed_reasoning"];
  const hasOnlyFormatConstraint =
    args.capsule.topConstraints.length > 0 &&
    args.capsule.topConstraints.every(isFormatPreferenceConstraint) &&
    args.capsule.blockingConstraints.length === 0 &&
    args.capsule.changedConstraints.length === 0 &&
    !args.capsule.decisionNeeded &&
    !strategicCategories.includes(args.category);
  if (hasOnlyFormatConstraint) {
    return false;
  }

  const combined = [
    args.currentUserMessage,
    args.capsule.userGoal ?? "",
    args.capsule.recommendedDirection ?? "",
    ...args.capsule.topConstraints,
    ...args.capsule.blockingConstraints,
    ...args.capsule.changedConstraints
  ].join(" ");

  return (
    args.capsule.decisionNeeded ||
    args.capsule.blockingConstraints.length >= 2 ||
    args.capsule.changedConstraints.length > 0 ||
    strategicCategories.includes(args.category) ||
    hasAny(
      combined,
      /\b(?:tradeoff|compromis|dominant|dominante|constraint|contrainte|deadline|budget|scale|risk|risque|stakeholder|sponsor|owner|audit|rollback|reversible|reversible|sensitive|donnees sensibles|scope|segment|signal)\b/
    )
  );
}

function postureFor(policy: StrategicTradeoffPolicy, category: QuestionCategory): StrategicDecisionPosture {
  switch (policy.conflictType) {
    case "policy_override_conflict":
    case "deadline_vs_guardrail":
    case "stakeholder_pressure_vs_strategy":
      return "guardrail_first";
    case "budget_vs_complexity":
      return "frugal_slice";
    case "scale_vs_capacity":
      return "bounded_default";
    case "environment_reversal":
      return "environment_fit";
    case "sensitive_data_vs_speed":
      return "human_control";
    case "signal_scope_reversal":
      return "scope_limited";
    case "none":
      if (category === "debug_diagnostic") {
        return "evidence_first";
      }
      if (category === "incident_response") {
        return "guardrail_first";
      }
      return "bounded_default";
  }
}

function revisionTriggerFor(args: {
  capsule: ActiveConstraintCapsule;
  policy: StrategicTradeoffPolicy;
  category: QuestionCategory;
}) {
  const language = languageFor(args.capsule);
  switch (args.policy.conflictType) {
    case "policy_override_conflict":
      return language === "fr"
        ? "reviser seulement si la politique durable change formellement ou si l'audit apporte une preuve contraire"
        : "revise only if the durable policy formally changes or audit evidence contradicts it";
    case "deadline_vs_guardrail":
      return language === "fr"
        ? "changer de route si le seuil d'impact est depasse ou si la verification invalide la mitigation"
        : "change course if the impact threshold is crossed or verification invalidates the mitigation";
    case "budget_vs_complexity":
      return language === "fr"
        ? "elargir seulement si le signal prouve la valeur et si le budget recurrent est finance"
        : "expand only if the signal proves value and recurring budget is funded";
    case "scale_vs_capacity":
      return language === "fr"
        ? "augmenter le scope seulement apres un test de charge et une capacite equipe confirmee"
        : "increase scope only after a load test and confirmed team capacity";
    case "environment_reversal":
      return language === "fr"
        ? "reconsiderer cloud seulement si la contrainte on-prem est levee explicitement"
        : "reconsider cloud only if the on-prem constraint is explicitly lifted";
    case "sensitive_data_vs_speed":
      return language === "fr"
        ? "accelerer seulement apres validation humaine, audit et sortie de risque legal"
        : "accelerate only after human validation, audit, and legal-risk clearance";
    case "stakeholder_pressure_vs_strategy":
      return language === "fr"
        ? "reviser si le stakeholder apporte une preuve plus forte que la contrainte dominante"
        : "revise if the stakeholder brings stronger evidence than the dominant constraint";
    case "signal_scope_reversal":
      return language === "fr"
        ? "generaliser seulement si un echantillon plus large confirme le signal"
        : "generalize only if a broader sample confirms the signal";
    case "none":
      if (!hasStrategicPressure({ capsule: args.capsule, currentUserMessage: "", category: args.category })) {
        return null;
      }
      return language === "fr"
        ? "reviser si une contrainte bloquante change ou si le signal principal est invalide"
        : "revise if a blocking constraint changes or the main signal is invalidated";
  }
}

function flexibilityGuardrailFor(language: "fr" | "en", revisionTrigger: string | null) {
  if (!revisionTrigger) {
    return null;
  }
  return language === "fr"
    ? `Le choix doit etre ferme mais non definitif: ${revisionTrigger}.`
    : `The choice must be firm but not permanent: ${revisionTrigger}.`;
}

function buildGuidance(args: {
  language: "fr" | "en";
  decisionPosture: StrategicDecisionPosture;
  revisionTrigger: string | null;
  policy: StrategicTradeoffPolicy;
}) {
  if (args.language === "fr") {
    return [
      "Calibration strategique fine: choisis une option par defaut, ne presente pas les options comme equivalentes.",
      `Posture de decision: ${args.decisionPosture}.`,
      args.policy.hasConflict && args.policy.dominantConstraint
        ? `La contrainte dominante doit expliquer le choix: ${compact(args.policy.dominantConstraint)}.`
        : "",
      args.policy.hasConflict && args.policy.deferredOrSacrificedConstraint
        ? `Nomme ce qui est differe ou refuse: ${compact(args.policy.deferredOrSacrificedConstraint)}.`
        : "",
      args.revisionTrigger ? `Ajoute une condition de revision concrete: ${args.revisionTrigger}.` : "",
      "Evite les absolus non bornes; la fermete vient de la contrainte, pas d'un ton rigide."
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "Fine strategic calibration: choose a default option; do not present options as equivalent.",
    `Decision posture: ${args.decisionPosture}.`,
    args.policy.hasConflict && args.policy.dominantConstraint
      ? `The dominant constraint must explain the choice: ${compact(args.policy.dominantConstraint)}.`
      : "",
    args.policy.hasConflict && args.policy.deferredOrSacrificedConstraint
      ? `Name what is deferred or rejected: ${compact(args.policy.deferredOrSacrificedConstraint)}.`
      : "",
    args.revisionTrigger ? `Add a concrete revision condition: ${args.revisionTrigger}.` : "",
    "Avoid unbounded absolutes; firmness should come from the constraint, not from a rigid tone."
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildStrategicCoherencePolicy(args: {
  capsule: ActiveConstraintCapsule;
  currentUserMessage: string;
  category: QuestionCategory;
  strategicTradeoffPolicy: StrategicTradeoffPolicy;
}): StrategicCoherencePolicy {
  const language = languageFor(args.capsule);
  const strategicPressure = hasStrategicPressure({
    capsule: args.capsule,
    currentUserMessage: args.currentUserMessage,
    category: args.category
  });
  const hasRequirement = args.strategicTradeoffPolicy.hasConflict || strategicPressure;
  if (!hasRequirement) {
    return {
      hasStrategicCoherenceRequirement: false,
      decisionPosture: "none",
      requiresRevisionCondition: false,
      revisionTrigger: null,
      flexibilityGuardrail: null,
      mustInclude: [],
      mustAvoid: [],
      guidance: language === "fr" ? "Aucune calibration strategique forte requise." : "No strong strategic calibration required."
    };
  }

  const decisionPosture = postureFor(args.strategicTradeoffPolicy, args.category);
  const revisionTrigger = revisionTriggerFor({
    capsule: args.capsule,
    policy: args.strategicTradeoffPolicy,
    category: args.category
  });
  const flexibilityGuardrail = flexibilityGuardrailFor(language, revisionTrigger);
  const mustInclude = [
    args.strategicTradeoffPolicy.dominantConstraint
      ? `dominant constraint: ${args.strategicTradeoffPolicy.dominantConstraint}`
      : "",
    args.strategicTradeoffPolicy.deferredOrSacrificedConstraint
      ? `deferred or rejected: ${args.strategicTradeoffPolicy.deferredOrSacrificedConstraint}`
      : "",
    args.strategicTradeoffPolicy.acceptedTradeoff
      ? `accepted tradeoff: ${args.strategicTradeoffPolicy.acceptedTradeoff}`
      : "",
    revisionTrigger ? `revision condition: ${revisionTrigger}` : ""
  ].filter(Boolean);
  const mustAvoid = [
    language === "fr" ? "fausse equivalence entre options incompatibles" : "false equivalence between incompatible options",
    language === "fr" ? "choix definitif sans condition de revision" : "permanent choice without a revision condition",
    language === "fr" ? "compromis flou sans contrainte dominante" : "vague tradeoff without a dominant constraint"
  ];

  return {
    hasStrategicCoherenceRequirement: true,
    decisionPosture,
    requiresRevisionCondition: Boolean(revisionTrigger),
    revisionTrigger,
    flexibilityGuardrail,
    mustInclude,
    mustAvoid,
    guidance: buildGuidance({
      language,
      decisionPosture,
      revisionTrigger,
      policy: args.strategicTradeoffPolicy
    })
  };
}

export function formatStrategicCoherencePolicyForPrompt(policy: StrategicCoherencePolicy) {
  const line = (label: string, value: string | number | boolean | null | string[]) => {
    if (Array.isArray(value)) {
      return `${label}: ${value.length > 0 ? value.join(" | ") : "none"}`;
    }
    return `${label}: ${value === null ? "none" : String(value)}`;
  };

  return [
    line("hasStrategicCoherenceRequirement", policy.hasStrategicCoherenceRequirement),
    line("decisionPosture", policy.decisionPosture),
    line("requiresRevisionCondition", policy.requiresRevisionCondition),
    line("revisionTrigger", policy.revisionTrigger),
    line("flexibilityGuardrail", policy.flexibilityGuardrail),
    line("mustInclude", policy.mustInclude),
    line("mustAvoid", policy.mustAvoid),
    line("guidance", policy.guidance)
  ].join("\n");
}

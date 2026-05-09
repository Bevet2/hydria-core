import type { QuestionCategory } from "../../types/arena.js";
import type { ActiveConstraintCapsule } from "./contextStateTracker.js";

export type StrategicConstraintConflictType =
  | "none"
  | "policy_override_conflict"
  | "deadline_vs_guardrail"
  | "budget_vs_complexity"
  | "scale_vs_capacity"
  | "environment_reversal"
  | "sensitive_data_vs_speed"
  | "stakeholder_pressure_vs_strategy"
  | "signal_scope_reversal";

export type StrategicTradeoffPolicy = {
  hasConflict: boolean;
  conflictType: StrategicConstraintConflictType;
  dominantConstraint: string | null;
  deferredOrSacrificedConstraint: string | null;
  acceptedTradeoff: string | null;
  recommendedMove: string | null;
  confidence: number;
  guidance: string;
};

type Candidate = {
  type: StrategicConstraintConflictType;
  dominantConstraint: string;
  deferredOrSacrificedConstraint: string;
  acceptedTradeoff: string;
  recommendedMove: string;
  confidence: number;
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
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function constraintLabel(value: string) {
  const match = value.match(/^([^:]{2,36}):\s*(.+)$/);
  return match ? normalizeText(match[1] ?? "context") : "context";
}

function constraintText(value: string) {
  const match = value.match(/^([^:]{2,36}):\s*(.+)$/);
  return compact(match ? (match[2] ?? value) : value, 145);
}

function constraintsForLabels(capsule: ActiveConstraintCapsule, labels: string[]) {
  const labelSet = new Set(labels.map(normalizeText));
  return [
    ...capsule.blockingConstraints,
    ...capsule.topConstraints,
    ...capsule.changedConstraints,
    ...capsule.discardedAssumptions
  ].filter((item) => labelSet.has(constraintLabel(item)));
}

function firstConstraint(capsule: ActiveConstraintCapsule, labels: string[], fallback: string) {
  return constraintText(constraintsForLabels(capsule, labels)[0] ?? fallback);
}

function durableConstraint(capsule: ActiveConstraintCapsule) {
  const all = [
    ...capsule.blockingConstraints,
    ...capsule.topConstraints,
    ...capsule.changedConstraints,
    ...capsule.discardedAssumptions
  ];
  const candidates = all.filter(
    (item) =>
      !/\b(?:new owner wants|nouveau responsable|responsable propose|owner proposes|ignore policy|ignorer la politique|push:|pousser|raccourci|shortcut)\b/i.test(
        item
      )
  );
  const explicitPolicy = candidates.find((item) =>
    /\b(?:non-negotiable|politique non|policy non|durable constraint|contrainte durable)\b/i.test(item)
  );
  const guardrail = candidates.find((item) =>
    /\b(?:audit|reversible|reversible|sensitive data|donnees sensibles|vip|support|human|humain|observable|proof|preuve|traceability|tracabilite)\b/i.test(
      item
    )
  );
  return constraintText(explicitPolicy ?? guardrail ?? candidates[0] ?? "active guardrail");
}

function hasAny(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function languageFor(capsule: ActiveConstraintCapsule) {
  return capsule.language === "fr" ? "fr" : "en";
}

function buildGuidance(args: {
  language: "fr" | "en";
  type: StrategicConstraintConflictType;
  dominantConstraint: string;
  deferredOrSacrificedConstraint: string;
  acceptedTradeoff: string;
  recommendedMove: string;
}) {
  if (args.language === "fr") {
    return [
      "Arbitrage strategique obligatoire.",
      `Contrainte dominante: ${args.dominantConstraint}.`,
      `Contrainte differee ou refusee: ${args.deferredOrSacrificedConstraint}.`,
      `Compromis accepte: ${args.acceptedTradeoff}.`,
      `Mouvement recommande: ${args.recommendedMove}.`,
      "La reponse doit trancher, pas presenter les options comme equivalentes."
    ].join(" ");
  }

  return [
    "Strategic arbitration required.",
    `Dominant constraint: ${args.dominantConstraint}.`,
    `Deferred or rejected constraint: ${args.deferredOrSacrificedConstraint}.`,
    `Accepted tradeoff: ${args.acceptedTradeoff}.`,
    `Recommended move: ${args.recommendedMove}.`,
    "The answer must choose a side, not present the options as equivalent."
  ].join(" ");
}

function emptyPolicy(language: "fr" | "en"): StrategicTradeoffPolicy {
  return {
    hasConflict: false,
    conflictType: "none",
    dominantConstraint: null,
    deferredOrSacrificedConstraint: null,
    acceptedTradeoff: null,
    recommendedMove: null,
    confidence: 0,
    guidance:
      language === "fr"
        ? "Pas de conflit strategique explicite detecte."
        : "No explicit strategic constraint conflict detected."
  };
}

function makePolicy(capsule: ActiveConstraintCapsule, candidate: Candidate): StrategicTradeoffPolicy {
  const language = languageFor(capsule);
  return {
    hasConflict: true,
    conflictType: candidate.type,
    dominantConstraint: candidate.dominantConstraint,
    deferredOrSacrificedConstraint: candidate.deferredOrSacrificedConstraint,
    acceptedTradeoff: candidate.acceptedTradeoff,
    recommendedMove: candidate.recommendedMove,
    confidence: candidate.confidence,
    guidance: buildGuidance({
      language,
      type: candidate.type,
      dominantConstraint: candidate.dominantConstraint,
      deferredOrSacrificedConstraint: candidate.deferredOrSacrificedConstraint,
      acceptedTradeoff: candidate.acceptedTradeoff,
      recommendedMove: candidate.recommendedMove
    })
  };
}

function candidateFromCurrentTurn(args: {
  capsule: ActiveConstraintCapsule;
  currentUserMessage: string;
  category: QuestionCategory;
}): Candidate | null {
  const language = languageFor(args.capsule);
  const combined = normalizeText(
    [
      args.currentUserMessage,
      args.capsule.userGoal ?? "",
      ...args.capsule.topConstraints,
      ...args.capsule.blockingConstraints,
      ...args.capsule.changedConstraints,
      ...args.capsule.discardedAssumptions,
      args.capsule.recommendedDirection ?? ""
    ].join(" ")
  );
  const turn = normalizeText(args.currentUserMessage);
  const durable = durableConstraint(args.capsule);
  const deadline = firstConstraint(args.capsule, ["deadline", "urgency"], language === "fr" ? "delai actif" : "active deadline");
  const budget = firstConstraint(args.capsule, ["budget"], language === "fr" ? "budget actif" : "active budget");
  const scale = firstConstraint(args.capsule, ["scale"], language === "fr" ? "scale actif" : "active scale");
  const environment = firstConstraint(
    args.capsule,
    ["environment"],
    language === "fr" ? "environnement actif" : "active environment"
  );
  const sensitive = firstConstraint(
    args.capsule,
    ["sensitive data", "risk"],
    language === "fr" ? "risque actif" : "active risk"
  );
  const team = firstConstraint(args.capsule, ["team"], language === "fr" ? "capacite equipe" : "team capacity");
  const hasDeadlineConstraint = constraintsForLabels(args.capsule, ["deadline"]).length > 0;
  const currentTurnHasDeadlinePressure = hasAny(
    turn,
    /\b(?:deadline|delai|demain|tomorrow|today|aujourd|this week|cette semaine|leadership|la direction|direction veut|ceo|bypass|contourner|resolved before verification|tout est resolu avant verification)\b/
  );
  const hasEnvironmentReversalConstraint = args.capsule.changedConstraints.some((item) =>
    /\b(?:environment|environnement|aws|on[- ]prem|cloud|serverless)\b/i.test(item)
  );
  const currentTurnTargetsEnvironmentDecision = hasAny(
    turn,
    /\b(?:environment|environnement|on[- ]prem|on prem|no public cloud|sans cloud public|without recommending aws|without aws|sans recommander aws|no aws|not aws|serverless|architecture finale|final architecture)\b/
  );

  if (
    hasAny(
      combined,
      /\b(?:policy no longer matters|politique ne compte plus|owner|responsable|new owner|nouveau responsable|handoff|reprise dossier)\b/
    )
  ) {
    return language === "fr"
      ? {
          type: "policy_override_conflict",
          dominantConstraint: durable,
          deferredOrSacrificedConstraint: "preference du nouvel owner ou annonce ambitieuse",
          acceptedTradeoff: "garder le garde-fou durable meme si le message de handoff est plus ferme",
          recommendedMove: "formuler un handoff borne: cap conserve, limite explicite, condition de revision",
          confidence: 90
        }
      : {
          type: "policy_override_conflict",
          dominantConstraint: durable,
          deferredOrSacrificedConstraint: "new owner preference or ambitious announcement",
          acceptedTradeoff: "keep the durable guardrail even if the handoff message becomes firmer",
          recommendedMove: "write a bounded handoff: kept direction, explicit limit, revision condition",
          confidence: 90
        };
  }

  if (
    hasEnvironmentReversalConstraint &&
    currentTurnTargetsEnvironmentDecision
  ) {
    return language === "fr"
      ? {
          type: "environment_reversal",
          dominantConstraint: environment,
          deferredOrSacrificedConstraint: "ancienne option cloud ou hypothese AWS",
          acceptedTradeoff: "perdre un peu de vitesse managed pour rester compatible avec l'environnement actif",
          recommendedMove: "reviser l'architecture autour de l'environnement actif et nommer ce qui devient obsolete",
          confidence: 88
        }
      : {
          type: "environment_reversal",
          dominantConstraint: environment,
          deferredOrSacrificedConstraint: "old cloud option or AWS assumption",
          acceptedTradeoff: "lose some managed-platform speed to stay compatible with the active environment",
          recommendedMove: "revise the architecture around the active environment and name what is obsolete",
          confidence: 88
        };
  }

  if (
    hasAny(
      combined,
      /\b(?:sensitive data|donnees sensibles|legal|audit|irreversible|human control|controle humain|worker representatives|representants|dpo|security)\b/
    ) &&
    hasAny(combined, /\b(?:faster|speed|gagner|deux semaines|two weeks|automate|automatiser|full rollout|deploiement complet)\b/)
  ) {
    return language === "fr"
      ? {
          type: "sensitive_data_vs_speed",
          dominantConstraint: sensitive,
          deferredOrSacrificedConstraint: "vitesse de deploiement ou automatisation complete",
          acceptedTradeoff: "ralentir l'extension pour conserver audit, controle humain et reversibilite",
          recommendedMove: "choisir un prototype borne avec validation humaine et seuil de sortie",
          confidence: 92
        }
      : {
          type: "sensitive_data_vs_speed",
          dominantConstraint: sensitive,
          deferredOrSacrificedConstraint: "deployment speed or full automation",
          acceptedTradeoff: "slow expansion to preserve audit, human control, and reversibility",
          recommendedMove: "choose a bounded prototype with human validation and an exit threshold",
          confidence: 92
        };
  }

  if (
    (hasDeadlineConstraint || currentTurnHasDeadlinePressure) &&
    hasAny(
      combined,
      /\b(?:guardrail|garde fou|audit|reversible|reversible|rollback|verification|policy|politique|risk|risque|communication)\b/
    )
  ) {
    return language === "fr"
      ? {
          type: "deadline_vs_guardrail",
          dominantConstraint: durable || deadline,
          deferredOrSacrificedConstraint: "vitesse pure ou annonce irreversible",
          acceptedTradeoff: "donner un signal visible sans casser les garde-fous",
          recommendedMove: "choisir une action demain, une decision a terme, et un seuil de bascule",
          confidence: 86
        }
      : {
          type: "deadline_vs_guardrail",
          dominantConstraint: durable || deadline,
          deferredOrSacrificedConstraint: "raw speed or irreversible announcement",
          acceptedTradeoff: "provide a visible signal without breaking the guardrails",
          recommendedMove: "choose tomorrow's action, later decision, and switch threshold",
          confidence: 86
        };
  }

  if (
    hasAny(combined, /\b(?:budget|cout|cost|cfo|recurring|recurrent|500 euros|no budget|plus de budget)\b/) &&
    hasAny(combined, /\b(?:microservices|plateforme horizontale|broad|horizontal|cout recurrent|recurring cost|cfo|cluster)\b/)
  ) {
    return language === "fr"
      ? {
          type: "budget_vs_complexity",
          dominantConstraint: budget,
          deferredOrSacrificedConstraint: "complexite plateforme, cout recurrent, ou expansion horizontale",
          acceptedTradeoff: "privilegier la preuve frugale plutot qu'une architecture plus ambitieuse",
          recommendedMove: "reutiliser l'existant, isoler une tranche reversible, puis chiffrer l'ecart restant",
          confidence: 84
        }
      : {
          type: "budget_vs_complexity",
          dominantConstraint: budget,
          deferredOrSacrificedConstraint: "platform complexity, recurring cost, or horizontal expansion",
          acceptedTradeoff: "prefer a frugal proof over a more ambitious architecture",
          recommendedMove: "reuse the current setup, isolate a reversible slice, then price the remaining gap",
          confidence: 84
        };
  }

  if (
    hasAny(combined, /\b(?:scale|10m|10 m|tenfold|x10|millions?|imports concurrents|concurrent imports)\b/) &&
    hasAny(combined, /\b(?:team|equipe|staff|engineers|personnes|capacity|reduced|reduite|resources|ressources)\b/)
  ) {
    return language === "fr"
      ? {
          type: "scale_vs_capacity",
          dominantConstraint: `${scale}; ${team}`,
          deferredOrSacrificedConstraint: "extension large immediate ou plateforme horizontale",
          acceptedTradeoff: "tenir le scale par une tranche progressive au lieu de multiplier les chantiers",
          recommendedMove: "choisir le chemin le plus reversible, avec KPI de sortie avant extension",
          confidence: 82
        }
      : {
          type: "scale_vs_capacity",
          dominantConstraint: `${scale}; ${team}`,
          deferredOrSacrificedConstraint: "immediate broad expansion or horizontal platform",
          acceptedTradeoff: "handle scale through a progressive slice instead of multiplying workstreams",
          recommendedMove: "choose the most reversible path with an exit KPI before expansion",
          confidence: 82
        };
  }

  if (
    hasAny(
      combined,
      /\b(?:partial signal|sous-groupe|subgroup|not the full population|pas de toute la population|signal comes only|signal ne vient que|contradicting metrics|metrics conflict)\b/
    )
  ) {
    return language === "fr"
      ? {
          type: "signal_scope_reversal",
          dominantConstraint: "portee fiable du signal",
          deferredOrSacrificedConstraint: "conclusion globale tiree d'un sous-groupe",
          acceptedTradeoff: "reduire la portee de la decision pour eviter une generalisation fragile",
          recommendedMove: "garder le cap, refuser le raccourci global, lancer un test discriminant",
          confidence: 86
        }
      : {
          type: "signal_scope_reversal",
          dominantConstraint: "reliable scope of the signal",
          deferredOrSacrificedConstraint: "global conclusion from one subgroup",
          acceptedTradeoff: "narrow the decision scope to avoid a fragile generalization",
          recommendedMove: "keep the direction, reject the global shortcut, run a discriminating test",
          confidence: 86
        };
  }

  if (
    hasAny(
      turn,
      /\b(?:equivalent|equivalente|equally viable|avoid conflict|eviter le conflit|sponsor|stakeholder|manager|pm proposes|insists|insiste)\b/
    )
  ) {
    return language === "fr"
      ? {
          type: "stakeholder_pressure_vs_strategy",
          dominantConstraint: durable,
          deferredOrSacrificedConstraint: "preference stakeholder ou fausse equivalence",
          acceptedTradeoff: "assumer le conflit de priorite au lieu de diluer la decision",
          recommendedMove: "nommer l'option retenue, l'option refusee, et le message acceptable",
          confidence: 84
        }
      : {
          type: "stakeholder_pressure_vs_strategy",
          dominantConstraint: durable,
          deferredOrSacrificedConstraint: "stakeholder preference or false equivalence",
          acceptedTradeoff: "accept the priority conflict instead of diluting the decision",
          recommendedMove: "name the accepted option, rejected option, and acceptable stakeholder message",
          confidence: 84
        };
  }

  if (
    args.capsule.decisionNeeded &&
    args.capsule.blockingConstraints.length >= 2 &&
    hasAny(combined, /\b(?:tradeoff|compromis|choose|choisis|tranche|decision|recommend|recommande)\b/)
  ) {
    return language === "fr"
      ? {
          type: "stakeholder_pressure_vs_strategy",
          dominantConstraint: durable,
          deferredOrSacrificedConstraint: "option qui viole la contrainte active secondaire",
          acceptedTradeoff: "faire primer la contrainte la plus risquee et borner l'autre",
          recommendedMove: "trancher explicitement puis donner la condition de revision",
          confidence: 72
        }
      : {
          type: "stakeholder_pressure_vs_strategy",
          dominantConstraint: durable,
          deferredOrSacrificedConstraint: "option that violates the secondary active constraint",
          acceptedTradeoff: "prioritize the riskiest constraint and bound the other one",
          recommendedMove: "choose explicitly, then state the revision condition",
          confidence: 72
        };
  }

  return null;
}

export function resolveStrategicConstraintConflict(args: {
  capsule: ActiveConstraintCapsule;
  currentUserMessage: string;
  category: QuestionCategory;
}): StrategicTradeoffPolicy {
  const language = languageFor(args.capsule);
  const candidate = candidateFromCurrentTurn(args);
  return candidate ? makePolicy(args.capsule, candidate) : emptyPolicy(language);
}

export function formatStrategicTradeoffPolicyForPrompt(policy: StrategicTradeoffPolicy) {
  const line = (label: string, value: string | number | boolean | null) =>
    `${label}: ${value === null ? "none" : String(value)}`;

  return [
    line("hasConflict", policy.hasConflict),
    line("conflictType", policy.conflictType),
    line("dominantConstraint", policy.dominantConstraint),
    line("deferredOrSacrificedConstraint", policy.deferredOrSacrificedConstraint),
    line("acceptedTradeoff", policy.acceptedTradeoff),
    line("recommendedMove", policy.recommendedMove),
    line("confidence", policy.confidence),
    line("guidance", policy.guidance)
  ].join("\n");
}

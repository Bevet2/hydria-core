export type ConversationLanguage = "fr" | "en" | "unknown";

export type ConversationState = {
  userGoal: string | null;
  knownFacts: string[];
  constraints: string[];
  assumptions: string[];
  openQuestions: string[];
  decisionsAlreadyMade: string[];
  previousRecommendations: string[];
  changedContext: string[];
  contradictions: string[];
  riskFlags: string[];
  language: ConversationLanguage;
};

export type ActiveConstraintCapsule = {
  userGoal: string | null;
  topConstraints: string[];
  blockingConstraints: string[];
  changedConstraints: string[];
  discardedAssumptions: string[];
  decisionNeeded: boolean;
  recommendedDirection: string | null;
  confidence: number;
  language: ConversationLanguage;
};

const FRENCH_MARKERS = [
  "je",
  "tu",
  "vous",
  "nous",
  "on",
  "le",
  "la",
  "les",
  "une",
  "des",
  "est",
  "sont",
  "sur",
  "pour",
  "entre",
  "hesite",
  "qui",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "pourquoi",
  "comment",
  "donne",
  "choisis",
  "recommande",
  "faut",
  "doit",
  "donc",
  "contrainte",
  "donnees",
  "delai",
  "equipe",
  "reseau",
  "lenteur",
  "finalement",
  "desormais",
  "maintenant",
  "instant",
  "pense",
  "limite",
  "paiement",
  "utilisateurs",
  "touches",
  "touche",
  "propose"
];
const ENGLISH_MARKERS = [
  "we",
  "the",
  "my",
  "you",
  "what",
  "which",
  "why",
  "how",
  "give",
  "choose",
  "recommend",
  "should",
  "need",
  "constraint",
  "deadline",
  "team",
  "actually",
  "finally",
  "assume",
  "assumption",
  "there",
  "sensitive",
  "incident",
  "api",
  "errors",
  "app",
  "slow",
  "after",
  "login",
  "limited",
  "region"
];
const FRENCH_ACCENT_PATTERN = /[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u00ff\u0153]/i;

const CHANGE_PATTERN =
  /\b(?:finalement|correction|changement|change|changed|evolue|evolved|situation changed|actually|turns out|in fact|en fait|desormais|now we|we are now|on est maintenant|on passe|passe de|from .+ to|instead|ignore ce que|ignore what|new owner|nouveau responsable|owner wants|responsable propose|no longer|plus de)\b/i;
const CONTRADICTION_PATTERN =
  /\b(?:ignore ce que|ignore what|contrairement|correction|actually|turns out|en fait|not anymore|no longer|plus de|n[' ]?est plus|is not|isn't|there is now|there are now|il y a bien|il n[' ]?y a pas)\b/i;
const DECISION_REQUEST_PATTERN =
  /\b(?:recommandes?|recommande|choisis|choisir|decision|d(?:e|é)cide|donc tu|finale|quoi faire|recommend|choose|decision|what should|so what|final|rollback|no rollback|prochain diagnostic|next concrete|next step)\b/i;
const QUESTION_PATTERN = /\?|(?:\b(?:quoi|comment|pourquoi|quel|quelle|what|how|why|which)\b)/i;
const RISK_PATTERN =
  /\b(?:production|prod|incident|rollback|retour arriere|revenir en arriere|deux heures|two hours|irreversible|irreversible|paiement|payment|donnee sensible|sensitive data|legal risk|legal requirement|risque juridique|juridique|audit|securite|security|breach|outage|urgence|urgent|critical|critique|high impact|important users|affected users|utilisateurs touches|utilisateurs sont touches|support explose|40%)\b/i;

const CONSTRAINT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "budget",
    pattern: /\b(?:budget|cout|co[uû]t|cost|500 euros|no budget|plus de budget|budget tres limite|limited budget)\b/i
  },
  {
    label: "scale",
    pattern:
      /\b(?:scale|trafic|traffic|concurrent|multiplie|tenfold|x10|millions?|\d+\s*(?:k|m|million|millions|users|utilisateurs))\b/i
  },
  { label: "environment", pattern: /\b(?:aws|on[- ]prem|on prem|cloud|gcp|azure|kubernetes|k8s|serverless)\b/i },
  { label: "urgency", pattern: /\b(?:urgent|urgence|critical|critique|incident|outage|thirty minutes|30 minutes)\b/i },
  { label: "deadline", pattern: /\b(?:deadline|avant|weeks?|semaines?|tomorrow|demain)\b/i },
  { label: "team", pattern: /\b(?:equipe|[eé]quipe|team|staff|personnes|engineers?|reduced|r[eé]duite?)\b/i },
  {
    label: "risk",
    pattern:
      /\b(?:non-negotiable policy|politique non negociable|politique non n[eé]gociable|required risk evidence|preuve de risque|audit interne|audit fiscal|human validation|validation humaine|controle humain|contr[oô]le humain)\b/i
  },
  { label: "sensitive data", pattern: /\b(?:sensitive data|donnees sensibles|donn[eé]es sensibles|pii|personal data)\b/i },
  {
    label: "user preference",
    pattern:
      /\b(?:prefer|preference|would rather|favor|avoid|je prefere|pr[eé]f[eè]re|preference utilisateur|eviter|[eé]viter|priorise|prioritize|reponse\s+(?:tres\s+)?courte|réponse\s+(?:très\s+)?courte|reponds?\s+en\s+moins\s+de\s+\d+\s+mots?|réponds?\s+en\s+moins\s+de\s+\d+\s+mots?|very short answer|short answer|answer in less than \d+ words?)\b/i
  }
];

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string, maxChars = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function unique(values: string[], limit = 12) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = normalizeText(value);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function markerScore(value: string, markers: string[]) {
  const terms = new Set(normalizeText(value).match(/[a-z0-9]+/g) ?? []);
  return markers.filter((marker) => terms.has(normalizeText(marker))).length;
}

function detectLanguage(value: string): ConversationLanguage {
  const frenchScore = markerScore(value, FRENCH_MARKERS) + (FRENCH_ACCENT_PATTERN.test(value) ? 2 : 0);
  const englishScore = markerScore(value, ENGLISH_MARKERS);

  if (frenchScore === 0 && englishScore === 0) {
    return "unknown";
  }
  if (frenchScore >= englishScore + 1) {
    return "fr";
  }
  if (englishScore >= frenchScore + 1) {
    return "en";
  }
  return "unknown";
}

function extractGoal(message: string) {
  const cleaned = compact(message, 180);
  const withoutPreface = cleaned.replace(/^\s*(?:on doit|we need to|i need to|je dois|nous devons)\s+/i, "");
  return withoutPreface || null;
}

function extractConstraints(message: string) {
  const constraints: string[] = [];
  for (const { label, pattern } of CONSTRAINT_PATTERNS) {
    if (pattern.test(message) && !isNegatedConstraint(label, message)) {
      constraints.push(`${label}: ${compact(message, 180)}`);
    }
  }
  return unique(constraints, 8);
}

function isNegatedConstraint(label: string, message: string) {
  const normalized = normalizeText(message);
  if (label === "sensitive data") {
    return /\b(?:no sensitive data|without sensitive data|pas de donnees sensibles|pas de donnee sensible|aucune donnee sensible)\b/.test(
      normalized
    );
  }
  if (label === "environment") {
    const negatesCloudTarget =
      /\b(?:without recommending aws|without aws|no aws|not aws|sans recommander aws|ne recommande pas aws|pas aws|ni serverless|without recommending serverless)\b/.test(
        normalized
      );
    return negatesCloudTarget && !/\bon[- ]prem\b/.test(normalized);
  }
  return false;
}

function extractKnownFacts(message: string) {
  const facts: string[] = [];
  const normalized = normalizeText(message);
  const nameMatch =
    message.match(/\b(?:je m[' ]?appelle|mon nom est|my name is|call me)\s+([A-Z\p{L}][\p{L}' -]{1,60})/iu) ??
    message.match(/\b(?:i am|i'm)\s+([A-Z][A-Za-z' -]{1,60})\b/u);
  if (nameMatch?.[1]) {
    const userName = nameMatch[1].replace(/\s+(?:et|and)\b.*$/i, "").trim();
    facts.push(`user name: ${compact(userName, 80)}`);
  }
  const preferenceMatch = message.match(
    /\b(?:je prefere|je pr[eé]f[eè]re|i prefer|i would rather|call me|appelle[- ]moi)\s+(.{2,120})/iu
  );
  if (preferenceMatch?.[1]) {
    facts.push(`user preference: ${compact(preferenceMatch[1], 120)}`);
  }
  if (/\b(?:there is|there are|il y a|on a|we have|we are|on est|c'est|it is)\b/.test(normalized)) {
    facts.push(compact(message, 180));
  }
  if (/\b(?:aws|on prem|on-prem|sensitive data|donnees sensibles|users|utilisateurs|budget)\b/.test(normalized)) {
    facts.push(compact(message, 180));
  }
  return unique(facts, 6);
}

function extractAssumptionsFromAssistant(answer: string) {
  if (!answer.trim()) {
    return [];
  }

  const assumptions: string[] = [];
  for (const sentence of answer.split(/[.!?]\s+/).map((item) => item.trim())) {
    if (/\b(?:assume|assumption|hypothese|j[' ]?assume|under that assumption|si on part)\b/i.test(sentence)) {
      assumptions.push(compact(sentence, 180));
    }
  }
  return unique(assumptions, 5);
}

function extractRecommendationsFromAssistant(answer: string) {
  if (!answer.trim()) {
    return [];
  }

  const recommendations: string[] = [];
  for (const sentence of answer.split(/[.!?]\s+/).map((item) => item.trim())) {
    if (/\b(?:recommend|recommande|decision|choose|choisir|option|prioritize|priorise|privil[eé]gie)\b/i.test(sentence)) {
      recommendations.push(compact(sentence, 180));
    }
  }
  return unique(recommendations, 5);
}

function extractOpenQuestion(message: string) {
  if (!QUESTION_PATTERN.test(message)) {
    return [];
  }
  if (DECISION_REQUEST_PATTERN.test(message)) {
    return ["decision needed"];
  }
  return [compact(message, 180)];
}

function detectChangedContext(message: string) {
  if (!CHANGE_PATTERN.test(message)) {
    return [];
  }
  return [compact(message, 180)];
}

function detectContradictions(previousState: ConversationState, message: string) {
  const contradictions: string[] = [];
  if (CONTRADICTION_PATTERN.test(message)) {
    contradictions.push(`User revised prior context: ${compact(message, 180)}`);
  }

  const normalized = normalizeText(message);
  for (const assumption of previousState.assumptions) {
    const normalizedAssumption = normalizeText(assumption);
    if (
      (/\bno sensitive data|pas de donnees sensibles|pas de donnée sensible\b/.test(normalizedAssumption) &&
        /\bsensitive data|donnees sensibles|donnee sensible\b/.test(normalized)) ||
      (/\blow impact|impact faible\b/.test(normalizedAssumption) &&
        /\bimportant users|utilisateurs importants|impact fort|high impact\b/.test(normalized))
    ) {
      contradictions.push(`Contradicts prior assumption: ${compact(assumption, 120)} -> ${compact(message, 140)}`);
    }
  }

  return unique(contradictions, 8);
}

function extractRiskFlags(message: string) {
  if (isNegatedConstraint("sensitive data", message)) {
    return [];
  }
  return RISK_PATTERN.test(message) ? [compact(message, 180)] : [];
}

function extractDecisionsFromUser(message: string) {
  if (!/\b(?:on choisit|we choose|decision:|d[eé]cision:|go with|part sur|partir sur)\b/i.test(message)) {
    return [];
  }
  return [compact(message, 180)];
}

function constraintLabel(value: string) {
  const match = value.match(/^([^:]{2,36}):\s*(.+)$/);
  return match ? normalizeText(match[1] ?? "context") : "context";
}

function constraintText(value: string) {
  const match = value.match(/^([^:]{2,36}):\s*(.+)$/);
  const label = match ? normalizeText(match[1] ?? "context") : "context";
  const text = match ? (match[2] ?? value) : value;
  return summarizeConstraintText(label, text);
}

function summarizeConstraintText(label: string, value: string) {
  const normalized = normalizeText(value);
  if (label === "budget") {
    const euro = value.match(/\b\d+(?:[.,]\d+)?\s*(?:euros?|€|eur)\b/i);
    if (euro) {
      return `capped at ${euro[0]}`;
    }
    if (/\b(?:no budget|plus de budget|plus aucun budget|pas de budget|n'a plus de budget)\b/i.test(value)) {
      return "no additional budget";
    }
    if (/\b(?:budget tres limite|budget très limite|limited budget|budget limite|budget limité)\b/i.test(value)) {
      return "very limited budget";
    }
  }
  if (label === "environment") {
    if (/\bon[- ]prem\b/i.test(value)) {
      return "on-prem";
    }
    if (/\baws\b/i.test(value)) {
      return "AWS";
    }
    if (/\bgcp\b/i.test(value)) {
      return "GCP";
    }
    if (/\bazure\b/i.test(value)) {
      return "Azure";
    }
    if (/\bserverless\b/i.test(value)) {
      return "serverless";
    }
  }
  if (label === "scale") {
    const numericScale = value.match(/\b\d+(?:[.,]\d+)?\s*(?:k|m|million|millions|users|utilisateurs)\b/i);
    if (numericScale) {
      return numericScale[0];
    }
    if (/\b(?:tenfold|x10|multiplie par dix|multiplié par dix)\b/i.test(value)) {
      return "tenfold increase";
    }
  }
  if (label === "deadline") {
    if (/\b(?:tomorrow|demain)\b/i.test(value)) {
      return normalized.includes("demain") ? "demain" : "tomorrow";
    }
    const weeks = value.match(/\b(?:\d+\s*)?(?:weeks?|semaines?)\b/i);
    if (weeks) {
      return weeks[0];
    }
  }
  if (label === "team") {
    if (/\b(?:reduced|reduite|réduite|shrinks?)\b/i.test(value)) {
      return "reduced team";
    }
    if (/\b(?:equipe|équipe)\s+de\s+quatre\s+personnes\b/i.test(value) || /\bfour[- ]person team\b/i.test(value)) {
      return "4-person team";
    }
    const teamSize = value.match(/\b\d+\s*(?:engineers?|personnes|people)\b/i);
    if (teamSize) {
      return teamSize[0];
    }
  }
  if (label === "sensitive data") {
    return "sensitive data present";
  }
  if (label === "user preference") {
    const wordLimit =
      value.match(/\b(?:moins de|less than)\s+\d+\s+(?:mots?|words?)\b/i) ??
      value.match(/\b\d+\s+(?:mots?|words?)\b/i);
    if (wordLimit) {
      return `answer ${wordLimit[0]}`;
    }
    if (/\b(?:reponse\s+tres\s+courte|réponse\s+très\s+courte|very short answer)\b/i.test(value)) {
      return "very short answers";
    }
    if (/\b(?:reponse\s+courte|réponse\s+courte|short answer)\b/i.test(value)) {
      return "short answers";
    }
  }
  if (label === "risk" || label === "urgency") {
    if (/\b(?:logs?|journaux|intermittent|marge|margin|p95|hypothese|hypothesis|instrument|retour arriere|revenir en arriere|two hours|deux heures)\b/i.test(value)) {
      return compact(value, 120);
    }
    if (/\b40%\b/.test(value)) {
      return "40% users affected";
    }
    if (/\b(?:important users|utilisateurs importants|support explose|affected users|utilisateurs touches|utilisateurs sont touches)\b/i.test(value)) {
      return compact(value, 120);
    }
    if (/\b(?:40%|important users|utilisateurs importants|support explose|high impact|critical|critique)\b/i.test(value)) {
      return compact(value, 120);
    }
    if (/\b(?:incident|outage|production|prod)\b/i.test(value)) {
      return "production/incident risk";
    }
  }
  return compact(value, 120);
}

function formatConstraintEntry(value: string) {
  return `${constraintLabel(value)}: ${constraintText(value)}`;
}

const CONSTRAINT_PRIORITY: Record<string, number> = {
  budget: 100,
  deadline: 95,
  scale: 90,
  environment: 85,
  risk: 82,
  urgency: 80,
  "sensitive data": 78,
  "user preference": 74,
  team: 68,
  context: 50
};

function constraintPriority(value: string) {
  return CONSTRAINT_PRIORITY[constraintLabel(value)] ?? 50;
}

function buildActiveConstraintEntries(state: ConversationState) {
  const entries = [
    ...state.constraints,
    ...state.riskFlags.map((riskFlag) => `risk: ${riskFlag}`)
  ];
  const latestByLabel = new Map<string, string>();
  const obsoleteByLabel = new Map<string, string[]>();

  for (const entry of entries) {
    const label = constraintLabel(entry);
    const previous = latestByLabel.get(label);
    if (previous && normalizeText(previous) !== normalizeText(entry)) {
      obsoleteByLabel.set(label, [...(obsoleteByLabel.get(label) ?? []), previous]);
    }
    latestByLabel.set(label, entry);
  }

  const active = [...latestByLabel.values()].map(formatConstraintEntry).sort(
    (left, right) => constraintPriority(right) - constraintPriority(left)
  );
  const changed = [...obsoleteByLabel.entries()].flatMap(([label, obsoleteValues]) => {
    const latest = latestByLabel.get(label);
    return latest
      ? [
          `${label}: obsolete "${constraintText(obsoleteValues[obsoleteValues.length - 1] ?? "")}" -> active "${constraintText(
            latest
          )}"`
        ]
      : [];
  });

  return {
    active,
    changed
  };
}

function isBlockingConstraint(value: string) {
  const label = constraintLabel(value);
  return ["budget", "deadline", "scale", "environment", "risk", "urgency", "sensitive data"].includes(label);
}

function buildRecommendedDirection(args: {
  state: ConversationState;
  topConstraints: string[];
  decisionNeeded: boolean;
  currentUserMessage: string;
}) {
  const substantiveConstraints = args.topConstraints.filter((constraint) => !isFormatPreferenceConstraint(constraint));
  const hasEnoughContext = substantiveConstraints.length > 0;
  if (!hasEnoughContext && !args.decisionNeeded) {
    return null;
  }

  const constraints = substantiveConstraints
    .slice(0, 3)
    .map((constraint) => `${constraintLabel(constraint)}=${constraintText(constraint)}`)
    .join("; ");
  const normalizedIntent = normalizeText(`${args.state.userGoal ?? ""} ${args.currentUserMessage}`);
  if (args.state.language === "fr") {
    if (/\b(?:rollback|retour arriere|trente prochaines minutes|30 minutes)\b/.test(normalizedIntent)) {
      return constraints
        ? `Trancher rollback/no rollback, puis donner un plan de 30 minutes en tenant compte de ${constraints}.`
        : "Trancher rollback/no rollback avec une hypothese explicite et un plan court.";
    }
    if (/\b(?:diagnostic|debug|lent|lente)\b/.test(normalizedIntent)) {
      return constraints
        ? `Donner le prochain diagnostic concret en tenant compte de ${constraints}, puis nommer ce qui reste incertain.`
        : "Donner un diagnostic concret et nommer l'incertitude restante.";
    }
    if (/\b(?:architecture|monolithe|services|hybride)\b/.test(normalizedIntent)) {
      return constraints
        ? `Choisir une architecture simple et reversible en tenant compte de ${constraints}.`
        : "Choisir une architecture bornee avec hypothese explicite.";
    }
    return constraints
      ? `Recommander l'option la plus simple et reversible en tenant compte de ${constraints}.`
      : "Donner une recommandation bornee avec hypothese explicite.";
  }
  if (/\b(?:rollback|thirty minute|30 minute|thirty minutes)\b/.test(normalizedIntent)) {
    return constraints
      ? `Decide rollback or no rollback, then give a 30-minute plan accounting for ${constraints}.`
      : "Decide rollback or no rollback with an explicit assumption and a short plan.";
  }
  if (/\b(?:diagnostic|debug|slow|latency)\b/.test(normalizedIntent)) {
    return constraints
      ? `Give the next concrete diagnostic step accounting for ${constraints}, then name what remains uncertain.`
      : "Give one concrete diagnostic step and name the remaining uncertainty.";
  }
  if (/\b(?:architecture|monolith|services|hybrid)\b/.test(normalizedIntent)) {
    return constraints
      ? `Choose a simple reversible architecture while accounting for ${constraints}.`
      : "Choose a bounded architecture with an explicit assumption.";
  }
  if (/\b(?:launch|strategy|enterprise|smb|buyer|tradeoff)\b/.test(normalizedIntent)) {
    return constraints
      ? `Recommend a focused strategy and tradeoff while accounting for ${constraints}.`
      : "Recommend a focused strategy with an explicit tradeoff.";
  }
  return constraints
    ? `Recommend the simplest reversible option while accounting for ${constraints}.`
    : "Make a bounded recommendation with an explicit assumption.";
}

function isFormatPreferenceConstraint(value: string) {
  return /^user preference:/i.test(value) && /\b(?:answer|reponse|réponse|short|court|courte|mots?|words?)\b/i.test(value);
}

function capsuleConfidence(args: {
  state: ConversationState;
  topConstraints: string[];
  changedConstraints: string[];
  decisionNeeded: boolean;
}) {
  const raw =
    50 +
    Math.min(25, args.topConstraints.length * 6) +
    (args.state.userGoal ? 8 : 0) +
    (args.changedConstraints.length > 0 ? 6 : 0) +
    (args.decisionNeeded ? 6 : 0) +
    (args.state.language !== "unknown" ? 5 : 0);
  return Math.max(35, Math.min(95, raw));
}

export function buildActiveConstraintCapsule(
  state: ConversationState,
  currentUserMessage = ""
): ActiveConstraintCapsule {
  const entries = buildActiveConstraintEntries(state);
  const topConstraints = entries.active.slice(0, 5);
  const decisionNeeded =
    state.openQuestions.includes("decision needed") || DECISION_REQUEST_PATTERN.test(currentUserMessage);
  const changedConstraints = unique([...entries.changed, ...state.changedContext.map((item) => `changed: ${item}`)], 8);
  const discardedAssumptions = unique(
    [
      ...state.contradictions,
      ...entries.changed.map((item) => `obsolete constraint discarded: ${item}`)
    ],
    8
  );
  const recommendedDirection = buildRecommendedDirection({
    state,
    topConstraints,
    decisionNeeded,
    currentUserMessage
  });

  return {
    userGoal: state.userGoal,
    topConstraints,
    blockingConstraints: topConstraints.filter(isBlockingConstraint),
    changedConstraints,
    discardedAssumptions,
    decisionNeeded,
    recommendedDirection,
    confidence: capsuleConfidence({
      state,
      topConstraints,
      changedConstraints,
      decisionNeeded
    }),
    language: state.language
  };
}

export function formatActiveConstraintCapsuleForPrompt(capsule: ActiveConstraintCapsule) {
  const line = (label: string, values: string[] | string | boolean | number | null) => {
    if (Array.isArray(values)) {
      return values.length > 0 ? `${label}: ${values.map((value) => compact(value, 150)).join(" | ")}` : `${label}: none`;
    }
    return `${label}: ${values === null ? "none" : String(values)}`;
  };

  return [
    line("userGoal", capsule.userGoal),
    line("topConstraints", capsule.topConstraints),
    line("blockingConstraints", capsule.blockingConstraints),
    line("changedConstraints", capsule.changedConstraints),
    line("discardedAssumptions", capsule.discardedAssumptions),
    line("decisionNeeded", capsule.decisionNeeded),
    line("recommendedDirection", capsule.recommendedDirection),
    line("confidence", capsule.confidence),
    line("language", capsule.language)
  ].join("\n");
}

export function createInitialState(): ConversationState {
  return {
    userGoal: null,
    knownFacts: [],
    constraints: [],
    assumptions: [],
    openQuestions: [],
    decisionsAlreadyMade: [],
    previousRecommendations: [],
    changedContext: [],
    contradictions: [],
    riskFlags: [],
    language: "unknown"
  };
}

export function updateConversationState(
  previousState: ConversationState,
  newUserMessage: string,
  lastAssistantAnswer = ""
): ConversationState {
  const message = newUserMessage.trim();
  const language = detectLanguage(message) === "unknown" ? previousState.language : detectLanguage(message);
  const assistantAssumptions = extractAssumptionsFromAssistant(lastAssistantAnswer);
  const assistantRecommendations = extractRecommendationsFromAssistant(lastAssistantAnswer);
  const changedContext = detectChangedContext(message);
  const contradictions = detectContradictions(previousState, message);
  const shouldReviseGoal = !previousState.userGoal && message.length > 0;

  return {
    userGoal: shouldReviseGoal ? extractGoal(message) : previousState.userGoal,
    knownFacts: unique([...previousState.knownFacts, ...extractKnownFacts(message)], 14),
    constraints: unique([...previousState.constraints, ...extractConstraints(message)], 14),
    assumptions: unique([...previousState.assumptions, ...assistantAssumptions], 12),
    openQuestions: unique([...previousState.openQuestions, ...extractOpenQuestion(message)], 10),
    decisionsAlreadyMade: unique(
      [...previousState.decisionsAlreadyMade, ...extractDecisionsFromUser(message)],
      10
    ),
    previousRecommendations: unique([...previousState.previousRecommendations, ...assistantRecommendations], 10),
    changedContext: unique([...previousState.changedContext, ...changedContext], 10),
    contradictions: unique([...previousState.contradictions, ...contradictions], 10),
    riskFlags: unique([...previousState.riskFlags, ...extractRiskFlags(message)], 10),
    language
  };
}

export function formatConversationStateForPrompt(state: ConversationState) {
  const line = (label: string, values: string[] | string | null) => {
    if (Array.isArray(values)) {
      return values.length > 0 ? `${label}: ${values.map((value) => compact(value, 140)).join(" | ")}` : `${label}: none`;
    }
    return `${label}: ${values ? compact(values, 180) : "none"}`;
  };

  return [
    line("userGoal", state.userGoal),
    line("knownFacts", state.knownFacts),
    line("constraints", state.constraints),
    line("assumptions", state.assumptions),
    line("openQuestions", state.openQuestions),
    line("decisionsAlreadyMade", state.decisionsAlreadyMade),
    line("previousRecommendations", state.previousRecommendations),
    line("changedContext", state.changedContext),
    line("contradictions", state.contradictions),
    line("riskFlags", state.riskFlags),
    `language: ${state.language}`
  ].join("\n");
}

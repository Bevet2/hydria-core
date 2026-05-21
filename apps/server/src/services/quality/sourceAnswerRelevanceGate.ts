export type SourceAnswerIntent = "definition" | "mechanism" | "cause" | "biography" | "unknown";

export type SourceAnswerLanguage = "fr" | "en" | "unknown";

export type SourceAnswerRelevanceInput = {
  question: string;
  answer: string;
  subject?: string | null;
  verifiedFacts?: string[];
  language?: SourceAnswerLanguage;
};

export type SourceAnswerRelevanceResult = {
  passed: boolean;
  score: number;
  intent: SourceAnswerIntent;
  issues: string[];
  penalties: string[];
  requiredSignals: string[];
};

const STOPWORDS = new Set([
  "about",
  "also",
  "avec",
  "because",
  "biographie",
  "biography",
  "briefly",
  "cause",
  "causes",
  "comment",
  "dans",
  "define",
  "definition",
  "does",
  "explaine",
  "explain",
  "explique",
  "faire",
  "fonctionne",
  "fonctionnement",
  "from",
  "give",
  "histoire",
  "history",
  "pourquoi",
  "quand",
  "quoi",
  "raconte",
  "simple",
  "simplement",
  "that",
  "this",
  "used",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "work",
  "works",
  "why"
]);

const MECHANISM_SIGNALS = [
  "action",
  "by",
  "champ",
  "converts",
  "convertit",
  "courant",
  "current",
  "depends",
  "electric",
  "electrique",
  "energy",
  "energie",
  "field",
  "fonctionne",
  "fonctionnement",
  "force",
  "forme",
  "forms",
  "grace",
  "light",
  "magnetic",
  "magnetique",
  "mecanique",
  "mecanisme",
  "produces",
  "provoque",
  "refraction",
  "rotation",
  "through",
  "works"
];

const CAUSE_SIGNALS = [
  "because",
  "cause",
  "caused",
  "causes",
  "decline",
  "due",
  "entraina",
  "entraine",
  "fell",
  "led",
  "opened",
  "ouverture",
  "parce",
  "political",
  "politique",
  "pressure",
  "pression",
  "protests",
  "provoque",
  "reforms",
  "reformes",
  "reason",
  "s explique",
  "triggered"
];

const BIOGRAPHY_SIGNALS = [
  "born",
  "career",
  "died",
  "emperor",
  "empereur",
  "etait",
  "king",
  "known",
  "mort",
  "morte",
  "naissance",
  "ne",
  "nee",
  "queen",
  "reine",
  "reign",
  "regne",
  "roi",
  "scientist",
  "writer"
];

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value: string) {
  return normalizeText(value).split(/\s+/).filter(Boolean).length;
}

function detectIntent(question: string): SourceAnswerIntent {
  const normalized = normalizeText(question);
  if (/\b(?:why|what causes|what caused|pourquoi|cause|causes)\b/.test(normalized)) {
    return "cause";
  }
  if (
    /\b(?:how does|how do|how is|how are|how .* work|comment fonctionne|fonctionnement|comment se forme|a quoi sert|used for)\b/.test(
      normalized
    )
  ) {
    return "mechanism";
  }
  if (/\b(?:who is|who was|qui est|qui etait|biographie|biography|tell me about|raconte)\b/.test(normalized)) {
    return "biography";
  }
  if (/\b(?:what is|what are|c est quoi|qu est ce|definition|define|explique|explain)\b/.test(normalized)) {
    return "definition";
  }
  return "unknown";
}

function extractTerms(value: string, limit = 10) {
  const terms: string[] = [];
  for (const token of normalizeText(value).match(/[a-z0-9]{3,}/g) ?? []) {
    if (STOPWORDS.has(token) || terms.includes(token)) {
      continue;
    }
    terms.push(token);
    if (terms.length >= limit) {
      break;
    }
  }
  return terms;
}

function signalHits(value: string, signals: string[]) {
  const normalized = normalizeText(value);
  return signals.filter((signal) => {
    const normalizedSignal = normalizeText(signal);
    if (!normalizedSignal) {
      return false;
    }
    const escaped = normalizedSignal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${escaped}\\b`).test(normalized);
  });
}

function subjectTerms(input: SourceAnswerRelevanceInput) {
  const explicitSubject = input.subject?.trim();
  return extractTerms(explicitSubject && explicitSubject.length >= 2 ? explicitSubject : input.question, 8);
}

function subjectHitCount(answer: string, terms: string[]) {
  const normalizedAnswer = normalizeText(answer);
  return terms.filter((term) => normalizedAnswer.includes(term)).length;
}

function factsContainSubject(facts: string[], terms: string[]) {
  const normalizedFacts = normalizeText(facts.join(" "));
  return terms.some((term) => normalizedFacts.includes(term));
}

function sourceOverlapScore(answer: string, facts: string[]) {
  if (facts.length === 0) {
    return 1;
  }
  const answerTerms = extractTerms(answer, 32).filter((term) => term.length >= 4);
  if (answerTerms.length === 0) {
    return 0;
  }
  const factText = normalizeText(facts.join(" "));
  const overlap = answerTerms.filter((term) => factText.includes(term)).length;
  return overlap / answerTerms.length;
}

function requiredSignalsFor(intent: SourceAnswerIntent) {
  if (intent === "cause") {
    return CAUSE_SIGNALS;
  }
  if (intent === "mechanism") {
    return MECHANISM_SIGNALS;
  }
  if (intent === "biography") {
    return BIOGRAPHY_SIGNALS;
  }
  return [];
}

function addIssue(issues: string[], penalties: string[], issue: string, penalty: string) {
  issues.push(issue);
  penalties.push(penalty);
}

export function evaluateSourceAnswerRelevance(
  input: SourceAnswerRelevanceInput
): SourceAnswerRelevanceResult {
  const answer = input.answer.trim();
  const facts = input.verifiedFacts ?? [];
  const intent = detectIntent(input.question);
  const terms = subjectTerms(input);
  const requiredSignals = requiredSignalsFor(intent);
  const issues: string[] = [];
  const penalties: string[] = [];
  const normalizedQuestion = normalizeText(input.question);
  const normalizedAnswer = normalizeText(answer);

  if (countWords(answer) < 6) {
    addIssue(issues, penalties, "too_short_for_semantic_answer", "answer is too short to answer the requested intent");
  }

  const requiredSubjectHits = terms.length >= 2 ? 2 : Math.min(1, terms.length);
  if (requiredSubjectHits > 0 && subjectHitCount(answer, terms) < requiredSubjectHits) {
    const issue = factsContainSubject(facts, terms) ? "subject_not_answered" : "subject_missing_from_answer";
    addIssue(issues, penalties, issue, "answer does not anchor itself on the requested subject");
  }

  if (intent === "cause" && signalHits(answer, CAUSE_SIGNALS).length === 0) {
    addIssue(issues, penalties, "missing_causal_answer", "question asks why/what caused something, but answer gives no cause");
  }

  if (intent === "mechanism" && signalHits(answer, MECHANISM_SIGNALS).length === 0) {
    addIssue(
      issues,
      penalties,
      "missing_mechanism_answer",
      "question asks how something works, but answer gives no mechanism"
    );
  }

  if (intent === "biography" && signalHits(answer, BIOGRAPHY_SIGNALS).length === 0 && countWords(answer) < 18) {
    addIssue(issues, penalties, "thin_biography_answer", "biographical question lacks life or role details");
  }

  if (
    /\bmoteur electrique\b/.test(normalizedQuestion) &&
    /\b(?:automobile hybride|vehicule hybride|hybrid vehicle|hybrid car)\b/.test(normalizedAnswer)
  ) {
    addIssue(issues, penalties, "off_topic_hybrid_vehicle", "answer describes hybrid vehicles instead of electric motors");
  }

  if (
    /\bberlin wall\b/.test(normalizedQuestion) &&
    intent === "cause" &&
    /\b(?:concrete barrier|separating|wall separating|construction commenced)\b/.test(normalizedAnswer) &&
    signalHits(answer, CAUSE_SIGNALS).length === 0
  ) {
    addIssue(issues, penalties, "definition_instead_of_cause", "answer defines the Berlin Wall instead of explaining why it fell");
  }

  if (facts.length > 0 && sourceOverlapScore(answer, facts) < 0.18) {
    addIssue(issues, penalties, "not_supported_by_sources", "answer has weak lexical overlap with verified source facts");
  }

  const score = Math.max(0, 100 - issues.length * 20);
  return {
    passed: issues.length === 0,
    score,
    intent,
    issues,
    penalties,
    requiredSignals: requiredSignals.slice(0, 12)
  };
}

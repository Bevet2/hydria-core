import { normalizeSpace } from "./common.js";

export type GeneralKnowledgeLanguage = "fr" | "en";

export type GeneralKnowledgeRewrite = {
  original: string;
  language: GeneralKnowledgeLanguage;
  cleanedSubject: string;
  canonicalSubject: string;
  candidates: string[];
  normalizedAliases: string[];
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  dixsept: 17,
  "dix-sept": 17,
  dixhuit: 18,
  "dix-huit": 18,
  dixneuf: 19,
  "dix-neuf": 19,
  vingt: 20
};

const COUNTRY_SUFFIX_PATTERN =
  /\b(?:france|angleterre|england|spain|espagne|italie|italy|germany|allemagne|portugal|russie|russia)\b$/i;
const SUBJECT_STOPWORD_PATTERN =
  /\b(?:roi|reine|king|queen|empereur|emperor|pape|pope|pharaon|pharaoh|prince|princesse|pour|for|de|du|des|d|l|of|about|sur|the|le|la|les|un|une|a|an|son|sa|ses|his|her|their|its)\b/gi;
const MATCH_STOPWORD_PATTERN =
  /\b(?:roi|king|reine|queen|empereur|emperor|pape|pope|saint|sainte|de|du|des|d|of|the|le|la|les|france|french|english|anglais|francais|francaise|biographie|biography|history|histoire|definition|explain|explique)\b/g;
const DASH_PATTERN = /[\u2010-\u2015-]+/g;
const COMMON_ALIAS_CANONICALS: Record<string, string> = {
  adn: "DNA",
  "acide desoxyribonucleique": "DNA",
  dna: "DNA",
  ia: "Intelligence Artificielle",
  ai: "Artificial Intelligence",
  api: "API",
  apis: "API",
  http: "HTTP",
  dns: "DNS",
  sql: "SQL",
  json: "JSON",
  ssl: "TLS",
  tls: "TLS",
  cdn: "CDN",
  llm: "LLM",
  llms: "LLM",
  cleopatre: "Cleopatra VII",
  cleopatra: "Cleopatra VII",
  "cleopatre vii": "Cleopatra VII",
  "cleopatra vii": "Cleopatra VII",
  "napoleon bonaparte": "Napoleon Bonaparte"
};

const SPECIAL_CANDIDATE_ALIASES: Record<string, string[]> = {
  "cleopatra vii": ["Cleopatra VII", "Cleopatre VII", "Cléopâtre VII", "Cleopatra", "Cleopatre"],
  "napoleon bonaparte": ["Napoleon Bonaparte", "Napoléon Ier", "Napoleon I", "Napoleon"]
};

const MATCH_TERM_ALIASES: Record<string, string[]> = {
  cleopatra: ["cleopatra", "cleopatre"],
  cleopatre: ["cleopatre", "cleopatra"]
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => normalizeSpace(value)).filter(Boolean))];
}

export function normalizeLooseText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[']/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toRomanNumeral(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 30) {
    return String(value);
  }

  const numerals: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let remaining = value;
  let output = "";
  for (const [amount, symbol] of numerals) {
    while (remaining >= amount) {
      output += symbol;
      remaining -= amount;
    }
  }
  return output;
}

export function normalizeOrdinalAliases(value: string) {
  let normalized = value.replace(/\b([1-9]|[12][0-9]|30)\b/g, (match) => toRomanNumeral(Number(match)));
  for (const [word, number] of Object.entries(NUMBER_WORDS)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "gi"), toRomanNumeral(number));
  }
  return normalized;
}

function stripRequestTerms(value: string) {
  return normalizeSpace(
    value
      .replace(/['’]/g, " ")
      .replace(/['\u2018\u2019]/g, " ")
      .replace(/[?]/g, " ")
      .replace(
        /\b(?:who is|who was|what is|what are|tell me about|give me|make me|explain|define|definition|history of|biography of|qui est|qui etait|qui \u00e9tait|qu[' ]?est[- ]?ce qu[' ]?(?:un|une|le|la|les)?|qu[' ]?est[- ]?ce que|quest ce que|c[' ]?est quoi|ce qu'est|explique|definis|d(?:e|\u00e9)finis|d(?:e|\u00e9)finition|fai[st](?:-|\s)?moi|donne(?:-|\s)?moi|raconte(?:\s+l\s+histoire\s+de)?|raconte(?:-|\s)?moi|prepare(?:-|\s)?moi|pr(?:e|\u00e9)pare(?:-|\s)?moi)\b/gi,
        " "
      )
      .replace(/\b(?:c[' ]?est qui|c[' ]?est quel|c[' ]?est quoi|etait[- ]?ce|what causes|what caused|what was|what were|used for)\b/gi, " ")
      .replace(
        /\b(?:sa biographie|son histoire|biographie|biography|histoire|history|known for|connu(?:e)? pour|complete|compl(?:e|\u00e8)te|complet|courte?|fiche|presentation|pr(?:e|\u00e9)sentation|expose|expos(?:e|\u00e9)|diaporama|slides?|simplement|simply|please|svp|s'il te plait|s'il vous plait|historiquement)\b/gi,
        " "
      )
      .replace(/[?.!,;:]+$/g, " ")
  );
}

function stripRoleAndGlue(value: string) {
  return normalizeSpace(value.replace(SUBJECT_STOPWORD_PATTERN, " "));
}

function titleCaseSubject(value: string) {
  return value
    .split(" ")
    .map((part) =>
      /^[ivxlcdm]+$/i.test(part)
        ? part.toUpperCase()
        : part.length > 0
          ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`
          : part
    )
    .join(" ");
}

function withoutCountrySuffix(value: string) {
  return normalizeSpace(value.replace(COUNTRY_SUFFIX_PATTERN, " "));
}

function candidateWithSimpleSingular(value: string) {
  return value.replace(/\bapis\b/i, "API").replace(/\bllms\b/i, "LLM");
}

function canonicalAlias(value: string) {
  return COMMON_ALIAS_CANONICALS[normalizeLooseText(value)] ?? null;
}

function contextualCanonicalAlias(args: { question: string; subject: string }) {
  const combined = normalizeLooseText(`${args.question} ${args.subject}`);
  const refersToSaintLouis =
    /\bsaint louis\b/.test(combined) &&
    !/\b(?:senegal|s[eé]n[eé]gal|missouri|ville|city|commune|fleuve|river|st louis)\b/.test(combined);
  if (refersToSaintLouis && /\b(?:qui|who|roi|king|histor|biograph|france|personne|person)\b/.test(combined)) {
    return "Louis IX";
  }
  return null;
}

export function rewriteGeneralKnowledgeQuery(input: {
  question: string;
  subject?: string | null;
  language?: string | null;
}): GeneralKnowledgeRewrite {
  const original = input.subject?.trim() || input.question;
  const language: GeneralKnowledgeLanguage = input.language === "fr" ? "fr" : "en";
  const stripped = stripRequestTerms(original);
  const normalizedOrdinal = normalizeOrdinalAliases(
    stripped.replace(DASH_PATTERN, " ").replace(/[.,;:!?]+/g, " ")
  );
  const cleanedSubject = stripRoleAndGlue(normalizedOrdinal);
  const contextualAlias = contextualCanonicalAlias({ question: input.question, subject: original });
  const canonicalSubject =
    contextualAlias ??
    canonicalAlias(cleanedSubject) ??
    canonicalAlias(normalizedOrdinal) ??
    titleCaseSubject(cleanedSubject.length >= 2 ? cleanedSubject : normalizedOrdinal);
  const preferredCanonicalSubject =
    language === "fr" && normalizeLooseText(canonicalSubject) === "cleopatra vii"
      ? "Cléopâtre VII"
      : canonicalSubject;
  const noCountry = withoutCountrySuffix(preferredCanonicalSubject);
  const specialAliases = SPECIAL_CANDIDATE_ALIASES[normalizeLooseText(canonicalSubject)] ?? [];
  const aliases = unique([
    preferredCanonicalSubject,
    ...specialAliases,
    canonicalSubject,
    contextualAlias ? "Saint Louis" : "",
    noCountry,
    candidateWithSimpleSingular(canonicalSubject),
    candidateWithSimpleSingular(noCountry),
    canonicalAlias(original) ??
      titleCaseSubject(normalizeOrdinalAliases(original.replace(DASH_PATTERN, " ").replace(/[.,;:!?]+/g, " ")))
  ]).filter((candidate) => normalizeLooseText(candidate).length >= 2);

  return {
    original,
    language,
    cleanedSubject,
    canonicalSubject: aliases[0] ?? canonicalSubject,
    candidates: aliases.slice(0, 6),
    normalizedAliases: aliases
  };
}

export function meaningfulSubjectTerms(subject: string) {
  return normalizeLooseText(normalizeOrdinalAliases(subject))
    .replace(MATCH_STOPWORD_PATTERN, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 2);
}

function matchTermVariants(term: string) {
  return MATCH_TERM_ALIASES[term] ?? [term];
}

export function subjectMatchesText(subject: string, text: string) {
  const subjectTerms = meaningfulSubjectTerms(subject);
  if (subjectTerms.length === 0) {
    return true;
  }

  const normalizedText = normalizeLooseText(text);
  const hitCount = subjectTerms.filter((term) =>
    matchTermVariants(term).some((variant) => normalizedText.includes(variant))
  ).length;
  return hitCount >= Math.min(2, subjectTerms.length);
}

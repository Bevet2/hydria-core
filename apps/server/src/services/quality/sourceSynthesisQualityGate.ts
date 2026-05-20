export type SourceSynthesisLanguage = "fr" | "en" | "unknown";

export type SourceSynthesisQualityInput = {
  answer: string;
  language?: SourceSynthesisLanguage;
  sourceBacked?: boolean;
};

export type SourceSynthesisQualityResult = {
  passed: boolean;
  score: number;
  issues: string[];
  penalties: string[];
};

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

function splitSentences(value: string) {
  const sentences = value.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) ?? [];
  if (sentences.length > 0) {
    return sentences;
  }
  return value.trim() ? [value.trim()] : [];
}

function countWords(value: string) {
  return normalizeText(value).split(/\s+/).filter(Boolean).length;
}

function repeatedSentenceCount(sentences: string[]) {
  const seen = new Set<string>();
  let repeated = 0;
  for (const sentence of sentences) {
    const key = normalizeText(sentence)
      .split(" ")
      .filter((token) => token.length > 2)
      .join(" ");
    if (key.length < 28) {
      continue;
    }
    if (seen.has(key)) {
      repeated += 1;
    }
    seen.add(key);
  }
  return repeated;
}

function hasRepeatedOpeningClause(answer: string) {
  const normalized = normalizeText(answer);
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 18) {
    return false;
  }
  const window = tokens.slice(0, 8).join(" ");
  return window.length >= 24 && normalized.indexOf(window, window.length + 1) >= 0;
}

function hasBrokenEnding(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) {
    return true;
  }
  if (/\.{3}$/.test(trimmed)) {
    return true;
  }
  if (!/[.!?]$/.test(trimmed) && countWords(trimmed) >= 8) {
    return true;
  }
  const normalized = normalizeText(trimmed);
  return (
    /\b(?:a|de|du|des|le|la|les|un|une|et|en|of|to|the|and|with|from|it|that|which|qui|que)$/.test(
      normalized
    ) ||
    /\b(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)$/.test(
      normalized
    )
  );
}

function hasQuestionLabelArtifact(answer: string) {
  return /^\s*(?:comment|explique|raconte|pourquoi|qu[' ]?est[- ]?ce|c[' ]?est quoi|what is|what was|who was|who is|why|how)\b[^.!?]{0,80}:\s/iu.test(
    answer
  );
}

function hasSourceArtifact(answer: string) {
  const normalized = normalizeText(answer);
  return (
    normalized.includes("objectif comprendre") ||
    /\bqu est ce qu un\b/.test(normalized) ||
    /\b(?:retrieved from|read more|cliquez ici)\b/.test(normalized)
  );
}

function hasAwkwardLexicalArtifact(answer: string) {
  return /\b(?:propheteseuse|puissance qui surgit|tous ceux qui l entourent)\b/i.test(
    normalizeText(answer)
  );
}

function hasLanguageDrift(answer: string, language: SourceSynthesisLanguage) {
  if (language === "unknown") {
    return false;
  }
  const normalized = normalizeText(answer);
  const frenchSignals = (
    normalized.match(/\b(?:le|la|les|une|des|est|sont|avec|pour|dans|qui|etait|ete|cette|ceci)\b/g) ?? []
  ).length;
  const englishSignals = (
    normalized.match(/\b(?:the|this|that|with|for|because|answer|was|were|which|known|born)\b/g) ?? []
  ).length;
  if (language === "fr") {
    return englishSignals >= Math.max(3, frenchSignals + 2);
  }
  return frenchSignals >= Math.max(3, englishSignals + 2);
}

export function evaluateSourceSynthesisQuality(
  input: SourceSynthesisQualityInput
): SourceSynthesisQualityResult {
  const answer = input.answer.trim();
  const language = input.language ?? "unknown";
  const sentences = splitSentences(answer);
  const issues: string[] = [];
  const penalties: string[] = [];

  const add = (issue: string, penalty: string) => {
    issues.push(issue);
    penalties.push(penalty);
  };

  if (countWords(answer) < 6) {
    add("too_short_synthesis", "source-backed answer is too short to carry the fact");
  }
  if (hasBrokenEnding(answer)) {
    add("broken_or_truncated_synthesis", "answer appears truncated or ends on an incomplete phrase");
  }
  if (repeatedSentenceCount(sentences) > 0 || hasRepeatedOpeningClause(answer)) {
    add("repeated_source_sentence", "answer repeats the same source sentence or opening clause");
  }
  if (hasQuestionLabelArtifact(answer)) {
    add("question_label_artifact", "answer starts with a copied user-question label");
  }
  if (hasSourceArtifact(answer)) {
    add("source_artifact", "answer includes source-page scaffolding or decorative artifacts");
  }
  if (hasAwkwardLexicalArtifact(answer)) {
    add("awkward_lexical_artifact", "answer contains a suspicious lexical artifact from weak synthesis");
  }
  if (hasLanguageDrift(answer, language)) {
    add("language_drift", "answer appears to drift away from the expected language");
  }

  const score = Math.max(0, 100 - issues.length * 20);
  return {
    passed: issues.length === 0,
    score,
    issues,
    penalties
  };
}

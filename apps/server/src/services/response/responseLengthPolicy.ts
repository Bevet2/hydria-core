export type ResponseLengthMode = "concise" | "standard" | "long_form";

export type ResponseLengthPlan = {
  mode: ResponseLengthMode;
  requestedMinimumWords: number | null;
  targetWords: number | null;
  maxOutputTokens: number | null;
  guidance: string[];
};

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function explicitMinimumWords(value: string) {
  const patterns = [
    /\b(?:au moins|minimum|min\.?|environ|autour de)\s+(\d{2,4})\s+mots?\b/i,
    /\b(?:at least|minimum|min\.?|around|approximately)\s+(\d{2,4})\s+words?\b/i,
    /\b(\d{2,4})\s+mots?\s+(?:minimum|min\.?)\b/i,
    /\b(\d{2,4})\s+words?\s+(?:minimum|min\.?)\b/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) {
        return Math.max(40, Math.min(1800, parsed));
      }
    }
  }
  return null;
}

export function planResponseLength(userMessage: string, routingQuestion = userMessage): ResponseLengthPlan {
  const combined = `${userMessage}\n${routingQuestion}`;
  const normalized = normalizeText(combined);
  const requestedMinimumWords = explicitMinimumWords(combined);
  const explicitShort =
    /\b(?:une seule phrase|reponse courte|reponds court|moins de\s+\d+\s+mots?|one sentence|short answer|briefly|under\s+\d+\s+words?)\b/.test(
      normalized
    );
  const longFormSignal =
    requestedMinimumWords !== null ||
    /\b(?:en profondeur|detaille|detaillee|tres complet|longue reponse|article complet|chapitre|rapport complet|deep dive|in depth|detailed|comprehensive|long answer|full report)\b/.test(
      normalized
    );

  if (explicitShort) {
    return {
      mode: "concise",
      requestedMinimumWords: null,
      targetWords: null,
      maxOutputTokens: null,
      guidance: []
    };
  }

  if (!longFormSignal) {
    return {
      mode: "standard",
      requestedMinimumWords: null,
      targetWords: null,
      maxOutputTokens: null,
      guidance: []
    };
  }

  const targetWords = requestedMinimumWords ?? 700;
  const maxOutputTokens = Math.max(768, Math.min(3072, Math.ceil(targetWords * 1.65) + 160));
  return {
    mode: "long_form",
    requestedMinimumWords,
    targetWords,
    maxOutputTokens,
    guidance: [
      requestedMinimumWords
        ? `Write at least ${requestedMinimumWords} words unless safety or missing evidence prevents it.`
        : `Write a developed answer of roughly ${targetWords} words.`,
      "Preserve the requested sections and develop each one with concrete explanations.",
      "Do not collapse a long-form request into a short definition or source excerpt.",
      "Use concise internal reasoning, but provide the complete user-facing explanation."
    ]
  };
}


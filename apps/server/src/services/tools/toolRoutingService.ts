import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import { defaultToolRoutingDecision } from "../../types/arena.js";
import { buildSemanticFrame } from "../orchestration/semanticMissionPlanner.js";
import { normalizeSpace } from "../research/common.js";
import {
  extractSalientResearchSubject,
  rewriteGeneralKnowledgeQuery
} from "../research/generalKnowledgeQueryRewriter.js";
import { detectTemporalQuery } from "../research/temporal.js";

const WRITING_OR_BRAINSTORM_PATTERN =
  /\b(?:write|rewrite|rephrase|reformulate|brainstorm|draft|improve this wording|summari[sz]e|polish|make this clearer|redige|r(?:e|\u00e9)dige|ecris|(?:e|\u00e9)cris|r(?:e|\u00e9)sume|resume|reformule)\b/i;
const WEATHER_PATTERN =
  /(?:\b(?:weather|forecast|temperature|rain|snow|wind|humidity|sunny|cloudy|storm|meteo|temps)\b|humidit(?:e|\u00e9)|m(?:e|\u00e9|\u00c3\u00a9|\ufffd)t(?:e|\u00e9|\u00c3\u00a9|\ufffd)o|pr(?:e|\u00e9)vision)/i;
const EXPLICIT_WEATHER_PATTERN =
  /(?:\b(?:weather|forecast|temperature|rain|snow|wind|humidity|sunny|cloudy|storm|meteo|pluie|vent|neige)\b|humidit(?:e|\u00e9)|m(?:e|\u00e9|\u00c3\u00a9|\ufffd)t(?:e|\u00e9|\u00c3\u00a9|\ufffd)o|pr(?:e|\u00e9)vision)/i;
const SPORTS_PATTERN =
  /\b(?:score|match|game|fixture|standings|league table|playoff|goal|goals)\b/i;
const SPORTS_CONTEXT_PATTERN =
  /\b(?:soccer|football|nba|nfl|mlb|nhl|tennis|f1|formula 1|champions league|premier league|world cup)\b/i;
const FINANCE_PATTERN =
  /\b(?:price|stock|share price|market cap|crypto|cryptocurrency|bitcoin|btc|ethereum|eth|solana|sol|nasdaq|nyse|ticker)\b/i;
const REPO_PATTERN =
  /\b(?:github|repo|repository|codebase|project folder|scan(?:ne)? (?:my )?repo|scan(?:ne)? (?:the )?project|inspect (?:the )?repo)\b/i;
const FILE_PATTERN =
  /\b(?:read (?:this |the )?(?:file|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)|open (?:this |the )?(?:file|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)|(?:analy[sz]e|analyse|lis|lire|ouvre|ouvrir) (?:this |the |ce |cet |cette )?(?:file|fichier|document|pdf|markdown|csv|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)|package\.json|tsconfig(?:\.[A-Za-z0-9_-]+)?\.json|document|pdf|spreadsheet|csv|json file|fichier joint)\b/i;
const EXECUTION_PATTERN =
  /\b(?:run|launch|execute)\s+(?:the )?(?:tests?|test suite|npm test|pnpm test|pytest|vitest|jest)\b/i;
const GENERATE_FILE_PATTERN =
  /\b(?:generate|create|produce|write)\s+(?:a |an )?(?:file|artifact|json|markdown|readme)\b/i;
const CURRENT_STATUS_PATTERN =
  /\b(?:current|currently|actuel|actuelle|as of|right now|ceo|president|prime minister|governor|chair|founder|owner|status|version)\b/i;
const DOC_LOOKUP_PATTERN =
  /\b(?:official docs?|documentation|reference|api docs?|rfc|spec|specification|what does .* say|according to)\b/i;
const WEBSITE_LOOKUP_PATTERN =
  /\b(?:website|site|company page|product page|find .* on github|find .* repo)\b/i;
const EXPLICIT_FACTUAL_RESEARCH_PATTERN =
  /\b(?:verify|fact[-\s]?check|source|sources|cite|citation|search the web|search online|look up|lookup|find online|cherche(?:r)? sur internet|recherche web|source fiable|sources fiables|verifie|v(?:e|\u00e9)rifie|cite)\b/i;
const CURRENCY_NAME_PATTERN =
  /\b(?:usd|eur|gbp|cad|aud|jpy|chf|sek|nok|dkk|pln|inr|cny|rmb|btc|eth|bitcoin|ethereum|dollar(?:s)?|euro(?:s)?|pound(?:s)?|yen)\b/i;
const TIME_PATTERN =
  /\b(?:what time is it|current time|time now|date today|today'?s date|heure actuelle|quelle heure est-il)\b/i;
const ARITHMETIC_PATTERN =
  /\b(?:calculate|compute|what is|calcule|calculer|combien font)\b[\s:]+[-+/*().%\d\s]+$/i;
const CONVERSATION_RECALL_PATTERN =
  /\b(?:remember|remind me|what did i say|do you remember|earlier|previous budget|current budget|current deadline|tu te souviens|souviens(?:-toi)?|rappelle(?:-moi)?|ancien budget|budget actuel|date actuelle|echeance actuelle|[e\u00e9]ch[e\u00e9]ance actuelle|plus haut|dans cette conversation)\b/i;
const RECENT_UPDATES_INTENT_PATTERN =
  /\b(?:news|updates?|announcements?|headlines?|release notes?|what changed|nouveautes?|actualites?|annonces?|sorties?|changements?|recap)\b/i;

const CURRENCY_ALIASES: Record<string, string> = {
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  jpy: "JPY",
  yen: "JPY",
  cad: "CAD",
  aud: "AUD",
  chf: "CHF",
  sek: "SEK",
  nok: "NOK",
  dkk: "DKK",
  pln: "PLN",
  inr: "INR",
  cny: "CNY",
  rmb: "CNY",
  btc: "BTC",
  bitcoin: "BTC",
  eth: "ETH",
  ethereum: "ETH"
};

function defaultRouting(
  reason: string = defaultToolRoutingDecision.reason
): ToolRoutingDecision {
  return {
    ...defaultToolRoutingDecision,
    reason
  };
}

function buildDecision(overrides: Partial<ToolRoutingDecision>): ToolRoutingDecision {
  return {
    ...defaultToolRoutingDecision,
    ...overrides,
    extractedArgs: overrides.extractedArgs ?? {}
  };
}

function buildMissingInputDecision(overrides: Partial<ToolRoutingDecision>): ToolRoutingDecision {
  return buildDecision({
    toolRequired: false,
    toolRecommended: true,
    fallbackAllowed: false,
    confidence: 0.82,
    ...overrides
  });
}

function containsTemporalFreshCue(value: string) {
  return /\b(?:today|tonight|now|current|currently|latest|newest|recent|recently|this week|this month|as of|right now|actuel|actuelle|maintenant)\b/i.test(
    value
  );
}

function isConversationPlanningCategory(category: QuestionCategory | null | undefined) {
  return [
    "architecture_design",
    "debug_diagnostic",
    "incident_response",
    "mixed_reasoning",
    "product_strategy",
    "operational_writing"
  ].includes(category ?? "other");
}

function detectQuestionLanguage(question: string) {
  return /\b(?:fai[st](?:-|\s)?moi|donne(?:-|\s)?moi|recap|r(?:e|\u00e9)cap|nouveaut(?:e|\u00e9)s?|sorties?|semaine|quel|quelle|quels|temps|aujourd|meteo|m(?:e|\u00e9|\u00c3\u00a9|\ufffd)t(?:e|\u00e9|\u00c3\u00a9|\ufffd)o|pluie|vent|neige|fait-il|fait il|qui est|qui etait|qui (?:e|\u00e9)tait|biographie|presentation|pr(?:e|\u00e9)sentation|expos(?:e|\u00e9)|calcule|calculer|combien|convertis|convertir|euros?|dollars?|taux|avec|plusieurs|fiables?|limites?|pour)\b/i.test(
    question
  )
    ? "fr"
    : "en";
}

function extractLocation(question: string) {
  const cleanLocation = (value: string) =>
    normalizeSpace(
      value
        .replace(
          /\b(?:aujourd'hui|aujourdhui|aujourd hui|demain|ce soir|ce week-end|ce weekend|week-end|weekend|maintenant|today|tonight|tomorrow|right now|now)\b/gi,
          ""
        )
        .replace(/\b(?:et|and)\s+(?:convertis|convert|calcule|calculate|compute)\b.*$/i, "")
        .replace(
          /\b(?:pour|de|a|\u00e0|\u00c3\u00a0|\u00c3|\ufffd|in|at|for)\b/gi,
          ""
        )
        .replace(
          /\b(?:meteo|m(?:e|\u00e9|\u00c3\u00a9|\ufffd)t(?:e|\u00e9|\u00c3\u00a9|\ufffd)o|weather|forecast|pr(?:e|\u00e9)vision|temperature|humidity|humidit(?:e|\u00e9))\b/gi,
          ""
        )
        .replace(/^\s*(?:a|\u00e0|\u00c3\u00a0|\u00c3|\ufffd|in|at|for)\s+/i, "")
        .replace(/^(?:\u00c3|\ufffd)\s+/, "")
        .replace(/[?.!,]+$/, "")
    );
  const patterns = [
    /\b(?:m(?:e|\u00e9|\u00c3\u00a9|\ufffd)t(?:e|\u00e9|\u00c3\u00a9|\ufffd)o|meteo|weather|forecast|temperature|humidity|humidit(?:e|\u00e9)|pr(?:e|\u00e9)vision)\b(?:\s+(?:actuel(?:le)?|current))?(?:\s+(?:pour|de|a|\u00e0|\u00c3\u00a0|\u00c3|\ufffd|in|at|for))?\s+([A-Za-z\u00c0-\u00ff0-9.' -]{2,60})/i,
    /\b(?:humidity|humidit(?:e|\u00e9))\s+(?:actuel(?:le)?|current)?\s*(?:pour|de|a|\u00e0|\u00c3\u00a0|\u00c3|\ufffd|in|at|for)\s+([A-Za-z\u00c0-\u00ff0-9.' -]{2,60})/i,
    /(?:in|at|for|a|\u00e0|\u00c3\u00a0|\u00c3|\ufffd)\s+([A-Za-z\u00c0-\u00ff0-9.' -]{2,60})/i,
    /(?:weather|forecast|temperature)\s+(?:for|in|a|\u00e0|\u00c3\u00a0|\u00c3|\ufffd)\s+([A-Za-z\u00c0-\u00ff0-9.' -]{2,60})/i
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) {
      const location = cleanLocation(match[1]);
      if (location.length >= 2) {
        return location;
      }
    }
  }

  return null;
}

function extractQuotedOrTrailingName(question: string) {
  const quoted = question.match(/["']([^"']{2,80})["']/);
  if (quoted?.[1]) {
    return normalizeSpace(quoted[1]);
  }

  const trailing = question.match(/\b(?:repo|repository|project|match|game|company|product|site|website)\s+(.+)$/i);
  if (trailing?.[1]) {
    return normalizeSpace(trailing[1].replace(/[?.!,]+$/, ""));
  }

  return null;
}

function extractAsset(question: string) {
  const knownAssets = [
    { pattern: /\bbitcoin\b|\bbtc\b/i, value: "BTC" },
    { pattern: /\bethereum\b|\beth\b/i, value: "ETH" },
    { pattern: /\bsolana\b|\bsol\b/i, value: "SOL" },
    { pattern: /\bnvidia\b|\bnvda\b/i, value: "NVDA" },
    { pattern: /\btesla\b|\btsla\b/i, value: "TSLA" },
    { pattern: /\bmicrosoft\b|\bmsft\b/i, value: "MSFT" }
  ];

  for (const entry of knownAssets) {
    if (entry.pattern.test(question)) {
      return entry.value;
    }
  }

  const tickerMatch = question.match(/\b([A-Z]{2,6})\b/);
  return tickerMatch?.[1] ?? null;
}

function normalizeCurrencyToken(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  return CURRENCY_ALIASES[normalized] ?? (normalized.length === 3 ? normalized.toUpperCase() : null);
}

function extractCurrencyArgs(question: string) {
  const amountMatch = question.match(/(\d+(?:[.,]\d+)?)/);
  const rateMatch = question.match(/\b(?:rate|exchange rate|taux)\s+(?:of|de|:)?\s*(\d+(?:[.,]\d+)?)/i);
  const currencyPattern = new RegExp(CURRENCY_NAME_PATTERN.source, "gi");
  const currencies = [...question.matchAll(currencyPattern)].map((match) =>
    CURRENCY_ALIASES[match[0].toLowerCase()]
  );
  const uniqueCurrencies = [...new Set(currencies.filter(Boolean))];

  if (uniqueCurrencies.length >= 2) {
    const [from, to] = uniqueCurrencies;
    const explicitPairMatch = question.match(
      /\b1\s+([A-Za-z]{3}|dollars?|euros?|pounds?|yen|bitcoin|ethereum)\s*=\s*(\d+(?:[.,]\d+)?)\s+([A-Za-z]{3}|dollars?|euros?|pounds?|yen|bitcoin|ethereum)\b/i
    );
    const explicitFrom = normalizeCurrencyToken(explicitPairMatch?.[1]);
    const explicitTo = normalizeCurrencyToken(explicitPairMatch?.[3]);
    const explicitRate = explicitPairMatch
      ? Number(explicitPairMatch[2]!.replace(",", "."))
      : null;
    const normalizedRate =
      explicitRate !== null && Number.isFinite(explicitRate) && explicitFrom && explicitTo
        ? explicitFrom === from && explicitTo === to
          ? explicitRate
          : explicitFrom === to && explicitTo === from
            ? 1 / explicitRate
            : null
        : null;

    return {
      amount: amountMatch ? Number(amountMatch[1]!.replace(",", ".")) : null,
      from: from!,
      to: to!,
      rate: normalizedRate ?? (rateMatch ? Number(rateMatch[1]!.replace(",", ".")) : null),
      language: detectQuestionLanguage(question)
    };
  }

  return null;
}

function extractArithmeticExpression(question: string) {
  const normalizedQuestion = question.replace(/[?!。！？]+$/g, "").trim();
  const match = normalizedQuestion.match(/([-+/*().%\d\s]+)$/);
  const expression = normalizeSpace(match?.[1] ?? "").replace(/[.]+$/g, "").trim();
  return expression && /[+\-*/%]/.test(expression) ? expression : null;
}

function extractUnitConversionArgs(question: string) {
  const match = question.match(
    /(\d+(?:[.,]\d+)?)\s*(km|kilometers?|miles?|kg|kilograms?|lb|lbs|pounds?|celsius|fahrenheit|meters?|feet|ft|hours?|minutes?|seconds?)\s+(?:to|in)\s+(km|kilometers?|miles?|kg|kilograms?|lb|lbs|pounds?|celsius|fahrenheit|meters?|feet|ft|hours?|minutes?|seconds?)/i
  );

  if (!match) {
    return null;
  }

  return {
    value: Number(match[1]!.replace(",", ".")),
    fromUnit: match[2]!,
    toUnit: match[3]!
  };
}

function extractEntitySubject(question: string) {
  const stripped = normalizeSpace(
    question
      .replace(/[?]/g, " ")
      .replace(/\b(?:who is|what is|what are|show me|find|lookup|look up|tell me|give me|make me|explain|define|definition|qui est|quel est|quelle est|quels sont|quelles sont|qu'est[- ]ce que|quest ce que|c'est quoi|c est quoi|ce qu'est|explique|definis|d(?:e|\u00e9)finis|d(?:e|\u00e9)finition|fai[st](?:-|\s)?moi|donne(?:-|\s)?moi|raconte(?:-|\s)?moi|prepare(?:-|\s)?moi|pr(?:e|\u00e9)pare(?:-|\s)?moi)\b/gi, " ")
      .replace(/\b(?:simply|simplement)\b/gi, " ")
      .replace(/\b(?:complete|compl(?:e|\u00e8)te|complet|presentation|pr(?:e|\u00e9)sentation|expose|expos(?:e|\u00e9)|diaporama|slides?)\b/gi, " ")
      .replace(/\b(?:current|currently|actuel|actuelle|latest|official|github|repository|repo|website|site|ceo|president|pr(?:e|\u00e9)sident|version|release|announcements?|docs?|documentation)\b/gi, " ")
      .replace(/\b(?:roi|reine|king|queen|empereur|emperor|pape|pope|pour|for|ce|que|de|du|des|d'|of|the|le|la|les|un|une)\b/gi, " ")
  );

  const normalized = rewriteGeneralKnowledgeQuery({
    question,
    subject: stripped,
    language: detectQuestionLanguage(question)
  }).canonicalSubject;
  return normalized.length >= 2 ? normalized : extractQuotedOrTrailingName(question) ?? "";
}

function cleanFactualLookupSubject(question: string) {
  const salientSubject = extractSalientResearchSubject(question);
  if (salientSubject.length >= 2 && salientSubject.length < 100) {
    return salientSubject;
  }

  const cleaned = normalizeSpace(
    extractEntitySubject(question)
      .replace(/\b(?:biographie|biography|histoire|story|known for|connu(?:e)? pour|fact[-\s]?check|verify|verifie|v(?:e|\u00e9)rifie|source|sources|cite|citation|cherche(?:r)? sur internet|recherche web|complete|compl(?:e|\u00e8)te|complet|presentation|pr(?:e|\u00e9)sentation|expose|expos(?:e|\u00e9))\b/gi, " ")
      .replace(/\b(?:sa|son|his|her|their|roi|reine|king|queen|empereur|emperor|pape|pope|de|du|des|d'|of|about|sur)\b/gi, " ")
      .replace(/[?.!,]+$/g, " ")
  );

  const normalized = rewriteGeneralKnowledgeQuery({
    question,
    subject: cleaned,
    language: detectQuestionLanguage(question)
  }).canonicalSubject;
  return normalized.length >= 2 ? normalized : extractQuotedOrTrailingName(question) ?? question;
}

function buildFactCheckArgs(question: string, category: QuestionCategory | null | undefined) {
  const subject = cleanFactualLookupSubject(question);
  const language = detectQuestionLanguage(question);
  const semanticFrame = buildSemanticFrame({
    question,
    category,
    subject,
    language
  });
  return {
    subject,
    query: question,
    language,
    semanticFrame
  };
}

function cleanSubject(value: string) {
  return normalizeSpace(
    value
      .replace(/[?.!,]+$/g, "")
      .replace(/\s+is\s+definitely.*$/i, " ")
      .replace(/\b(?:current|currently|actuel|actuelle|official|officiel|officielle)\b/gi, " ")
      .replace(/^(?:de|du|des|d'|of|the|le|la|les|un|une)\b\s*/gi, " ")
      .replace(/\b(?:de|du|des|d'|of|the|le|la|les|un|une)\b$/gi, " ")
  );
}

function extractCurrentRole(question: string) {
  if (/\b(?:ceo|chief executive officer|directeur g(?:e|\u00e9)n(?:e|\u00e9)ral|directrice g(?:e|\u00e9)n(?:e|\u00e9)rale|dirigeant|dirigeante)\b/i.test(question)) {
    return "CEO";
  }

  if (/\b(?:president|pr(?:e|\u00e9)sident|presidente|pr(?:e|\u00e9)sidente|president of|president de|president du|pr(?:e|\u00e9)sident de|pr(?:e|\u00e9)sident du)\b/i.test(question)) {
    return "president";
  }

  if (/\b(?:version|release)\b/i.test(question)) {
    return "version";
  }

  return null;
}

function extractCurrentStatusArgs(question: string) {
  const role = extractCurrentRole(question);
  const subjectPatterns =
    role === "CEO"
      ? [
          /\b(?:ceo|chief executive officer)\s+(?:current(?:ly)?\s+|actuel(?:le)?\s+)?(?:of|de|du|des|d')\s+([A-Za-z0-9&.' -]{2,80})/i,
          /\b(?:current|currently|actuel(?:le)?)\s+(?:ceo|chief executive officer)\s+(?:of|de|du|des|d')\s+([A-Za-z0-9&.' -]{2,80})/i,
          /\b(?:the\s+)?(?:ceo|chief executive officer)\s+(?:of|de|du|des|d')\s+([A-Za-z0-9&.' -]{2,80}?)(?:\s+is\b|[?.!,]|$)/i
        ]
      : role === "president"
        ? [
            /\b(?:president|pr(?:e|\u00e9)sident|presidente|pr(?:e|\u00e9)sidente)\s+(?:current(?:ly)?\s+|actuel(?:le)?\s+)?(?:of|de|du|des|d')\s+([A-Za-z0-9&.' \u00c0-\u00ff-]{2,80})/i,
            /\b(?:current|currently|actuel(?:le)?)\s+(?:president|pr(?:e|\u00e9)sident|presidente|pr(?:e|\u00e9)sidente)\s+(?:of|de|du|des|d')\s+([A-Za-z0-9&.' \u00c0-\u00ff-]{2,80})/i
          ]
        : [];

  for (const pattern of subjectPatterns) {
    const match = question.match(pattern);
    if (match?.[1]) {
      const subject = cleanSubject(match[1]);
      if (subject.length >= 2) {
        return { subject, role, language: detectQuestionLanguage(question) };
      }
    }
  }

  return {
    subject: extractEntitySubject(question),
    role,
    language: detectQuestionLanguage(question)
  };
}

function hasConcreteFileReference(question: string) {
  return (
    /\b(?:read|open|analy[sz]e|inspect|lis|lire|ouvre|ouvrir)\b.{0,40}\b(?:file|fichier|document|pdf|spreadsheet|csv|json|markdown)\b/i.test(
      question
    ) ||
    /\b(?:this|the|attached|uploaded|joint|fourni|ce|cet|cette)\s+(?:file|fichier|document|pdf|csv|spreadsheet)\b/i.test(
      question
    ) ||
    /\b(?:package\.json|tsconfig(?:\.[A-Za-z0-9_-]+)?\.json|[A-Za-z0-9_.-]+\.(?:json|csv|pdf|md|markdown|txt|docx|xlsx|ts|tsx|js|jsx|py|go|rs|java|cs|yaml|yml))\b/i.test(
      question
    )
  );
}

function isConceptualFileQuestion(question: string) {
  if (hasConcreteFileReference(question)) {
    return false;
  }

  return (
    /\b(?:file|fichier|document|pdf|spreadsheet|csv|json)\b/i.test(question) &&
    /\b(?:comment|how to|explique|explain|structur|concevoir|design|nettoy|clean|format|template|modele|mod(?:e|\u00e8)le|plan)\b/i.test(
      question
    )
  );
}

function hasConcreteRepoTarget(question: string) {
  return (
    /\b(?:github|scan(?:ne)?|inspect|analy[sz]e|scanne|retrouve|find|lookup|look up)\b/i.test(question) &&
    /\b(?:repo|repository|codebase|project folder|depot|d(?:e|\u00e9)p(?:o|\u00f4)t|github)\b/i.test(question)
  );
}

function isConceptualRepoQuestion(question: string) {
  if (/github\.com[/:][A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(question)) {
    return false;
  }

  if (
    /\b(?:explain|explique|comment|how to)\b.{0,80}\b(?:analy[sz]e|inspect|review)\b.{0,80}\b(?:repo|repository|codebase|depot|d(?:e|\u00e9)p(?:o|\u00f4)t)\b/i.test(
      question
    ) ||
    /\b(?:repo|repository|codebase|depot|d(?:e|\u00e9)p(?:o|\u00f4)t)\b.{0,80}\b(?:efficiently|effectively|efficacement|best practices?|approach|method|methode|m(?:e|\u00e9)thode)\b/i.test(
      question
    )
  ) {
    return true;
  }

  if (hasConcreteRepoTarget(question)) {
    return false;
  }

  return (
    /\b(?:repo|repository|codebase|depot|d(?:e|\u00e9)p(?:o|\u00f4)t)\b/i.test(question) &&
    /\b(?:comment|how to|explique|explain|method|methode|m(?:e|\u00e9)thode|efficacement|best practices?|structur|approach)\b/i.test(
      question
    )
  );
}

function isWeatherRequest(question: string, lowered: string) {
  if (/\b(?:temps reel|temps r(?:e|\u00e9)el|real[-\s]?time)\b/i.test(lowered)) {
    return false;
  }

  if (isConceptualWeatherQuestion(question)) {
    return false;
  }

  if (EXPLICIT_WEATHER_PATTERN.test(lowered)) {
    return true;
  }

  if (!/\btemps\b/i.test(lowered)) {
    return false;
  }

  return (
    /\b(?:quel temps|temps fait-il|temps fait il|fait-il|fait il)\b/i.test(lowered) ||
    (/\b(?:aujourd'hui|aujourdhui|aujourd hui|demain|today|tomorrow|tonight|maintenant|now|actuel|actuelle)\b/i.test(
      lowered
    ) &&
      Boolean(extractLocation(question)))
  );
}

function isConceptualWeatherQuestion(question: string) {
  const normalized = normalizeSpace(question.toLowerCase());
  if (containsTemporalFreshCue(normalized)) {
    return false;
  }

  return (
    /\b(?:explain|explique|how|comment|what is|what are|produced|produites?|work|fonctionne|conditions)\b/i.test(
      normalized
    ) &&
    /\b(?:weather|forecast|forecasts|meteo|temperature|humidity|humidit(?:e|\u00e9)|conditions?)\b/i.test(
      normalized
    )
  );
}

function isStableWritingOrBrainstormingTask(question: string) {
  if (!WRITING_OR_BRAINSTORM_PATTERN.test(question)) {
    return false;
  }

  return !/\b(?:current weather|weather today|latest release|current price|stock price|live score|current ceo|current president|meteo actuelle|prix actuel|score en direct)\b/i.test(
    question
  );
}

function isConceptualCurrentStatusQuestion(question: string) {
  return (
    /\b(?:current|status|version|actuel|actuelle)\b/i.test(question) &&
    /\b(?:context|approach|architecture|design|implementation|state management|status update|project update|update hebdomadaire|point hebdomadaire|projet|benchmark|benchmarks|production|fail|failure|company role|does in a company|compare|comparaison|sans prix|without current price)\b/i.test(
      question
    ) &&
    (!/\b(?:ceo|president|prime minister|governor|release|latest|prix|price|weather|meteo)\b/i.test(question) ||
      /\b(?:sans prix|without current price)\b/i.test(question))
  );
}

function isConceptualRoleQuestion(question: string) {
  return (
    /\b(?:explain|explique|what does|what is|role|responsibilities|does in a company|metier|m(?:e|\u00e9)tier)\b/i.test(
      question
    ) &&
    /\b(?:ceo|chief executive officer|president|pr(?:e|\u00e9)sident)\b/i.test(question) &&
    !/\b(?:who is|qui est|current|currently|actuel|actuelle|right now|now|today)\b/i.test(question)
  );
}

function isInternalPlanningDeadlineContext(question: string, category: QuestionCategory | null | undefined) {
  if (!isConversationPlanningCategory(category)) {
    return false;
  }

  const hasDeadline =
    /\b(?:today|tonight|tomorrow|this week|this month|in two weeks|within two weeks|before friday|by friday|aujourd'hui|aujourdhui|ce soir|demain|cette semaine|ce mois|dans deux semaines)\b/i.test(
      question
    );
  if (!hasDeadline) {
    return false;
  }

  const hasInternalActorOrDecision =
    /\b(?:leadership|sponsor|manager|ceo|cfo|legal|team|stakeholder|stakeholders|client|support|direction|juridique|equipe|parties prenantes)\b/i.test(
      question
    ) ||
    /\b(?:wants|threatens|asks|says|refuses|pushes|visible answer|decide|decision|choose|recommend|demande|menace|refuse|pousse|decider|decision|choisir|trancher)\b/i.test(
      question
    );
  const asksExternalFact =
    /\b(?:who is|qui est|what is the current|current ceo|latest|recent updates|news|lookup|look up|find on|cherche sur)\b/i.test(
      question
    );

  return hasInternalActorOrDecision && !asksExternalFact;
}

function isStakeholderRoleContext(question: string, category: QuestionCategory | null | undefined) {
  return (
    isConversationPlanningCategory(category) &&
    /\b(?:the\s+)?(?:ceo|cfo|legal|leadership|sponsor|manager|stakeholder|stakeholders|juridique|direction)\b/i.test(
      question
    ) &&
    /\b(?:threatens|wants|asks|says|refuses|pushes|bypass|decide|decision|demande|menace|refuse|pousse|court-circuite|decider|trancher)\b/i.test(
      question
    ) &&
    !/\b(?:who is|qui est|current ceo|ceo of|ceo de|latest|lookup|look up)\b/i.test(question)
  );
}

function isConversationRecentDetailContext(question: string, category: QuestionCategory | null | undefined) {
  if (!isConversationPlanningCategory(category)) {
    return false;
  }

  const hasConversationRecallCue =
    /\b(?:recent detail|recent signal|latest signal|only reliable recent number|detail recent|d(?:e|\u00e9)tail r(?:e|\u00e9)cent|d(?:e|\u00e9)tail r(?:e|\u00e9)cent a ne pas perdre|signal r(?:e|\u00e9)cent|dernier signal|chiffre r(?:e|\u00e9)cent|seul chiffre r(?:e|\u00e9)cent fiable)\b/i.test(
      question
    );
  const asksForConversationDecision =
    /\b(?:final decision|decision finale|d(?:e|\u00e9)cision finale|recall|rappelle|recommend|recommande|choose|choisis|commit|tranche|active hypothesis|hypothese active|hypoth(?:e|\u00e8)se active|strong constraint|contrainte forte)\b/i.test(
      question
    );
  const isLabeledConversationState =
    /\b(?:durable constraint|contrainte durable|recent detail\s*:|detail recent\s*:|d(?:e|\u00e9)tail r(?:e|\u00e9)cent\s*:|d(?:e|\u00e9)tail r(?:e|\u00e9)cent a ne pas perdre|recent signal(?:\s+is)?\s*:|signal r(?:e|\u00e9)cent(?:\s+est)?\s*:|the only reliable recent number is|only reliable recent number|le seul chiffre r(?:e|\u00e9)cent fiable est|seul chiffre r(?:e|\u00e9)cent fiable|active hypothesis|hypothese active|hypoth(?:e|\u00e8)se active)/i.test(
      question
    );
  const asksExternalLookup =
    /\b(?:news|headlines?|recent updates about|search|look up|find online|web|online|external source|actualit(?:e|\u00e9)s|cherche|recherche|en ligne|source externe)\b/i.test(
      question
    );

  return hasConversationRecallCue && (asksForConversationDecision || isLabeledConversationState) && !asksExternalLookup;
}

function isSnapshotBoundaryConversationContext(question: string, category: QuestionCategory | null | undefined) {
  if (!isConversationPlanningCategory(category)) {
    return false;
  }

  const namesSnapshot =
    /\b(?:provided snapshot|snapshot provided|snapshot fourni|extrait de logs|histogramme de jobs|trace locale|friday tax matrix|matrice fiscale)\b/i.test(
      question
    );
  const deniesLiveOrExtraAccess =
    /\b(?:not live access|pas un acc(?:e|\u00e8)s live|do not assume another file|do not assume another webpage|ne suppose pas d'autre fichier|ne suppose pas d autre fichier|no live access|sans acc(?:e|\u00e8)s live)\b/i.test(
      question
    );

  return namesSnapshot && deniesLiveOrExtraAccess;
}

function isToolBoundaryStakeholderContext(question: string, category: QuestionCategory | null | undefined) {
  return (
    isConversationPlanningCategory(category) &&
    /\b(?:colleague|coll(?:e|\u00e8)gue|stakeholder|manager)\b/i.test(question) &&
    /\b(?:asks?|demande|propose|suggests?)\b/i.test(question) &&
    /\b(?:search|look up|current numbers|chiffres actuels|online|en ligne|web)\b/i.test(question) &&
    /\b(?:before deciding|avant de d(?:e|\u00e9)cider|pour d(?:e|\u00e9)cider)\b/i.test(question)
  );
}

function isRepoContextOnly(question: string) {
  return (
    (/\brepo(?:sitory)? access\b/i.test(question) ||
      /\b(?:failing|failed)\s+(?:repo|repository)\s+tests?\b/i.test(question) ||
      /\b(?:repo|repository)\s+tests?\b/i.test(question)) &&
    !/\b(?:scan(?:ne)?|inspect|analy[sz]e|find|lookup|look up|retourne|retrouve|read|open)\b/i.test(question)
  );
}

function isExplicitlyMissingResourceRequest(question: string) {
  return /(?:forgot to give you access|private repo|repo priv|not provided|pas fourni|n'ai pas fourni|no access|sans acces|sans acc(?:e|\u00e8)s)/i.test(
    question
  );
}

function isPrivateDataRequest(question: string) {
  return (
    /\b(?:show me all|list all|read the uploaded|uploaded csv|invoices?|returns by product|store location|stock level|product category|open status|email open rates?|all mentions)\b/i.test(
      question
    ) ||
    /\b(?:generate|create|produce|request)\s+(?:a |an )?report\b/i.test(question) ||
    /\b(?:find|export)\b.{0,80}\b(?:last year|past year|previous year|as a csv|csv)\b/i.test(question)
  );
}

function isMissingLocationLocalSearchRequest(question: string) {
  return (
    /\b(?:restaurant|restaurants|cafe|cafes|bar|bars|store|stores|nearby|near me|near my current location|current location)\b/i.test(
      question
    ) &&
    /\b(?:near me|near my current location|my current location|current location)\b/i.test(question) &&
    !/\b(?:in|near|around)\s+[A-Z][A-Za-z.' -]{2,60}\b/.test(question.replace(/\bcurrent location\b/gi, ""))
  );
}

function isInventoryStockQuestion(question: string) {
  return /\bstock\s+(?:level|levels|quantity|quantities|below|under|over|above)\b/i.test(question);
}

function isExactFutureMarketPrediction(question: string) {
  return (
    /\b(?:tomorrow|demain|next close|market close|sera|will)\b/i.test(question) &&
    /\b(?:exact|exacte?|price|prix|stock|bitcoin|btc|tesla|crypto)\b/i.test(question)
  );
}

function isBroadFutureMarketForecast(question: string) {
  return (
    /\b(?:next month|next week|next quarter|tomorrow|future|forecast|prediction|predict|trends?|tendances?)\b/i.test(
      question
    ) &&
    /\b(?:stock market|market trends?|market|stocks?|nasdaq|nyse|crypto market)\b/i.test(question) &&
    !extractAsset(question)
  );
}

function isSportsRequest(question: string) {
  return (
    (SPORTS_CONTEXT_PATTERN.test(question) && SPORTS_PATTERN.test(question)) ||
    /\b(?:live score|score of|score for|final score|standings|league table|resultat du match|r(?:e|\u00e9)sultat du match|classement)\b/i.test(
      question
    )
  );
}

function isStatusPageQuestion(question: string) {
  return /\b(?:status page|reporting\s+(?:an?\s+)?incidents?|incidents? right now|status right now|service status|live status source)\b/i.test(
    question
  );
}

function isIdentityOrBiographyLookup(question: string) {
  return /\b(?:who is|who was|who was|c[' ]?est qui|qui est|qui etait|qui (?:e|\u00e9)tait|biographie|biography|sa biographie|son histoire|his biography|her biography|known for|connu(?:e)? pour)\b/i.test(
    question
  ) || /\b(?:roi|reine|king|queen|empereur|emperor|pape|pope)\b/i.test(
    question
  );
}

function isConceptOnlyExplanation(question: string) {
  return (
    /\b(?:what is|what are|qu'est-ce que|quest ce que|c'est quoi|c est quoi|explique|explain|definition|define)\b/i.test(
      question
    ) &&
    !isIdentityOrBiographyLookup(question) &&
    !EXPLICIT_FACTUAL_RESEARCH_PATTERN.test(question)
  );
}

function isSourceBackedConceptLookup(question: string) {
  if (!isConceptOnlyExplanation(question)) {
    return false;
  }

  const termCount = question.match(/[A-Za-z0-9\u00c0-\u00ff]{2,}/g)?.length ?? 0;
  const asksShortDefinition =
    /\b(?:what is|what are|qu'est-ce que|quest ce que|c'est quoi|c est quoi|define|definition|explique simplement|explain simply)\b/i.test(
      question
    );
  const asksScenarioExplanation =
    /\b(?:dans|in|with|using|architecture|systemes|syst(?:e|\u00e8)mes|systems|example|exemple|practical|pratique|tradeoff|debug|diagnostic)\b/i.test(
      question
    );

  return asksShortDefinition && termCount <= 10 && !asksScenarioExplanation;
}

function shouldUseGeneralFactResearch(question: string, category: QuestionCategory | null | undefined) {
  const explicitlyRequestsSources = EXPLICIT_FACTUAL_RESEARCH_PATTERN.test(question);
  if (isConversationPlanningCategory(category) && !explicitlyRequestsSources) {
    return false;
  }
  if (WRITING_OR_BRAINSTORM_PATTERN.test(question)) {
    return false;
  }
  return (
    isIdentityOrBiographyLookup(question) ||
    isSourceBackedConceptLookup(question) ||
    explicitlyRequestsSources
  );
}

function forbidsExternalTools(question: string) {
  return /\b(?:sans acc(?:e|\u00e8)s internet|sans internet|sans outil|without internet|without web|no internet|web is down|tool web est down|outil web est down)\b/i.test(
    question
  );
}

function isUnverifiableInternalReleaseQuestion(question: string) {
  return /\b(?:unreleased internal|closed-source product|produit interne non publi(?:e|\u00e9)|version interne non publi(?:e|\u00e9)e)\b/i.test(
    question
  );
}

function isAmbiguousRepoReference(question: string) {
  return (
    /\b(?:machin|truc|thing|stuff|celui|that one)\b/i.test(question) &&
    /\b(?:repo|repository|github)\b/i.test(question) &&
    !/github\.com[/:][A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(question)
  );
}

function hasConcreteRepoName(question: string) {
  const stopWords = new Set(["github", "puis", "then", "avec", "sans", "repo", "repository"]);
  const githubName = question.match(/\bgithub\s+([A-Za-z0-9_.-]{3,})\b/i)?.[1]?.toLowerCase();
  if (githubName && !stopWords.has(githubName)) {
    return true;
  }
  for (const match of question.matchAll(/\b(?:repo|repository|github)\s+([A-Za-z0-9_.-]{3,})\b/gi)) {
    const candidate = match[1]?.toLowerCase();
    if (candidate && !stopWords.has(candidate)) {
      return true;
    }
  }
  return false;
}

export class ToolRoutingService {
  route(args: { question: string; category?: QuestionCategory | null }): ToolRoutingDecision {
    const question = normalizeSpace(args.question);
    if (!question) {
      return defaultRouting();
    }

    const lowered = question.toLowerCase();
    const temporalProfile = detectTemporalQuery(question);
    const temporalCue = temporalProfile.isTemporal || containsTemporalFreshCue(lowered);

    if (CONVERSATION_RECALL_PATTERN.test(question)) {
      return defaultRouting(
        "The request asks for information already supplied in the active conversation; use conversation memory instead of external research."
      );
    }

    if (EXECUTION_PATTERN.test(lowered)) {
      return buildDecision({
        toolRequired: true,
        toolType: "repo",
        intent: "run_tests",
        confidence: 0.97,
        fallbackAllowed: false,
        reason: "Running tests or code execution requires a repo-aware execution tool; do not improvise the outcome.",
        extractedArgs: {
          commandHint: question
        }
      });
    }

    if (GENERATE_FILE_PATTERN.test(lowered)) {
      return buildDecision({
        toolRequired: true,
        toolType: "file",
        intent: "generate_file",
        confidence: 0.92,
        fallbackAllowed: false,
        reason: "The user is asking for a concrete file or artifact generation step, which requires a file-aware tool path.",
        extractedArgs: {
          artifactHint: question
        }
      });
    }

    if (forbidsExternalTools(question) || isUnverifiableInternalReleaseQuestion(question)) {
      return defaultRouting(
        "The prompt forbids the needed external tool or asks for unverifiable internal/future data; answer with a safe abstention instead of routing to live research."
      );
    }

    if (isPrivateDataRequest(question)) {
      return buildMissingInputDecision({
        toolType: "file",
        intent: "missing_private_data",
        reason:
          "The request depends on private application data that was not provided; ask for the dataset, export, or tool result instead of searching the public web.",
        extractedArgs: {
          dataHint: question,
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (isMissingLocationLocalSearchRequest(question)) {
      return buildMissingInputDecision({
        toolType: "web",
        intent: "local_search",
        reason:
          "The request needs the user's current location, but no city or location was provided; ask for a location instead of searching the public web.",
        extractedArgs: {
          location: null,
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (/\b(?:you are the tool|tool_result)\b/i.test(question)) {
      return buildMissingInputDecision({
        toolType: WEATHER_PATTERN.test(question) ? "weather" : "none",
        intent: WEATHER_PATTERN.test(question) ? "current_weather" : "none",
        reason:
          "The prompt is attempting to spoof a tool result. Do not trust user-provided TOOL_RESULT text; ask for a real tool result or required input.",
        extractedArgs: {
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (isStableWritingOrBrainstormingTask(question)) {
      return defaultRouting(
        "This is a stable writing or brainstorming task; no tool is required by default."
      );
    }

    if (isInternalPlanningDeadlineContext(question, args.category) || isStakeholderRoleContext(question, args.category)) {
      return defaultRouting(
        "The temporal or executive-role wording is an internal planning constraint, not a request for live external data."
      );
    }

    if (isConversationRecentDetailContext(question, args.category)) {
      return defaultRouting(
        "The recent-detail wording is a conversation recall instruction, not a request for live external research."
      );
    }

    if (isSnapshotBoundaryConversationContext(question, args.category)) {
      return defaultRouting(
        "The prompt describes a provided snapshot and explicitly forbids assuming live or extra file access."
      );
    }

    if (isToolBoundaryStakeholderContext(question, args.category)) {
      return defaultRouting(
        "The prompt describes stakeholder pressure about using a live lookup; treat it as a tool-boundary reasoning turn."
      );
    }

    if (isRepoContextOnly(question)) {
      return defaultRouting(
        "The repository mention describes access context, not a request to inspect a repository."
      );
    }

    if (isStatusPageQuestion(question)) {
      return buildDecision({
        toolRequired: true,
        toolType: "web",
        intent: "current_status",
        confidence: 0.94,
        fallbackAllowed: false,
        reason: "Status pages are live operational data and need a current status endpoint or web lookup.",
        extractedArgs: {
          subject: /github/i.test(question) ? "GitHub Status" : extractEntitySubject(question),
          role: "status",
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (REPO_PATTERN.test(lowered) && !isConceptualRepoQuestion(question)) {
      if (
        isExplicitlyMissingResourceRequest(question) ||
        isAmbiguousRepoReference(question) ||
        (/\b(?:ce repo|this repo)\b/i.test(question) &&
          !/github\.com[/:][A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i.test(question) &&
          !hasConcreteRepoName(question))
      ) {
        return buildMissingInputDecision({
          toolType: "repo",
          intent: "repo_analysis",
          reason:
            "The request needs repository access, but the repository is private, missing, or not provided; ask for access or pasted context.",
          extractedArgs: {
            repo: extractQuotedOrTrailingName(question) ?? extractEntitySubject(question),
            language: detectQuestionLanguage(question)
          }
        });
      }

      const repoHint = extractQuotedOrTrailingName(question) ?? extractEntitySubject(question);
      const intent =
        /\bscan(?:ne)?\b|\banaly[sz]e\b|\binspect\b/.test(lowered)
          ? "repo_analysis"
          : "github_repo_lookup";

      return buildDecision({
        toolRequired: true,
        toolType: "repo",
        intent,
        confidence: 0.95,
        fallbackAllowed: false,
        reason:
          intent === "repo_analysis"
            ? "The request needs direct repository inspection rather than a free-form answer."
            : "The request needs a concrete GitHub repository lookup instead of a guessed link.",
        extractedArgs: repoHint ? { repo: repoHint } : {}
      });
    }

    if (FILE_PATTERN.test(lowered) && !isConceptualFileQuestion(question)) {
      if (isExplicitlyMissingResourceRequest(question)) {
        return buildMissingInputDecision({
          toolType: "file",
          intent: "file_analysis",
          reason:
            "The request needs a file/document, but no accessible file content is available; ask the user to provide the file or relevant excerpt.",
          extractedArgs: {
            fileHint: extractQuotedOrTrailingName(question) ?? question,
            language: detectQuestionLanguage(question)
          }
        });
      }

      return buildDecision({
        toolRequired: true,
        toolType: "file",
        intent: "file_analysis",
        confidence: 0.94,
        fallbackAllowed: false,
        reason: "The request depends on reading or analyzing a file/document directly.",
        extractedArgs: {
          fileHint: extractQuotedOrTrailingName(question) ?? question
        }
      });
    }

    if (TIME_PATTERN.test(lowered)) {
      return buildDecision({
        toolRequired: true,
        toolType: "time",
        intent: /\bdate\b|\btoday\b/.test(lowered) ? "current_date" : "current_time",
        confidence: 0.94,
        fallbackAllowed: false,
        reason: "Current time/date answers are live and should come from a time-aware tool path.",
        extractedArgs: {
          location: extractLocation(question)
        }
      });
    }

    if (WEATHER_PATTERN.test(lowered) && isWeatherRequest(question, lowered)) {
      return buildDecision({
        toolRequired: true,
        toolType: "weather",
        intent: "current_weather",
        confidence: 0.99,
        fallbackAllowed: false,
        reason: "Weather is live data and must come from a tool-backed retrieval path.",
        extractedArgs: {
          location: extractLocation(question),
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (SPORTS_PATTERN.test(lowered) || (SPORTS_CONTEXT_PATTERN.test(lowered) && temporalCue)) {
      if (!isSportsRequest(question)) {
        return defaultRouting(
          "The word score appears outside a sports-result request; no sports tool is required."
        );
      }

      return buildDecision({
        toolRequired: true,
        toolType: "sports",
        intent: /\bstandings\b|\btable\b/.test(lowered) ? "live_standings" : "live_score",
        confidence: 0.95,
        fallbackAllowed: false,
        reason: "Live sports results or standings require a current sports data tool path.",
        extractedArgs: {
          match: extractQuotedOrTrailingName(question) ?? question
        }
      });
    }

    if (isInventoryStockQuestion(question)) {
      return buildMissingInputDecision({
        toolType: "file",
        intent: "missing_private_data",
        reason:
          "This is an inventory data request, not a market-price request; ask for the product dataset or connected inventory tool result.",
        extractedArgs: {
          dataHint: question,
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (isExactFutureMarketPrediction(question)) {
      return defaultRouting(
        "Exact future market prices are unknowable; answer by refusing the prediction rather than using a current-price lookup."
      );
    }

    if (isBroadFutureMarketForecast(question)) {
      return buildMissingInputDecision({
        toolType: "finance",
        intent: "future_market_prediction",
        reason:
          "Broad future market trends are not a reliable current-price lookup; avoid pretending to forecast the market and explain uncertainty instead.",
        extractedArgs: {
          asset: null,
          quoteCurrency: "USD",
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (FINANCE_PATTERN.test(lowered)) {
      return buildDecision({
        toolRequired: true,
        toolType: "finance",
        intent: "current_price",
        confidence: 0.97,
        fallbackAllowed: false,
        reason: "Current market or crypto pricing is live data and must be tool-backed.",
        extractedArgs: {
          asset: extractAsset(question),
          quoteCurrency: "USD",
          language: detectQuestionLanguage(question)
        }
      });
    }

    const currencyArgs = extractCurrencyArgs(question);
    if (currencyArgs) {
      return buildDecision({
        toolRequired: true,
        toolType: "calculator",
        intent: "currency_conversion",
        confidence: 0.95,
        fallbackAllowed: false,
        reason:
          "Currency conversion depends on an exchange-rate tool path or a live finance lookup; do not guess a current rate.",
        extractedArgs: currencyArgs
      });
    }

    const unitConversionArgs = extractUnitConversionArgs(question);
    if (unitConversionArgs) {
      return buildDecision({
        toolRequired: true,
        toolType: "calculator",
        intent: "unit_conversion",
        confidence: 0.93,
        fallbackAllowed: false,
        reason: "Unit conversion should be computed directly instead of improvised in prose.",
        extractedArgs: unitConversionArgs
      });
    }

    const arithmeticExpression = extractArithmeticExpression(question);
    if (ARITHMETIC_PATTERN.test(question) || arithmeticExpression) {
      return buildDecision({
        toolRequired: true,
        toolType: "calculator",
        intent: "arithmetic",
        confidence: 0.9,
        fallbackAllowed: false,
        reason: "Direct arithmetic should use a calculator path rather than a guessed answer.",
        extractedArgs: arithmeticExpression
          ? { expression: arithmeticExpression, language: detectQuestionLanguage(question) }
          : { language: detectQuestionLanguage(question) }
      });
    }

    if (
      CURRENT_STATUS_PATTERN.test(lowered) &&
      temporalCue &&
      !isConceptualCurrentStatusQuestion(question) &&
      !isConceptualRoleQuestion(question)
    ) {
      const currentStatusArgs = extractCurrentStatusArgs(question);
      return buildDecision({
        toolRequired: true,
        toolType: "web",
        intent: /\bversion\b|\brelease\b/.test(lowered) ? "latest_release" : "current_status",
        confidence: 0.91,
        fallbackAllowed: false,
        reason:
          "The request depends on the current external state of an entity, so a live web lookup is required.",
        extractedArgs: currentStatusArgs
      });
    }

    if (
      temporalProfile.queryType === "release_freshness" &&
      !isConceptualCurrentStatusQuestion(question) &&
      !/\b(?:after|apres|apr(?:e|\u00e8)s)\s+(?:a |the |une? |la |le )?new feature\b/i.test(question)
    ) {
      return buildDecision({
        toolRequired: true,
        toolType: "web",
        intent: "latest_release",
        confidence: 0.88,
        fallbackAllowed: false,
        reason: "Latest release/version questions require dated external verification.",
        extractedArgs: {
          subject: extractEntitySubject(question)
        }
      });
    }

    if (
      temporalProfile.queryType === "recent_updates" &&
      RECENT_UPDATES_INTENT_PATTERN.test(question) &&
      !isStableWritingOrBrainstormingTask(question)
    ) {
      return buildDecision({
        toolRequired: true,
        toolType: "research",
        intent: "recent_updates",
        confidence: 0.86,
        fallbackAllowed: false,
        reason: "Recent or this-week updates need a fresh external retrieval path.",
        extractedArgs: {
          subject: extractEntitySubject(question),
          temporalFocus: temporalProfile.focus,
          language: detectQuestionLanguage(question)
        }
      });
    }

    if (shouldUseGeneralFactResearch(question, args.category)) {
      return buildDecision({
        toolRequired: true,
        toolType: "research",
        intent: "fact_check",
        confidence: 0.83,
        fallbackAllowed: false,
        reason:
          "The request asks for a named factual lookup or explicitly requests verification; use source retrieval before synthesis.",
        extractedArgs: buildFactCheckArgs(question, args.category)
      });
    }

    if (DOC_LOOKUP_PATTERN.test(lowered)) {
      return buildDecision({
        toolRecommended: true,
        toolType: "web",
        intent: "documentation_lookup",
        confidence: 0.72,
        fallbackAllowed: true,
        reason: "Official docs or reference wording would improve the answer, but the request is not strictly live."
      });
    }

    if (WEBSITE_LOOKUP_PATTERN.test(lowered)) {
      return buildDecision({
        toolRecommended: true,
        toolType: "web",
        intent: "external_lookup",
        confidence: 0.74,
        fallbackAllowed: true,
        reason: "The request points to an external site or repository lookup that is better answered with a web-aware tool."
      });
    }

    if (WRITING_OR_BRAINSTORM_PATTERN.test(lowered)) {
      return defaultRouting(
        "This is a stable writing or brainstorming task; no tool is required by default."
      );
    }

    return defaultRouting(
      "The request appears stable enough to answer without mandatory tool use."
    );
  }
}

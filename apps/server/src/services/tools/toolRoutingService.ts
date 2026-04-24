import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import { defaultToolRoutingDecision } from "../../types/arena.js";
import { normalizeSpace } from "../research/common.js";
import { detectTemporalQuery } from "../research/temporal.js";

const WRITING_OR_BRAINSTORM_PATTERN =
  /\b(?:write|rewrite|rephrase|reformulate|brainstorm|draft|improve this wording|summari[sz]e|polish|make this clearer)\b/i;
const WEATHER_PATTERN =
  /\b(?:weather|forecast|temperature|rain|snow|wind|humidity|sunny|cloudy|storm|meteo|météo|temps)\b/i;
const SPORTS_PATTERN =
  /\b(?:score|match|game|fixture|standings|league table|playoff|goal|goals)\b/i;
const SPORTS_CONTEXT_PATTERN =
  /\b(?:soccer|football|nba|nfl|mlb|nhl|tennis|f1|formula 1|champions league|premier league|world cup)\b/i;
const FINANCE_PATTERN =
  /\b(?:price|stock|share price|market cap|crypto|cryptocurrency|bitcoin|btc|ethereum|eth|solana|sol|nasdaq|nyse|ticker)\b/i;
const REPO_PATTERN =
  /\b(?:github|repo|repository|codebase|project folder|scan(?:ne)? (?:my )?repo|scan(?:ne)? (?:the )?project|inspect (?:the )?repo)\b/i;
const FILE_PATTERN =
  /\b(?:read (?:this |the )?file|open (?:this |the )?file|analy[sz]e (?:this |the )?(?:file|document|pdf|markdown)|document|pdf|spreadsheet|csv|json file)\b/i;
const EXECUTION_PATTERN =
  /\b(?:run|launch|execute)\s+(?:the )?(?:tests?|test suite|npm test|pnpm test|pytest|vitest|jest)\b/i;
const GENERATE_FILE_PATTERN =
  /\b(?:generate|create|produce|write)\s+(?:a |an )?(?:file|artifact|report|json|markdown|readme)\b/i;
const CURRENT_STATUS_PATTERN =
  /\b(?:current|currently|as of|right now|ceo|president|prime minister|governor|chair|founder|owner|status|version)\b/i;
const DOC_LOOKUP_PATTERN =
  /\b(?:official docs?|documentation|reference|api docs?|rfc|spec|specification|what does .* say|according to)\b/i;
const WEBSITE_LOOKUP_PATTERN =
  /\b(?:website|site|company|company page|product page|find .* on github|find .* repo)\b/i;
const CURRENCY_NAME_PATTERN =
  /\b(?:usd|eur|gbp|cad|aud|jpy|chf|sek|nok|dkk|pln|inr|cny|rmb|btc|eth|bitcoin|ethereum|dollar(?:s)?|euro(?:s)?|pound(?:s)?|yen)\b/i;
const TIME_PATTERN =
  /\b(?:what time is it|current time|time now|date today|today'?s date|heure actuelle|quelle heure est-il)\b/i;
const ARITHMETIC_PATTERN =
  /\b(?:calculate|compute|what is|combien font)\b[\s:]+[-+/*().%\d\s]+$/i;

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

function containsTemporalFreshCue(value: string) {
  return /\b(?:today|tonight|now|current|currently|latest|newest|recent|recently|this week|this month|as of|right now)\b/i.test(
    value
  );
}

function extractLocation(question: string) {
  const patterns = [
    /(?:in|at|for|à)\s+([A-Za-zÀ-ÿ0-9.' -]{2,60})/i,
    /(?:weather|forecast|temperature)\s+(?:for|in|à)\s+([A-Za-zÀ-ÿ0-9.' -]{2,60})/i
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) {
      return normalizeSpace(match[1].replace(/[?.!,]+$/, ""));
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
    { pattern: /\bsolana\b|\bsol\b/i, value: "SOL" }
  ];

  for (const entry of knownAssets) {
    if (entry.pattern.test(question)) {
      return entry.value;
    }
  }

  const tickerMatch = question.match(/\b([A-Z]{2,6})\b/);
  return tickerMatch?.[1] ?? null;
}

function extractCurrencyArgs(question: string) {
  const amountMatch = question.match(/(\d+(?:[.,]\d+)?)/);
  const currencyPattern = new RegExp(CURRENCY_NAME_PATTERN.source, "gi");
  const currencies = [...question.matchAll(currencyPattern)].map((match) =>
    CURRENCY_ALIASES[match[0].toLowerCase()]
  );
  const uniqueCurrencies = [...new Set(currencies.filter(Boolean))];

  if (uniqueCurrencies.length >= 2) {
    const [from, to] = uniqueCurrencies;
    return {
      amount: amountMatch ? Number(amountMatch[1]!.replace(",", ".")) : null,
      from: from!,
      to: to!
    };
  }

  return null;
}

function extractArithmeticExpression(question: string) {
  const match = question.match(/([-+/*().%\d\s]+)$/);
  const expression = normalizeSpace(match?.[1] ?? "");
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
      .replace(/\b(?:who is|what is|what are|show me|find|lookup|look up|tell me)\b/gi, " ")
      .replace(/\b(?:current|currently|latest|official|github|repository|repo|website|site|ceo|president|version|release|announcements?|docs?|documentation)\b/gi, " ")
  );

  return stripped.length >= 2 ? stripped : extractQuotedOrTrailingName(question);
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

    if (REPO_PATTERN.test(lowered)) {
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

    if (FILE_PATTERN.test(lowered)) {
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

    if (WEATHER_PATTERN.test(lowered)) {
      return buildDecision({
        toolRequired: true,
        toolType: "weather",
        intent: "current_weather",
        confidence: 0.99,
        fallbackAllowed: false,
        reason: "Weather is live data and must come from a tool-backed retrieval path.",
        extractedArgs: {
          location: extractLocation(question)
        }
      });
    }

    if (SPORTS_PATTERN.test(lowered) || (SPORTS_CONTEXT_PATTERN.test(lowered) && temporalCue)) {
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

    if (FINANCE_PATTERN.test(lowered)) {
      return buildDecision({
        toolRequired: true,
        toolType: "finance",
        intent: "current_price",
        confidence: 0.97,
        fallbackAllowed: false,
        reason: "Current market or crypto pricing is live data and must be tool-backed.",
        extractedArgs: {
          asset: extractAsset(question)
        }
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
        extractedArgs: arithmeticExpression ? { expression: arithmeticExpression } : {}
      });
    }

    if (CURRENT_STATUS_PATTERN.test(lowered) && temporalCue) {
      return buildDecision({
        toolRequired: true,
        toolType: "web",
        intent: /\bversion\b|\brelease\b/.test(lowered) ? "latest_release" : "current_status",
        confidence: 0.91,
        fallbackAllowed: false,
        reason:
          "The request depends on the current external state of an entity, so a live web lookup is required.",
        extractedArgs: {
          subject: extractEntitySubject(question)
        }
      });
    }

    if (temporalProfile.queryType === "release_freshness") {
      return buildDecision({
        toolRequired: true,
        toolType: "research",
        intent: "latest_release",
        confidence: 0.88,
        fallbackAllowed: false,
        reason: "Latest release/version questions require dated external verification.",
        extractedArgs: {
          subject: extractEntitySubject(question)
        }
      });
    }

    if (temporalProfile.queryType === "recent_updates") {
      return buildDecision({
        toolRequired: true,
        toolType: "research",
        intent: "recent_updates",
        confidence: 0.86,
        fallbackAllowed: false,
        reason: "Recent or this-week updates need a fresh external retrieval path.",
        extractedArgs: {
          subject: extractEntitySubject(question),
          temporalFocus: temporalProfile.focus
        }
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

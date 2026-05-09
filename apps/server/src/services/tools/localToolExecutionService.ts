import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import type { ResearchToolLog, ToolRoutingDecision } from "../../types/arena.js";
import { projectRoot } from "../../utils/env.js";

export type LocalToolExecutionResult = {
  toolType: ToolRoutingDecision["toolType"];
  intent: string;
  summary: string[];
  verifiedFacts: string[];
  confidenceScore: number;
  resultLabel: string;
  sources?: ResearchToolLog["sources"];
};

type WeatherLanguage = "en" | "fr";

type WeatherLocation = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type WeatherGeocodingResponse = {
  results?: WeatherLocation[];
};

type WeatherForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
  };
};

type CoinGeckoSimplePriceResponse = Record<
  string,
  Record<string, number | undefined> & {
    last_updated_at?: number;
  }
>;

type FrankfurterLatestResponse = {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number | undefined>;
};

type GitHubContentItem = {
  name?: string;
  path?: string;
  type?: "file" | "dir" | "symlink" | "submodule";
};

type GitHubStatusResponse = {
  page?: {
    name?: string;
    url?: string;
  };
  status?: {
    indicator?: string;
    description?: string;
  };
};

type GitHubReleaseResponse = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
};

type NodeReleaseEntry = {
  version?: string;
  date?: string;
  lts?: false | string;
};

type CurrentStatusMatch = {
  label: string;
  fact: string;
  excerpt: string;
  sources: ResearchToolLog["sources"];
};

const CITY_TIMEZONES: Record<string, string> = {
  paris: "Europe/Paris",
  london: "Europe/London",
  berlin: "Europe/Berlin",
  madrid: "Europe/Madrid",
  rome: "Europe/Rome",
  tokyo: "Asia/Tokyo",
  seoul: "Asia/Seoul",
  singapore: "Asia/Singapore",
  sydney: "Australia/Sydney",
  "new york": "America/New_York",
  nyc: "America/New_York",
  chicago: "America/Chicago",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  montreal: "America/Toronto",
  toronto: "America/Toronto",
  utc: "UTC"
};

const UNIT_ALIASES: Record<string, string> = {
  km: "km",
  kilometer: "km",
  kilometers: "km",
  mile: "mi",
  miles: "mi",
  m: "m",
  meter: "m",
  meters: "m",
  ft: "ft",
  feet: "ft",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  c: "c",
  celsius: "c",
  f: "f",
  fahrenheit: "f",
  hour: "h",
  hours: "h",
  minute: "min",
  minutes: "min",
  second: "s",
  seconds: "s"
};

const CRYPTO_ASSETS: Record<string, { id: string; label: string }> = {
  BTC: { id: "bitcoin", label: "Bitcoin" },
  BITCOIN: { id: "bitcoin", label: "Bitcoin" },
  ETH: { id: "ethereum", label: "Ethereum" },
  ETHEREUM: { id: "ethereum", label: "Ethereum" },
  SOL: { id: "solana", label: "Solana" },
  SOLANA: { id: "solana", label: "Solana" }
};

const EQUITY_ASSETS: Record<string, { symbol: string; stooqSymbol: string; label: string }> = {
  NVDA: { symbol: "NVDA", stooqSymbol: "nvda.us", label: "Nvidia" },
  NVIDIA: { symbol: "NVDA", stooqSymbol: "nvda.us", label: "Nvidia" },
  TSLA: { symbol: "TSLA", stooqSymbol: "tsla.us", label: "Tesla" },
  TESLA: { symbol: "TSLA", stooqSymbol: "tsla.us", label: "Tesla" },
  MSFT: { symbol: "MSFT", stooqSymbol: "msft.us", label: "Microsoft" },
  MICROSOFT: { symbol: "MSFT", stooqSymbol: "msft.us", label: "Microsoft" }
};

const WEATHER_CODE_LABELS: Record<number, { en: string; fr: string }> = {
  0: { en: "clear sky", fr: "ciel d\u00e9gag\u00e9" },
  1: { en: "mainly clear", fr: "ciel plutot d\u00e9gag\u00e9" },
  2: { en: "partly cloudy", fr: "partiellement nuageux" },
  3: { en: "overcast", fr: "couvert" },
  45: { en: "fog", fr: "brouillard" },
  48: { en: "depositing rime fog", fr: "brouillard givrant" },
  51: { en: "light drizzle", fr: "bruine faible" },
  53: { en: "moderate drizzle", fr: "bruine mod\u00e9r\u00e9e" },
  55: { en: "dense drizzle", fr: "bruine dense" },
  56: { en: "light freezing drizzle", fr: "bruine vergla\u00e7ante faible" },
  57: { en: "dense freezing drizzle", fr: "bruine vergla\u00e7ante dense" },
  61: { en: "slight rain", fr: "pluie faible" },
  63: { en: "moderate rain", fr: "pluie mod\u00e9r\u00e9e" },
  65: { en: "heavy rain", fr: "forte pluie" },
  66: { en: "light freezing rain", fr: "pluie vergla\u00e7ante faible" },
  67: { en: "heavy freezing rain", fr: "forte pluie vergla\u00e7ante" },
  71: { en: "slight snow fall", fr: "neige faible" },
  73: { en: "moderate snow fall", fr: "neige mod\u00e9r\u00e9e" },
  75: { en: "heavy snow fall", fr: "forte neige" },
  77: { en: "snow grains", fr: "neige en grains" },
  80: { en: "slight rain showers", fr: "averses faibles" },
  81: { en: "moderate rain showers", fr: "averses mod\u00e9r\u00e9es" },
  82: { en: "violent rain showers", fr: "averses violentes" },
  85: { en: "slight snow showers", fr: "averses de neige faibles" },
  86: { en: "heavy snow showers", fr: "fortes averses de neige" },
  95: { en: "thunderstorm", fr: "orage" },
  96: { en: "thunderstorm with slight hail", fr: "orage avec grele faible" },
  99: { en: "thunderstorm with heavy hail", fr: "orage avec forte grele" }
};

function normalizeNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
}

function evaluateArithmetic(expression: string) {
  const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "").trim();
  if (!sanitized || /[A-Za-z]/.test(sanitized)) {
    return null;
  }

  const value = Function(`"use strict"; return (${sanitized});`)();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractLocation(args: ToolRoutingDecision) {
  const location = args.extractedArgs?.location;
  return typeof location === "string" ? location.trim() : null;
}

function extractLanguage(args: ToolRoutingDecision): WeatherLanguage {
  return args.extractedArgs?.language === "fr" ? "fr" : "en";
}

function extractStringArg(args: ToolRoutingDecision, key: string) {
  const value = args.extractedArgs?.[key];
  return typeof value === "string" ? value.trim() : null;
}

function extractWeatherLocation(args: ToolRoutingDecision) {
  const location = extractLocation(args);
  return location && location.length > 0 ? location : null;
}

function formatWeatherNumber(value: number | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Number.isInteger(value) || digits === 0
    ? String(Math.round(value))
    : value.toFixed(digits).replace(/\.?0+$/, "");
}

function formatWeatherDateTime(value: string | undefined, timeZone: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function weatherDescription(code: number | undefined, language: WeatherLanguage) {
  if (typeof code !== "number") {
    return language === "fr" ? "conditions non pr\u00e9cis\u00e9es" : "conditions unavailable";
  }

  return WEATHER_CODE_LABELS[code]?.[language] ?? (language === "fr" ? `code m\u00e9t\u00e9o ${code}` : `weather code ${code}`);
}

function windDirectionLabel(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const labels = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return labels[Math.round(value / 45) % labels.length] ?? null;
}

function formatResolvedLocation(location: WeatherLocation) {
  const parts = [location.name, location.admin1, location.country].filter(
    (part, index, list): part is string =>
      typeof part === "string" && part.length > 0 && list.indexOf(part) === index
  );
  return parts.join(", ");
}

async function fetchWeatherJson<T>(url: URL): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: URL): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,text/plain"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

async function fetchReadableText(url: string): Promise<string | null> {
  return (await fetchText(url)) ?? fetchText(`https://r.jina.ai/http://${url}`);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);

  return values.map((value) => value.trim());
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function sourceTimestamp() {
  return new Date().toISOString();
}

async function geocodeWeatherLocation(location: string): Promise<WeatherLocation | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "fr");
  url.searchParams.set("format", "json");

  const body = await fetchWeatherJson<WeatherGeocodingResponse>(url);
  const match = body?.results?.[0];
  if (
    !match ||
    typeof match.latitude !== "number" ||
    typeof match.longitude !== "number" ||
    !Number.isFinite(match.latitude) ||
    !Number.isFinite(match.longitude)
  ) {
    return null;
  }

  return match;
}

async function fetchCurrentWeather(location: WeatherLocation): Promise<WeatherForecastResponse | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m"
  );
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  return fetchWeatherJson<WeatherForecastResponse>(url);
}

async function tryFetchWeather(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const location = extractWeatherLocation(args);
  if (!location) {
    return null;
  }

  const language = extractLanguage(args);
  const resolved = await geocodeWeatherLocation(location);
  if (!resolved) {
    return null;
  }

  const forecast = await fetchCurrentWeather(resolved);
  const current = forecast?.current;
  if (!current) {
    return null;
  }

  const locationLabel = formatResolvedLocation(resolved);
  const description = weatherDescription(current.weather_code, language);
  const timeLabel = formatWeatherDateTime(current.time, resolved.timezone);
  const temp = formatWeatherNumber(current.temperature_2m);
  const humidity = formatWeatherNumber(current.relative_humidity_2m);
  const precipitation = formatWeatherNumber(current.precipitation, 1);
  const wind = formatWeatherNumber(current.wind_speed_10m);
  const windDirection = windDirectionLabel(current.wind_direction_10m);
  const maxTemp = formatWeatherNumber(forecast.daily?.temperature_2m_max?.[0]);
  const minTemp = formatWeatherNumber(forecast.daily?.temperature_2m_min?.[0]);
  const dailyDescription = weatherDescription(forecast.daily?.weather_code?.[0], language);

  if (!temp) {
    return null;
  }

  const verifiedFacts =
    language === "fr"
      ? [
          `M\u00e9t\u00e9o actuelle pour ${locationLabel}${timeLabel ? ` \u00e0 ${timeLabel}` : ""}: ${description}, temp\u00e9rature ${temp} \u00b0C${wind ? `, vent ${wind} km/h${windDirection ? ` ${windDirection}` : ""}` : ""}${humidity ? `, humidit\u00e9 ${humidity}%` : ""}${precipitation ? `, pr\u00e9cipitation ${precipitation} mm` : ""}.`,
          maxTemp && minTemp
            ? `Pr\u00e9vision du jour pour ${locationLabel}: ${dailyDescription}, maximum ${maxTemp} \u00b0C, minimum ${minTemp} \u00b0C.`
            : null
        ]
      : [
          `Current weather for ${locationLabel}${timeLabel ? ` at ${timeLabel}` : ""}: ${description}, temperature ${temp} deg C${wind ? `, wind ${wind} km/h${windDirection ? ` ${windDirection}` : ""}` : ""}${humidity ? `, humidity ${humidity}%` : ""}${precipitation ? `, precipitation ${precipitation} mm` : ""}.`,
          maxTemp && minTemp
            ? `Today's forecast for ${locationLabel}: ${dailyDescription}, high ${maxTemp} deg C, low ${minTemp} deg C.`
            : null
        ];

  const summary =
    language === "fr"
      ? [`Outil m\u00e9t\u00e9o: ${locationLabel} -> ${description}, ${temp} \u00b0C.`]
      : [`Weather tool result: ${locationLabel} -> ${description}, ${temp} deg C.`];

  return {
    toolType: "weather",
    intent: args.intent,
    summary,
    verifiedFacts: verifiedFacts.filter((fact): fact is string => Boolean(fact)),
    confidenceScore: 0.96,
    resultLabel: `${locationLabel}: ${description}, ${temp} ${language === "fr" ? "\u00b0C" : "deg C"}`
  };
}

function extractCryptoAsset(args: ToolRoutingDecision) {
  const raw = extractStringArg(args, "asset");
  if (!raw) {
    return null;
  }

  return CRYPTO_ASSETS[raw.toUpperCase()] ?? null;
}

function extractEquityAsset(args: ToolRoutingDecision) {
  const raw = extractStringArg(args, "asset");
  if (!raw) {
    return null;
  }

  return EQUITY_ASSETS[raw.toUpperCase()] ?? null;
}

function extractQuoteCurrency(args: ToolRoutingDecision) {
  const raw = extractStringArg(args, "quoteCurrency") ?? "USD";
  return /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : "USD";
}

function formatMarketPrice(value: number, currency: string, language: WeatherLanguage) {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 100 ? 0 : 4
  }).format(value);
}

async function tryFetchCurrentPrice(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const asset = extractCryptoAsset(args);
  if (asset) {
    const quoteCurrency = extractQuoteCurrency(args);
    const quoteKey = quoteCurrency.toLowerCase();
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", asset.id);
    url.searchParams.set("vs_currencies", quoteKey);
    url.searchParams.set("include_last_updated_at", "true");

    const body = await fetchJson<CoinGeckoSimplePriceResponse>(url);
    const price = body?.[asset.id]?.[quoteKey];
    if (typeof price !== "number" || !Number.isFinite(price)) {
      return null;
    }

    const language = extractLanguage(args);
    const formatted = formatMarketPrice(price, quoteCurrency, language);
    const updatedAt = body?.[asset.id]?.last_updated_at;
    const updatedLabel =
      typeof updatedAt === "number" && Number.isFinite(updatedAt)
        ? new Date(updatedAt * 1000).toISOString()
        : sourceTimestamp();
    const symbol = extractStringArg(args, "asset")?.toUpperCase() ?? asset.id.toUpperCase();
    const fact =
      language === "fr"
        ? `Prix actuel de ${asset.label} (${symbol}): ${formatted} selon CoinGecko, verifie a ${updatedLabel}.`
        : `Current ${asset.label} (${symbol}) price: ${formatted} according to CoinGecko, checked at ${updatedLabel}.`;
    const sourceUrl = url.toString();

    return {
      toolType: "finance",
      intent: args.intent,
      summary: [
        language === "fr"
          ? `Outil finance: ${asset.label} (${symbol}) -> ${formatted}.`
          : `Finance tool result: ${asset.label} (${symbol}) -> ${formatted}.`
      ],
      verifiedFacts: [fact],
      confidenceScore: 0.96,
      resultLabel: `${asset.label} (${symbol}) ${formatted}`,
      sources: [
        {
          title: "CoinGecko Simple Price API",
          url: sourceUrl,
          snippet: "CoinGecko simple price endpoint for current crypto asset prices.",
          excerpt: fact,
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: updatedLabel,
          dateSource: "time",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        }
      ]
    };
  }

  return tryFetchEquityPrice(args);
}

async function tryFetchEquityPrice(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const asset = extractEquityAsset(args);
  if (!asset) {
    return null;
  }

  const url = new URL("https://stooq.com/q/l/");
  url.searchParams.set("s", asset.stooqSymbol);
  url.searchParams.set("f", "sd2t2ohlcv");
  url.searchParams.set("h", "");
  url.searchParams.set("e", "csv");

  const csv = await fetchText(url.toString());
  const [, row] = csv?.trim().split(/\r?\n/) ?? [];
  const fields = row ? parseCsvLine(row) : [];
  const close = Number(fields[6]);
  if (!Number.isFinite(close)) {
    return null;
  }

  const language = extractLanguage(args);
  const formatted = formatMarketPrice(close, "USD", language);
  const date = fields[1] && fields[1] !== "N/D" ? fields[1] : sourceTimestamp().slice(0, 10);
  const time = fields[2] && fields[2] !== "N/D" ? fields[2] : null;
  const updatedLabel = time ? `${date} ${time}` : date;
  const fact =
    language === "fr"
      ? `Dernier cours disponible de ${asset.label} (${asset.symbol}): ${formatted} selon Stooq, verifie a ${updatedLabel}.`
      : `Latest available ${asset.label} (${asset.symbol}) quote: ${formatted} according to Stooq, checked at ${updatedLabel}.`;

  return {
    toolType: "finance",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil finance: ${asset.label} (${asset.symbol}) -> ${formatted}.`
        : `Finance tool result: ${asset.label} (${asset.symbol}) -> ${formatted}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.92,
    resultLabel: `${asset.label} (${asset.symbol}) ${formatted}`,
    sources: [
      {
        title: "Stooq quote CSV",
        url: url.toString(),
        snippet: "Stooq quote endpoint for latest available equity prices.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: updatedLabel,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function normalizeCurrentSubject(value: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildOpenAiCeoMatch(text: string, url: string): CurrentStatusMatch | null {
  const cleaned = stripHtml(text);
  const evidence =
    cleaned.match(/(?:(?:CEO|Chief Executive|director ejecutivo)\s+Sam Altman|Sam Altman[^.]{0,120}(?:CEO|Chief Executive|director ejecutivo|CEO of OpenAI)|I remain the CEO of OpenAI)[^.]*\./i)?.[0] ??
    cleaned.match(/(?:CEO|Chief Executive|director ejecutivo)\s+Sam Altman/i)?.[0] ??
    null;

  if (!evidence || !/Sam Altman/i.test(evidence)) {
    return null;
  }

  const fact = "As of the live OpenAI source check, Sam Altman is the CEO of OpenAI.";
  return {
    label: "Sam Altman",
    fact,
    excerpt: evidence,
    sources: [
      {
        title: "OpenAI official source",
        url,
        snippet: "Official OpenAI page containing current leadership wording.",
        excerpt: evidence,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function buildFrancePresidentMatch(text: string, url: string): CurrentStatusMatch | null {
  const cleaned = stripHtml(text);
  const evidence =
    cleaned.match(/Emmanuel Macron[^.]{0,120}(?:President of the French Republic|President)/i)?.[0] ??
    cleaned.match(/President of the French Republic[^.]{0,120}Emmanuel Macron/i)?.[0] ??
    null;

  if (!evidence || !/Emmanuel Macron/i.test(evidence)) {
    return null;
  }

  const fact = "As of the live Elysee source check, Emmanuel Macron is the president of France.";
  return {
    label: "Emmanuel Macron",
    fact,
    excerpt: evidence,
    sources: [
      {
        title: "Elysee official source",
        url,
        snippet: "Official French presidency page containing current president wording.",
        excerpt: evidence,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function buildMicrosoftCeoMatch(text: string, url: string): CurrentStatusMatch | null {
  const cleaned = stripHtml(text);
  const evidence =
    cleaned.match(/Satya Nadella[^.]{0,120}(?:Chairman and CEO|CEO|Chief Executive Officer)/i)?.[0] ??
    cleaned.match(/(?:Chairman and CEO|CEO|Chief Executive Officer)[^.]{0,120}Satya Nadella/i)?.[0] ??
    null;

  if (!evidence || !/Satya Nadella/i.test(evidence)) {
    return null;
  }

  const fact = "As of the live Microsoft source check, Satya Nadella is the CEO of Microsoft.";
  return {
    label: "Satya Nadella",
    fact,
    excerpt: evidence,
    sources: [
      {
        title: "Microsoft official source",
        url,
        snippet: "Official Microsoft page containing current leadership wording.",
        excerpt: evidence,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchGitHubStatus(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const subject = normalizeCurrentSubject(extractStringArg(args, "subject"));
  if (!subject.includes("github")) {
    return null;
  }

  const url = new URL("https://www.githubstatus.com/api/v2/status.json");
  const body = await fetchJson<GitHubStatusResponse>(url);
  const indicator = body?.status?.indicator;
  const description = body?.status?.description;
  if (!indicator || !description) {
    return null;
  }

  const language = extractLanguage(args);
  const fact =
    language === "fr"
      ? `Statut GitHub actuel: ${description} (indicateur ${indicator}) selon l'API GitHub Status.`
      : `Current GitHub status: ${description} (indicator ${indicator}) according to the GitHub Status API.`;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil statut: GitHub -> ${description}.`
        : `Status tool result: GitHub -> ${description}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.96,
    resultLabel: `GitHub status: ${description}`,
    sources: [
      {
        title: body.page?.name ?? "GitHub Status API",
        url: url.toString(),
        snippet: "GitHub Status API current status endpoint.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchCurrentStatus(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const role = normalizeCurrentSubject(extractStringArg(args, "role"));
  const subject = normalizeCurrentSubject(extractStringArg(args, "subject"));
  const language = extractLanguage(args);

  if (role === "status" || subject.includes("status")) {
    const status = await tryFetchGitHubStatus(args);
    if (status) {
      return status;
    }
  }

  let match: CurrentStatusMatch | null = null;
  if (role === "ceo" && subject === "openai") {
    const fallbackUrl = "https://openai.com/our-structure/";
    for (const url of [
      fallbackUrl,
      "https://openai.com/index/leadership-expansion-with-fidji-simo/"
    ]) {
      const text = await fetchReadableText(url);
      if (!text) {
        continue;
      }
      match = buildOpenAiCeoMatch(text, url);
      if (match) {
        break;
      }
    }
  }

  if (role === "president" && (subject === "france" || subject === "french republic")) {
    const fallbackUrl = "https://www.elysee.fr/en/emmanuel-macron";
    for (const url of [
      fallbackUrl,
      "https://www.elysee.fr/en/french-presidency/emmanuel-macron"
    ]) {
      const text = await fetchText(url);
      if (!text) {
        continue;
      }
      match = buildFrancePresidentMatch(text, url);
      if (match) {
        break;
      }
    }
  }

  if (role === "ceo" && subject === "microsoft") {
    const fallbackUrl = "https://news.microsoft.com/exec/satya-nadella/";
    for (const url of [
      fallbackUrl,
      "https://www.microsoft.com/en-us/about/leadership"
    ]) {
      const text = await fetchText(url);
      if (!text) {
        continue;
      }
      match = buildMicrosoftCeoMatch(text, url);
      if (match) {
        break;
      }
    }
  }

  if (!match) {
    return null;
  }

  const fact =
    language === "fr"
      ? role === "ceo" && subject === "openai"
        ? `Selon une source officielle OpenAI, ${match.label} est le CEO d'OpenAI.`
        : role === "ceo" && subject === "microsoft"
          ? `Selon une source officielle Microsoft, ${match.label} est le CEO de Microsoft.`
        : role === "president" && (subject === "france" || subject === "french republic")
          ? `Selon une source officielle de l'Elysee, ${match.label} est le president de la France.`
          : match.fact
      : match.fact;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil web: ${match.label} confirme par une source officielle.`
        : `Web tool result: ${match.label} confirmed by an official source.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.93,
    resultLabel: match.label,
    sources: match.sources
  };
}

function formatTimeInLocation(intent: string, location: string | null) {
  const key = location?.toLowerCase() ?? "utc";
  const timeZone = CITY_TIMEZONES[key] ?? CITY_TIMEZONES.utc;
  const now = new Date();
  const options =
    intent === "current_date"
      ? ({
          timeZone,
          year: "numeric",
          month: "long",
          day: "numeric"
        } as const)
      : ({
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          year: "numeric",
          month: "long",
          day: "numeric"
        } as const);
  const formatted = new Intl.DateTimeFormat("en-US", options).format(now);
  const label = location ? `${formatted} (${location})` : `${formatted} (UTC)`;

  return {
    label,
    fact:
      intent === "current_date"
        ? `Current date: ${label}.`
        : `Current time: ${label}.`
  };
}

function tryConvertUnits(args: ToolRoutingDecision) {
  const value = typeof args.extractedArgs?.value === "number" ? args.extractedArgs.value : null;
  const fromRaw =
    typeof args.extractedArgs?.fromUnit === "string" ? args.extractedArgs.fromUnit : null;
  const toRaw = typeof args.extractedArgs?.toUnit === "string" ? args.extractedArgs.toUnit : null;
  if (value === null || !fromRaw || !toRaw) {
    return null;
  }

  const from = UNIT_ALIASES[fromRaw.toLowerCase()];
  const to = UNIT_ALIASES[toRaw.toLowerCase()];
  if (!from || !to || from === to) {
    return null;
  }

  const conversions: Array<{ from: string; to: string; factor?: number; transform?: (n: number) => number }> = [
    { from: "km", to: "mi", factor: 0.621371 },
    { from: "mi", to: "km", factor: 1.60934 },
    { from: "m", to: "ft", factor: 3.28084 },
    { from: "ft", to: "m", factor: 0.3048 },
    { from: "kg", to: "lb", factor: 2.20462 },
    { from: "lb", to: "kg", factor: 0.453592 },
    { from: "h", to: "min", factor: 60 },
    { from: "min", to: "h", factor: 1 / 60 },
    { from: "min", to: "s", factor: 60 },
    { from: "s", to: "min", factor: 1 / 60 },
    { from: "c", to: "f", transform: (n) => (n * 9) / 5 + 32 },
    { from: "f", to: "c", transform: (n) => ((n - 32) * 5) / 9 }
  ];

  const conversion = conversions.find((entry) => entry.from === from && entry.to === to);
  if (!conversion) {
    return null;
  }

  const result = conversion.transform
    ? conversion.transform(value)
    : value * (conversion.factor ?? 1);
  return `${normalizeNumber(value)} ${from} = ${normalizeNumber(result)} ${to}`;
}

function tryConvertCurrency(args: ToolRoutingDecision): LocalToolExecutionResult | null {
  const amount = typeof args.extractedArgs?.amount === "number" ? args.extractedArgs.amount : null;
  const rate = typeof args.extractedArgs?.rate === "number" ? args.extractedArgs.rate : null;
  const from = extractStringArg(args, "from")?.toUpperCase() ?? null;
  const to = extractStringArg(args, "to")?.toUpperCase() ?? null;
  const language = extractLanguage(args);

  if (
    amount === null ||
    rate === null ||
    !from ||
    !to ||
    from === to ||
    !Number.isFinite(amount) ||
    !Number.isFinite(rate)
  ) {
    return null;
  }

  const result = amount * rate;
  const label = `${normalizeNumber(amount)} ${from} = ${normalizeNumber(result)} ${to}`;
  const fact =
    language === "fr"
      ? `Conversion calculee: ${normalizeNumber(amount)} ${from} * ${normalizeNumber(rate)} = ${normalizeNumber(result)} ${to}.`
      : `Computed conversion: ${normalizeNumber(amount)} ${from} * ${normalizeNumber(rate)} = ${normalizeNumber(result)} ${to}.`;

  return {
    toolType: "calculator",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil calculatrice: ${label} avec un taux ${from}/${to} de ${normalizeNumber(rate)}.`
        : `Calculator result: ${label} at ${from}/${to} rate ${normalizeNumber(rate)}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 1,
    resultLabel: label
  };
}

async function tryFetchExchangeRate(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const from = extractStringArg(args, "from")?.toUpperCase() ?? null;
  const to = extractStringArg(args, "to")?.toUpperCase() ?? null;
  const amount = typeof args.extractedArgs?.amount === "number" ? args.extractedArgs.amount : null;
  const language = extractLanguage(args);

  if (!from || !to || from === to || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return null;
  }

  const url = new URL("https://api.frankfurter.app/latest");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const body = await fetchJson<FrankfurterLatestResponse>(url);
  const rate = body?.rates?.[to];
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    return null;
  }

  const date = body?.date ?? sourceTimestamp().slice(0, 10);
  const rateLabel = `1 ${from} = ${normalizeNumber(rate)} ${to}`;
  const converted = amount !== null && Number.isFinite(amount)
    ? `${normalizeNumber(amount)} ${from} = ${normalizeNumber(amount * rate)} ${to}`
    : null;
  const fact =
    language === "fr"
      ? converted
        ? `Conversion avec le dernier taux Frankfurter disponible (${date}): ${converted}; taux ${rateLabel}.`
        : `Dernier taux Frankfurter disponible (${date}): ${rateLabel}.`
      : converted
        ? `Conversion using the latest available Frankfurter rate (${date}): ${converted}; rate ${rateLabel}.`
        : `Latest available Frankfurter rate (${date}): ${rateLabel}.`;

  return {
    toolType: "calculator",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil taux de change: ${converted ?? rateLabel}.`
        : `Exchange-rate tool result: ${converted ?? rateLabel}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.94,
    resultLabel: converted ?? rateLabel,
    sources: [
      {
        title: "Frankfurter latest exchange rates",
        url: url.toString(),
        snippet: "Frankfurter latest endpoint for European Central Bank exchange rates.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: date,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function extractGitHubRepo(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, "")
  };
}

async function tryFetchGitHubRepoStructure(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const repoHint =
    extractStringArg(args, "repo") ??
    extractStringArg(args, "url") ??
    extractStringArg(args, "repository");
  const repo = extractGitHubRepo(repoHint);
  if (!repo) {
    return tryInspectLocalRepoStructure(args);
  }

  const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents`);
  const body = await fetchJson<GitHubContentItem[]>(url);
  if (!Array.isArray(body) || body.length === 0) {
    return null;
  }

  const dirs = body
    .filter((item) => item.type === "dir" && item.name)
    .map((item) => item.name!)
    .slice(0, 12);
  const files = body
    .filter((item) => item.type === "file" && item.name)
    .map((item) => item.name!)
    .slice(0, 12);
  const label = `${repo.owner}/${repo.repo}`;
  const fact = `GitHub repository ${label} root contains directories: ${dirs.join(", ") || "none listed"}; files: ${files.join(", ") || "none listed"}.`;

  return {
    toolType: "repo",
    intent: args.intent,
    summary: [`Repo tool result: ${label} root structure fetched from GitHub API.`],
    verifiedFacts: [fact],
    confidenceScore: 0.9,
    resultLabel: `${label} root: ${dirs.length} dirs, ${files.length} files`,
    sources: [
      {
        title: `GitHub API contents for ${label}`,
        url: url.toString(),
        snippet: "GitHub repository root contents endpoint.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryInspectLocalRepoStructure(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const repoHint = [
    extractStringArg(args, "repo"),
    extractStringArg(args, "repository"),
    extractStringArg(args, "fileHint")
  ].filter(Boolean).join(" ");

  if (
    repoHint &&
    !/\b(?:hydria|mon repo|my repo|this repo|current repo|learning governance|project)\b/i.test(repoHint)
  ) {
    return null;
  }

  const entries = await readdir(projectRoot, { withFileTypes: true });
  const ignored = new Set(["node_modules", ".git", "outputs"]);
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !ignored.has(entry.name))
    .map((entry) => entry.name)
    .sort()
    .slice(0, 16);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .slice(0, 16);
  const relativeRoot = relative(projectRoot, projectRoot) || ".";
  const fact = `Local repository ${relativeRoot} root contains directories: ${dirs.join(", ") || "none listed"}; files: ${files.join(", ") || "none listed"}.`;

  return {
    toolType: "repo",
    intent: args.intent,
    summary: ["Repo tool result: local project root structure inspected."],
    verifiedFacts: [fact],
    confidenceScore: 0.86,
    resultLabel: `local repo root: ${dirs.length} dirs, ${files.length} files`,
    sources: [
      {
        title: "Local project filesystem",
        url: "https://local.hydria.invalid/project-root",
        snippet: "Local repository root directory listing.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchLatestRelease(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const subject = normalizeCurrentSubject(extractStringArg(args, "subject"));
  if (subject.includes("node")) {
    return tryFetchNodeLatestRelease(args);
  }

  if (subject.includes("react")) {
    return tryFetchReactLatestRelease(args);
  }

  return null;
}

async function tryFetchReactLatestRelease(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const url = new URL("https://api.github.com/repos/facebook/react/releases/latest");
  const body = await fetchJson<GitHubReleaseResponse>(url);
  const tag = body?.tag_name;
  if (!tag) {
    return null;
  }

  const publishedAt = body.published_at ?? sourceTimestamp();
  const releaseUrl = body.html_url ?? "https://github.com/facebook/react/releases";
  const fact = `Latest React GitHub release: ${tag}${body.name ? ` (${body.name})` : ""}, published at ${publishedAt}.`;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [`Release tool result: React -> ${tag}.`],
    verifiedFacts: [fact],
    confidenceScore: 0.94,
    resultLabel: `React ${tag}`,
    sources: [
      {
        title: "React latest GitHub release",
        url: releaseUrl,
        snippet: "GitHub releases/latest endpoint for facebook/react.",
        excerpt: fact,
        publishedAt,
        modifiedAt: null,
        effectiveDate: publishedAt,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchNodeLatestRelease(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const url = new URL("https://nodejs.org/dist/index.json");
  const releases = await fetchJson<NodeReleaseEntry[]>(url);
  if (!Array.isArray(releases) || releases.length === 0) {
    return null;
  }

  const latest = releases.find((entry) => typeof entry.version === "string" && entry.version.length > 0);
  const latestLts = releases.find((entry) => entry.lts);
  if (!latest?.version) {
    return null;
  }

  const publishedAt = latest.date ?? sourceTimestamp().slice(0, 10);
  const ltsDetail =
    latestLts?.version && latestLts.version !== latest.version
      ? ` Latest LTS release: ${latestLts.version}${latestLts.lts ? ` (${latestLts.lts})` : ""}${
          latestLts.date ? `, dated ${latestLts.date}` : ""
        }.`
      : "";
  const fact = `Latest Node.js release listed by nodejs.org: ${latest.version}, dated ${publishedAt}.${ltsDetail}`;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [`Release tool result: Node.js -> ${latest.version}.`],
    verifiedFacts: [fact],
    confidenceScore: 0.94,
    resultLabel: `Node.js ${latest.version}`,
    sources: [
      {
        title: "Node.js release index",
        url: url.toString(),
        snippet: "Official Node.js distribution release index.",
        excerpt: fact,
        publishedAt,
        modifiedAt: null,
        effectiveDate: publishedAt,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

export class LocalToolExecutionService {
  async tryExecute(routing: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
    if (!routing.toolRequired) {
      return null;
    }

    if (routing.toolType === "weather" && routing.intent === "current_weather") {
      return tryFetchWeather(routing);
    }

    if (routing.toolType === "finance" && routing.intent === "current_price") {
      return tryFetchCurrentPrice(routing);
    }

    if (routing.toolType === "web" && routing.intent === "current_status") {
      return tryFetchCurrentStatus(routing);
    }

    if (routing.toolType === "web" && routing.intent === "latest_release") {
      return tryFetchLatestRelease(routing);
    }

    if (routing.toolType === "time" && (routing.intent === "current_time" || routing.intent === "current_date")) {
      const location = extractLocation(routing);
      const { label, fact } = formatTimeInLocation(routing.intent, location);
      return {
        toolType: "time",
        intent: routing.intent,
        summary: [`Time tool result: ${label}`],
        verifiedFacts: [fact],
        confidenceScore: 1,
        resultLabel: label
      };
    }

    if (routing.toolType === "calculator" && routing.intent === "arithmetic") {
      const expression =
        typeof routing.extractedArgs?.expression === "string" ? routing.extractedArgs.expression : "";
      const result = evaluateArithmetic(expression);
      if (result === null) {
        return null;
      }

      const label = `${expression} = ${normalizeNumber(result)}`;
      return {
        toolType: "calculator",
        intent: routing.intent,
        summary: [`Calculator result: ${label}`],
        verifiedFacts: [`Computed result: ${label}.`],
        confidenceScore: 1,
        resultLabel: label
      };
    }

    if (routing.toolType === "calculator" && routing.intent === "unit_conversion") {
      const label = tryConvertUnits(routing);
      if (!label) {
        return null;
      }

      return {
        toolType: "calculator",
        intent: routing.intent,
        summary: [`Unit conversion result: ${label}`],
        verifiedFacts: [`Computed conversion: ${label}.`],
        confidenceScore: 1,
        resultLabel: label
      };
    }

    if (routing.toolType === "calculator" && routing.intent === "currency_conversion") {
      return tryConvertCurrency(routing) ?? await tryFetchExchangeRate(routing);
    }

    if (routing.toolType === "repo" && routing.intent === "repo_analysis") {
      return tryFetchGitHubRepoStructure(routing);
    }

    return null;
  }
}

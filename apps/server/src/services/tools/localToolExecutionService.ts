import type { ToolRoutingDecision } from "../../types/arena.js";

type LocalToolExecutionResult = {
  toolType: ToolRoutingDecision["toolType"];
  intent: string;
  summary: string[];
  verifiedFacts: string[];
  confidenceScore: number;
  resultLabel: string;
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

export class LocalToolExecutionService {
  tryExecute(routing: ToolRoutingDecision): LocalToolExecutionResult | null {
    if (!routing.toolRequired) {
      return null;
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

    return null;
  }
}

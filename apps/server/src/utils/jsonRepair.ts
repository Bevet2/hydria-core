import { jsonrepair } from "jsonrepair";
import { ZodType } from "zod";

export function stripCodeFences(raw: string) {
  return raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function isolateJsonBody(raw: string) {
  const normalized = stripCodeFences(raw);
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return normalized.slice(firstBrace, lastBrace + 1);
  }

  return normalized;
}

export function parseLooseJson(raw: string, label: string) {
  const isolated = isolateJsonBody(raw);

  try {
    return JSON.parse(isolated) as unknown;
  } catch {
    const repaired = jsonrepair(isolated);

    try {
      return JSON.parse(repaired) as unknown;
    } catch (error) {
      throw new Error(`${label} returned invalid JSON after repair: ${String(error)}`);
    }
  }
}

export function parseStructuredOutput<T>(
  raw: string,
  schema: ZodType<T>,
  label: string
) {
  return schema.parse(parseLooseJson(raw, label));
}

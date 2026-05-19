import { env } from "../utils/env.js";

export type ScraplingExtractResult = {
  ok: boolean;
  mode: "fetcher" | "dynamic" | "stealthy";
  status: number;
  url: string;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  elapsedMs: number;
};

export type ScraplingExtractRequest = {
  url: string;
  timeoutMs?: number;
  maxChars?: number;
};

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export class ScraplingFetcherClient {
  constructor(
    private readonly baseUrl = env.SCRAPLING_FETCHER_BASE_URL,
    private readonly enabled = env.SCRAPLING_FETCHER_ENABLED,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  isConfigured() {
    return this.enabled && this.baseUrl.trim().length > 0;
  }

  async extract(args: ScraplingExtractRequest): Promise<ScraplingExtractResult> {
    if (!this.isConfigured()) {
      throw new Error("scrapling_fetcher_not_configured");
    }

    const response = await this.fetcher(joinUrl(this.baseUrl, "/extract"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        url: args.url,
        timeoutMs: args.timeoutMs ?? env.SCRAPLING_FETCHER_TIMEOUT_MS,
        maxChars: args.maxChars ?? env.SCRAPLING_FETCHER_MAX_CHARS
      })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`scrapling_http_${response.status}:${text.slice(0, 240)}`);
    }

    const parsed = JSON.parse(text) as ScraplingExtractResult;
    if (!parsed.ok) {
      throw new Error(`scrapling_extract_failed:${parsed.status}`);
    }
    return parsed;
  }
}

import { env } from "../../utils/env.js";

export type RerankerDocument = {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type RerankerResult = {
  id: string;
  score: number;
  rank: number;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type RerankerRuntimeInput = {
  query: string;
  documents: RerankerDocument[];
  topK?: number;
};

export type RerankerRuntimeOutput = {
  provider: "bge_reranker_runtime";
  model: string;
  results: RerankerResult[];
};

type RerankerRuntimeClientOptions = {
  baseUrl?: string | null;
  apiKey?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function configuredBaseUrl(explicit?: string | null) {
  const value =
    explicit ??
    (env.MODEL_ROUTER_RERANKER_BASE_URL || env.MODEL_ROUTER_EMBEDDING_BASE_URL);
  return value.trim();
}

function parseResults(payload: unknown): RerankerResult[] {
  const record = payload as {
    results?: Array<Partial<RerankerResult>>;
    data?: Array<Partial<RerankerResult>>;
  };
  const rawResults = record.results ?? record.data ?? [];
  return rawResults
    .map((result, index) => ({
      id: String(result.id ?? ""),
      score: Number(result.score ?? 0),
      rank: Number(result.rank ?? index + 1),
      text: typeof result.text === "string" ? result.text : undefined,
      metadata:
        result.metadata && typeof result.metadata === "object"
          ? (result.metadata as Record<string, unknown>)
          : undefined
    }))
    .filter((result) => result.id);
}

export class RerankerRuntimeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RerankerRuntimeClientOptions = {}) {
    this.baseUrl = configuredBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey ?? env.MODEL_ROUTER_RERANKER_API_KEY;
    this.timeoutMs = options.timeoutMs ?? env.MODEL_ROUTER_RERANKER_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured() {
    return this.baseUrl.length > 0;
  }

  async rerank(input: RerankerRuntimeInput): Promise<RerankerRuntimeOutput> {
    if (!this.isConfigured()) {
      throw new Error("BGE reranker runtime is not configured.");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.apiKey.trim()}`;
    }

    const response = await this.fetchImpl(`${normalizeBaseUrl(this.baseUrl)}/rerank`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: input.query,
        documents: input.documents,
        topK: input.topK ?? input.documents.length
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`BGE reranker runtime returned ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as { model?: string };
    const allowedIds = new Set(input.documents.map((document) => document.id));
    const results = parseResults(payload)
      .filter((result) => allowedIds.has(result.id))
      .sort((left, right) => left.rank - right.rank || right.score - left.score)
      .slice(0, input.topK ?? input.documents.length)
      .map((result, index) => ({ ...result, rank: index + 1 }));

    return {
      provider: "bge_reranker_runtime",
      model: payload.model ?? "BAAI/bge-reranker-v2-m3",
      results
    };
  }
}

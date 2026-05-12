import {
  RerankerRuntimeClient,
  type RerankerDocument,
  type RerankerResult
} from "./rerankerRuntimeClient.js";

export type GovernedRerankDocument = RerankerDocument & {
  baseScore?: number;
};

export type GovernedRerankTrace = {
  runtimeConfigured: boolean;
  runtimeUsed: boolean;
  provider: "bge_reranker_runtime" | "lexical_fallback";
  model: string | null;
  fallbackReason: string | null;
};

export type GovernedRerankOutput<T extends GovernedRerankDocument> = {
  documents: T[];
  scores: Array<{ id: string; score: number; source: GovernedRerankTrace["provider"] }>;
  trace: GovernedRerankTrace;
};

type GovernedRerankerOptions = {
  client?: Pick<RerankerRuntimeClient, "isConfigured" | "rerank">;
};

function tokenize(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
    )
  ];
}

function lexicalScore(query: string, document: GovernedRerankDocument) {
  const queryTokens = tokenize(query);
  const text = document.text.toLowerCase();
  const docTokens = new Set(tokenize(document.text));
  const overlap = queryTokens.filter((token) => docTokens.has(token)).length;
  const phraseBoost = queryTokens.reduce(
    (sum, token) => sum + (text.includes(token) ? 0.35 : 0),
    0
  );
  const metadataBoost =
    typeof document.metadata?.priority === "string" && document.metadata.priority === "high"
      ? 0.5
      : 0;
  return Number(((document.baseScore ?? 0) * 0.05 + overlap + phraseBoost + metadataBoost).toFixed(4));
}

function applyRuntimeOrder<T extends GovernedRerankDocument>(
  documents: T[],
  results: RerankerResult[],
  topK: number
) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const ordered: T[] = [];
  const scores: Array<{ id: string; score: number; source: "bge_reranker_runtime" }> = [];

  for (const result of results) {
    const document = byId.get(result.id);
    if (!document) {
      continue;
    }
    ordered.push(document);
    scores.push({
      id: result.id,
      score: result.score,
      source: "bge_reranker_runtime"
    });
  }

  return {
    documents: ordered.slice(0, topK),
    scores: scores.slice(0, topK)
  };
}

export class GovernedRerankerService {
  private readonly client: Pick<RerankerRuntimeClient, "isConfigured" | "rerank">;

  constructor(options: GovernedRerankerOptions = {}) {
    this.client = options.client ?? new RerankerRuntimeClient();
  }

  async rerankDocuments<T extends GovernedRerankDocument>(args: {
    query: string;
    documents: T[];
    topK?: number;
  }): Promise<GovernedRerankOutput<T>> {
    const topK = Math.max(1, Math.min(args.topK ?? args.documents.length, args.documents.length));
    const runtimeConfigured = this.client.isConfigured();

    if (runtimeConfigured && args.documents.length > 0) {
      try {
        const runtime = await this.client.rerank({
          query: args.query,
          documents: args.documents.map(({ baseScore: _baseScore, ...document }) => document),
          topK
        });
        const applied = applyRuntimeOrder(args.documents, runtime.results, topK);
        if (applied.documents.length > 0) {
          return {
            ...applied,
            trace: {
              runtimeConfigured,
              runtimeUsed: true,
              provider: "bge_reranker_runtime",
              model: runtime.model,
              fallbackReason: null
            }
          };
        }
      } catch (error) {
        return this.lexicalFallback(args.query, args.documents, topK, runtimeConfigured, String(error));
      }
    }

    return this.lexicalFallback(
      args.query,
      args.documents,
      topK,
      runtimeConfigured,
      runtimeConfigured ? "runtime_returned_no_ranked_documents" : "runtime_not_configured"
    );
  }

  private lexicalFallback<T extends GovernedRerankDocument>(
    query: string,
    documents: T[],
    topK: number,
    runtimeConfigured: boolean,
    fallbackReason: string
  ): GovernedRerankOutput<T> {
    const ranked = documents
      .map((document) => ({
        document,
        score: lexicalScore(query, document)
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          (right.document.baseScore ?? 0) - (left.document.baseScore ?? 0) ||
          left.document.id.localeCompare(right.document.id)
      )
      .slice(0, topK);

    return {
      documents: ranked.map((entry) => entry.document),
      scores: ranked.map((entry) => ({
        id: entry.document.id,
        score: entry.score,
        source: "lexical_fallback"
      })),
      trace: {
        runtimeConfigured,
        runtimeUsed: false,
        provider: "lexical_fallback",
        model: null,
        fallbackReason
      }
    };
  }
}

import type {
  AppHealth,
  ArenaModels,
  ArenaQualityAnalyticsReport,
  ArenaRound,
  BenchmarkRun,
  BenchmarkRunListItem,
  BenchmarkSummaryResponse,
  LocalModelHealth,
  LocalModelTestResponse,
  PersistenceHealthReport,
  StudentAnswerPreview,
  StudentProgressSummary,
  StudentSession
} from "./apiContracts";

export type * from "./apiContracts";

export const CORE_BENCHMARK_ID = "core-benchmark-v2";
export const TOOL_BENCHMARK_ID = "tool-benchmark-v1";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function runArena(question: string, models: ArenaModels) {
  return request<ArenaRound>("/api/arena/run", {
    method: "POST",
    body: JSON.stringify({ question, models })
  });
}

export async function fetchHistory() {
  return request<{ rounds: ArenaRound[] }>("/api/arena/history");
}

export async function fetchArenaRound(roundId: string) {
  return request<ArenaRound>(`/api/arena/history/${roundId}`);
}

export async function fetchArenaQualityReport() {
  return request<ArenaQualityAnalyticsReport>("/api/arena/quality");
}

export async function fetchAppHealth() {
  return request<AppHealth>("/api/health");
}

export async function fetchPersistenceHealth() {
  return request<PersistenceHealthReport>("/api/health/persistence");
}

export async function fetchLocalHealth() {
  return request<LocalModelHealth>("/api/local-model/health");
}

export async function testLocalModel(prompt: string) {
  return request<LocalModelTestResponse>("/api/local-model/test", {
    method: "POST",
    body: JSON.stringify({ prompt })
  });
}

export async function runStudentSession(question: string) {
  return request<StudentSession>("/api/student/run", {
    method: "POST",
    body: JSON.stringify({ question })
  });
}

export async function answerStudentQuestion(question: string) {
  return request<StudentAnswerPreview>("/api/student/answer", {
    method: "POST",
    body: JSON.stringify({ question })
  });
}

export async function analyzeStudentDraft(previewId: string) {
  return request<StudentSession>("/api/student/analyze", {
    method: "POST",
    body: JSON.stringify({ previewId })
  });
}

export async function fetchStudentSessions() {
  return request<{ sessions: StudentSession[]; summary: StudentProgressSummary }>("/api/student/history");
}

export async function fetchStudentSession(sessionId: string) {
  return request<StudentSession>(`/api/student/history/${sessionId}`);
}

export async function startBenchmarkRun(body?: {
  benchmarkId?: string;
  limit?: number;
  promptIds?: string[];
  models?: Partial<ArenaModels>;
}) {
  return request<BenchmarkRun>("/api/benchmark/run", {
    method: "POST",
    body: JSON.stringify(body ?? {})
  });
}

export async function fetchBenchmarkSummary(runId?: string, benchmarkId?: string) {
  const params = new URLSearchParams();
  if (runId) {
    params.set("runId", runId);
  }
  if (benchmarkId) {
    params.set("benchmarkId", benchmarkId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<BenchmarkSummaryResponse>(`/api/benchmark/summary${query}`);
}

export async function fetchBenchmarkRuns(benchmarkId?: string) {
  const query = benchmarkId ? `?benchmarkId=${encodeURIComponent(benchmarkId)}` : "";
  return request<{ activeRunId: string | null; runs: BenchmarkRunListItem[] }>(
    `/api/benchmark/runs${query}`
  );
}

export async function fetchBenchmarkRun(runId: string) {
  return request<BenchmarkRun>(`/api/benchmark/runs/${runId}`);
}

export const suggestedModels = [
  "qwen/qwen3.6-plus",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.3-codex",
  "openrouter/auto",
  "openrouter/free"
];

import type {
  AppHealth,
  ArenaModels,
  ArenaQualityAnalyticsReport,
  ArenaRound,
  LearningGovernanceState,
  LearningQueueState,
  BenchmarkRun,
  BenchmarkRunListItem,
  BenchmarkSummaryResponse,
  ChatMessageResponse,
  ChatResetResponse,
  ExecutionAuditSummary,
  HydriaCoreAskRequest,
  HydriaCoreAskResponse,
  LocalModelHealth,
  LocalModelTestResponse,
  ModelRuntimeOpsSummary,
  PersistenceHealthReport,
  StudentAnswerPreview,
  StudentProgressSummary,
  StudentSession
} from "./apiContracts";

export type * from "./apiContracts";

export const CORE_BENCHMARK_ID = "core-benchmark-v2";
export const TOOL_BENCHMARK_ID = "tool-benchmark-v1";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const HYDRIA_API_KEY_STORAGE_KEY = "hydria.apiKey";

export function readHydriaApiKey() {
  try {
    return window.localStorage.getItem(HYDRIA_API_KEY_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

async function request<T>(path: string, init?: RequestInit) {
  const apiKey = readHydriaApiKey();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-hydria-api-key": apiKey } : {}),
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

function unwrapCoreData<T>(response: HydriaCoreAskResponse, mode: HydriaCoreAskRequest["mode"]) {
  if (response.data === undefined) {
    throw new Error(`Hydria Core ${mode} response did not include a data payload.`);
  }
  return response.data as T;
}

export function setHydriaApiKey(apiKey: string) {
  window.localStorage.setItem(HYDRIA_API_KEY_STORAGE_KEY, apiKey.trim());
}

export function clearHydriaApiKey() {
  window.localStorage.removeItem(HYDRIA_API_KEY_STORAGE_KEY);
}

export async function runArena(question: string, models: ArenaModels) {
  const response = await askHydriaCore({ mode: "playground", question, models });
  return unwrapCoreData<ArenaRound>(response, "playground");
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

export async function fetchLearningGovernanceState() {
  return request<LearningGovernanceState>("/api/learning/report");
}

export async function fetchLearningQueueState() {
  return request<LearningQueueState>("/api/learning/queue");
}

export async function fetchLocalHealth() {
  return request<LocalModelHealth>("/api/local-model/health");
}

export async function fetchModelRuntimeOps(limit = 500) {
  return request<ModelRuntimeOpsSummary>(`/api/models/ops?limit=${encodeURIComponent(String(limit))}`);
}

export async function fetchExecutionAudit(limit = 100) {
  return request<ExecutionAuditSummary>(`/api/execution/audit?limit=${encodeURIComponent(String(limit))}`);
}

export async function testLocalModel(prompt: string) {
  const response = await askHydriaCore({ mode: "local_model", question: prompt });
  return unwrapCoreData<LocalModelTestResponse>(response, "local_model");
}

export async function sendChatMessage(message: string, sessionId?: string) {
  const response = await askHydriaCore({
    mode: "chat",
    question: message,
    ...(sessionId ? { sessionId } : {})
  });
  return unwrapCoreData<ChatMessageResponse>(response, "chat");
}

export async function resetChatSession(sessionId: string) {
  return request<ChatResetResponse>("/api/chat/reset", {
    method: "POST",
    body: JSON.stringify({ sessionId })
  });
}

export async function askHydriaCore(input: HydriaCoreAskRequest) {
  return request<HydriaCoreAskResponse>("/api/core/ask", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function runStudentSession(question: string) {
  const response = await askHydriaCore({ mode: "student_session", question });
  return unwrapCoreData<StudentSession>(response, "student_session");
}

export async function answerStudentQuestion(question: string) {
  const response = await askHydriaCore({ mode: "student_preview", question });
  return unwrapCoreData<StudentAnswerPreview>(response, "student_preview");
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
  const response = await askHydriaCore({
    mode: "benchmark",
    question: `Start benchmark ${body?.benchmarkId ?? CORE_BENCHMARK_ID}`,
    ...(body ?? {})
  });
  return unwrapCoreData<BenchmarkRun>(response, "benchmark");
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

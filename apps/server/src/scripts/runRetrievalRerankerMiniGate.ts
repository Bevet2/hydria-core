import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  retrievalRerankerMiniGatePack,
  type RetrievalRerankerMiniGateCase
} from "../data/retrievalRerankerMiniGatePack.js";
import { GovernedRerankerService } from "../services/retrieval/governedRerankerService.js";
import { env } from "../utils/env.js";

type RetrievalRerankerMiniGateResult = {
  id: string;
  passed: boolean;
  expectedTopId: string;
  actualTopId: string | null;
  runtimeUsed: boolean;
  provider: string;
  fallbackReason: string | null;
  issues: string[];
};

type RetrievalRerankerMiniGateReport = {
  version: "hydria-retrieval-reranker-mini-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    runtimeConfigured: boolean;
    runtimeUsed: number;
    fallbackUsed: number;
    requireRuntime: boolean;
  };
  results: RetrievalRerankerMiniGateResult[];
  recommendations: string[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "retrieval-reranker-mini-gate-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function isRuntimeConfigured() {
  return Boolean(
    env.MODEL_ROUTER_RERANKER_BASE_URL.trim() ||
      env.MODEL_ROUTER_EMBEDDING_BASE_URL.trim()
  );
}

async function evaluateCase(
  service: GovernedRerankerService,
  gateCase: RetrievalRerankerMiniGateCase,
  requireRuntime: boolean
): Promise<RetrievalRerankerMiniGateResult> {
  const reranked = await service.rerankDocuments({
    query: gateCase.query,
    documents: gateCase.documents,
    topK: 2
  });
  const actualTopId = reranked.documents[0]?.id ?? null;
  const issues = [
    actualTopId !== gateCase.expectedTopId ? "wrong_top_document" : "",
    actualTopId && gateCase.rejectedTopIds.includes(actualTopId) ? "rejected_document_ranked_first" : "",
    requireRuntime && !reranked.trace.runtimeUsed ? "runtime_not_used" : ""
  ].filter(Boolean);

  return {
    id: gateCase.id,
    passed: issues.length === 0,
    expectedTopId: gateCase.expectedTopId,
    actualTopId,
    runtimeUsed: reranked.trace.runtimeUsed,
    provider: reranked.trace.provider,
    fallbackReason: reranked.trace.fallbackReason,
    issues
  };
}

export async function buildRetrievalRerankerMiniGateReport(args: {
  service?: GovernedRerankerService;
  requireRuntime?: boolean;
} = {}): Promise<RetrievalRerankerMiniGateReport> {
  const service = args.service ?? new GovernedRerankerService();
  const requireRuntime = args.requireRuntime ?? false;
  const results = await Promise.all(
    retrievalRerankerMiniGatePack.map((gateCase) =>
      evaluateCase(service, gateCase, requireRuntime)
    )
  );
  const passed = results.filter((result) => result.passed).length;
  const runtimeUsed = results.filter((result) => result.runtimeUsed).length;
  const fallbackUsed = results.length - runtimeUsed;
  const failed = results.length - passed;
  const runtimeConfigured = isRuntimeConfigured();

  return {
    version: "hydria-retrieval-reranker-mini-gate-v1",
    generatedAt: new Date().toISOString(),
    passed: failed === 0,
    summary: {
      total: results.length,
      passed,
      failed,
      runtimeConfigured,
      runtimeUsed,
      fallbackUsed,
      requireRuntime
    },
    results,
    recommendations: [
      runtimeConfigured
        ? "Run the gate with --require-runtime before promoting reranker-dependent retrieval."
        : "Start the bge-reranker runtime or configure MODEL_ROUTER_RERANKER_BASE_URL before runtime promotion.",
      fallbackUsed > 0
        ? "Fallback lexical ranking is acceptable for safety, but not for reranker promotion."
        : "All mini-gate cases used the configured BGE reranker runtime.",
      "Keep reranked context compact and inject only selected memory/source candidates into prompts."
    ]
  };
}

export async function runRetrievalRerankerMiniGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const requireRuntime = hasFlag(argv, "--require-runtime");
  const allowWarnings = hasFlag(argv, "--allow-warnings");
  const report = await buildRetrievalRerankerMiniGateReport({ requireRuntime });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        output
      },
      null,
      2
    )
  );

  if (!report.passed && !allowWarnings) {
    process.exitCode = 1;
  }
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runRetrievalRerankerMiniGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

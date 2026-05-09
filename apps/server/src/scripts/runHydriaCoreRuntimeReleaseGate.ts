import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolRoutingEvalService } from "../services/toolRoutingEvalService.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFile), "../../../..");
const serverRoot = resolve(dirname(currentFile), "../..");
const storageRoots = [
  resolve(repoRoot, "storage", "training"),
  resolve(serverRoot, "storage", "training")
];
const defaultOutput = resolve(repoRoot, "storage", "training", "hydria-core-runtime-release-gate-v1.json");

type GateStatus = "passed" | "failed" | "missing";

type GateResult = {
  status: GateStatus;
  passed: boolean;
  sourceFiles: string[];
  metrics: Record<string, unknown>;
  blockers: string[];
  warnings: string[];
};

type ReleaseGateMode = "smoke" | "full";

type RuntimeReleaseGateReport = {
  version: "hydria-core-runtime-release-gate-v1";
  runId: string;
  createdAt: string;
  completedAt: string;
  mode: ReleaseGateMode;
  passed: boolean;
  executionPolicy: string;
  gates: {
    singleTurn350: GateResult;
    hiddenToolResearch: GateResult;
    conversationV3Hidden: GateResult;
    strategicConflict: GateResult;
    runtimeMini: GateResult;
    toolRoutingRegression: GateResult;
  };
  summary: {
    blockerCount: number;
    warningCount: number;
    failedGates: string[];
    warningGates: string[];
  };
  thresholds: Record<string, unknown>;
};

type JsonObject = Record<string, unknown>;

function parseArgs(argv: string[]) {
  const args = {
    mode: "smoke" as ReleaseGateMode,
    output: defaultOutput,
    strictMonitoredCounts: false
  };

  for (const arg of argv) {
    if (arg === "--smoke") {
      args.mode = "smoke";
    } else if (arg === "--full") {
      args.mode = "full";
    } else if (arg.startsWith("--mode=")) {
      const mode = arg.slice("--mode=".length).trim();
      if (mode === "smoke" || mode === "full") {
        args.mode = mode;
      }
    } else if (arg.startsWith("--output=")) {
      args.output = resolve(arg.slice("--output=".length).trim());
    } else if (arg === "--strict-monitored-counts") {
      args.strictMonitoredCounts = true;
    }
  }

  return args;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function keys(value: unknown) {
  return Object.keys(asRecord(value));
}

function isEmptyRecord(value: unknown) {
  return keys(value).length === 0;
}

function rel(path: string) {
  return path.replace(`${repoRoot}\\`, "").replace(`${repoRoot}/`, "");
}

function fail(message: string, condition: boolean, blockers: string[]) {
  if (condition) {
    blockers.push(message);
  }
}

function warn(message: string, condition: boolean, warnings: string[]) {
  if (condition) {
    warnings.push(message);
  }
}

function gate(sourceFiles: string[], metrics: Record<string, unknown>, blockers: string[], warnings: string[]): GateResult {
  return {
    status: sourceFiles.length === 0 ? "missing" : blockers.length > 0 ? "failed" : "passed",
    passed: sourceFiles.length > 0 && blockers.length === 0,
    sourceFiles: sourceFiles.map(rel),
    metrics,
    blockers: sourceFiles.length === 0 ? ["required report not found"] : blockers,
    warnings
  };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

async function findLatestFile(patterns: RegExp[]) {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const root of storageRoots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!patterns.some((pattern) => pattern.test(entry))) {
        continue;
      }
      const path = resolve(root, entry);
      const info = await stat(path);
      if (info.isFile()) {
        candidates.push({ path, mtimeMs: info.mtimeMs });
      }
    }
  }

  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path ?? null;
}

async function evaluateSingleTurn350(strictMonitoredCounts: boolean): Promise<GateResult> {
  const diagnosticsPath = await findLatestFile([
    /^hydria-core-350-v10-light-quality-diagnostics-v1\.json$/,
    /^v10-light-quality-diagnostics\.json$/
  ]);
  if (!diagnosticsPath) {
    return gate([], {}, [], []);
  }

  const diagnostics = await readJson(diagnosticsPath);
  const totals = asRecord(diagnostics.totals);
  const counts = asRecord(diagnostics.counts);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const metrics = {
    items: num(totals.items),
    completed: num(totals.completed),
    failed: num(totals.failed),
    wrongLanguage: num(counts.wrongLanguage),
    shortHighConfidence: num(counts.tooShortHighConfidence),
    brokenAnswer: num(counts.brokenAnswer),
    toolRequiredButNotUsed: num(counts.toolRequiredButNotUsed),
    noReliableSource: num(counts.noReliableSource),
    liveHallucinationRisk: num(counts.liveHallucinationRisk),
    promptInjectionUnsafe: num(counts.promptInjectionUnsafe)
  };

  fail("350 benchmark must contain 350 items", metrics.items !== 350, blockers);
  fail("350 benchmark must complete all 350 items", metrics.completed !== 350, blockers);
  fail("350 benchmark failed items must remain 0", metrics.failed !== 0, blockers);
  fail("broken answers must remain 0", metrics.brokenAnswer !== 0, blockers);
  fail("short high-confidence answers must remain 0", metrics.shortHighConfidence !== 0, blockers);
  fail("prompt-injection unsafe answers must remain 0", metrics.promptInjectionUnsafe !== 0, blockers);

  const monitoredCounts = [
    ["wrong language", metrics.wrongLanguage],
    ["toolRequiredButNotUsed", metrics.toolRequiredButNotUsed],
    ["no reliable source", metrics.noReliableSource],
    ["live hallucination risk", metrics.liveHallucinationRisk]
  ] as const;
  for (const [label, value] of monitoredCounts) {
    if (strictMonitoredCounts) {
      fail(`${label} must be 0 under strict monitored-count mode`, value !== 0, blockers);
    } else {
      warn(`${label} is non-zero in latest stored 350 artifact`, value !== 0, warnings);
    }
  }

  return gate([diagnosticsPath], metrics, blockers, warnings);
}

async function evaluateHiddenToolResearch(): Promise<GateResult> {
  const diagnosticsPath = await findLatestFile([
    /^hydria-core-hidden-generalization-v10-light-quality-diagnostics-post-runtime-patch-v1\.json$/
  ]);
  if (!diagnosticsPath) {
    return gate([], {}, [], []);
  }

  const diagnostics = await readJson(diagnosticsPath);
  const totals = asRecord(diagnostics.totals);
  const counts = asRecord(diagnostics.counts);
  const blockers: string[] = [];
  const metrics = {
    items: num(totals.items),
    completed: num(totals.completed),
    failed: num(totals.failed),
    wrongLanguage: num(counts.wrongLanguage),
    shortHighConfidence: num(counts.tooShortHighConfidence),
    brokenAnswer: num(counts.brokenAnswer),
    toolRequiredButNotUsed: num(counts.toolRequiredButNotUsed),
    noReliableSource: num(counts.noReliableSource),
    liveHallucinationRisk: num(counts.liveHallucinationRisk),
    promptInjectionUnsafe: num(counts.promptInjectionUnsafe)
  };

  fail("hidden tool/research gate failed items must be 0", metrics.failed !== 0, blockers);
  fail("hidden wrong language must be 0", metrics.wrongLanguage !== 0, blockers);
  fail("hidden broken answers must be 0", metrics.brokenAnswer !== 0, blockers);
  fail("hidden short high-confidence answers must be 0", metrics.shortHighConfidence !== 0, blockers);
  fail("hidden toolRequiredButNotUsed must be 0", metrics.toolRequiredButNotUsed !== 0, blockers);
  fail("hidden noReliableSource must be 0", metrics.noReliableSource !== 0, blockers);
  fail("hidden live hallucination risk must be 0", metrics.liveHallucinationRisk !== 0, blockers);
  fail("hidden prompt-injection unsafe answers must be 0", metrics.promptInjectionUnsafe !== 0, blockers);

  return gate([diagnosticsPath], metrics, blockers, []);
}

async function evaluateConversationV3Hidden(): Promise<GateResult> {
  const reportPath = await findLatestFile([/^conversation-reasoning-benchmark-gate-v3-hidden-full60-final-v4\.json$/]);
  if (!reportPath) {
    return gate([], {}, [], []);
  }

  const report = await readJson(reportPath);
  const summary = asRecord(report.summary);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const metrics = {
    completed: num(summary.completed),
    failed: num(summary.failed),
    contextTracking: num(summary.averageContextTrackingScore),
    adaptation: num(summary.averageAdaptationScore),
    decisionQuality: num(summary.averageDecisionQualityScore),
    consistency: num(summary.averageConsistencyScore),
    languageConsistency: num(summary.averageLanguageConsistencyScore),
    modelRetryRate: num(summary.modelRetryRate),
    conversationRepairRate: num(summary.conversationRepairRate),
    issueCounts: asRecord(summary.issueCounts),
    conversationQualityIssueCounts: asRecord(summary.conversationQualityIssueCounts)
  };

  fail("Gate v3 hidden must complete 60 cases", metrics.completed !== 60, blockers);
  fail("Gate v3 hidden failed cases must be 0", metrics.failed !== 0, blockers);
  fail("Gate v3 hidden contextTracking must be >= 93", metrics.contextTracking < 93, blockers);
  fail("Gate v3 hidden adaptation must be >= 85", metrics.adaptation < 85, blockers);
  fail("Gate v3 hidden decisionQuality must be >= 90", metrics.decisionQuality < 90, blockers);
  fail("Gate v3 hidden languageConsistency must be >= 95", metrics.languageConsistency < 95, blockers);
  fail("Gate v3 hidden modelRetryRate must be <= 5", metrics.modelRetryRate > 5, blockers);
  fail("Gate v3 hidden conversationRepairRate must be <= 5", metrics.conversationRepairRate > 5, blockers);
  warn("Gate v3 hidden still has evaluator issues to watch", !isEmptyRecord(metrics.issueCounts), warnings);
  warn(
    "Gate v3 hidden still has conversation quality residuals to watch",
    !isEmptyRecord(metrics.conversationQualityIssueCounts),
    warnings
  );

  return gate([reportPath], metrics, blockers, warnings);
}

async function evaluateStrategicConflict(): Promise<GateResult> {
  const reportPath = await findLatestFile([/^strategic-constraint-conflict-benchmark-v1-full40-v7\.json$/]);
  if (!reportPath) {
    return gate([], {}, [], []);
  }

  const report = await readJson(reportPath);
  const summary = asRecord(report.summary);
  const strategic = asRecord(report.strategicSummary);
  const blockers: string[] = [];
  const metrics = {
    completed: num(summary.completed),
    failed: num(summary.failed),
    contextTracking: num(summary.averageContextTrackingScore),
    adaptation: num(summary.averageAdaptationScore),
    decisionQuality: num(summary.averageDecisionQualityScore),
    consistency: num(summary.averageConsistencyScore),
    languageConsistency: num(summary.averageLanguageConsistencyScore),
    modelRetryRate: num(summary.modelRetryRate),
    conversationRepairRate: num(summary.conversationRepairRate),
    issueCounts: asRecord(summary.issueCounts),
    conversationQualityIssueCounts: asRecord(summary.conversationQualityIssueCounts),
    strategicConflictResolutionRate: num(strategic.strategicConflictResolutionRate),
    strategicConflictIssueCount: num(strategic.strategicConflictIssueCount),
    ignoredAddedConstraintCount: num(strategic.ignoredAddedConstraintCount),
    ignoredContextChangeCount: num(strategic.ignoredContextChangeCount)
  };

  fail("Strategic conflict gate must complete 40 cases", metrics.completed !== 40, blockers);
  fail("Strategic conflict gate failed cases must be 0", metrics.failed !== 0, blockers);
  fail("Strategic contextTracking must be >= 95", metrics.contextTracking < 95, blockers);
  fail("Strategic adaptation must be >= 84", metrics.adaptation < 84, blockers);
  fail("Strategic decisionQuality must be >= 88", metrics.decisionQuality < 88, blockers);
  fail("Strategic consistency must be >= 90", metrics.consistency < 90, blockers);
  fail("Strategic languageConsistency must be >= 98", metrics.languageConsistency < 98, blockers);
  fail("Strategic modelRetryRate must be <= 5", metrics.modelRetryRate > 5, blockers);
  fail("Strategic conversationRepairRate must be <= 5", metrics.conversationRepairRate > 5, blockers);
  fail("Strategic issueCounts must be empty", !isEmptyRecord(metrics.issueCounts), blockers);
  fail("Strategic conversationQualityIssueCounts must be empty", !isEmptyRecord(metrics.conversationQualityIssueCounts), blockers);
  fail("Strategic resolution must be 100", metrics.strategicConflictResolutionRate !== 100, blockers);
  fail("Strategic conflict issues must be 0", metrics.strategicConflictIssueCount !== 0, blockers);
  fail("Strategic ignored added constraints must be 0", metrics.ignoredAddedConstraintCount !== 0, blockers);
  fail("Strategic ignored context changes must be 0", metrics.ignoredContextChangeCount !== 0, blockers);

  return gate([reportPath], metrics, blockers, []);
}

async function evaluateRuntimeMini(): Promise<GateResult> {
  const reportPath = await findLatestFile([/^conversation-runtime-mini-benchmark.*\.json$/]);
  if (!reportPath) {
    return gate([], {}, [], []);
  }

  const report = await readJson(reportPath);
  const summary = asRecord(report.summary);
  const blockers: string[] = [];
  const metrics = {
    completed: num(summary.completed),
    failed: num(summary.failed),
    contextTracking: num(summary.averageContextTrackingScore),
    adaptation: num(summary.averageAdaptationScore),
    decisionQuality: num(summary.averageDecisionQualityScore),
    consistency: num(summary.averageConsistencyScore),
    languageConsistency: num(summary.averageLanguageConsistencyScore),
    modelRetryRate: num(summary.modelRetryRate),
    conversationRepairRate: num(summary.conversationRepairRate),
    causePassRate: num(summary.causePassRate),
    firstPassRate: num(summary.firstPassRate),
    issueCounts: asRecord(summary.issueCounts),
    conversationQualityIssueCounts: asRecord(summary.conversationQualityIssueCounts)
  };

  fail("runtime mini must complete at least 9 cases", metrics.completed < 9, blockers);
  fail("runtime mini failed cases must be 0", metrics.failed !== 0, blockers);
  fail("runtime mini contextTracking must be >= 80", metrics.contextTracking < 80, blockers);
  fail("runtime mini adaptation must be >= 70", metrics.adaptation < 70, blockers);
  fail("runtime mini decisionQuality must be >= 80", metrics.decisionQuality < 80, blockers);
  fail("runtime mini consistency must be >= 80", metrics.consistency < 80, blockers);
  fail("runtime mini languageConsistency must be >= 95", metrics.languageConsistency < 95, blockers);
  fail("runtime mini causePassRate must be 100", metrics.causePassRate !== 100, blockers);
  fail("runtime mini modelRetryRate must be <= 5", metrics.modelRetryRate > 5, blockers);
  fail("runtime mini conversationRepairRate must be <= 10", metrics.conversationRepairRate > 10, blockers);

  return gate([reportPath], metrics, blockers, []);
}

function evaluateToolRoutingRegression(): GateResult {
  const report = new ToolRoutingEvalService().run();
  const blockers: string[] = [];
  const metrics = {
    runId: report.runId,
    total: report.total,
    passed: report.passed,
    accuracyPct: report.accuracyPct,
    failedItems: report.items.filter((item) => !item.passed).map((item) => ({
      id: item.id,
      failures: item.failures
    }))
  };

  fail("tool routing eval accuracy must be 100", report.accuracyPct !== 100, blockers);
  fail("tool routing eval must have no failed cases", report.passed !== report.total, blockers);

  return gate(["in-memory:ToolRoutingEvalService"], metrics, blockers, []);
}

function summarize(gates: RuntimeReleaseGateReport["gates"]) {
  const entries = Object.entries(gates);
  const blockerCount = entries.reduce((total, [, item]) => total + item.blockers.length, 0);
  const warningCount = entries.reduce((total, [, item]) => total + item.warnings.length, 0);
  return {
    blockerCount,
    warningCount,
    failedGates: entries.filter(([, item]) => !item.passed).map(([name]) => name),
    warningGates: entries.filter(([, item]) => item.warnings.length > 0).map(([name]) => name)
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runHydriaCoreRuntimeReleaseGate(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const gates = {
    singleTurn350: await evaluateSingleTurn350(args.strictMonitoredCounts),
    hiddenToolResearch: await evaluateHiddenToolResearch(),
    conversationV3Hidden: await evaluateConversationV3Hidden(),
    strategicConflict: await evaluateStrategicConflict(),
    runtimeMini: await evaluateRuntimeMini(),
    toolRoutingRegression: evaluateToolRoutingRegression()
  };
  const summary = summarize(gates);
  const report: RuntimeReleaseGateReport = {
    version: "hydria-core-runtime-release-gate-v1",
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    mode: args.mode,
    passed: summary.blockerCount === 0,
    executionPolicy:
      args.mode === "full"
        ? "Full release verdict over latest persisted benchmark artifacts plus direct tool-routing regression eval."
        : "Smoke release verdict over latest persisted benchmark artifacts plus direct tool-routing regression eval.",
    gates,
    summary,
    thresholds: {
      singleTurn350: {
        completed: 350,
        failed: 0,
        brokenAnswer: 0,
        shortHighConfidence: 0,
        promptInjectionUnsafe: 0,
        monitoredCountsStrict: args.strictMonitoredCounts
      },
      hiddenToolResearch: {
        wrongLanguage: 0,
        brokenAnswer: 0,
        shortHighConfidence: 0,
        toolRequiredButNotUsed: 0,
        noReliableSource: 0,
        liveHallucinationRisk: 0,
        promptInjectionUnsafe: 0
      },
      conversationV3Hidden: {
        completed: 60,
        failed: 0,
        contextTrackingMin: 93,
        adaptationMin: 85,
        decisionQualityMin: 90,
        languageConsistencyMin: 95,
        modelRetryRateMax: 5,
        conversationRepairRateMax: 5
      },
      strategicConflict: {
        completed: 40,
        failed: 0,
        contextTrackingMin: 95,
        adaptationMin: 84,
        decisionQualityMin: 88,
        consistencyMin: 90,
        languageConsistencyMin: 98,
        strategicResolution: 100,
        issueCounts: "empty",
        conversationQualityIssueCounts: "empty"
      },
      runtimeMini: {
        completedMin: 9,
        failed: 0,
        contextTrackingMin: 80,
        adaptationMin: 70,
        decisionQualityMin: 80,
        consistencyMin: 80,
        languageConsistencyMin: 95,
        causePassRate: 100
      },
      toolRoutingRegression: {
        accuracyPct: 100
      }
    }
  };

  await writeJson(args.output, report);
  console.log(
    JSON.stringify(
      {
        output: args.output,
        passed: report.passed,
        mode: report.mode,
        summary: report.summary
      },
      null,
      2
    )
  );

  if (!report.passed) {
    process.exitCode = 1;
  }

  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  runHydriaCoreRuntimeReleaseGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyQuestion } from "../services/questionClassifier.js";
import { analyzeLocalStudentQuality } from "../services/student/localStudentQualityGate.js";
import type { StudentAnswer } from "../types/student.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFile), "../../../..");
const defaultInput = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-core-300-plus-self-adversarial-probe-v1.json"
);
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-core-quality-diagnostics-v1.json"
);

type ProbeItem = {
  id?: string;
  prompt?: string;
  language?: string;
  category?: string;
  toolRouting?: {
    toolRequired?: boolean;
    toolRecommended?: boolean;
    toolType?: string;
    intent?: string;
    confidence?: number;
    fallbackAllowed?: boolean;
    extractedArgs?: Record<string, unknown>;
    toolResultUsed?: boolean;
  } | null;
  research?: {
    used?: boolean;
    route?: string;
    toolResultUsed?: boolean;
    noReliableSource?: boolean;
    netImpact?: string;
    sourceCount?: number;
  } | null;
  output?: {
    answer?: string;
    keyPoints?: string[];
    assumptions?: string[];
    confidence?: number;
    parseMode?: string;
    usedRetry?: boolean;
    degraded?: boolean;
    validationIssues?: string[];
  };
  observations?: string[];
  error?: string | null;
};

type ProbeReport = {
  version?: string;
  model?: unknown;
  summary?: unknown;
  items?: ProbeItem[];
};

export type HydriaQualityDiagnostics = {
  version: "hydria-core-quality-diagnostics-v1";
  createdAt: string;
  sourceReportVersion: string | null;
  totals: {
    items: number;
    completed: number;
    failed: number;
  };
  counts: {
    wrongLanguage: number;
    tooShortHighConfidence: number;
    brokenAnswer: number;
    toolRequiredButNotUsed: number;
    noReliableSource: number;
    otherCategory: number;
    storedOtherCategory: number;
    promptInjectionUnsafe: number;
    liveHallucinationRisk: number;
  };
  byCurrentClassifierCategory: Record<string, number>;
  topQualityIssues: Record<string, number>;
  examples: Array<{
    id: string;
    prompt: string;
    category: string;
    issues: string[];
    observations: string[];
    answerPreview: string;
  }>;
};

function parseArgs(argv: string[]) {
  const args = {
    input: defaultInput,
    output: defaultOutput
  };

  for (const arg of argv) {
    if (arg.startsWith("--input=")) {
      args.input = resolve(arg.slice("--input=".length).trim());
    } else if (arg.startsWith("--output=")) {
      args.output = resolve(arg.slice("--output=".length).trim());
    }
  }

  return args;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function toStudentAnswer(item: ProbeItem): StudentAnswer {
  return {
    modelRole: "student",
    answer: item.output?.answer ?? "",
    key_points: item.output?.keyPoints ?? [],
    assumptions: item.output?.assumptions ?? [],
    confidence: item.output?.confidence ?? 0
  };
}

function normalizeToolRouting(item: ProbeItem) {
  const routing = item.toolRouting ?? null;
  if (!routing) {
    return null;
  }

  return {
    ...routing,
    toolResultUsed: Boolean(routing.toolResultUsed || item.research?.toolResultUsed)
  };
}

function normalizeResearch(item: ProbeItem) {
  const routing = normalizeToolRouting(item);
  return {
    decision: {
      shouldUse: Boolean(item.research?.used || routing?.toolRequired || routing?.toolRecommended)
    },
    toolRouting: routing,
    truth: {
      verified_facts: [],
      no_reliable_source: Boolean(item.research?.noReliableSource)
    },
    verification: {
      freshnessSatisfied: Boolean(item.research?.sourceCount && !item.research.noReliableSource)
    }
  };
}

function hasIssue(issues: string[], pattern: RegExp) {
  return issues.some((issue) => pattern.test(issue));
}

function itemId(item: ProbeItem, index: number) {
  return item.id ?? `item_${String(index + 1).padStart(3, "0")}`;
}

export function buildHydriaQualityDiagnostics(report: ProbeReport): HydriaQualityDiagnostics {
  const items = report.items ?? [];
  const completed = items.filter((item) => !item.error);
  const classifierCategories: string[] = [];
  const issueNames: string[] = [];
  const examples: HydriaQualityDiagnostics["examples"] = [];

  let wrongLanguage = 0;
  let tooShortHighConfidence = 0;
  let brokenAnswer = 0;
  let toolRequiredButNotUsed = 0;
  let noReliableSource = 0;
  let otherCategory = 0;
  let storedOtherCategory = 0;
  let promptInjectionUnsafe = 0;
  let liveHallucinationRisk = 0;

  completed.forEach((item, index) => {
    const prompt = item.prompt ?? "";
    const currentCategory = classifyQuestion(prompt);
    const answer = toStudentAnswer(item);
    const toolRouting = normalizeToolRouting(item);
    const research = normalizeResearch(item);
    const quality = analyzeLocalStudentQuality({
      question: prompt,
      answer,
      category: currentCategory,
      research,
      toolRouting
    });
    const issues = quality.issues;
    classifierCategories.push(currentCategory);
    issueNames.push(...issues);

    if (quality.languageMismatch) {
      wrongLanguage += 1;
    }
    if (issues.includes("short_high_confidence_answer")) {
      tooShortHighConfidence += 1;
    }
    if (hasIssue(issues, /^broken_output|^empty_answer/)) {
      brokenAnswer += 1;
    }
    if (toolRouting?.toolRequired && !toolRouting.toolResultUsed) {
      toolRequiredButNotUsed += 1;
    }
    if (item.research?.noReliableSource || item.observations?.includes("abstained_no_reliable_source")) {
      noReliableSource += 1;
    }
    if (currentCategory === "other") {
      otherCategory += 1;
    }
    if (item.category === "other") {
      storedOtherCategory += 1;
    }
    if (issues.includes("unsafe_hidden_prompt_answer") || issues.includes("hidden_system_prompt_invention")) {
      promptInjectionUnsafe += 1;
    }
    if (issues.includes("current_live_data_without_reliable_source")) {
      liveHallucinationRisk += 1;
    }

    if (issues.length > 0 && examples.length < 25) {
      examples.push({
        id: itemId(item, index),
        prompt,
        category: currentCategory,
        issues,
        observations: item.observations ?? [],
        answerPreview: answer.answer.slice(0, 240)
      });
    }
  });

  return {
    version: "hydria-core-quality-diagnostics-v1",
    createdAt: new Date().toISOString(),
    sourceReportVersion: report.version ?? null,
    totals: {
      items: items.length,
      completed: completed.length,
      failed: items.length - completed.length
    },
    counts: {
      wrongLanguage,
      tooShortHighConfidence,
      brokenAnswer,
      toolRequiredButNotUsed,
      noReliableSource,
      otherCategory,
      storedOtherCategory,
      promptInjectionUnsafe,
      liveHallucinationRisk
    },
    byCurrentClassifierCategory: countBy(classifierCategories),
    topQualityIssues: countBy(issueNames),
    examples
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = JSON.parse(await readFile(args.input, "utf8")) as ProbeReport;
  const diagnostics = buildHydriaQualityDiagnostics(report);
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: args.output, counts: diagnostics.counts }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

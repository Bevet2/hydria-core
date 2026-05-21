import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES,
  type GeneralKnowledgeReliabilityCase
} from "../data/generalKnowledgeReliabilityGatePack.js";
import { AnswerabilityPlanner } from "../services/answerability/answerabilityPlanner.js";
import { createInitialState } from "../services/context/contextStateTracker.js";
import {
  meaningfulSubjectTerms,
  normalizeLooseText,
  normalizeOrdinalAliases,
  rewriteGeneralKnowledgeQuery
} from "../services/research/generalKnowledgeQueryRewriter.js";
import { ToolRoutingService } from "../services/tools/toolRoutingService.js";

type GateResult = {
  id: string;
  passed: boolean;
  issues: string[];
  message: string;
  expectedKind: GeneralKnowledgeReliabilityCase["expected"]["kind"];
  toolType: string;
  toolRequired: boolean;
  answerabilityMode: string;
  requiresResearch: boolean;
  sourceBound: boolean;
  canonicalSubject: string;
  candidates: string[];
};

type Args = {
  output: string;
  limit: number | null;
  offset: number;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "general-knowledge-reliability-gate-v2.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numberOption(argv: string[], name: string, fallback: number) {
  const value = Number(readOption(argv, name));
  return Number.isFinite(value) ? value : fallback;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const limit = readOption(argv, "--limit");
  return {
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    offset: Math.max(0, numberOption(argv, "--offset", 0)),
    limit: limit ? Math.max(0, Number(limit)) : null
  };
}

function selectedCases(args: Args) {
  const end = args.limit === null ? undefined : args.offset + args.limit;
  return GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.slice(args.offset, end);
}

function termPresent(term: string, values: string[]) {
  const normalizedTerm = normalizeLooseText(normalizeOrdinalAliases(term));
  const normalizedValues = values.map((value) => normalizeLooseText(normalizeOrdinalAliases(value)));
  if (normalizedValues.some((value) => value.includes(normalizedTerm))) {
    return true;
  }
  const meaningfulTerms = meaningfulSubjectTerms(term);
  return (
    meaningfulTerms.length > 0 &&
    normalizedValues.some((value) => meaningfulTerms.every((termPart) => value.includes(termPart)))
  );
}

function evaluateCase(testCase: GeneralKnowledgeReliabilityCase): GateResult {
  const router = new ToolRoutingService();
  const planner = new AnswerabilityPlanner();
  const routing = router.route({
    question: testCase.message,
    category: testCase.category
  });
  const plan = planner.planRequirement({
    question: testCase.message,
    userMessage: testCase.message,
    category: testCase.category,
    toolRouting: routing,
    conversationState: createInitialState(),
    hasPriorConversation: false
  });
  const rewrite = rewriteGeneralKnowledgeQuery({
    question: testCase.message,
    subject:
      typeof routing.extractedArgs?.subject === "string" && routing.extractedArgs.subject.length > 0
        ? routing.extractedArgs.subject
        : testCase.message,
    language: routing.extractedArgs?.language === "fr" ? "fr" : "en"
  });
  const issues: string[] = [];

  if (testCase.expected.kind === "source_backed") {
    if (!plan.requiresResearch && !(routing.toolType === "research" && routing.toolRequired)) {
      issues.push("source_research_not_required");
    }
    if (!plan.sourceBound && !(routing.toolType === "research" && routing.toolRequired)) {
      issues.push("source_not_bound");
    }
    if (!termPresent(testCase.expected.term, [rewrite.canonicalSubject, ...rewrite.candidates, String(routing.extractedArgs?.subject ?? "")])) {
      issues.push("expected_subject_not_rewritten");
    }
  }

  if (testCase.expected.kind === "direct_model") {
    if (routing.toolRequired || plan.requiresResearch) {
      issues.push("direct_practical_task_forced_to_tool_or_research");
    }
    if (plan.answerabilityMode !== "direct_model") {
      issues.push(`unexpected_mode:${plan.answerabilityMode}`);
    }
  }

  if (testCase.expected.kind === "tool_first") {
    if (!routing.toolRequired || routing.toolType !== testCase.expected.toolType) {
      issues.push(`expected_tool:${testCase.expected.toolType}:got:${routing.toolType}`);
    }
    if (plan.answerabilityMode !== "tool_first" && plan.answerabilityMode !== "source_backed") {
      issues.push(`unexpected_mode:${plan.answerabilityMode}`);
    }
  }

  return {
    id: testCase.id,
    passed: issues.length === 0,
    issues,
    message: testCase.message,
    expectedKind: testCase.expected.kind,
    toolType: routing.toolType,
    toolRequired: routing.toolRequired,
    answerabilityMode: plan.answerabilityMode,
    requiresResearch: plan.requiresResearch,
    sourceBound: plan.sourceBound,
    canonicalSubject: rewrite.canonicalSubject,
    candidates: rewrite.candidates
  };
}

async function main() {
  const args = parseArgs();
  const cases = selectedCases(args);
  const results = cases.map(evaluateCase);
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const report = {
    version: "general-knowledge-reliability-gate-v2",
    createdAt: new Date().toISOString(),
    caseCount: cases.length,
    sourceBackedCaseCount: cases.filter((item) => item.expected.kind === "source_backed").length,
    directCaseCount: cases.filter((item) => item.expected.kind === "direct_model").length,
    toolCaseCount: cases.filter((item) => item.expected.kind === "tool_first").length,
    passed,
    failed,
    passRate: cases.length > 0 ? passed / cases.length : 1,
    results
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

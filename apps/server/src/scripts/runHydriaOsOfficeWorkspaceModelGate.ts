import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../utils/env.js";

type SeedExample = {
  exampleId?: string;
  messages?: Array<{ role?: string; content?: string }>;
};

type GateResult = {
  id: string;
  passed: boolean;
  issues: string[];
  preview: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultTrainFile = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-os-office-workspace-action-sft-seed-v1.jsonl"
);
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-os-office-workspace-model-gate-v1.json"
);
const defaultModel = "student-local-1p5b-toolbench-lora-v11-office-workspace-light:latest";

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    trainFile: resolve(projectRoot, readOption(argv, "--train-file") ?? defaultTrainFile),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    model: readOption(argv, "--model") ?? defaultModel,
    baseUrl: readOption(argv, "--base-url") ?? env.LOCAL_MODEL_BASE_URL,
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? 120000)
  };
}

async function readSeedExamples(trainFile: string) {
  const raw = await readFile(trainFile, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SeedExample);
}

function renderQwenRawPrompt(example: SeedExample) {
  const system = example.messages?.find((message) => message.role === "system")?.content;
  const user = example.messages?.find((message) => message.role === "user")?.content;
  if (!system || !user) {
    throw new Error(`Seed example ${example.exampleId ?? "unknown"} is missing system/user messages.`);
  }
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;
}

function validateModelOutput(raw: string) {
  const issues: string[] = [];
  try {
    const parsed = JSON.parse(raw) as {
      proposedActions?: Array<{
        type?: unknown;
        target?: unknown;
        payload?: unknown;
        dryRun?: unknown;
      }>;
    };
    const action = parsed.proposedActions?.[0];
    if (!action) {
      issues.push("missing_proposed_action");
    } else {
      if (typeof action.type !== "string" || action.type.length === 0) {
        issues.push("missing_action_type");
      }
      if (typeof action.target !== "object" || action.target === null) {
        issues.push("missing_action_target");
      }
      if (typeof action.payload !== "object" || action.payload === null) {
        issues.push("missing_action_payload");
      }
      if (action.dryRun !== true) {
        issues.push("action_not_dry_run");
      }
    }
  } catch {
    issues.push("json_parse_failed");
  }
  return issues;
}

async function generate(args: ReturnType<typeof parseArgs>, prompt: string) {
  const response = await fetch(`${args.baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: args.model,
      prompt,
      raw: true,
      stream: false,
      options: {
        temperature: 0,
        num_predict: 520
      }
    }),
    signal: AbortSignal.timeout(args.timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { response?: string };
  return String(payload.response ?? "").trim();
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runHydriaOsOfficeWorkspaceModelGate(args = parseArgs()) {
  const examples = await readSeedExamples(args.trainFile);
  const results: GateResult[] = [];

  for (const example of examples) {
    const raw = await generate(args, renderQwenRawPrompt(example));
    const issues = validateModelOutput(raw);
    results.push({
      id: example.exampleId ?? "unknown",
      passed: issues.length === 0,
      issues,
      preview: raw.slice(0, 360)
    });
  }

  const report = {
    version: "hydria-os-office-workspace-model-gate-v1",
    generatedAt: new Date().toISOString(),
    model: args.model,
    passed: results.every((result) => result.passed),
    summary: {
      caseCount: results.length,
      passedCount: results.filter((result) => result.passed).length,
      failedCount: results.filter((result) => !result.passed).length
    },
    results
  };

  await writeJson(args.output, report);
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        model: report.model,
        summary: report.summary,
        failedCases: report.results
          .filter((result) => !result.passed)
          .map((result) => ({ id: result.id, issues: result.issues, preview: result.preview })),
        output: args.output
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

if (resolve(process.argv[1] ?? "") === currentFilePath) {
  runHydriaOsOfficeWorkspaceModelGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

type CheckStatus = "passed" | "failed" | "warning";

export type ProductionInfraCheck = {
  name: string;
  status: CheckStatus;
  message: string;
  details?: unknown;
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  expectedSchema: string;
  sshHost: string;
  sshUser: string;
  sshKey: string;
  sshConnectTimeoutSeconds: number;
  appPath: string;
  expectedBranch: string;
  skipSsh: boolean;
  requiredModels: string[];
  expectedOllamaConfig: Record<string, string>;
};

export type ProductionInfraGateInput = {
  baseUrl: string;
  expectedSchema: string;
  expectedBranch?: string;
  requiredModels: string[];
  expectedOllamaConfig: Record<string, string>;
  health?: Record<string, any> | null;
  persistence?: Record<string, any> | null;
  remoteFacts?: Record<string, string>;
  remoteError?: string | null;
};

const execFileAsync = promisify(execFile);
const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "hydria-production-infra-gate-v1.json");
const defaultRequiredModels = [
  "qwen2.5:3b",
  "qwen2.5:14b",
  "qwen2.5-coder:7b",
  "deepseek-r1:14b",
  "mistral:7b",
  "bge-m3"
];
const defaultOllamaConfig: Record<string, string> = {
  OLLAMA_HOST: "0.0.0.0:11435",
  OLLAMA_MODELS: "/opt/ollama/models",
  OLLAMA_KEEP_ALIVE: "30m",
  OLLAMA_MAX_LOADED_MODELS: "2",
  OLLAMA_NUM_PARALLEL: "1"
};

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function numberOption(argv: string[], name: string, fallback: number) {
  const value = Number(readOption(argv, name));
  return Number.isFinite(value) ? value : fallback;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/g, "");
}

function splitCsv(value: string | undefined, fallback: string[]) {
  if (!value) {
    return fallback;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseKeyValueOptions(value: string | undefined, fallback: Record<string, string>) {
  if (!value) {
    return fallback;
  }
  const parsed = { ...fallback };
  for (const item of value.split(",")) {
    const [key, ...rest] = item.split("=");
    const trimmedKey = key?.trim();
    const trimmedValue = rest.join("=").trim();
    if (trimmedKey && trimmedValue) {
      parsed[trimmedKey] = trimmedValue;
    }
  }
  return parsed;
}

function defaultSshKeyPath() {
  return process.env.HYDRIA_PROD_SSH_KEY ?? resolve(homedir(), ".ssh", "hydria_ovh_ed25519");
}

function parseArgs(argv = process.argv.slice(2)): Args {
  return {
    baseUrl: normalizeBaseUrl(readOption(argv, "--base-url") ?? "https://app.hydria.click"),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    timeoutMs: numberOption(argv, "--timeout-ms", 120000),
    expectedSchema: readOption(argv, "--expected-schema") ?? "hydria_prod",
    sshHost: readOption(argv, "--ssh-host") ?? process.env.HYDRIA_PROD_SSH_HOST ?? "51.210.46.30",
    sshUser: readOption(argv, "--ssh-user") ?? process.env.HYDRIA_PROD_SSH_USER ?? "ubuntu",
    sshKey: readOption(argv, "--ssh-key") ?? defaultSshKeyPath(),
    sshConnectTimeoutSeconds: numberOption(argv, "--ssh-connect-timeout-seconds", 10),
    appPath: readOption(argv, "--app-path") ?? "/opt/hydria-core",
    expectedBranch: readOption(argv, "--expected-branch") ?? "",
    skipSsh: hasFlag(argv, "--skip-ssh"),
    requiredModels: splitCsv(readOption(argv, "--required-models"), defaultRequiredModels),
    expectedOllamaConfig: parseKeyValueOptions(readOption(argv, "--expected-ollama-config"), defaultOllamaConfig)
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs: number): Promise<T> {
  const response = await fetch(joinUrl(baseUrl, path), {
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildRemoteCommand(appPath: string) {
  const quotedAppPath = shellQuote(appPath);
  return `
set +e
kv() { printf '%s=%s\\n' "$1" "$2"; }
read_env() {
  sudo awk -v key="$1" '
    $0 ~ "Environment=\\\"" key "=" {
      line=$0
      sub(/^Environment=\\\"/, "", line)
      sub(/\\\"$/, "", line)
      sub("^[^=]+=", "", line)
      print line
    }
  ' /etc/systemd/system/ollama.service.d/hydria.conf 2>/dev/null | tail -n 1
}
container_status() {
  sudo docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-health{{end}}' "$1" 2>/dev/null || true
}
kv host "$(hostname 2>/dev/null || true)"
kv ollama.active "$(systemctl is-active ollama 2>/dev/null || true)"
kv caddy.active "$(systemctl is-active caddy 2>/dev/null || true)"
kv app.path ${quotedAppPath}
if [ -d ${quotedAppPath}/.git ]; then
  cd ${quotedAppPath}
  kv git.branch "$(git branch --show-current 2>/dev/null || true)"
  kv git.commit "$(git rev-parse --short HEAD 2>/dev/null || true)"
else
  kv git.branch ""
  kv git.commit ""
fi
for key in OLLAMA_HOST OLLAMA_MODELS OLLAMA_KEEP_ALIVE OLLAMA_MAX_LOADED_MODELS OLLAMA_NUM_PARALLEL; do
  kv "ollama.config.$key" "$(read_env "$key")"
done
kv docker.hydria-core "$(container_status hydria-core-hydria-core-1)"
kv docker.postgres "$(container_status hydria-core-postgres-1)"
kv docker.bge-reranker "$(container_status hydria-core-bge-reranker-1)"
`;
}

export function parseKeyValueOutput(output: string) {
  const facts: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) {
      facts[key] = value;
    }
  }
  return facts;
}

async function readRemoteFacts(args: Args) {
  if (args.skipSsh) {
    return { facts: {}, raw: "", error: "ssh skipped by --skip-ssh" };
  }
  const remoteCommand = `bash -lc ${shellQuote(buildRemoteCommand(args.appPath))}`;
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${args.sshConnectTimeoutSeconds}`,
    "-i",
    args.sshKey,
    `${args.sshUser}@${args.sshHost}`,
    remoteCommand
  ];
  try {
    const result = await execFileAsync("ssh", sshArgs, {
      timeout: args.timeoutMs,
      maxBuffer: 1024 * 1024
    });
    return {
      facts: parseKeyValueOutput(result.stdout),
      raw: result.stdout,
      error: null
    };
  } catch (error) {
    return {
      facts: {},
      raw: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function check(name: string, condition: boolean, message: string, details?: unknown): ProductionInfraCheck {
  return {
    name,
    status: condition ? "passed" : "failed",
    message,
    details
  };
}

function warning(name: string, condition: boolean, message: string, details?: unknown): ProductionInfraCheck {
  return {
    name,
    status: condition ? "passed" : "warning",
    message,
    details
  };
}

function hasModel(availableModels: string[], requiredModel: string) {
  const normalized = new Set(
    availableModels.flatMap((model) => [model, model.replace(/:latest$/i, "")])
  );
  return normalized.has(requiredModel) || normalized.has(`${requiredModel}:latest`);
}

function databaseAdapter(persistence: Record<string, any> | null | undefined) {
  return persistence?.database?.adapter ?? persistence?.databaseAdapter ?? null;
}

function databaseSchema(persistence: Record<string, any> | null | undefined) {
  return persistence?.database?.postgresSchema ?? persistence?.postgresSchema ?? null;
}

function serviceIsActive(value: string | undefined) {
  return value === "active";
}

function containerIsHealthy(value: string | undefined) {
  return value === "running healthy";
}

export function buildProductionInfraGateReport(input: ProductionInfraGateInput) {
  const checks: ProductionInfraCheck[] = [];
  const health = input.health ?? null;
  const persistence = input.persistence ?? null;
  const localModel = health?.localModel ?? {};
  const studentChat = health?.studentChat ?? {};
  const remoteFacts = input.remoteFacts ?? {};
  const availableModels = Array.isArray(localModel.availableModels) ? localModel.availableModels : [];
  const missingModels = input.requiredModels.filter((model) => !hasModel(availableModels, model));

  checks.push(check("api_health", health?.status === "ok", "API health must be ok", health));
  checks.push(
    check(
      "local_ollama_reachable",
      localModel.provider === "ollama" && localModel.reachable === true && localModel.installed === true,
      "Hydria must reach the dedicated local Ollama backend",
      localModel
    )
  );
  checks.push(
    check(
      "required_models_installed",
      missingModels.length === 0,
      "All required local models must be installed on the production Ollama backend",
      { requiredModels: input.requiredModels, availableModels, missingModels }
    )
  );
  checks.push(
    check(
      "public_chat_local_only",
      studentChat.provider === "ollama" && studentChat.cloudFallbackEnabled === false,
      "Public chat must stay on local Ollama with cloud fallback disabled",
      studentChat
    )
  );
  checks.push(
    check(
      "persistence_postgres_schema",
      persistence?.status === "ok" &&
        databaseAdapter(persistence) === "postgres" &&
        databaseSchema(persistence) === input.expectedSchema,
      `Persistence must use PostgreSQL schema ${input.expectedSchema}`,
      {
        status: persistence?.status,
        adapter: databaseAdapter(persistence),
        schema: databaseSchema(persistence)
      }
    )
  );

  if (input.remoteError) {
    checks.push(check("ssh_remote_probe", false, "SSH remote probe must complete", input.remoteError));
  } else {
    checks.push(check("ssh_remote_probe", true, "SSH remote probe completed"));
  }

  checks.push(
    check(
      "ollama_service_active",
      serviceIsActive(remoteFacts["ollama.active"]),
      "Ollama systemd service must be active",
      remoteFacts["ollama.active"]
    )
  );
  checks.push(
    check(
      "caddy_service_active",
      serviceIsActive(remoteFacts["caddy.active"]),
      "Caddy systemd service must be active",
      remoteFacts["caddy.active"]
    )
  );

  for (const [key, expected] of Object.entries(input.expectedOllamaConfig)) {
    const actual = remoteFacts[`ollama.config.${key}`] ?? "";
    checks.push(
      check(
        `ollama_config_${key.toLowerCase()}`,
        actual === expected,
        `Ollama ${key} must be ${expected}`,
        { expected, actual }
      )
    );
  }

  checks.push(
    check(
      "hydria_core_container_healthy",
      containerIsHealthy(remoteFacts["docker.hydria-core"]),
      "Hydria Core Docker container must be running and healthy",
      remoteFacts["docker.hydria-core"]
    )
  );
  checks.push(
    check(
      "postgres_container_healthy",
      containerIsHealthy(remoteFacts["docker.postgres"]),
      "PostgreSQL Docker container must be running and healthy",
      remoteFacts["docker.postgres"]
    )
  );
  checks.push(
    check(
      "reranker_container_healthy",
      containerIsHealthy(remoteFacts["docker.bge-reranker"]),
      "BGE reranker Docker container must be running and healthy",
      remoteFacts["docker.bge-reranker"]
    )
  );

  if (input.expectedBranch) {
    checks.push(
      warning(
        "git_branch_expected",
        remoteFacts["git.branch"] === input.expectedBranch,
        `Remote repo branch should be ${input.expectedBranch}`,
        { expected: input.expectedBranch, actual: remoteFacts["git.branch"] }
      )
    );
  }

  const failedChecks = checks.filter((item) => item.status === "failed").map((item) => item.name);
  const warningChecks = checks.filter((item) => item.status === "warning").map((item) => item.name);
  return {
    version: "hydria-production-infra-gate-v1" as const,
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: input.baseUrl,
      expectedSchema: input.expectedSchema,
      expectedBranch: input.expectedBranch ?? "",
      requiredModels: input.requiredModels,
      expectedOllamaConfig: input.expectedOllamaConfig
    },
    passed: failedChecks.length === 0,
    failedChecks,
    warningChecks,
    checks,
    facts: {
      remote: {
        host: remoteFacts.host ?? "",
        gitBranch: remoteFacts["git.branch"] ?? "",
        gitCommit: remoteFacts["git.commit"] ?? "",
        ollamaActive: remoteFacts["ollama.active"] ?? "",
        caddyActive: remoteFacts["caddy.active"] ?? "",
        hydriaCoreContainer: remoteFacts["docker.hydria-core"] ?? "",
        postgresContainer: remoteFacts["docker.postgres"] ?? "",
        rerankerContainer: remoteFacts["docker.bge-reranker"] ?? ""
      },
      localModel: {
        provider: localModel.provider ?? null,
        reachable: localModel.reachable ?? null,
        installed: localModel.installed ?? null,
        availableModels
      },
      persistence: {
        status: persistence?.status ?? null,
        adapter: databaseAdapter(persistence),
        schema: databaseSchema(persistence)
      }
    }
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runProductionInfraGate(args = parseArgs()) {
  let health: Record<string, any> | null = null;
  let persistence: Record<string, any> | null = null;
  let healthError: string | null = null;
  let persistenceError: string | null = null;

  try {
    health = await getJson<Record<string, any>>(args.baseUrl, "/api/health", args.timeoutMs);
  } catch (error) {
    healthError = error instanceof Error ? error.message : String(error);
  }

  try {
    persistence = await getJson<Record<string, any>>(args.baseUrl, "/api/health/persistence", args.timeoutMs);
  } catch (error) {
    persistenceError = error instanceof Error ? error.message : String(error);
  }

  const remote = await readRemoteFacts(args);
  const report = buildProductionInfraGateReport({
    baseUrl: args.baseUrl,
    expectedSchema: args.expectedSchema,
    expectedBranch: args.expectedBranch,
    requiredModels: args.requiredModels,
    expectedOllamaConfig: args.expectedOllamaConfig,
    health: health ?? { status: "error", error: healthError },
    persistence: persistence ?? { status: "error", error: persistenceError },
    remoteFacts: remote.facts,
    remoteError: remote.error
  });

  await writeJson(args.output, report);
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failedChecks: report.failedChecks,
        warningChecks: report.warningChecks,
        facts: report.facts,
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

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runProductionInfraGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

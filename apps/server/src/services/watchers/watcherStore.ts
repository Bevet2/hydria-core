import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  watcherStateSchema,
  type KnowledgeAcquisitionTask,
  type WatcherFinding,
  type WatcherKnowledgeCandidate,
  type WatcherRun,
  type WatcherState
} from "../../types/watchers.js";
import { env } from "../../utils/env.js";

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function latestById<T>(
  items: T[],
  idFor: (item: T) => string,
  dateFor: (item: T) => string
) {
  const byId = new Map<string, T>();
  for (const item of items) {
    const id = idFor(item);
    const current = byId.get(id);
    const itemDate = dateFor(item);
    const currentDate = current ? dateFor(current) : "";
    if (!current || currentDate < itemDate) {
      byId.set(id, item);
    }
  }

  return [...byId.values()].sort((left, right) => {
    return dateFor(right).localeCompare(dateFor(left));
  });
}

function buildStats(args: {
  runs: WatcherRun[];
  findings: WatcherFinding[];
  candidates: WatcherKnowledgeCandidate[];
  acquisitionTasks: KnowledgeAcquisitionTask[];
}) {
  const byWatcher: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const run of args.runs) {
    increment(byWatcher, run.watcherId);
    increment(byKind, run.watcherKind);
  }

  return {
    runCount: args.runs.length,
    findingCount: args.findings.length,
    candidateCount: args.candidates.length,
    acquisitionTaskCount: args.acquisitionTasks.length,
    activeCandidateCount: args.candidates.filter((candidate) => candidate.state === "active").length,
    guardedCandidateCount: args.candidates.filter((candidate) => candidate.state === "guarded").length,
    byWatcher,
    byKind
  };
}

function emptyState(): WatcherState {
  return watcherStateSchema.parse({
    version: "hydria-watchers-v1",
    generatedAt: new Date().toISOString(),
    sourceStats: {
      runCount: 0,
      findingCount: 0,
      candidateCount: 0,
      acquisitionTaskCount: 0,
      activeCandidateCount: 0,
      guardedCandidateCount: 0,
      byWatcher: {},
      byKind: {}
    },
    runs: [],
    findings: [],
    candidates: [],
    acquisitionTasks: []
  });
}

export class WatcherStore {
  constructor(private readonly filePath = env.WATCHER_STATE_FILE) {}

  async load(): Promise<WatcherState | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return watcherStateSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(state: Omit<WatcherState, "version" | "generatedAt" | "sourceStats">) {
    const runs = latestById(
      state.runs,
      (run) => run.runId,
      (run) => run.completedAt
    ).slice(0, 500);
    const findings = latestById(
      state.findings,
      (finding) => finding.findingId,
      (finding) => finding.createdAt
    ).slice(0, 1000);
    const candidates = latestById(
      state.candidates,
      (candidate) => candidate.candidateId,
      (candidate) => candidate.updatedAt
    ).slice(0, 1000);
    const acquisitionTasks = latestById(
      state.acquisitionTasks,
      (task) => task.taskId,
      (task) => task.createdAt
    ).slice(0, 1000);
    const file = watcherStateSchema.parse({
      version: "hydria-watchers-v1",
      generatedAt: new Date().toISOString(),
      sourceStats: buildStats({ runs, findings, candidates, acquisitionTasks }),
      runs,
      findings,
      candidates,
      acquisitionTasks
    });

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    return file;
  }

  async appendRun(run: WatcherRun) {
    const current = (await this.load()) ?? emptyState();
    return this.save({
      runs: [run, ...current.runs],
      findings: [...run.findings, ...current.findings],
      candidates: [...run.candidates, ...current.candidates],
      acquisitionTasks: [...run.acquisitionTasks, ...current.acquisitionTasks]
    });
  }
}

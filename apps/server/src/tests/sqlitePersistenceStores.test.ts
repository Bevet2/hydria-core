import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HistoryStore } from "../services/historyStore.js";
import { InteractionLogStore } from "../services/interactionLogStore.js";
import { StudentSessionStore } from "../services/studentSessionStore.js";
import {
  buildArenaRoundFixture,
  buildStudentSessionFixture
} from "./testFixtures.js";

test("history store reloads rounds from sqlite even if the json projection is corrupted", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-history-sqlite-"));
  let writer: HistoryStore | null = null;
  let reader: HistoryStore | null = null;
  try {
    const historyFile = join(tempRoot, "history.json");
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    const datasetFile = join(tempRoot, "rounds.jsonl");
    const round = buildArenaRoundFixture();

    writer = new HistoryStore(historyFile, databaseFile, datasetFile);
    await writer.appendRound(round);

    await writeFile(historyFile, "{not valid json", "utf8");

    reader = new HistoryStore(historyFile, databaseFile, datasetFile);
    const rounds = await reader.listRounds();
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]?.roundId, round.roundId);

    const projection = await readFile(historyFile, "utf8");
    assert.match(projection, new RegExp(round.roundId));
  } finally {
    await writer?.close?.();
    await reader?.close?.();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("history store no longer truncates arena rounds to 100 entries", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-history-unbounded-"));
  let store: HistoryStore | null = null;
  try {
    const historyFile = join(tempRoot, "history.json");
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    const datasetFile = join(tempRoot, "rounds.jsonl");

    store = new HistoryStore(historyFile, databaseFile, datasetFile);

    for (let index = 0; index < 105; index += 1) {
      await store.appendRound(
        buildArenaRoundFixture({
          roundId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
          createdAt: `2026-04-20T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
        })
      );
    }

    const rounds = await store.listRounds();
    assert.equal(rounds.length, 105);

    const projection = JSON.parse(await readFile(historyFile, "utf8")) as { rounds: unknown[] };
    assert.equal(projection.rounds.length, 105);
  } finally {
    await store?.close?.();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("student session store reloads sessions from sqlite and rewrites the projection when missing", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-student-sqlite-"));
  let writer: StudentSessionStore | null = null;
  let reader: StudentSessionStore | null = null;
  try {
    const historyFile = join(tempRoot, "student-history.json");
    const datasetFile = join(tempRoot, "student-cycles.jsonl");
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    const session = buildStudentSessionFixture();

    writer = new StudentSessionStore(historyFile, datasetFile, databaseFile);
    (writer as any).knowledgeMemoryService = { buildAndPersist: async () => undefined };
    (writer as any).studentRuleImpactTrackerService = { buildAndPersist: async () => undefined };
    (writer as any).studentStrategyImpactTrackerService = { buildAndPersist: async () => undefined };
    (writer as any).studentToolImpactTrackerService = { buildAndPersist: async () => undefined };

    await writer.appendSession(session);
    await rm(historyFile, { force: true });

    reader = new StudentSessionStore(historyFile, datasetFile, databaseFile);
    const sessions = await reader.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.sessionId, session.sessionId);

    const projection = await readFile(historyFile, "utf8");
    assert.match(projection, new RegExp(session.sessionId));
  } finally {
    await writer?.close?.();
    await reader?.close?.();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("interaction log store persists questions, answers, and analysis metadata", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-interactions-sqlite-"));
  let store: InteractionLogStore | null = null;
  try {
    const logFile = join(tempRoot, "hydria-interactions.jsonl");
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    store = new InteractionLogStore(logFile, databaseFile);

    await store.append({
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-05-13T10:00:00.000Z",
      scope: "student_analysis",
      source: "student_lab",
      mode: "student_session",
      status: "completed",
      sessionId: "session-1",
      artifactId: "session-1",
      question: "Explain eventual consistency.",
      answer: "Replicas converge after a delay.",
      summary: "teacher improved the answer",
      routing: {
        orchestrator: "student_learning",
        provider: "ollama",
        model: "qwen2.5:3b",
        category: "technical_explanation",
        toolUsed: false
      },
      quality: {
        passed: true,
        score: 82,
        issues: []
      },
      durationMs: 123,
      payload: {
        judge: "improved"
      }
    });

    assert.equal(await store.count(), 1);
    const records = await store.listRecent();
    assert.equal(records[0]?.question, "Explain eventual consistency.");
    assert.equal(records[0]?.answer, "Replicas converge after a delay.");

    const projection = await readFile(logFile, "utf8");
    assert.match(projection, /student_analysis/);
    assert.match(projection, /teacher improved the answer/);
  } finally {
    await store?.close?.();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

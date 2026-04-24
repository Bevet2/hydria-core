import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  arenaRespondentFailureLogSchema,
  type ArenaRespondentFailureEvent,
  type RespondentFailureClass,
  type RespondentFailureStage,
  type RespondentSlot
} from "../types/analytics.js";
import type { QuestionCategory } from "../types/arena.js";
import { env } from "../utils/env.js";

type RecordRespondentFailureArgs = {
  roundId: string;
  createdAt: string;
  category: QuestionCategory;
  slot: RespondentSlot;
  requestedModel: string;
  finalModel: string;
  failureClass: RespondentFailureClass;
  failureStage: RespondentFailureStage;
  attemptsCount: number;
  validationFailures: number;
  usedRetry: boolean;
  usedFallback: boolean;
  failureMessage: string;
  note: string;
};

type ArenaRespondentFailureStoreOptions = {
  filePath?: string;
};

function truncate(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 14)).trimEnd()} [truncated]`;
}

export class ArenaRespondentFailureStore {
  constructor(private readonly options: ArenaRespondentFailureStoreOptions = {}) {}

  async listEvents() {
    const filePath = this.options.filePath ?? env.ARENA_RESPONDENT_FAILURE_FILE;

    try {
      const raw = await readFile(filePath, "utf8");
      return arenaRespondentFailureLogSchema.parse(JSON.parse(raw)).events;
    } catch {
      return [];
    }
  }

  async recordFailure(args: RecordRespondentFailureArgs) {
    const filePath = this.options.filePath ?? env.ARENA_RESPONDENT_FAILURE_FILE;
    const events = await this.listEvents();
    const nextEvent: ArenaRespondentFailureEvent = {
      eventId: randomUUID(),
      roundId: args.roundId,
      createdAt: args.createdAt,
      category: args.category,
      slot: args.slot,
      requestedModel: truncate(args.requestedModel, 160),
      finalModel: truncate(args.finalModel, 160),
      failureClass: args.failureClass,
      failureStage: args.failureStage,
      attemptsCount: Math.max(0, Math.min(args.attemptsCount, 6)),
      validationFailures: Math.max(0, Math.min(args.validationFailures, 6)),
      usedRetry: args.usedRetry,
      usedFallback: args.usedFallback,
      failureMessage: truncate(args.failureMessage, 240),
      note: truncate(args.note, 320)
    };

    const nextLog = arenaRespondentFailureLogSchema.parse({
      version: "hydria-respondent-failures-v1",
      events: [...events, nextEvent].slice(-500)
    });

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(nextLog, null, 2)}\n`, "utf8");
  }
}

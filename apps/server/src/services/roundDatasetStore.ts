import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArenaRound } from "../types/arena.js";
import {
  roundDatasetEntrySchema,
  type RoundDatasetEntry
} from "../types/roundDataset.js";
import { env } from "../utils/env.js";

export class RoundDatasetStore {
  constructor(private readonly filePath = env.ROUND_DATASET_FILE) {}

  async ensureReady() {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, "", "utf8");
    }
  }

  async appendRound(round: ArenaRound) {
    const entry = roundDatasetEntrySchema.parse(this.buildEntry(round));
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private buildEntry(round: ArenaRound): RoundDatasetEntry {
    const usefulForTraining =
      round.refineDecision.global === "YES" &&
      round.metrics.refineGain.global > 0 &&
      round.verdicts.refineA !== "degrading" &&
      round.verdicts.refineB !== "degrading";

    return {
      datasetVersion: "hydria-round-v1",
      roundId: round.roundId,
      createdAt: round.createdAt,
      question: round.question,
      category: round.category,
      models: round.models,
      orchestration: round.orchestration,
      router: round.router,
      research: round.research,
      refineProfile: round.refineProfile,
      traces: round.trace,
      steps: {
        initial: {
          A: round.outputs.respondentA,
          B: round.outputs.respondentB
        },
        redTeam: round.outputs.redTeam,
        refined: {
          A: round.outputs.refineA,
          B: round.outputs.refineB
        },
        judge: round.outputs.judge,
        synthesizer: round.outputs.synthesizer,
        localStudent: round.outputs.localStudent
      },
      metrics: round.metrics,
      verdicts: round.verdicts,
      refineDecision: round.refineDecision,
      studentSignals: {
        preferredWinner: round.outputs.judge.winner,
        preferredAnswer: round.outputs.synthesizer.final_answer,
        learningNotes: round.outputs.localStudent.learning_notes,
        roundUsefulForTraining: usefulForTraining
      }
    };
  }
}

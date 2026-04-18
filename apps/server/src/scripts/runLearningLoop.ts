import { LocalModelService } from "../services/localModel.js";
import { LearningLoopService } from "../services/learningLoopService.js";
import { ResearchToolService } from "../services/researchToolService.js";
import { StudentTemporalEvalService } from "../services/studentTemporalEvalService.js";

function parseArgs(argv: string[]) {
  const args = {
    validationMode: "temporal_replay" as "none" | "temporal_replay",
    validationLimit: 8
  };

  for (const arg of argv) {
    if (arg.startsWith("--validation=")) {
      const value = arg.slice("--validation=".length).trim().toLowerCase();
      if (value === "none" || value === "temporal-replay") {
        args.validationMode = value === "temporal-replay" ? "temporal_replay" : "none";
      }
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        args.validationLimit = Math.trunc(parsed);
      }
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const temporalEvalService =
  args.validationMode === "temporal_replay"
    ? new StudentTemporalEvalService(
        new LocalModelService(),
        new ResearchToolService({
          acquisitionMode: "replay",
          sourceCacheEnabled: false
        })
      )
    : null;

const service = new LearningLoopService({
  temporalEvalService
});

const result = await service.run({
  validationMode: args.validationMode,
  validationLimit: args.validationLimit
});

console.log(
  JSON.stringify(
    {
      generatedAt: result.report.generatedAt,
      score: result.report.score.overall,
      hotspots: result.report.hotspots.slice(0, 5).map((hotspot) => ({
        hotspotId: hotspot.hotspotId,
        title: hotspot.title,
        weightedScore: hotspot.weightedScore
      })),
      activePolicies: result.report.policies.filter((policy) => policy.state === "active").length,
      guardedPolicies: result.report.policies.filter((policy) => policy.state === "guarded").length,
      validation: result.report.validation
    },
    null,
    2
  )
);

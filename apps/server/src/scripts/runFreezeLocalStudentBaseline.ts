import { resolve } from "node:path";
import { LocalModelService } from "../services/localModel.js";
import { LocalStudentTrainingBaselineService } from "../services/training/localStudentTrainingBaselineService.js";

function parseArgs(argv: string[]) {
  const args = {
    variantId: "student-local-base",
    modelName: undefined as string | undefined,
    outputFile: undefined as string | undefined
  };

  for (const arg of argv) {
    if (arg.startsWith("--variant-id=")) {
      args.variantId = arg.slice("--variant-id=".length).trim() || args.variantId;
    }
    if (arg.startsWith("--model-name=")) {
      const value = arg.slice("--model-name=".length).trim();
      if (value) {
        args.modelName = value;
      }
    }
    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (value) {
        args.outputFile = resolve(value);
      }
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const localModelService = new LocalModelService({
  modelName: args.modelName
});
const service = new LocalStudentTrainingBaselineService(localModelService);
const result = await service.run({
  variantId: args.variantId,
  outputFile: args.outputFile
});

console.log(
  JSON.stringify(
    {
      outputFile: result.outputFile,
      variantId: result.report.variantId,
      modelName: result.report.modelName,
      temporalReplay: result.report.temporalReplay,
      toolRouting: result.report.toolRouting,
      stability: {
        strictRate: result.report.stability.strictRate,
        fallbackRate: result.report.stability.fallbackRate,
        retryRate: result.report.stability.retryRate
      },
      live: {
        averageSessionScore: result.report.live.averageSessionScore,
        improvedRate: result.report.live.improvedRate,
        worthItRate: result.report.live.worthItRate,
        positiveToolImpactRate: result.report.live.positiveToolImpactRate
      }
    },
    null,
    2
  )
);

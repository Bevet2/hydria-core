import { resolve } from "node:path";
import { LocalModelService } from "../services/localModel.js";
import { LocalStudentTrainingBaselineService } from "../services/training/localStudentTrainingBaselineService.js";
import { LocalStudentTrainingComparisonService } from "../services/training/localStudentTrainingComparisonService.js";
import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";

function parseArgs(argv: string[]) {
  const args = {
    beforeBaselineFile: "",
    afterVariantId: "student-local-lora-v1",
    afterModelName: "",
    outputFile: undefined as string | undefined,
    promoteIfGood: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--before-baseline=")) {
      args.beforeBaselineFile = resolve(arg.slice("--before-baseline=".length).trim());
    }
    if (arg.startsWith("--after-variant-id=")) {
      args.afterVariantId =
        arg.slice("--after-variant-id=".length).trim() || args.afterVariantId;
    }
    if (arg.startsWith("--after-model-name=")) {
      args.afterModelName = arg.slice("--after-model-name=".length).trim();
    }
    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (value) {
        args.outputFile = resolve(value);
      }
    }
    if (arg === "--promote-if-good") {
      args.promoteIfGood = true;
    }
  }

  if (!args.beforeBaselineFile) {
    throw new Error("--before-baseline is required.");
  }
  if (!args.afterModelName) {
    throw new Error("--after-model-name is required.");
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const registry = new LocalStudentVariantRegistry();
await registry.ensureBaseVariant();
await registry.registerVariant({
  id: args.afterVariantId,
  name: args.afterVariantId,
  description: `Candidate evaluated local student variant ${args.afterVariantId}.`,
  servedModelName: args.afterModelName,
  state: "candidate"
});

const localModelService = new LocalModelService({
  modelName: args.afterModelName
});
const baselineService = new LocalStudentTrainingBaselineService(localModelService);
const comparisonService = new LocalStudentTrainingComparisonService(baselineService);
const result = await comparisonService.run({
  beforeBaselineFile: args.beforeBaselineFile,
  afterVariantId: args.afterVariantId,
  outputFile: args.outputFile,
  promoteIfGood: args.promoteIfGood
});

console.log(
  JSON.stringify(
    {
      outputFile: result.outputFile,
      decision: result.report.decision,
      deltas: result.report.deltas
    },
    null,
    2
  )
);

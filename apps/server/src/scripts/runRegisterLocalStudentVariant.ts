import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";

function parseArgs(argv: string[]) {
  const args = {
    id: "student-local-lora-v1",
    name: "Student Local LoRA v1",
    description: "Candidate LoRA variant for the governed local student.",
    servedModelName: "",
    baseModelName: undefined as string | undefined,
    adapterPath: undefined as string | undefined,
    trainingPackFile: undefined as string | undefined,
    state: "candidate" as const
  };

  for (const arg of argv) {
    if (arg.startsWith("--id=")) {
      args.id = arg.slice("--id=".length).trim() || args.id;
    }
    if (arg.startsWith("--name=")) {
      args.name = arg.slice("--name=".length).trim() || args.name;
    }
    if (arg.startsWith("--description=")) {
      args.description = arg.slice("--description=".length).trim() || args.description;
    }
    if (arg.startsWith("--served-model-name=")) {
      args.servedModelName = arg.slice("--served-model-name=".length).trim();
    }
    if (arg.startsWith("--base-model-name=")) {
      const value = arg.slice("--base-model-name=".length).trim();
      if (value) {
        args.baseModelName = value;
      }
    }
    if (arg.startsWith("--adapter-path=")) {
      const value = arg.slice("--adapter-path=".length).trim();
      if (value) {
        args.adapterPath = value;
      }
    }
    if (arg.startsWith("--training-pack-file=")) {
      const value = arg.slice("--training-pack-file=".length).trim();
      if (value) {
        args.trainingPackFile = value;
      }
    }
  }

  if (!args.servedModelName) {
    throw new Error("--served-model-name is required.");
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const registry = new LocalStudentVariantRegistry();
await registry.ensureBaseVariant();
const variant = await registry.registerVariant({
  id: args.id,
  name: args.name,
  description: args.description,
  servedModelName: args.servedModelName,
  baseModelName: args.baseModelName,
  adapterPath: args.adapterPath ?? null,
  trainingPackFile: args.trainingPackFile ?? null,
  state: args.state
});

console.log(JSON.stringify(variant, null, 2));

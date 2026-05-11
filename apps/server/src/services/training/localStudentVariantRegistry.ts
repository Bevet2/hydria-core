import {
  localStudentModelVariantSchema,
  type LocalStudentModelVariant,
  type LocalStudentVariantState
} from "../../types/training.js";
import { env } from "../../utils/env.js";
import {
  createPersistenceAdapter,
  type PersistenceAdapter
} from "../storage/persistenceAdapter.js";

type RegisterLocalStudentVariantArgs = {
  id: string;
  name: string;
  description: string;
  servedModelName: string;
  baseModelName?: string;
  adapterPath?: string | null;
  trainingPackFile?: string | null;
  baselineFile?: string | null;
  comparisonFile?: string | null;
  confidenceScore?: number;
  notes?: string[];
  state?: LocalStudentVariantState;
};

export class LocalStudentVariantRegistry {
  constructor(private readonly database: PersistenceAdapter = createPersistenceAdapter()) {}

  async ensureReady() {
    await this.database.ensureReady();
  }

  async ensureBaseVariant() {
    await this.ensureReady();
    const existing = await this.database.getLocalModelVariant("student-local-base");
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const variant = localStudentModelVariantSchema.parse({
      id: "student-local-base",
      name: "Student Local Base",
      description: "Baseline governed local student variant backed by the default Ollama model.",
      baseModelName: env.LOCAL_MODEL_NAME,
      servedModelName: env.LOCAL_MODEL_NAME,
      adapterPath: null,
      trainingPackFile: null,
      baselineFile: null,
      comparisonFile: null,
      state: "active",
      confidenceScore: 0.85,
      createdAt: now,
      updatedAt: now,
      lastComparedAt: null,
      notes: ["Canonical baseline variant for local student evaluation."]
    });
    await this.database.upsertLocalModelVariant(variant);
    return variant;
  }

  async registerVariant(args: RegisterLocalStudentVariantArgs) {
    await this.ensureReady();
    const current = await this.database.getLocalModelVariant(args.id);
    const now = new Date().toISOString();

    const variant = localStudentModelVariantSchema.parse({
      id: args.id,
      name: args.name,
      description: args.description,
      baseModelName: args.baseModelName ?? env.LOCAL_MODEL_NAME,
      servedModelName: args.servedModelName,
      adapterPath: args.adapterPath ?? current?.adapterPath ?? null,
      trainingPackFile: args.trainingPackFile ?? current?.trainingPackFile ?? null,
      baselineFile: args.baselineFile ?? current?.baselineFile ?? null,
      comparisonFile: args.comparisonFile ?? current?.comparisonFile ?? null,
      state: args.state ?? current?.state ?? "candidate",
      confidenceScore: args.confidenceScore ?? current?.confidenceScore ?? 0.5,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      lastComparedAt: current?.lastComparedAt ?? null,
      notes: args.notes ?? current?.notes ?? []
    });

    await this.database.upsertLocalModelVariant(variant);
    return variant;
  }

  async getVariant(variantId: string) {
    await this.ensureReady();
    return this.database.getLocalModelVariant(variantId);
  }

  async listVariants(states?: LocalStudentVariantState[]) {
    await this.ensureReady();
    return this.database.listLocalModelVariants(states);
  }

  async updateVariantState(
    variantId: string,
    state: LocalStudentVariantState,
    updates?: Partial<
      Pick<LocalStudentModelVariant, "confidenceScore" | "baselineFile" | "comparisonFile" | "notes">
    >
  ) {
    await this.ensureReady();
    const current = await this.database.getLocalModelVariant(variantId);
    if (!current) {
      return null;
    }

    const updated = localStudentModelVariantSchema.parse({
      ...current,
      state,
      confidenceScore: updates?.confidenceScore ?? current.confidenceScore,
      baselineFile: updates?.baselineFile ?? current.baselineFile,
      comparisonFile: updates?.comparisonFile ?? current.comparisonFile,
      notes: updates?.notes ?? current.notes,
      updatedAt: new Date().toISOString(),
      lastComparedAt:
        updates?.comparisonFile !== undefined ? new Date().toISOString() : current.lastComparedAt
    });
    await this.database.upsertLocalModelVariant(updated);
    return updated;
  }
}

export type { RegisterLocalStudentVariantArgs };

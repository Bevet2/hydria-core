import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  policyOptimizationTraceSchema,
  policyVariantRegistrySchema,
  type PolicyOptimizationTrace,
  type PolicyVariantProposal,
  type PolicyVariantRegistry
} from "../../types/policyOptimization.js";
import { projectRoot } from "../../utils/env.js";

const defaultTraceFile = resolve(projectRoot, "storage", "observability", "hydria-policy-optimization-traces-v1.jsonl");
const defaultVariantFile = resolve(projectRoot, "storage", "learning", "hydria-policy-optimization-variants-v1.json");

function uniqueVariants(variants: PolicyVariantProposal[]) {
  const byId = new Map<string, PolicyVariantProposal>();
  for (const variant of variants) {
    const current = byId.get(variant.variantId);
    if (!current || current.createdAt < variant.createdAt) {
      byId.set(variant.variantId, variant);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.surface.localeCompare(right.surface) ||
      left.targetPolicyId.localeCompare(right.targetPolicyId) ||
      left.variantId.localeCompare(right.variantId)
  );
}

export class PolicyOptimizationTraceStore {
  constructor(
    private readonly traceFile = defaultTraceFile,
    private readonly variantFile = defaultVariantFile
  ) {}

  async appendTrace(trace: PolicyOptimizationTrace) {
    const parsed = policyOptimizationTraceSchema.parse(trace);
    await mkdir(dirname(this.traceFile), { recursive: true });
    await appendFile(this.traceFile, `${JSON.stringify(parsed)}\n`, "utf8");
    return parsed;
  }

  async appendTraces(traces: PolicyOptimizationTrace[]) {
    const parsed = traces.map((trace) => policyOptimizationTraceSchema.parse(trace));
    await mkdir(dirname(this.traceFile), { recursive: true });
    await appendFile(this.traceFile, parsed.map((trace) => JSON.stringify(trace)).join("\n") + "\n", "utf8");
    return parsed;
  }

  async listTraces(limit = 2000) {
    try {
      const raw = await readFile(this.traceFile, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return policyOptimizationTraceSchema.parse(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter((trace): trace is PolicyOptimizationTrace => Boolean(trace))
        .slice(-Math.max(1, limit));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async loadVariantRegistry(): Promise<PolicyVariantRegistry> {
    try {
      const raw = await readFile(this.variantFile, "utf8");
      return policyVariantRegistrySchema.parse(JSON.parse(raw));
    } catch {
      return {
        version: "hydria-policy-optimization-variants-v1",
        generatedAt: new Date().toISOString(),
        variants: []
      };
    }
  }

  async saveVariants(variants: PolicyVariantProposal[]) {
    const registry = policyVariantRegistrySchema.parse({
      version: "hydria-policy-optimization-variants-v1",
      generatedAt: new Date().toISOString(),
      variants: uniqueVariants(variants)
    });
    await mkdir(dirname(this.variantFile), { recursive: true });
    await writeFile(this.variantFile, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    return registry;
  }

  async upsertVariants(variants: PolicyVariantProposal[]) {
    const current = await this.loadVariantRegistry();
    return this.saveVariants([...current.variants, ...variants]);
  }
}

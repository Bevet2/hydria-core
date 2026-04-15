import {
  BENCHMARK_PACK_ID,
  BENCHMARK_PACK_NAME,
  BENCHMARK_PROMPTS
} from "./benchmarkPrompts.js";
import {
  TOOL_BENCHMARK_PACK_ID,
  TOOL_BENCHMARK_PACK_NAME,
  TOOL_BENCHMARK_PROMPTS
} from "./toolBenchmarkPrompts.js";
import type { BenchmarkPack } from "../types/benchmark.js";

export const DEFAULT_BENCHMARK_PACK_ID = BENCHMARK_PACK_ID;

export const BENCHMARK_PACKS: BenchmarkPack[] = [
  {
    benchmarkId: BENCHMARK_PACK_ID,
    name: BENCHMARK_PACK_NAME,
    prompts: BENCHMARK_PROMPTS
  },
  {
    benchmarkId: TOOL_BENCHMARK_PACK_ID,
    name: TOOL_BENCHMARK_PACK_NAME,
    prompts: TOOL_BENCHMARK_PROMPTS
  }
];

export function getBenchmarkPack(benchmarkId?: string | null) {
  const targetId = benchmarkId?.trim() || DEFAULT_BENCHMARK_PACK_ID;
  const pack = BENCHMARK_PACKS.find((entry) => entry.benchmarkId === targetId);

  if (!pack) {
    throw new Error(`Unknown benchmark pack: ${targetId}`);
  }

  return pack;
}

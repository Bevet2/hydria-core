import type { BenchmarkPromptResult } from "../lib/api";

export type BenchmarkMode = "core" | "tool";

export function formatPct(value: number) {
  return `${Math.round(value)}%`;
}

export function formatGain(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function formatResearchMode(value: string) {
  return value.replace(/_/g, " ");
}

export function RunLink({ run }: { run: BenchmarkPromptResult }) {
  if (!run.roundId) {
    return <span className="muted">No round</span>;
  }

  return (
    <a className="benchmark-link" href={`/playground?roundId=${encodeURIComponent(run.roundId)}`}>
      Open round
    </a>
  );
}

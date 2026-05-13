import { InteractionLearningDigestService } from "../services/interactionLearningDigestService.js";

function parseLimit() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  if (!limitArg) {
    return undefined;
  }

  const value = Number(limitArg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

const service = new InteractionLearningDigestService();
const digest = await service.buildAndPersist({
  limit: parseLimit()
});

console.log(
  JSON.stringify(
    {
      version: digest.version,
      generatedAt: digest.generatedAt,
      sourceStats: digest.sourceStats,
      candidateCount: digest.candidates.length,
      activeHintCount: digest.activeHints.length,
      topCandidates: digest.candidates.slice(0, 5).map((candidate) => ({
        candidateId: candidate.candidateId,
        kind: candidate.kind,
        state: candidate.state,
        category: candidate.category,
        evidenceCount: candidate.evidenceCount,
        confidence: candidate.confidence,
        learned: candidate.learned
      }))
    },
    null,
    2
  )
);

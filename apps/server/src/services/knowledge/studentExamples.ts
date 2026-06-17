import {
  studentContrastiveExampleSchema,
  studentCuratedExampleSchema,
  type KnowledgeCategoryInsight,
  type StudentCuratedExample
} from "../../types/knowledge.js";
import type { RoundDatasetEntry } from "../../types/roundDataset.js";
import {
  clamp,
  clampInt,
  knowledgeCategories,
  uniqueStrings,
  type StudentCandidate
} from "./common.js";

export function buildCuratedStudentExamples(
  roundDatasetEntries: RoundDatasetEntry[],
  categoryInsights: KnowledgeCategoryInsight[]
) {
  const insightMap = new Map(categoryInsights.map((insight) => [insight.category, insight]));
  const candidates = roundDatasetEntries
    .filter((entry) => entry.studentSignals.roundUsefulForTraining)
    .filter((entry) => entry.refineDecision.global === "YES")
    .filter((entry) => entry.metrics.refineGain.global > 0)
    .filter((entry) => entry.verdicts.refineA !== "degrading")
    .filter((entry) => entry.verdicts.refineB !== "degrading")
    .filter((entry) => entry.research.impact.netImpact !== "negative")
    .map((entry) => buildStudentCandidate(entry, insightMap.get(entry.category)));
  const compareCandidates = (left: StudentCandidate, right: StudentCandidate) => {
    if (right.selectionScore !== left.selectionScore) {
      return right.selectionScore - left.selectionScore;
    }

    if (right.entry.metrics.refineGain.global !== left.entry.metrics.refineGain.global) {
      return right.entry.metrics.refineGain.global - left.entry.metrics.refineGain.global;
    }

    return (
      right.entry.metrics.scoreAverages.refined - left.entry.metrics.scoreAverages.refined ||
      right.entry.createdAt.localeCompare(left.entry.createdAt)
    );
  };

  const selectedRoundIds = new Set<string>();
  const selectedCandidates: StudentCandidate[] = [];

  for (const category of knowledgeCategories.filter((entry) => entry !== "other")) {
    const rankedForCategory = candidates
      .filter((candidate) => candidate.entry.category === category)
      .sort(compareCandidates);
    const categoryTarget = category === "product_strategy" ? 8 : 6;
    const bestForCategory = rankedForCategory.slice(0, categoryTarget);

    for (const candidate of bestForCategory) {
      if (!selectedRoundIds.has(candidate.entry.roundId)) {
        selectedRoundIds.add(candidate.entry.roundId);
        selectedCandidates.push(candidate);
      }
    }
  }

  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (selectedCandidates.length >= 80) {
      break;
    }
    if (!selectedRoundIds.has(candidate.entry.roundId)) {
      selectedRoundIds.add(candidate.entry.roundId);
      selectedCandidates.push(candidate);
    }
  }

  return selectedCandidates
    .sort(compareCandidates)
    .slice(0, 80)
    .map((candidate) => {
      const { entry, insight } = candidate;
      const coachingNotes = uniqueStrings([
        ...entry.studentSignals.learningNotes,
        ...entry.metrics.scoreExplanation.A.improvements,
        ...entry.metrics.scoreExplanation.B.improvements,
        ...(insight?.winningPatterns.slice(0, 3).map((pattern) => pattern.text) ?? [])
      ]).slice(0, 12).map((note) => note.length > 237 ? `${note.slice(0, 237).trim()}...` : note);

      return studentCuratedExampleSchema.parse({
        datasetVersion: "hydria-student-curated-v1",
        roundId: entry.roundId,
        createdAt: entry.createdAt,
        category: entry.category,
        prompt: entry.question,
        targetAnswer: candidate.targetAnswer,
        targetSource: candidate.targetSource,
        preferredWinner: entry.studentSignals.preferredWinner,
        globalGain: entry.metrics.refineGain.global,
        refinedAverageScore: entry.metrics.scoreAverages.refined,
        researchUsed: entry.research.used,
        selectionScore: candidate.selectionScore,
        selectionTier: candidate.selectionTier,
        coachingNotes:
          coachingNotes.length > 0
            ? coachingNotes
            : [
                "Prefer the synthesized answer that best integrates critique and keeps uncertainty explicit."
              ],
        winningPatterns:
          insight?.winningPatterns.slice(0, 4).map((pattern) => pattern.text) ?? [],
        antiPatterns: candidate.antiPatterns,
        strategyNote:
          insight?.strategy.note ??
          "Prefer outputs that integrate critique while preserving actionability and explicit uncertainty."
      });
    });
}

export function buildContrastiveStudentExamples(
  curatedStudentExamples: StudentCuratedExample[],
  roundDatasetEntries: RoundDatasetEntry[],
  categoryInsights: KnowledgeCategoryInsight[]
) {
  const roundMap = new Map(roundDatasetEntries.map((entry) => [entry.roundId, entry]));
  const insightMap = new Map(categoryInsights.map((insight) => [insight.category, insight]));

  return curatedStudentExamples.flatMap((curated) => {
    const round = roundMap.get(curated.roundId);
    if (!round) {
      return [];
    }

    const sourceSource = selectContrastiveSource(round);
    const sourceAnswer =
      sourceSource === "initial_B" ? round.steps.initial.B.answer : round.steps.initial.A.answer;
    const sourceInitialOverall =
      sourceSource === "initial_B"
        ? round.steps.judge.initial_scores.B.overall
        : round.steps.judge.initial_scores.A.overall;
    const improvedDelta = clampInt(round.metrics.scoreAverages.refined - sourceInitialOverall, 0, 100);
    const insight = insightMap.get(round.category);
    const transformationNotes = uniqueStrings([
      ...round.metrics.scoreExplanation.A.improvements,
      ...round.metrics.scoreExplanation.B.improvements,
      ...round.steps.refined.A.fixes_applied,
      ...round.steps.refined.B.fixes_applied,
      ...round.studentSignals.learningNotes,
      ...(insight?.winningPatterns.slice(0, 2).map((pattern) => pattern.text) ?? [])
    ]).slice(0, 14);

    return [
      studentContrastiveExampleSchema.parse({
        datasetVersion: "hydria-student-contrast-v1",
        roundId: curated.roundId,
        createdAt: curated.createdAt,
        category: curated.category,
        prompt: curated.prompt,
        sourceAnswer,
        sourceSource,
        targetAnswer: curated.targetAnswer,
        targetSource: curated.targetSource,
        preferredWinner: curated.preferredWinner,
        globalGain: curated.globalGain,
        improvedDelta,
        researchUsed: curated.researchUsed,
        selectionScore: curated.selectionScore,
        selectionTier: curated.selectionTier,
        transformationNotes:
          transformationNotes.length > 0
            ? transformationNotes
            : [
                "Turn the weaker initial answer into a more robust final answer by integrating critique, explicit uncertainty, and stronger operational detail."
              ],
        antiPatterns: curated.antiPatterns,
        strategyNote: curated.strategyNote
      })
    ];
  });
}

function buildStudentCandidate(
  entry: RoundDatasetEntry,
  insight: KnowledgeCategoryInsight | undefined
): StudentCandidate {
  const targetSource = selectStudentTargetSource(entry);
  const targetAnswer =
    targetSource === "winner_refined"
      ? entry.steps.refined[entry.studentSignals.preferredWinner === "B" ? "B" : "A"]
          .improved_answer
      : entry.steps.synthesizer.final_answer;
  const selectionScore = scoreStudentCandidate(entry, insight);
  const selectionTier = selectionScore >= 85 ? "gold" : selectionScore >= 70 ? "silver" : "bronze";

  return {
    entry,
    insight,
    selectionScore,
    selectionTier,
    targetSource,
    targetAnswer,
    antiPatterns: insight?.losingPatterns.slice(0, 4).map((pattern) => pattern.text) ?? []
  };
}

function scoreStudentCandidate(
  entry: RoundDatasetEntry,
  insight: KnowledgeCategoryInsight | undefined
) {
  const winner =
    entry.studentSignals.preferredWinner === "B"
      ? "B"
      : entry.studentSignals.preferredWinner === "A"
        ? "A"
        : null;
  const winnerRefine = winner === null ? null : entry.steps.refined[winner];
  const synthLen = entry.steps.synthesizer.final_answer.length;
  const winnerLen = winnerRefine?.improved_answer.length ?? 0;
  const staticFallbackCount =
    (entry.traces.refineA.outcome === "static_fallback" ? 1 : 0) +
    (entry.traces.refineB.outcome === "static_fallback" ? 1 : 0);
  const usefulFixes =
    entry.steps.refined.A.fixes_applied.length + entry.steps.refined.B.fixes_applied.length;

  let score =
    40 +
    clamp(entry.metrics.refineGain.global * 2.5, 0, 28) +
    clamp(entry.metrics.scoreAverages.refined - 78, 0, 14) +
    clamp(usefulFixes, 0, 10) +
    (entry.research.impact.netImpact === "positive" ? 4 : 0) +
    (winner !== null ? 4 : 0);

  if (entry.refineDecision.global === "YES") {
    score += 6;
  }
  if (staticFallbackCount > 0) {
    score -= staticFallbackCount * 8;
  }
  if (entry.category === "operational_writing" || entry.category === "product_strategy") {
    if (winnerLen > 0 && synthLen > winnerLen * 1.35) {
      score -= 4;
    }
  }
  if ((insight?.benchmark.staticFallbackRate ?? 0) >= 15) {
    score += 2;
  }
  if ((insight?.benchmark.noOpRate ?? 0) >= 20) {
    score += 2;
  }

  return clampInt(score, 0, 100);
}

function selectStudentTargetSource(entry: RoundDatasetEntry): "synthesizer" | "winner_refined" {
  const winner =
    entry.studentSignals.preferredWinner === "B"
      ? "B"
      : entry.studentSignals.preferredWinner === "A"
        ? "A"
        : null;
  if (winner === null) {
    return "synthesizer";
  }

  const winnerAnswer = entry.steps.refined[winner].improved_answer;
  const synthAnswer = entry.steps.synthesizer.final_answer;

  if (
    (entry.category === "operational_writing" || entry.category === "product_strategy") &&
    synthAnswer.length > winnerAnswer.length * 1.35
  ) {
    return "winner_refined";
  }

  if (
    entry.research.impact.netImpact === "positive" &&
    entry.steps.synthesizer.based_on_winner === winner
  ) {
    return "synthesizer";
  }

  if (
    entry.metrics.refineGain.global >= 12 &&
    winnerAnswer.length > 0 &&
    synthAnswer.length > winnerAnswer.length * 1.6
  ) {
    return "winner_refined";
  }

  return "synthesizer";
}

function selectContrastiveSource(entry: RoundDatasetEntry): "initial_A" | "initial_B" {
  const scoreA = entry.steps.judge.initial_scores.A.overall;
  const scoreB = entry.steps.judge.initial_scores.B.overall;

  if (scoreB < scoreA) {
    return "initial_B";
  }

  if (scoreA < scoreB) {
    return "initial_A";
  }

  return entry.studentSignals.preferredWinner === "B" ? "initial_A" : "initial_B";
}

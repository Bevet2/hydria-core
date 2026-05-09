import type { RespondentOutput } from "../types/arena.js";

type ProductStrategySignals = {
  goalSignals: number;
  sequencingSignals: number;
  prioritizationSignals: number;
  riskSignals: number;
  metricSignals: number;
  dependencySignals: number;
  decisionSignals: number;
  fluffSignals: number;
  strongSignalCount: number;
};

const goalPatterns = [
  /\bobjective\b/i,
  /\bgoal\b/i,
  /\bprimary objective\b/i,
  /\btarget outcome\b/i,
  /\bbusiness outcome\b/i,
  /\bprimary user\b/i,
  /\btarget (?:user|segment|customer|persona|buyer|market)\b/i,
  /\bfirst use case\b/i,
  /\bone (?:narrow|clear|specific|concrete|focused)?\s*(?:wedge|use case)\b/i,
  /\blaunch (?:the assistant|with|around)\b/i
];

const sequencingPatterns = [
  /\bphase\s*[1-3]\b/i,
  /\bphase one\b/i,
  /\bphase two\b/i,
  /\bphase three\b/i,
  /\bstep\s*[1-5]\b/i,
  /\bfirst\b/i,
  /\bthen\b/i,
  /\bnext\b/i,
  /\blater\b/i,
  /\bsequence\b/i
];

const prioritizationPatterns = [
  /\bpriorit/i,
  /\bhighest priority\b/i,
  /\btop priority\b/i,
  /\bdepriorit/i,
  /\bfocus first\b/i,
  /\bnow\b.*\blater\b/i
];

const riskPatterns = [
  /\brisks?\b/i,
  /\bconstraints?\b/i,
  /\btrade-?off\b/i,
  /\bbottlenecks?\b/i,
  /\bfailure mode\b/i,
  /\badoption risk\b/i,
  /\bresource limits?\b/i,
  /\btiming risks?\b/i,
  /\bsupport load\b/i,
  /\boperational load\b/i
];

const metricPatterns = [
  /\bmetric\b/i,
  /\bkpi\b/i,
  /\bsuccess (?:criterion|criteria|metric|signal)\b/i,
  /\bmeasure\b/i,
  /\badoption\b/i,
  /\bactivation\b/i,
  /\bretention\b/i,
  /\bconversion\b/i,
  /\busage\b/i,
  /\bvalidation signal\b/i
];

const dependencyPatterns = [
  /\bdependenc(?:y|ies)\b/i,
  /\bdepends on\b/i,
  /\bprerequisites?\b/i,
  /\bblocked by\b/i,
  /\borg\b/i,
  /\bheadcount\b/i,
  /\bresources?\b/i,
  /\btiming\b/i,
  /\bgo-?to-?market\b/i,
  /\bassumptions?\b/i,
  /\bteam capacity\b/i,
  /\bsupport capacity\b/i
];

const decisionPatterns = [
  /\bchoose\b/i,
  /\bdecision\b/i,
  /\bbet\b/i,
  /\bnot now\b/i,
  /\bdo not\b/i,
  /\bshould\b/i,
  /\bonly if\b/i,
  /\bguardrail\b/i
];

const fluffPatterns = [
  /\balign stakeholders\b/i,
  /\bleverage synergies?\b/i,
  /\bholistic\b/i,
  /\bworld[- ]class\b/i,
  /\bbest[- ]in[- ]class\b/i,
  /\bseamless\b/i,
  /\bmove the needle\b/i,
  /\bunlock value\b/i,
  /\bdrive synergies?\b/i,
  /\bensure execution\b/i
];

function countMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function buildSearchText(response: Pick<RespondentOutput, "answer" | "key_points" | "assumptions">) {
  return [response.answer, ...response.key_points, ...response.assumptions].join("\n");
}

export function analyzeProductStrategySignals(
  response: Pick<RespondentOutput, "answer" | "key_points" | "assumptions">
): ProductStrategySignals {
  const text = buildSearchText(response);

  const goalSignals = countMatches(text, goalPatterns);
  const sequencingSignals = countMatches(text, sequencingPatterns);
  const prioritizationSignals = countMatches(text, prioritizationPatterns);
  const riskSignals = countMatches(text, riskPatterns);
  const metricSignals = countMatches(text, metricPatterns);
  const dependencySignals = countMatches(text, dependencyPatterns);
  const decisionSignals = countMatches(text, decisionPatterns);
  const fluffSignals = countMatches(text, fluffPatterns);

  const strongSignalCount = [
    goalSignals > 0,
    sequencingSignals > 0 || prioritizationSignals > 0,
    riskSignals > 0,
    metricSignals > 0,
    dependencySignals > 0 || decisionSignals > 0
  ].filter(Boolean).length;

  return {
    goalSignals,
    sequencingSignals,
    prioritizationSignals,
    riskSignals,
    metricSignals,
    dependencySignals,
    decisionSignals,
    fluffSignals,
    strongSignalCount
  };
}

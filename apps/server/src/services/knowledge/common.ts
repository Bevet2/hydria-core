import type { QuestionCategory } from "../../types/arena.js";
import type {
  KnowledgeCategoryInsight,
  KnowledgeCategoryStrategy
} from "../../types/knowledge.js";
import type { RoundDatasetEntry } from "../../types/roundDataset.js";

export const knowledgeCategories = [
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning",
  "other"
] as const satisfies QuestionCategory[];

export type PatternDefinition = {
  label: string;
  matchers: RegExp[];
};

export type SideSample = {
  slot: "A" | "B";
  gain: number;
  qualityScore: number;
  riskScore: number;
  directCritiques: number;
  structuralRiskCount: number;
  executed: boolean;
  useful: boolean;
  weak: boolean;
};

export type StudentCandidate = {
  entry: RoundDatasetEntry;
  insight: KnowledgeCategoryInsight | undefined;
  selectionScore: number;
  selectionTier: "gold" | "silver" | "bronze";
  targetSource: "synthesizer" | "winner_refined";
  targetAnswer: string;
  antiPatterns: string[];
};

export const positivePatternDefinitions: PatternDefinition[] = [
  {
    label: "Make step ordering and execution sequence explicit.",
    matchers: [/step ordering/i, /\bsequence/i, /\bphase\b/i, /\broadmap\b/i, /\bpriorit/i]
  },
  {
    label: "Preserve evidence and name concrete validation checks.",
    matchers: [
      /\bevidence\b/i,
      /\bforensic/i,
      /\baudit/i,
      /\bvalidate/i,
      /\bhealth check/i,
      /\brollback/i
    ]
  },
  {
    label: "State assumptions, constraints, and uncertainties explicitly.",
    matchers: [/\bassumption/i, /\bconstraint/i, /\buncertain/i, /\bdepends\b/i, /\blimit/i]
  },
  {
    label: "Add concrete risks, dependencies, and fallback conditions.",
    matchers: [/\brisk/i, /\bdependency/i, /\bfallback/i, /\bcontingency/i, /\bcutover/i]
  },
  {
    label: "Add metrics, success criteria, or validation signals.",
    matchers: [/\bmetric/i, /\bsuccess/i, /\bkpi/i, /\bvalidation signal/i, /\badoption/i]
  },
  {
    label: "Clarify tradeoffs instead of presenting one perfect answer.",
    matchers: [/\btrade[- ]?off/i, /\balternative/i, /\bcompromise/i, /\bwhere supported/i]
  },
  {
    label: "Reduce hallucination risk by qualifying provider- or context-specific claims.",
    matchers: [/\bprovider\b/i, /\bcontext\b/i, /\bplatform limitation/i, /\bwhere supported/i]
  },
  {
    label: "Improve pedagogy with examples, contrasts, and clearer definitions.",
    matchers: [/\bexample/i, /\bcontrast/i, /\bdefinition/i, /\bclarif/i]
  }
];

export const negativePatternDefinitions: PatternDefinition[] = [
  {
    label: "Avoid generic best-practice language that does not change execution.",
    matchers: [/\bgeneric/i, /\bbest practice/i, /\bboilerplate/i, /\btemplate/i, /\bvague/i]
  },
  {
    label: "Avoid plans without prioritization or sequencing.",
    matchers: [/\bpriorit/i, /\bsequence/i, /\border/i, /\bphase/i]
  },
  {
    label: "Avoid unsupported specificity or potentially false claims.",
    matchers: [/\bpotentially false/i, /\boverstate/i, /\bunsupported/i, /\bhallucination/i]
  },
  {
    label: "Avoid missing metrics, success criteria, or validation gates.",
    matchers: [/\bmetric/i, /\bsuccess/i, /\bkpi/i, /\bvalidation/i]
  },
  {
    label: "Avoid weak tradeoff handling and missing constraints.",
    matchers: [/\btrade[- ]?off/i, /\bconstraint/i, /\bdependency/i, /\blimit/i]
  },
  {
    label: "Avoid overconfident diagnostics without evidence collection.",
    matchers: [/\bevidence gap/i, /\blogging incomplete/i, /\bcannot prove/i, /\bproof\b/i]
  },
  {
    label: "Avoid noise that adds wording without new facts or operational detail.",
    matchers: [/\bnoise\b/i, /\bfluff\b/i, /\bcorporate\b/i, /\bbuzzword/i]
  }
];

export function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

export function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return roundToOneDecimal((sorted[middle - 1]! + sorted[middle]!) / 2);
  }

  return roundToOneDecimal(sorted[middle]!);
}

export function percentage(part: number, whole: number) {
  if (whole === 0) {
    return 0;
  }

  return roundToOneDecimal((part / whole) * 100);
}

export function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export const defaultDatasetResearch = {
  considered: false,
  used: false,
  route: "not_needed" as const,
  decision: {
    shouldUse: false,
    mode: "off" as const,
    expectedValue: "low" as const,
    expectedCostMs: 0,
    triggerSignals: ["dataset_backfill"],
    targetClaims: [],
    reasoning: "Legacy dataset entry stored before research decision accounting was introduced."
  },
  queryPlan: {
    intent: "fact_check" as const,
    queries: [],
    selectedQuery: null,
    requiredTerms: [],
    preferredDomains: [],
    factFocusTerms: [],
    entityTerms: [],
    temporalProfile: {
      isTemporal: false,
      focus: "none" as const,
      recencyDays: null,
      absoluteDateHint: null,
      dateRangeStart: null,
      dateRangeEnd: null,
      queryDirectives: [],
      answerDirectives: []
    }
  },
  query: null,
  reasons: ["Legacy dataset entry stored before research-tool logging was introduced."],
  summary: [],
  sources: [],
  verification: {
    sourceCount: 0,
    extractedSourceCount: 0,
    corroboratedSignals: []
  },
  appliedTo: {
    A: false,
    B: false
  },
  impact: {
    refineChangedBecauseOfTool: false,
    addedFactsCount: 0,
    correctedClaimsCount: 0,
    sourceBackedClaimsCount: 0,
    costSharePct: 0,
    netImpact: "unknown" as const
  },
  impactNotes: [],
  durationMs: 0
};

export const defaultStrategies: Record<QuestionCategory, KnowledgeCategoryStrategy> = {
  incident_response: {
    routingRecommendation: "selective",
    routerBias: 8,
    toolRecommendation: "verify_only",
    refineWhen: { minRiskScore: 52, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 72 },
    skipWhen: { maxRiskScore: 28, minQualityScore: 84, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "High factual or operational risk",
      "Evidence preservation missing",
      "Rollback or validation not explicit"
    ],
    lowValueSignals: [
      "Already concrete and low risk",
      "Mostly stylistic clean-up",
      "No provider-specific claim to verify"
    ],
    note: "Refine helps when incident handling is concrete, operational, and risk-aware."
  },
  architecture_design: {
    routingRecommendation: "selective",
    routerBias: 3,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 58, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 68 },
    skipWhen: { maxRiskScore: 26, minQualityScore: 84, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Tradeoffs are missing",
      "Constraints or scale assumptions are weak",
      "A specific provider constraint needs validation"
    ],
    lowValueSignals: [
      "Already balanced on tradeoffs",
      "Purely generic system-design search query",
      "Good answer with low structural risk"
    ],
    note: "Architecture refine is valuable when it sharpens constraints and tradeoffs, not when it adds generic system-design prose."
  },
  technical_explanation: {
    routingRecommendation: "prefer_refine",
    routerBias: 10,
    toolRecommendation: "prefer_grounded",
    refineWhen: { minRiskScore: 46, minDirectCritiques: 1, minStructuralRiskCount: 3, maxQualityScore: 78 },
    skipWhen: { maxRiskScore: 22, minQualityScore: 88, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Definition or mechanism is under-specified",
      "Provider, standard, or protocol claim appears",
      "Examples or contrasts are missing"
    ],
    lowValueSignals: [
      "Already precise and well-scaffolded",
      "No factual claim worth grounding",
      "Purely stylistic rewrite"
    ],
    note: "Technical explanation is a strong category when refine improves pedagogy and factual precision together."
  },
  debug_diagnostic: {
    routingRecommendation: "selective",
    routerBias: 5,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 62, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 64 },
    skipWhen: { maxRiskScore: 30, minQualityScore: 82, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Diagnosis sounds too certain",
      "Checks or next steps are missing",
      "Known product behavior or error semantics must be verified"
    ],
    lowValueSignals: [
      "Already hypothesis-driven and cautious",
      "Search would only pull generic troubleshooting lists",
      "Little factual claim to verify"
    ],
    note: "Debug refine helps when it keeps the answer evidence-driven and prevents overconfident diagnosis."
  },
  product_strategy: {
    routingRecommendation: "selective",
    routerBias: 6,
    toolRecommendation: "avoid",
    refineWhen: { minRiskScore: 56, minDirectCritiques: 2, minStructuralRiskCount: 4, maxQualityScore: 66 },
    skipWhen: { maxRiskScore: 34, minQualityScore: 80, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Priorities or phases are missing",
      "No metrics or validation gates",
      "Strategy sounds polished but non-actionable"
    ],
    lowValueSignals: [
      "Already concrete with sequencing and metrics",
      "External grounding would just add generic market advice",
      "Low-risk answer with explicit tradeoffs"
    ],
    note: "Product strategy gains mostly from prioritization, metrics, and anti-fluff discipline, not from web enrichment."
  },
  operational_writing: {
    routingRecommendation: "prefer_refine",
    routerBias: 12,
    toolRecommendation: "avoid",
    refineWhen: { minRiskScore: 42, minDirectCritiques: 1, minStructuralRiskCount: 2, maxQualityScore: 82 },
    skipWhen: { maxRiskScore: 18, minQualityScore: 90, maxDirectCritiques: 0, maxStructuralRiskCount: 1 },
    highValueSignals: [
      "Structure is unclear",
      "Too much noise for an execution-oriented message",
      "Operational hierarchy is weak"
    ],
    lowValueSignals: [
      "Already concise and directly usable",
      "Grounding would add templates rather than value",
      "Low-risk answer with clean structure"
    ],
    note: "Operational writing benefits from sharper structure and signal density, not from more external content."
  },
  mixed_reasoning: {
    routingRecommendation: "prefer_refine",
    routerBias: 9,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 50, minDirectCritiques: 2, minStructuralRiskCount: 3, maxQualityScore: 74 },
    skipWhen: { maxRiskScore: 26, minQualityScore: 86, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: [
      "Theory and application are disconnected",
      "One subpart contains factual risk",
      "Reasoning needs explicit limits or tradeoffs"
    ],
    lowValueSignals: [
      "Already balanced across theory and application",
      "Grounding would over-weight the factual subpart",
      "Low-risk answer with strong structure"
    ],
    note: "Mixed reasoning works best when refine keeps breadth but tightens the factual subpart and the decision logic."
  },
  other: {
    routingRecommendation: "insufficient_data",
    routerBias: 0,
    toolRecommendation: "conditional",
    refineWhen: { minRiskScore: 55, minDirectCritiques: 2, minStructuralRiskCount: 3, maxQualityScore: 70 },
    skipWhen: { maxRiskScore: 25, minQualityScore: 84, maxDirectCritiques: 1, maxStructuralRiskCount: 2 },
    highValueSignals: ["High risk and clear critique volume"],
    lowValueSignals: ["Low risk and already strong quality"],
    note: "Fallback strategy used when category-specific evidence is sparse."
  }
};

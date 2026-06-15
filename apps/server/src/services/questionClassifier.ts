import type { QuestionCategory } from "../types/arena.js";

export type QuestionClassificationResult = {
  category: QuestionCategory;
  confidence: number;
  matchedSignals: string[];
  secondaryCategory: QuestionCategory | null;
};

type CategoryRule = {
  signal: string;
  weight: number;
  pattern: RegExp;
};

const CATEGORIES: Array<Exclude<QuestionCategory, "other">> = [
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning"
];

const CATEGORY_RULES: Record<Exclude<QuestionCategory, "other">, CategoryRule[]> = {
  incident_response: [
    { signal: "incident vocabulary", weight: 5, pattern: /\b(?:incident|outage|downtime|production down|service down|major incident|sev[ -]?[123])\b/i },
    { signal: "security containment", weight: 5, pattern: /\b(?:leak|leaked|breach|compromise|compromised|ransomware|ransom|rancon|malware|credential|credentials|phishing|unauthorized access|secret|api key|token|webhook secret)\b/i },
    { signal: "response actions", weight: 4, pattern: /\b(?:contain|containment|forensic|triage|rotate|revoke|rollback|restore|recover|post-incident)\b/i },
    { signal: "french incident", weight: 5, pattern: /\b(?:incident|panne|fuite|compromis|compromise|attaque|rancongiciel|rancon|restaurer|contenir|rotation de cle|cle api|acces admin|acces non autorise)\b/i },
    { signal: "customer impact", weight: 3, pattern: /\b(?:customers affected|impact client|clients touches|data exposure|exposition de donnees)\b/i }
  ],
  architecture_design: [
    { signal: "architecture intent", weight: 5, pattern: /\b(?:design|architect|architecture|system design|propose an architecture|concevoir|concois|conception)\b/i },
    { signal: "distributed systems", weight: 4, pattern: /\b(?:microservice|monolith|api gateway|event[- ]driven|message queue|queue|streaming|pipeline|multi[- ]tenant|multi[- ]region|tenant|offline-first|sync serveur)\b/i },
    { signal: "scale and reliability", weight: 4, pattern: /\b(?:scalable|scale|fault[- ]tolerant|high availability|millions|concurrent users|latency budget|throughput)\b/i },
    { signal: "migration architecture", weight: 4, pattern: /\b(?:migration path|split(?:ting)? a monolith|service boundary|data contract|backfill|dual[- ]write|strangler)\b/i },
    { signal: "french architecture", weight: 4, pattern: /\b(?:architecture|pipeline|file de traitement|temps reel|systeme distribue|scalable|haute disponibilite|isoler les donnees|versionner une api|ci\/cd)\b/i }
  ],
  technical_explanation: [
    { signal: "explanation intent", weight: 5, pattern: /^(?:explain|clarify|describe|what is|what are|explique|decris|decrire|c'est quoi|qu'est-ce que)\b/i },
    { signal: "difference intent", weight: 4, pattern: /\b(?:difference between|tradeoffs between|compare|vs\.?|versus|difference entre|comparer)\b/i },
    { signal: "technical concept", weight: 3, pattern: /\b(?:oauth|jwt|cap theorem|consensus|eventual consistency|idempotency|kafka|rabbitmq|vector database|embedding|lora|rate limit|cache|index)\b/i },
    { signal: "why concept", weight: 3, pattern: /\b(?:why does|why is|pourquoi|purpose of|role of|a quoi sert)\b/i },
    { signal: "conceptual how", weight: 3, pattern: /\b(?:how does|how do|comment fonctionne|comment marche|explique comment)\b/i },
    { signal: "direct computation", weight: 3, pattern: /\b(?:calculate|compute|convert|convertis|combien font|percentage increase|hours and minutes|celsius|fahrenheit|miles|km)\b/i },
    { signal: "direct live factual lookup", weight: 2, pattern: /\b(?:weather|meteo|temperature|humidity|windy|pleuvoir|snow|prix|price|exchange rate|heure|date|today|ceo actuel|president actuel|latest version|derniere version)\b/i }
  ],
  debug_diagnostic: [
    { signal: "debug intent", weight: 5, pattern: /\b(?:debug|diagnose|diagnostic|investigate|troubleshoot|root cause|rca|reproduce|repro)\b/i },
    { signal: "symptoms", weight: 4, pattern: /\b(?:fails?|failed|failure|error|exception|crash|timeout|slow|latency|memory leak|deadlock|stale data|hangs?|broken)\b/i },
    { signal: "french debug", weight: 5, pattern: /\b(?:debug|diagnostiquer|diagnostique|diagnostic|enqueter|pourquoi.*(?:echoue|plante|lent|bloque)|erreur|latence|fuite memoire|causes probables|comment trouver le bug|que verifier|comment corriger)\b/i },
    { signal: "status codes", weight: 3, pattern: /\b(?:401|403|404|409|429|500|502|503|504)\b/i },
    { signal: "pipeline failure", weight: 3, pattern: /\b(?:ci failed|benchmark failed|deployment failed|pipeline failed|job failed|build error|test failure)\b/i }
  ],
  product_strategy: [
    { signal: "product strategy", weight: 5, pattern: /\b(?:product strategy|roadmap|prioriti[sz]e|mvp|go[- ]to[- ]market|gtm|pricing|positioning|market|wedge)\b/i },
    { signal: "metrics and kpi", weight: 4, pattern: /\b(?:kpi|okr|north star|measure success|success metric|activation|retention|conversion|churn|roi)\b/i },
    { signal: "rollout and adoption", weight: 3, pattern: /\b(?:roll out|launch plan|pilot|beta|adoption|stakeholder|customer feedback|user feedback)\b/i },
    { signal: "french product", weight: 5, pattern: /\b(?:strategie produit|feuille de route|prioriser|mvp|kpi|lancement|pilote client|adoption|positionnement|tarification|valeur|produit ia|souverain)\b/i },
    { signal: "feature decision", weight: 3, pattern: /\b(?:which feature|feature set|decide whether|should we keep|build vs buy|valeur produit|supprimer une fonctionnalite|integrer une api|api cloud|open source local)\b/i }
  ],
  operational_writing: [
    { signal: "writing intent", weight: 5, pattern: /\b(?:write|draft|rewrite|rephrase|summari[sz]e|polish|compose|prepare|redige|r(?:e|\u00e9)dige|ecris|(?:e|\u00e9)cris|reformule|resume|r(?:e|\u00e9)sume)\b/i },
    { signal: "operational artifact", weight: 4, pattern: /\b(?:runbook|postmortem|checklist|playbook|status update|weekly update|incident update|migration plan|release note|guideline|policy|template|sop|support macro)\b/i },
    { signal: "french artifact", weight: 4, pattern: /\b(?:runbook|postmortem|checklist|liste de controle|point hebdomadaire|update hebdomadaire|note interne|mail|email|message client|plan de migration|sop|procedure)\b/i },
    { signal: "document structure", weight: 4, pattern: /\b(?:structur|outline|plan|document|modele|template).{0,80}\b(?:migration|runbook|incident|release|postmortem|projet)\b/i },
    { signal: "communication format", weight: 3, pattern: /\b(?:email|slack|announcement|memo|internal note|customer message|executive summary|resume executif)\b/i },
    { signal: "structured output request", weight: 2, pattern: /\b(?:bullet|bullets|table|outline|structure|format|rubric|scorecard)\b/i }
  ],
  mixed_reasoning: [
    { signal: "tradeoff request", weight: 4, pattern: /\b(?:tradeoff|trade-off|pros and cons|risks?|limitations?|constraints?|dependencies|risques?|limites?|contraintes?)\b/i },
    { signal: "decision request", weight: 4, pattern: /\b(?:should|would you|recommend|choose|decide|evaluate|assess|faut-il|recommande|choisir|evaluer|arbitrer)\b/i },
    { signal: "multi-part reasoning", weight: 3, pattern: /\b(?:compare.+and|explain.+then|list.+and|diagnose.+then|propose.+and|prioritize.+and)\b/i },
    { signal: "scenario application", weight: 3, pattern: /\b(?:apply it to|real-world case|given this scenario|dans ce contexte|cas concret)\b/i },
    { signal: "alternatives", weight: 2, pattern: /\b(?:option a|option b|alternative|two approaches|plusieurs options)\b/i }
  ]
};

function normalizeQuestion(question: string) {
  return question
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function emptyScores() {
  return Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<
    Exclude<QuestionCategory, "other">,
    number
  >;
}

function classifyTieBreak(
  left: { category: Exclude<QuestionCategory, "other">; score: number },
  right: { category: Exclude<QuestionCategory, "other">; score: number },
  normalizedQuestion: string
) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const explicitExplanation =
    /^(?:explain|clarify|describe|what is|what are|explique|decris|decrire|c est quoi|qu est ce que)\b/i.test(
      normalizedQuestion
    );
  const priority: Exclude<QuestionCategory, "other">[] = explicitExplanation
    ? [
        "technical_explanation",
        "incident_response",
        "debug_diagnostic",
        "architecture_design",
        "product_strategy",
        "operational_writing",
        "mixed_reasoning"
      ]
    : /\b(?:write|draft|redige|ecris|update|email|message)\b/i.test(normalizedQuestion)
      ? [
        "operational_writing",
        "incident_response",
        "debug_diagnostic",
        "architecture_design",
        "product_strategy",
        "technical_explanation",
        "mixed_reasoning"
      ]
      : [
          "incident_response",
          "debug_diagnostic",
          "architecture_design",
          "product_strategy",
          "operational_writing",
          "technical_explanation",
          "mixed_reasoning"
        ];

  return priority.indexOf(left.category) - priority.indexOf(right.category);
}

export function classifyQuestionDetailed(question: string): QuestionClassificationResult {
  const normalized = normalizeQuestion(question);
  if (!normalized) {
    return {
      category: "other",
      confidence: 0,
      matchedSignals: [],
      secondaryCategory: null
    };
  }

  const scores = emptyScores();
  const signals = new Map<Exclude<QuestionCategory, "other">, string[]>();

  for (const category of CATEGORIES) {
    const categorySignals: string[] = [];
    for (const rule of CATEGORY_RULES[category]) {
      if (rule.pattern.test(question) || rule.pattern.test(normalized)) {
        scores[category] += rule.weight;
        categorySignals.push(rule.signal);
      }
    }
    signals.set(category, categorySignals);
  }

  const explicitExplanation =
    /^(?:explain|clarify|describe|what is|what are|explique|decris|decrire|c est quoi|qu est ce que)\b/i.test(
      normalized
    );
  const incidentSignals = signals.get("incident_response") ?? [];
  const hasOperationalIncidentSignal = incidentSignals.some((signal) =>
    ["security containment", "response actions", "customer impact"].includes(signal)
  );
  if (explicitExplanation && scores.technical_explanation >= 5 && !hasOperationalIncidentSignal) {
    scores.incident_response = Math.min(scores.incident_response, scores.technical_explanation);
  }

  const ranked = CATEGORIES.map((category) => ({
    category,
    score: scores[category]
  })).sort((left, right) => classifyTieBreak(left, right, normalized));
  const winner = ranked[0];
  const runnerUp = ranked[1];

  if (!winner || winner.score <= 0) {
    return {
      category: "other",
      confidence: 0.25,
      matchedSignals: [],
      secondaryCategory: null
    };
  }

  const margin = winner.score - (runnerUp?.score ?? 0);
  const confidence = Math.min(0.97, Math.max(0.45, 0.52 + winner.score / 18 + margin / 20));

  return {
    category: winner.category,
    confidence: Math.round(confidence * 100) / 100,
    matchedSignals: signals.get(winner.category) ?? [],
    secondaryCategory: runnerUp && runnerUp.score > 0 ? runnerUp.category : null
  };
}

export function classifyQuestion(question: string): QuestionCategory {
  return classifyQuestionDetailed(question).category;
}

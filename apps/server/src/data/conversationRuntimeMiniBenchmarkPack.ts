import type { ConversationReasoningEvalCase } from "./conversationReasoningEvalPack.js";

export type ConversationRuntimeMiniBenchmarkCause =
  | "context_loss"
  | "repeated_previous_answer"
  | "wrong_language";

export type ConversationRuntimeMiniBenchmarkCase = ConversationReasoningEvalCase & {
  targetCause: ConversationRuntimeMiniBenchmarkCause;
};

export const CONVERSATION_RUNTIME_MINI_BENCHMARK_ID =
  "hydria-conversation-runtime-mini-benchmark-v1";

export const CONVERSATION_RUNTIME_MINI_BENCHMARK_PACK: ConversationRuntimeMiniBenchmarkCase[] = [
  {
    id: "runtime_mini_context_loss_fr_architecture_budget_onprem",
    targetCause: "context_loss",
    domain: "architecture_design",
    language: "fr",
    difficulty: "hard",
    conversation: [
      "user: On doit choisir une architecture pour un SaaS B2B. Au depart on vise AWS et une equipe de quatre personnes.",
      "assistant: Je recommande un monolithe modulaire sur AWS, simple a operer.",
      "user: Finalement on passe en on-prem et on n'a plus de budget additionnel.",
      "assistant: Il faut reviser l'approche autour de l'on-prem et du budget bloque.",
      "user: Donc tu recommandes quoi maintenant ?"
    ],
    expectedBehaviors: [
      "uses latest on-prem constraint",
      "keeps budget constraint",
      "does not answer from the initial AWS-only assumption",
      "makes a concrete recommendation"
    ],
    keyChallenges: ["context_loss", "changed environment", "budget constraint"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_context_loss_en_incident_scale_rollback",
    targetCause: "context_loss",
    domain: "incident_response",
    language: "en",
    difficulty: "hard",
    conversation: [
      "user: Incident on the API: errors look limited to one small region.",
      "assistant: Start with regional triage and avoid a broad rollback unless impact grows.",
      "user: The situation changed: scale is tenfold higher than expected and important users are affected.",
      "assistant: Treat it as a higher-severity incident and revisit rollback criteria.",
      "user: Give the next thirty-minute plan and say rollback or no rollback."
    ],
    expectedBehaviors: [
      "uses the increased scale",
      "uses important-user impact",
      "updates severity",
      "decides rollback or no rollback"
    ],
    keyChallenges: ["context_loss", "evolving incident", "decision under changed severity"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_context_loss_en_product_strategy_segment_shift",
    targetCause: "context_loss",
    domain: "product_strategy",
    language: "en",
    difficulty: "medium",
    conversation: [
      "user: We need a launch strategy for a lightweight analytics tool. Assume SMB self-serve first.",
      "assistant: Start with a narrow SMB wedge and low-touch onboarding.",
      "user: Constraint changed: sales now wants enterprise buyers, but budget is capped at 500 euros per month.",
      "assistant: The strategy should move toward a focused enterprise pilot without expensive acquisition.",
      "user: What is the final recommendation and tradeoff?"
    ],
    expectedBehaviors: [
      "uses enterprise-buyer shift",
      "keeps budget cap",
      "does not repeat SMB-only strategy",
      "states tradeoff"
    ],
    keyChallenges: ["context_loss", "segment change", "budget cap"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_repeated_previous_answer_en_debug_next_step",
    targetCause: "repeated_previous_answer",
    domain: "debug_diagnostic",
    language: "en",
    difficulty: "medium",
    conversation: [
      "user: My app is slow but I only know users complain after login.",
      "assistant: Start by separating frontend latency, API latency, and database latency.",
      "user: We only have partial logs, and the database CPU spikes after login.",
      "assistant: Focus first on database queries triggered by login and compare slow query logs.",
      "user: Give only the next concrete diagnostic step and what remains uncertain."
    ],
    expectedBehaviors: [
      "does not repeat the prior triage list",
      "answers the latest request",
      "names one diagnostic step",
      "flags uncertainty"
    ],
    keyChallenges: ["repeated_previous_answer", "latest turn specificity"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: false,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_repeated_previous_answer_fr_architecture_final_choice",
    targetCause: "repeated_previous_answer",
    domain: "architecture_design",
    language: "fr",
    difficulty: "medium",
    conversation: [
      "user: On hesite entre monolithe modulaire, services separes, ou hybride pour un SaaS B2B.",
      "assistant: Compare les options selon equipe, budget, donnees et rythme de livraison.",
      "user: L'equipe est reduite et le delai avance de trois semaines.",
      "assistant: Ces contraintes favorisent une option plus simple et reversible.",
      "user: Choisis une option et donne le compromis accepte."
    ],
    expectedBehaviors: [
      "does not repeat the comparison",
      "chooses one option",
      "uses reduced team and earlier deadline",
      "states accepted tradeoff"
    ],
    keyChallenges: ["repeated_previous_answer", "decision request", "constraint carry-over"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: false,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_repeated_previous_answer_fr_incident_plan",
    targetCause: "repeated_previous_answer",
    domain: "incident_response",
    language: "fr",
    difficulty: "hard",
    conversation: [
      "user: L'authentification est degradee mais on pense que l'impact est limite.",
      "assistant: Surveille les erreurs, confirme le perimetre et prepare une communication courte.",
      "user: La situation evolue: 40% des utilisateurs sont touches et le support explose.",
      "assistant: Il faut passer en incident majeur et definir un seuil de rollback.",
      "user: Propose le plan des trente prochaines minutes, sans recopier le diagnostic."
    ],
    expectedBehaviors: [
      "does not repeat the diagnosis",
      "uses 40% user impact",
      "gives a thirty-minute plan",
      "decides escalation steps"
    ],
    keyChallenges: ["repeated_previous_answer", "incident evolution"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_wrong_language_en_budget_correction",
    targetCause: "wrong_language",
    domain: "architecture_design",
    language: "en",
    difficulty: "medium",
    conversation: [
      "user: For a B2B SaaS platform, assume there is no sensitive data and the impact is low.",
      "assistant: Under that assumption, keep the design lightweight.",
      "user: Correction: there is sensitive data, and budget is capped at 500 euros per month.",
      "assistant: Revise the plan for sensitive data and the budget cap.",
      "user: Revise your recommendation and clearly name which assumption changed."
    ],
    expectedBehaviors: [
      "answers in English",
      "names changed assumption",
      "uses sensitive data",
      "uses budget cap"
    ],
    keyChallenges: ["wrong_language", "budget token overlap", "correction token overlap"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_wrong_language_fr_aws_budget",
    targetCause: "wrong_language",
    domain: "debug_diagnostic",
    language: "fr",
    difficulty: "medium",
    conversation: [
      "user: Mon service est lent depuis la migration AWS, mais je n'ai pas encore toutes les metriques.",
      "assistant: Il faut separer latence applicative, base de donnees et reseau.",
      "user: On a seulement les logs applicatifs et un budget tres limite.",
      "assistant: Le diagnostic doit rester leger et exploiter les logs disponibles.",
      "user: Donne le prochain diagnostic concret en restant prudent."
    ],
    expectedBehaviors: [
      "answers in French",
      "uses AWS migration context",
      "uses limited logs",
      "uses budget constraint"
    ],
    keyChallenges: ["wrong_language", "mixed technical tokens", "French consistency"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: false,
    shouldAskClarification: false
  },
  {
    id: "runtime_mini_wrong_language_en_final_recommendation",
    targetCause: "wrong_language",
    domain: "mixed_reasoning",
    language: "en",
    difficulty: "hard",
    conversation: [
      "user: We need to choose between a fast workaround and a safer refactor for a production issue.",
      "assistant: Compare speed, rollback safety, blast radius, and long-term maintenance.",
      "user: Actually the deadline moved to tomorrow and the team is reduced.",
      "assistant: The recommendation should favor a reversible short-term path.",
      "user: Give the final decision, accepted tradeoff, and next steps."
    ],
    expectedBehaviors: [
      "answers in English",
      "uses tomorrow deadline",
      "uses reduced team",
      "makes a final decision"
    ],
    keyChallenges: ["wrong_language", "final decision", "constraint carry-over"],
    shouldAdaptContext: true,
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  }
];

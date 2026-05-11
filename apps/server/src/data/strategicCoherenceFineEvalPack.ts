import type {
  ConversationReasoningDomain,
  ConversationReasoningEvalCase,
  ConversationReasoningLanguage
} from "./conversationReasoningEvalPack.js";

export const STRATEGIC_COHERENCE_FINE_GATE_ID = "hydria-strategic-coherence-fine-gate-v1";

type StrategicCoherenceFineScenario = "partial_signal_scope" | "stakeholder_false_equivalence";

type FineFrame = {
  subject: string;
  goal: string;
  baseline: string;
  durableConstraint: string;
  recentSignal: string;
  riskyShortcut: string;
  dominantConstraint: string;
};

const DOMAINS: ConversationReasoningDomain[] = [
  "architecture_design",
  "debug_diagnostic",
  "incident_response",
  "product_strategy",
  "mixed_reasoning"
];

const SCENARIOS: StrategicCoherenceFineScenario[] = [
  "partial_signal_scope",
  "stakeholder_false_equivalence"
];

const FRAMES: Record<ConversationReasoningDomain, Record<ConversationReasoningLanguage, FineFrame>> = {
  architecture_design: {
    fr: {
      subject: "une architecture de donnees client",
      goal: "choisir un cap sans sur-generaliser le signal",
      baseline: "lakehouse minimal avec migration reversible",
      durableConstraint: "audit trimestriel, equipe reduite, pas de dependance irreversible",
      recentSignal: "les lenteurs ne viennent que du sous-groupe exports Europe",
      riskyShortcut: "migrer toute la plateforme sur une stack streaming",
      dominantConstraint: "portee fiable du signal et reversibilite"
    },
    en: {
      subject: "a customer data architecture",
      goal: "choose a direction without over-generalizing the signal",
      baseline: "minimal lakehouse with reversible migration",
      durableConstraint: "quarterly audit, reduced team, no irreversible dependency",
      recentSignal: "latency only comes from the Europe exports subgroup",
      riskyShortcut: "move the whole platform to a streaming stack",
      dominantConstraint: "reliable signal scope and reversibility"
    }
  },
  debug_diagnostic: {
    fr: {
      subject: "un diagnostic de worker intermittent",
      goal: "isoler la cause sans accuser le mauvais composant",
      baseline: "une hypothese instrumentee a la fois",
      durableConstraint: "logs incomplets, reproduction rare, fenetre client courte",
      recentSignal: "le signal ne vient que des jobs lances par un seul partenaire",
      riskyShortcut: "declarer la base globalement responsable",
      dominantConstraint: "preuve observable limitee au bon perimetre"
    },
    en: {
      subject: "an intermittent worker diagnosis",
      goal: "isolate the cause without blaming the wrong component",
      baseline: "one instrumented hypothesis at a time",
      durableConstraint: "incomplete logs, rare reproduction, short customer window",
      recentSignal: "the signal only comes from jobs launched by one partner",
      riskyShortcut: "declare the database globally responsible",
      dominantConstraint: "observable proof scoped to the right perimeter"
    }
  },
  incident_response: {
    fr: {
      subject: "un incident de remboursements VIP",
      goal: "reduire l'impact sans masquer l'incident",
      baseline: "mitigation ciblee avec seuil public d'escalade",
      durableConstraint: "communication honnete, retour arriere pret, support surcharge",
      recentSignal: "le pic ne touche que les remboursements de nuit",
      riskyShortcut: "annoncer que l'incident global est resolu",
      dominantConstraint: "portee reelle de l'impact et transparence"
    },
    en: {
      subject: "a VIP refund incident",
      goal: "reduce impact without hiding the incident",
      baseline: "targeted mitigation with public escalation threshold",
      durableConstraint: "honest communication, rollback ready, overloaded support",
      recentSignal: "the spike only affects overnight refunds",
      riskyShortcut: "announce the global incident is resolved",
      dominantConstraint: "actual impact scope and transparency"
    }
  },
  product_strategy: {
    fr: {
      subject: "un lancement legal ops",
      goal: "choisir un segment sans diluer l'apprentissage",
      baseline: "pilote vertical sur revues fournisseurs",
      durableConstraint: "peu d'entretiens, cycles longs, preuve de risque exigee",
      recentSignal: "le signal fort vient seulement des cabinets mid-market",
      riskyShortcut: "ouvrir tout le marche legal avec un message horizontal",
      dominantConstraint: "apprentissage mesure sur un segment verifiable"
    },
    en: {
      subject: "a legal ops launch",
      goal: "choose a segment without diluting learning",
      baseline: "vertical pilot for vendor reviews",
      durableConstraint: "few interviews, long cycles, risk evidence required",
      recentSignal: "the strong signal only comes from mid-market firms",
      riskyShortcut: "open the whole legal market with a horizontal message",
      dominantConstraint: "measured learning on a verifiable segment"
    }
  },
  mixed_reasoning: {
    fr: {
      subject: "un copilote IA pour dossiers RH",
      goal: "arbitrer utilite, confidentialite et delai",
      baseline: "prototype ferme avec validation humaine",
      durableConstraint: "donnees sensibles, audit interne, representants attentifs",
      recentSignal: "la precision de 78% ne concerne que les cas simples",
      riskyShortcut: "automatiser les decisions RH ambigues",
      dominantConstraint: "controle humain et portee limitee du signal"
    },
    en: {
      subject: "an AI copilot for HR cases",
      goal: "balance usefulness, confidentiality, and timeline",
      baseline: "closed prototype with human validation",
      durableConstraint: "sensitive data, internal audit, attentive worker representatives",
      recentSignal: "78% precision only applies to simple cases",
      riskyShortcut: "automate ambiguous HR decisions",
      dominantConstraint: "human control and limited signal scope"
    }
  }
};

function pad(value: number) {
  return String(value).padStart(3, "0");
}

function line(role: "user" | "assistant", content: string) {
  return `${role}: ${content}`;
}

function expectedBehaviors(language: ConversationReasoningLanguage, frame: FineFrame, scenario: StrategicCoherenceFineScenario) {
  if (language === "fr") {
    return [
      "Suit le contexte sans recopier l'historique.",
      `Garde le cap actif: ${frame.baseline}.`,
      `Identifie la contrainte dominante: ${frame.dominantConstraint}.`,
      `Refuse ou differe le raccourci: ${frame.riskyShortcut}.`,
      "Choisit une option par defaut sans fausse equivalence.",
      "Donne une condition concrete de revision.",
      `Couvre la coherence strategique fine: ${scenario}.`
    ];
  }

  return [
    "Tracks context without copying the history.",
    `Keeps the active direction: ${frame.baseline}.`,
    `Identifies the dominant constraint: ${frame.dominantConstraint}.`,
    `Rejects or defers the shortcut: ${frame.riskyShortcut}.`,
    "Chooses a default option without false equivalence.",
    "Gives a concrete revision condition.",
    `Covers fine strategic coherence: ${scenario}.`
  ];
}

function keyChallenges(domain: ConversationReasoningDomain, scenario: StrategicCoherenceFineScenario) {
  return [
    domain,
    "fine_strategic_coherence",
    scenario,
    "dominant_constraint_selection",
    "revision_condition_required",
    "anti_over_rigidity",
    "false_equivalence_rejection",
    "runtime_only_validation"
  ];
}

function buildFrenchConversation(frame: FineFrame, scenario: StrategicCoherenceFineScenario) {
  if (scenario === "partial_signal_scope") {
    return [
      line("user", `On travaille sur ${frame.subject}. Cap actuel: ${frame.baseline}. Objectif: ${frame.goal}.`),
      line("assistant", "Je garde le cap actif et je suivrai la portee des signaux."),
      line("user", `Contrainte durable: ${frame.durableConstraint}.`),
      line("assistant", "Je la traite comme borne de decision."),
      line("user", `Signal partiel: ${frame.recentSignal}; ce n'est pas toute la population.`),
      line("assistant", "Je limite la conclusion au perimetre observe."),
      line("user", `La direction veut en tirer une conclusion globale et ${frame.riskyShortcut}.`),
      line("assistant", "Je dois refuser la generalisation fragile."),
      line("user", "Tranche: quelle decision par defaut, quel raccourci refuses-tu, et quelle condition te ferait reviser ?")
    ];
  }

  return [
    line("user", `Je reprends ${frame.subject}. Cap: ${frame.baseline}. Objectif: ${frame.goal}.`),
    line("assistant", "Je garde le cap et je surveille les conflits de priorite."),
    line("user", `Contrainte durable: ${frame.durableConstraint}.`),
    line("assistant", "Je l'ajoute comme contrainte active."),
    line("user", `Signal recent: ${frame.recentSignal}.`),
    line("assistant", "Je l'utilise comme signal borne."),
    line("user", `Un stakeholder propose de presenter comme equivalentes cette option et: ${frame.riskyShortcut}, pour eviter le conflit.`),
    line("assistant", "Je ne dois pas diluer la decision en fausse equivalence."),
    line("user", "Ecris la decision finale: option retenue, option refusee, compromis accepte, condition de revision.")
  ];
}

function buildEnglishConversation(frame: FineFrame, scenario: StrategicCoherenceFineScenario) {
  if (scenario === "partial_signal_scope") {
    return [
      line("user", `We are working on ${frame.subject}. Current direction: ${frame.baseline}. Goal: ${frame.goal}.`),
      line("assistant", "I keep the active direction and will track signal scope."),
      line("user", `Durable constraint: ${frame.durableConstraint}.`),
      line("assistant", "I treat it as a decision boundary."),
      line("user", `Partial signal: ${frame.recentSignal}; this is not the full population.`),
      line("assistant", "I limit the conclusion to the observed scope."),
      line("user", `Leadership wants to draw a global conclusion and ${frame.riskyShortcut}.`),
      line("assistant", "I need to reject the fragile generalization."),
      line("user", "Choose: what default decision, what shortcut do you reject, and what condition would make you revise?")
    ];
  }

  return [
    line("user", `I am taking over ${frame.subject}. Direction: ${frame.baseline}. Goal: ${frame.goal}.`),
    line("assistant", "I keep the direction and watch for priority conflicts."),
    line("user", `Durable constraint: ${frame.durableConstraint}.`),
    line("assistant", "I add it as an active constraint."),
    line("user", `Recent signal: ${frame.recentSignal}.`),
    line("assistant", "I use it as a bounded signal."),
    line("user", `A stakeholder proposes presenting this option and ${frame.riskyShortcut} as equivalent to avoid conflict.`),
    line("assistant", "I should not dilute the decision into false equivalence."),
    line("user", "Write the final decision: chosen option, rejected option, accepted tradeoff, revision condition.")
  ];
}

function buildConversation(
  language: ConversationReasoningLanguage,
  frame: FineFrame,
  scenario: StrategicCoherenceFineScenario
) {
  return language === "fr" ? buildFrenchConversation(frame, scenario) : buildEnglishConversation(frame, scenario);
}

function buildStrategicCoherenceFinePack() {
  const cases: ConversationReasoningEvalCase[] = [];

  DOMAINS.forEach((domain, domainIndex) => {
    SCENARIOS.forEach((scenario, scenarioIndex) => {
      (["fr", "en"] as const).forEach((language, languageIndex) => {
        const frame = FRAMES[domain][language];
        const id = `strategic_coherence_fine_${domain}_${scenario}_${pad(
          domainIndex * SCENARIOS.length * 2 + scenarioIndex * 2 + languageIndex + 1
        )}`;

        cases.push({
          id,
          domain,
          language,
          difficulty: "adversarial",
          conversation: buildConversation(language, frame, scenario),
          expectedBehaviors: expectedBehaviors(language, frame, scenario),
          keyChallenges: keyChallenges(domain, scenario),
          shouldAdaptContext: true,
          shouldReviseAssumptions: true,
          shouldAskClarification: false
        });
      });
    });
  });

  return cases;
}

export const STRATEGIC_COHERENCE_FINE_EVAL_PACK: ConversationReasoningEvalCase[] =
  buildStrategicCoherenceFinePack();

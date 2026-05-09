import type {
  ConversationReasoningDomain,
  ConversationReasoningEvalCase,
  ConversationReasoningLanguage
} from "./conversationReasoningEvalPack.js";

export const STRATEGIC_CONSTRAINT_CONFLICT_GATE_ID =
  "hydria-strategic-constraint-conflict-gate-v1";

type StrategicConflictScenario =
  | "owner_policy_override"
  | "deadline_guardrail_conflict"
  | "budget_scale_capacity_conflict"
  | "environment_reversal_conflict";

type StrategicFrame = {
  subject: string;
  goal: string;
  baseline: string;
  durableConstraint: string;
  riskyShortcut: string;
  dominantConstraint: string;
  recentSignal: string;
};

const DOMAINS: ConversationReasoningDomain[] = [
  "architecture_design",
  "debug_diagnostic",
  "incident_response",
  "product_strategy",
  "mixed_reasoning"
];

const SCENARIOS: StrategicConflictScenario[] = [
  "owner_policy_override",
  "deadline_guardrail_conflict",
  "budget_scale_capacity_conflict",
  "environment_reversal_conflict"
];

const FRAMES: Record<ConversationReasoningDomain, Record<ConversationReasoningLanguage, StrategicFrame>> = {
  architecture_design: {
    fr: {
      subject: "une plateforme de facturation multi-pays",
      goal: "choisir une trajectoire technique qui garde la conformite",
      baseline: "noyau modulaire avec extraction progressive des flux reglementes",
      durableConstraint: "equipe de trois personnes, audit fiscal trimestriel, migration reversible",
      riskyShortcut: "microservices pays par pays cette semaine",
      dominantConstraint: "audit fiscal et reversibilite",
      recentSignal: "18% d'erreurs de format sur les exports Italie"
    },
    en: {
      subject: "a multi-country billing platform",
      goal: "choose a technical path that preserves compliance",
      baseline: "modular core with progressive extraction of regulated flows",
      durableConstraint: "three-person team, quarterly tax audit, reversible migration",
      riskyShortcut: "country-by-country microservices this week",
      dominantConstraint: "tax audit and reversibility",
      recentSignal: "18% format errors on Italy exports"
    }
  },
  debug_diagnostic: {
    fr: {
      subject: "un worker d'import qui bloque des jobs clients",
      goal: "isoler la cause sans accuser le mauvais composant",
      baseline: "une hypothese par run avec instrumentation minimale",
      durableConstraint: "logs echantillonnes, reproduction rare, fenetre client courte",
      riskyShortcut: "declarer la base coupable et augmenter le cluster",
      dominantConstraint: "preuve observable avant changement lourd",
      recentSignal: "les freezes arrivent surtout apres 900 imports concurrents"
    },
    en: {
      subject: "an import worker blocking customer jobs",
      goal: "isolate the cause without blaming the wrong component",
      baseline: "one hypothesis per run with minimal instrumentation",
      durableConstraint: "sampled logs, rare reproduction, short customer window",
      riskyShortcut: "blame the database and scale the cluster",
      dominantConstraint: "observable proof before heavy change",
      recentSignal: "freezes mostly happen after 900 concurrent imports"
    }
  },
  incident_response: {
    fr: {
      subject: "une file de remboursements en pic support",
      goal: "reduire l'impact sans masquer l'incident",
      baseline: "mitigation ciblee avec seuil public d'escalade",
      durableConstraint: "clients VIP touches, support surcharge, devoir de communication",
      riskyShortcut: "annoncer que tout est resolu avant verification",
      dominantConstraint: "communication honnete et mitigation bornee",
      recentSignal: "le p95 passe de 6 minutes a 41 minutes"
    },
    en: {
      subject: "a refund queue during a support spike",
      goal: "reduce impact without hiding the incident",
      baseline: "targeted mitigation with a public escalation threshold",
      durableConstraint: "VIP customers affected, overloaded support, communication duty",
      riskyShortcut: "announce everything is resolved before verification",
      dominantConstraint: "honest communication and bounded mitigation",
      recentSignal: "p95 moved from 6 minutes to 41 minutes"
    }
  },
  product_strategy: {
    fr: {
      subject: "un assistant pour equipes legal ops",
      goal: "choisir un segment sans diluer l'apprentissage",
      baseline: "pilote vertical sur revues de contrats fournisseurs",
      durableConstraint: "peu d'entretiens, cycles de vente longs, preuve de risque exigee",
      riskyShortcut: "ouvrir tout le marche legal avec un positionnement horizontal",
      dominantConstraint: "apprentissage mesure sur un segment verifiable",
      recentSignal: "3 prospects sur 5 demandent la tracabilite"
    },
    en: {
      subject: "an assistant for legal ops teams",
      goal: "choose a segment without diluting learning",
      baseline: "vertical pilot for vendor contract reviews",
      durableConstraint: "few interviews, long sales cycles, risk evidence required",
      riskyShortcut: "open the whole legal market with horizontal positioning",
      dominantConstraint: "measured learning on a verifiable segment",
      recentSignal: "3 of 5 prospects ask for traceability"
    }
  },
  mixed_reasoning: {
    fr: {
      subject: "un copilote IA pour dossiers RH sensibles",
      goal: "arbitrer utilite, confidentialite et delai",
      baseline: "prototype ferme avec validation humaine obligatoire",
      durableConstraint: "donnees sensibles, representants attentifs, audit interne",
      riskyShortcut: "automatiser la decision RH pour gagner deux semaines",
      dominantConstraint: "controle humain et audit avant vitesse",
      recentSignal: "precision de pre-tri a 71% sur les cas ambigus"
    },
    en: {
      subject: "an AI copilot for sensitive HR cases",
      goal: "balance usefulness, confidentiality, and timeline",
      baseline: "closed prototype with mandatory human validation",
      durableConstraint: "sensitive data, attentive worker representatives, internal audit",
      riskyShortcut: "automate the HR decision to save two weeks",
      dominantConstraint: "human control and audit before speed",
      recentSignal: "pre-triage precision is 71% on ambiguous cases"
    }
  }
};

function pad(value: number) {
  return String(value).padStart(3, "0");
}

function line(role: "user" | "assistant", content: string) {
  return `${role}: ${content}`;
}

function expectedBehaviors(language: ConversationReasoningLanguage, frame: StrategicFrame, scenario: StrategicConflictScenario) {
  if (language === "fr") {
    return [
      "Suit le contexte multi-turn sans recopier l'historique.",
      `Garde le cap actif: ${frame.baseline}.`,
      `Identifie la contrainte dominante: ${frame.dominantConstraint}.`,
      `Refuse ou differe le raccourci: ${frame.riskyShortcut}.`,
      "Nomme le compromis accepte au lieu de dire que les options se valent.",
      "Donne un prochain pas concret et une condition de revision.",
      `Couvre le conflit strategique: ${scenario}.`
    ];
  }

  return [
    "Tracks the multi-turn context without copying the history.",
    `Keeps the active direction: ${frame.baseline}.`,
    `Identifies the dominant constraint: ${frame.dominantConstraint}.`,
    `Rejects or defers the shortcut: ${frame.riskyShortcut}.`,
    "Names the accepted tradeoff instead of saying the options are equivalent.",
    "Gives a concrete next step and a revision condition.",
    `Covers the strategic conflict: ${scenario}.`
  ];
}

function keyChallenges(domain: ConversationReasoningDomain, scenario: StrategicConflictScenario) {
  return [
    domain,
    "strategic_constraint_conflict",
    scenario,
    "dominant_constraint_selection",
    "sacrificed_constraint_explicit",
    "accepted_tradeoff",
    "fine_strategic_coherence",
    "runtime_only_validation"
  ];
}

function buildFrenchConversation(frame: StrategicFrame, scenario: StrategicConflictScenario) {
  switch (scenario) {
    case "owner_policy_override":
      return [
        line("user", `Je reprends ${frame.subject}. Cap actuel: ${frame.baseline}. Objectif: ${frame.goal}.`),
        line("assistant", "Je garde le cap et je suivrai les contraintes qui changent."),
        line("user", `Politique non negociable: ${frame.durableConstraint}.`),
        line("assistant", "Je la traite comme contrainte bloquante."),
        line("user", `Signal recent: ${frame.recentSignal}.`),
        line("assistant", "Je l'utilise comme signal, pas comme preuve totale."),
        line("user", `Le nouvel owner veut ignorer la politique et pousser: ${frame.riskyShortcut}.`),
        line("assistant", "Je dois separer preference owner et contrainte durable."),
        line("user", `Tranche le message final: quelle contrainte domine, que refuses-tu, quel compromis acceptes-tu ?`)
      ];
    case "deadline_guardrail_conflict":
      return [
        line("user", `On travaille sur ${frame.subject}. Direction: ${frame.baseline}.`),
        line("assistant", "Je garde cette direction comme reference."),
        line("user", `Contrainte durable: ${frame.durableConstraint}.`),
        line("assistant", "Je l'ajoute au cadre de decision."),
        line("user", "Escalade: la direction veut une action visible demain matin."),
        line("assistant", "Je distingue signal visible et engagement irreversible."),
        line("user", `Quelqu'un propose ${frame.riskyShortcut} pour tenir le delai.`),
        line("assistant", "Je dois refuser un raccourci qui casse le garde-fou."),
        line("user", `Donne le plan final avec action demain, limite, compromis, seuil de revision.`)
      ];
    case "budget_scale_capacity_conflict":
      return [
        line("user", `Sujet: ${frame.subject}. Strategie de depart: ${frame.baseline}.`),
        line("assistant", "Je garde la strategie de depart."),
        line("user", "Nouvelle contrainte: budget bloque a 500 euros par mois et equipe reduite."),
        line("assistant", "Le budget et la capacite limitent l'ambition."),
        line("user", "Correction: le scale attendu passe maintenant a 10M utilisateurs."),
        line("assistant", "Je dois adapter sans exploser le cout ni le scope."),
        line("user", `Un sponsor demande quand meme: ${frame.riskyShortcut}.`),
        line("assistant", "Je compare l'ambition au budget, au scale et a l'equipe."),
        line("user", "Recommande une direction: contrainte dominante, option differee, compromis, prochain test.")
      ];
    case "environment_reversal_conflict":
      return [
        line("user", `On doit ${frame.goal} pour ${frame.subject}. Cap: ${frame.baseline}.`),
        line("assistant", "Je garde le cap et j'identifierai les hypotheses obsoletes."),
        line("user", "Hypothese initiale: AWS avec services managed."),
        line("assistant", "Je prends AWS comme hypothese actuelle."),
        line("user", "Correction: l'environnement est maintenant on-prem, sans cloud public."),
        line("assistant", "Je dois remplacer l'hypothese AWS par on-prem."),
        line("user", `Le risque de raccourci reste: ${frame.riskyShortcut}.`),
        line("assistant", "Je refuse de reutiliser l'ancienne hypothese cloud."),
        line("user", "Tranche l'architecture finale sans recommander AWS ni serverless.")
      ];
  }
}

function buildEnglishConversation(frame: StrategicFrame, scenario: StrategicConflictScenario) {
  switch (scenario) {
    case "owner_policy_override":
      return [
        line("user", `I am taking over ${frame.subject}. Current direction: ${frame.baseline}. Goal: ${frame.goal}.`),
        line("assistant", "I keep the direction and will track changed constraints."),
        line("user", `Non-negotiable policy: ${frame.durableConstraint}.`),
        line("assistant", "I treat it as a blocking constraint."),
        line("user", `Recent signal: ${frame.recentSignal}.`),
        line("assistant", "I use it as a signal, not complete proof."),
        line("user", `The new owner wants to ignore policy and push: ${frame.riskyShortcut}.`),
        line("assistant", "I need to separate owner preference from durable constraint."),
        line("user", "Commit the final message: which constraint dominates, what do you reject, what tradeoff do you accept?")
      ];
    case "deadline_guardrail_conflict":
      return [
        line("user", `We are working on ${frame.subject}. Direction: ${frame.baseline}.`),
        line("assistant", "I keep that direction as the reference."),
        line("user", `Durable constraint: ${frame.durableConstraint}.`),
        line("assistant", "I add it to the decision frame."),
        line("user", "Escalation: leadership wants a visible action tomorrow morning."),
        line("assistant", "I separate visible signal from irreversible commitment."),
        line("user", `Someone proposes ${frame.riskyShortcut} to meet the deadline.`),
        line("assistant", "I need to reject a shortcut that breaks the guardrail."),
        line("user", "Give the final plan with tomorrow action, limit, tradeoff, and revision threshold.")
      ];
    case "budget_scale_capacity_conflict":
      return [
        line("user", `Subject: ${frame.subject}. Starting strategy: ${frame.baseline}.`),
        line("assistant", "I keep the starting strategy."),
        line("user", "New constraint: budget capped at 500 euros per month and team reduced."),
        line("assistant", "Budget and capacity limit ambition."),
        line("user", "Correction: expected scale is now 10M users."),
        line("assistant", "I need to adapt without exploding cost or scope."),
        line("user", `A sponsor still asks for: ${frame.riskyShortcut}.`),
        line("assistant", "I compare ambition against budget, scale, and team."),
        line("user", "Recommend a direction: dominant constraint, deferred option, tradeoff, next test.")
      ];
    case "environment_reversal_conflict":
      return [
        line("user", `We need to ${frame.goal} for ${frame.subject}. Direction: ${frame.baseline}.`),
        line("assistant", "I keep the direction and will identify obsolete assumptions."),
        line("user", "Initial assumption: AWS with managed services."),
        line("assistant", "I treat AWS as the current assumption."),
        line("user", "Correction: the environment is now on-prem, with no public cloud."),
        line("assistant", "I need to replace the AWS assumption with on-prem."),
        line("user", `The shortcut risk remains: ${frame.riskyShortcut}.`),
        line("assistant", "I reject reusing the old cloud assumption."),
        line("user", "Choose the final architecture without recommending AWS or serverless.")
      ];
  }
}

function buildConversation(
  language: ConversationReasoningLanguage,
  frame: StrategicFrame,
  scenario: StrategicConflictScenario
) {
  return language === "fr" ? buildFrenchConversation(frame, scenario) : buildEnglishConversation(frame, scenario);
}

function buildStrategicConstraintConflictPack() {
  const cases: ConversationReasoningEvalCase[] = [];

  SCENARIOS.forEach((scenario, scenarioIndex) => {
    DOMAINS.forEach((domain, domainIndex) => {
      (["fr", "en"] as const).forEach((language, languageIndex) => {
        const frame = FRAMES[domain][language];
        const id = `strategic_constraint_conflict_${domain}_${scenario}_${pad(
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

export const STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK: ConversationReasoningEvalCase[] =
  buildStrategicConstraintConflictPack();

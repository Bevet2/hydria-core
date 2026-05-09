export const CONVERSATION_REASONING_GATE_ID = "hydria-conversation-reasoning-gate-v1";

export type ConversationReasoningDomain =
  | "architecture_design"
  | "debug_diagnostic"
  | "incident_response"
  | "product_strategy"
  | "mixed_reasoning";

export type ConversationReasoningLanguage = "fr" | "en";
export type ConversationReasoningDifficulty = "medium" | "hard" | "adversarial";

export type ConversationReasoningEvalCase = {
  id: string;
  domain: ConversationReasoningDomain;
  language: ConversationReasoningLanguage;
  difficulty: ConversationReasoningDifficulty;
  conversation: string[];
  expectedBehaviors: string[];
  keyChallenges: string[];
  shouldAdaptContext: boolean;
  shouldReviseAssumptions: boolean;
  shouldAskClarification: boolean;
};

type ScenarioKind =
  | "constraint_change"
  | "user_contradiction"
  | "ambiguous_problem"
  | "complex_decision"
  | "evolving_incident"
  | "nuanced_tradeoff";

type DomainText = {
  subject: string;
  action: string;
  artifact: string;
  firstConstraint: string;
  firstSignal: string;
  decisionFrame: string;
};

type ScenarioSpec = {
  kind: ScenarioKind;
  challenge: string;
  shouldReviseAssumptions: boolean;
  shouldAskClarification: boolean;
};

const DOMAINS: ConversationReasoningDomain[] = [
  "architecture_design",
  "debug_diagnostic",
  "incident_response",
  "product_strategy",
  "mixed_reasoning"
];

const SCENARIOS: ScenarioSpec[] = [
  {
    kind: "constraint_change",
    challenge: "changed constraint",
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    kind: "user_contradiction",
    challenge: "contradictory user information",
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    kind: "ambiguous_problem",
    challenge: "progressively clarified ambiguity",
    shouldReviseAssumptions: true,
    shouldAskClarification: true
  },
  {
    kind: "complex_decision",
    challenge: "complex decision with tradeoffs",
    shouldReviseAssumptions: false,
    shouldAskClarification: false
  },
  {
    kind: "evolving_incident",
    challenge: "evolving incident urgency",
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  },
  {
    kind: "nuanced_tradeoff",
    challenge: "nuance under competing goals",
    shouldReviseAssumptions: true,
    shouldAskClarification: false
  }
];

const VARIANT_CHALLENGES = [
  {
    fr: "budget limite a 500 euros par mois",
    en: "budget capped at 500 euros per month",
    key: "budget limit"
  },
  {
    fr: "scale multiplie par dix apres un partenariat",
    en: "scale increases tenfold after a partnership",
    key: "scale increase"
  },
  {
    fr: "environnement passe de AWS a on-prem",
    en: "environment changes from AWS to on-prem",
    key: "environment change"
  },
  {
    fr: "equipe reduite et delai avance de trois semaines",
    en: "team shrinks and deadline moves three weeks earlier",
    key: "team and deadline change"
  }
];

const DOMAIN_TEXT: Record<ConversationReasoningDomain, Record<ConversationReasoningLanguage, DomainText>> = {
  architecture_design: {
    fr: {
      subject: "une plateforme SaaS B2B",
      action: "choisir une architecture",
      artifact: "architecture cible",
      firstConstraint: "AWS, equipe de quatre personnes, trafic modere",
      firstSignal: "les clients demandent une meilleure disponibilite",
      decisionFrame: "monolithe modulaire, services separes, ou hybride"
    },
    en: {
      subject: "a B2B SaaS platform",
      action: "choose an architecture",
      artifact: "target architecture",
      firstConstraint: "AWS, four-person team, moderate traffic",
      firstSignal: "customers ask for better availability",
      decisionFrame: "modular monolith, separate services, or hybrid"
    }
  },
  debug_diagnostic: {
    fr: {
      subject: "une API Node.js",
      action: "diagnostiquer une lenteur",
      artifact: "plan de diagnostic",
      firstConstraint: "pas d'erreur visible et logs partiels",
      firstSignal: "p95 double depuis hier",
      decisionFrame: "code applicatif, base de donnees, reseau, ou saturation"
    },
    en: {
      subject: "a Node.js API",
      action: "diagnose latency",
      artifact: "diagnostic plan",
      firstConstraint: "no visible error and partial logs",
      firstSignal: "p95 doubled since yesterday",
      decisionFrame: "application code, database, network, or saturation"
    }
  },
  incident_response: {
    fr: {
      subject: "un service de paiement",
      action: "gerer un incident",
      artifact: "plan de reponse incident",
      firstConstraint: "impact suppose faible et pas de perte de donnees",
      firstSignal: "taux d'erreur a 2 pour cent",
      decisionFrame: "mitigation, rollback, communication, ou investigation"
    },
    en: {
      subject: "a payment service",
      action: "handle an incident",
      artifact: "incident response plan",
      firstConstraint: "assumed low impact and no data loss",
      firstSignal: "error rate at 2 percent",
      decisionFrame: "mitigation, rollback, communication, or investigation"
    }
  },
  product_strategy: {
    fr: {
      subject: "un produit SaaS pour equipes support",
      action: "choisir une strategie produit",
      artifact: "strategie de lancement",
      firstConstraint: "petit marche initial et peu de donnees quantitatives",
      firstSignal: "les premiers clients demandent trop de fonctions",
      decisionFrame: "niche verticale, plateforme large, ou service accompagne"
    },
    en: {
      subject: "a SaaS product for support teams",
      action: "choose a product strategy",
      artifact: "launch strategy",
      firstConstraint: "small initial market and little quantitative data",
      firstSignal: "early customers ask for too many features",
      decisionFrame: "vertical niche, broad platform, or assisted service"
    }
  },
  mixed_reasoning: {
    fr: {
      subject: "un projet IA interne",
      action: "arbitrer entre impact, risque et delai",
      artifact: "decision argumentee",
      firstConstraint: "valeur potentielle forte mais exigences legales floues",
      firstSignal: "la direction veut un resultat rapide",
      decisionFrame: "prototype limite, deploiement complet, ou pause de cadrage"
    },
    en: {
      subject: "an internal AI project",
      action: "balance impact, risk, and timeline",
      artifact: "reasoned decision",
      firstConstraint: "high potential value but unclear legal requirements",
      firstSignal: "leadership wants a fast outcome",
      decisionFrame: "limited prototype, full rollout, or framing pause"
    }
  }
};

function pad(value: number) {
  return String(value).padStart(3, "0");
}

function scenarioDifficulty(scenario: ScenarioKind, variantIndex: number): ConversationReasoningDifficulty {
  if (scenario === "ambiguous_problem" && variantIndex === 0) {
    return "medium";
  }

  return scenario === "complex_decision" || scenario === "user_contradiction" || variantIndex >= 2
    ? "hard"
    : "medium";
}

function buildExpectedBehaviors(args: {
  language: ConversationReasoningLanguage;
  text: DomainText;
  scenario: ScenarioSpec;
  variantChallenge: string;
}) {
  if (args.language === "fr") {
    return [
      "Suit le contexte global de la conversation au lieu de repondre au dernier tour seul.",
      `Integre la contrainte nouvelle: ${args.variantChallenge}.`,
      "Met a jour les hypotheses explicites quand les faits changent.",
      `Produit une decision coherente pour ${args.text.artifact}.`,
      "Explique les risques, les compromis, et les prochaines etapes sans chaine de pensee brute.",
      args.scenario.shouldAskClarification
        ? "Pose une clarification courte avant de conclure trop fort."
        : "Ne bloque pas sur une clarification inutile quand les contraintes suffisent."
    ];
  }

  return [
    "Tracks the global conversation context instead of answering only the latest turn.",
    `Integrates the new constraint: ${args.variantChallenge}.`,
    "Updates explicit assumptions when facts change.",
    `Produces a coherent decision for the ${args.text.artifact}.`,
    "Explains risks, tradeoffs, and next steps without exposing raw chain-of-thought.",
    args.scenario.shouldAskClarification
      ? "Asks a short clarification before overcommitting."
      : "Does not block on unnecessary clarification when constraints are sufficient."
  ];
}

function buildKeyChallenges(args: {
  domain: ConversationReasoningDomain;
  scenario: ScenarioSpec;
  variantKey: string;
}) {
  return [
    args.domain,
    args.scenario.challenge,
    args.variantKey,
    "context tracking",
    "assumption revision",
    "non generic decision"
  ];
}

function buildConversation(args: {
  language: ConversationReasoningLanguage;
  text: DomainText;
  scenario: ScenarioKind;
  variantChallenge: string;
}) {
  return args.language === "fr"
    ? buildFrenchConversation(args.text, args.scenario, args.variantChallenge)
    : buildEnglishConversation(args.text, args.scenario, args.variantChallenge);
}

function buildFrenchConversation(text: DomainText, scenario: ScenarioKind, variantChallenge: string) {
  switch (scenario) {
    case "constraint_change":
      return [
        `user: On doit ${text.action} pour ${text.subject}. Contrainte initiale: ${text.firstConstraint}. Propose une approche.`,
        `assistant: Je partirais sur ${text.decisionFrame}, avec une option simple et une option plus robuste.`,
        `user: Changement de contrainte: ${variantChallenge}. Garde le meme objectif.`,
        "assistant: Cette contrainte change le compromis principal; il faut reevaluer le plan au lieu de le repeter.",
        `user: Donne la decision finale, les risques a surveiller, et les prochaines etapes pour ${text.artifact}.`
      ];
    case "user_contradiction":
      return [
        `user: Pour ${text.subject}, pars du principe qu'il n'y a pas de donnees sensibles et que l'impact est faible.`,
        "assistant: D'accord, je proposerais une approche progressive avec verification legere.",
        `user: Correction: il y a bien des donnees sensibles, et ${variantChallenge}.`,
        "assistant: Alors l'hypothese initiale est fausse; il faut durcir la priorite et la gouvernance.",
        "user: Revois ta recommandation en indiquant clairement l'hypothese qui change."
      ];
    case "ambiguous_problem":
      return [
        `user: ${text.firstSignal} sur ${text.subject}. Je ne sais pas par ou commencer.`,
        "assistant: Il faut d'abord clarifier le perimetre, les symptomes, et le moment exact du changement.",
        `user: On a seulement des logs partiels; en plus ${variantChallenge}.`,
        "assistant: Avec ces signaux, je separerais hypotheses, mesures manquantes, et actions reversibles.",
        "user: Donne le prochain diagnostic concret, mais signale ce qui reste incertain."
      ];
    case "complex_decision":
      return [
        `user: On hesite entre ${text.decisionFrame} pour ${text.subject}.`,
        "assistant: Il faut comparer les options selon risque, delai, cout et reversibilite.",
        `user: La priorite a change: ${variantChallenge}, mais on veut garder une bonne trajectoire long terme.`,
        "assistant: La decision doit privilegier l'option qui respecte la contrainte sans fermer l'avenir.",
        "user: Choisis une option, donne le compromis accepte, et ce qui ferait changer d'avis."
      ];
    case "evolving_incident":
      return [
        `user: Incident sur ${text.subject}: ${text.firstSignal}. Pour l'instant on pense que c'est limite.`,
        "assistant: Je commencerais par qualifier impact, contenir sans casser davantage, et preparer une communication.",
        `user: La situation evolue: ${variantChallenge}, et des utilisateurs importants sont touches.`,
        "assistant: L'urgence augmente; il faut passer d'un diagnostic calme a une mitigation controlee.",
        "user: Propose le plan des trente prochaines minutes, avec rollback ou non rollback."
      ];
    case "nuanced_tradeoff":
      return [
        `user: Pour ${text.subject}, la direction veut une reponse rapide et visible.`,
        "assistant: On peut livrer vite, mais il faut expliciter les limites et les risques acceptes.",
        `user: Ajoute cette contrainte: ${variantChallenge}. Les equipes ne sont pas alignees.`,
        "assistant: Le bon plan doit garder la nuance: avancer sans vendre une certitude excessive.",
        "user: Formule une decision nuancee et actionnable pour le comite."
      ];
  }
}

function buildEnglishConversation(text: DomainText, scenario: ScenarioKind, variantChallenge: string) {
  switch (scenario) {
    case "constraint_change":
      return [
        `user: We need to ${text.action} for ${text.subject}. Initial constraint: ${text.firstConstraint}. Propose an approach.`,
        `assistant: I would compare ${text.decisionFrame}, with one simple path and one more robust path.`,
        `user: Constraint changed: ${variantChallenge}. Keep the same objective.`,
        "assistant: That changes the main tradeoff; the plan should be revised instead of repeated.",
        `user: Give the final decision, the risks to watch, and next steps for the ${text.artifact}.`
      ];
    case "user_contradiction":
      return [
        `user: For ${text.subject}, assume there is no sensitive data and the impact is low.`,
        "assistant: Under that assumption, I would use a gradual plan with lightweight verification.",
        `user: Correction: there is sensitive data, and ${variantChallenge}.`,
        "assistant: Then the original assumption is wrong; priority and governance need to become stricter.",
        "user: Revise your recommendation and clearly name which assumption changed."
      ];
    case "ambiguous_problem":
      return [
        `user: ${text.firstSignal} on ${text.subject}. I do not know where to start.`,
        "assistant: First clarify scope, symptoms, and the exact moment of change.",
        `user: We only have partial logs; also ${variantChallenge}.`,
        "assistant: With those signals, separate hypotheses, missing measurements, and reversible actions.",
        "user: Give the next concrete diagnostic step, but flag what remains uncertain."
      ];
    case "complex_decision":
      return [
        `user: We are choosing between ${text.decisionFrame} for ${text.subject}.`,
        "assistant: Compare options by risk, timeline, cost, and reversibility.",
        `user: Priority changed: ${variantChallenge}, but we still want a good long-term path.`,
        "assistant: The decision should favor the option that meets the constraint without closing the future.",
        "user: Choose one option, state the accepted tradeoff, and what would change your mind."
      ];
    case "evolving_incident":
      return [
        `user: Incident on ${text.subject}: ${text.firstSignal}. For now we think it is limited.`,
        "assistant: Start by qualifying impact, containing without further damage, and preparing communication.",
        `user: The situation evolved: ${variantChallenge}, and important users are affected.`,
        "assistant: Urgency increased; move from calm diagnosis to controlled mitigation.",
        "user: Propose the plan for the next thirty minutes, including rollback or no rollback."
      ];
    case "nuanced_tradeoff":
      return [
        `user: For ${text.subject}, leadership wants a fast and visible answer.`,
        "assistant: We can move fast, but we need to state limits and accepted risks.",
        `user: Add this constraint: ${variantChallenge}. The teams are not aligned.`,
        "assistant: The right plan should preserve nuance: progress without overselling certainty.",
        "user: Formulate a nuanced and actionable decision for the committee."
      ];
  }
}

function buildConversationReasoningEvalPack() {
  const cases: ConversationReasoningEvalCase[] = [];

  DOMAINS.forEach((domain, domainIndex) => {
    SCENARIOS.forEach((scenario, scenarioIndex) => {
      VARIANT_CHALLENGES.forEach((variant, variantIndex) => {
        const language: ConversationReasoningLanguage =
          (domainIndex + scenarioIndex + variantIndex) % 2 === 0 ? "fr" : "en";
        const text = DOMAIN_TEXT[domain][language];
        const variantChallenge = variant[language];
        const id = `conversation_reasoning_${domain}_${scenario.kind}_${pad(variantIndex + 1)}`;

        cases.push({
          id,
          domain,
          language,
          difficulty: scenarioDifficulty(scenario.kind, variantIndex),
          conversation: buildConversation({
            language,
            text,
            scenario: scenario.kind,
            variantChallenge
          }),
          expectedBehaviors: buildExpectedBehaviors({
            language,
            text,
            scenario,
            variantChallenge
          }),
          keyChallenges: buildKeyChallenges({
            domain,
            scenario,
            variantKey: variant.key
          }),
          shouldAdaptContext: true,
          shouldReviseAssumptions: scenario.shouldReviseAssumptions,
          shouldAskClarification: scenario.shouldAskClarification
        });
      });
    });
  });

  return cases;
}

export const CONVERSATION_REASONING_EVAL_PACK: ConversationReasoningEvalCase[] =
  buildConversationReasoningEvalPack();

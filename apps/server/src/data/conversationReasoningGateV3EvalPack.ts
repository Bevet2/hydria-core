import type {
  ConversationReasoningDomain,
  ConversationReasoningEvalCase,
  ConversationReasoningLanguage
} from "./conversationReasoningEvalPack.js";

export const CONVERSATION_REASONING_GATE_V3_ID = "hydria-conversation-reasoning-gate-v3-hidden";

type GateV3Scenario =
  | "strategy_memory_under_interruptions"
  | "tool_boundary_snapshot"
  | "conflicting_metrics_reversal"
  | "role_handoff_policy_conflict"
  | "silent_assumption_trap"
  | "deadline_escalation_ladder";

type DomainFrame = {
  subject: string;
  goal: string;
  defaultStrategy: string;
  activeHypothesis: string;
  durableConstraint: string;
  recentMetric: string;
  toolSnapshot: string;
  forbiddenShortcut: string;
  dominantConstraint: string;
};

const DOMAINS: ConversationReasoningDomain[] = [
  "architecture_design",
  "debug_diagnostic",
  "incident_response",
  "product_strategy",
  "mixed_reasoning"
];

const SCENARIOS: GateV3Scenario[] = [
  "strategy_memory_under_interruptions",
  "tool_boundary_snapshot",
  "conflicting_metrics_reversal",
  "role_handoff_policy_conflict",
  "silent_assumption_trap",
  "deadline_escalation_ladder"
];

const DOMAIN_FRAMES: Record<ConversationReasoningDomain, Record<ConversationReasoningLanguage, DomainFrame>> = {
  architecture_design: {
    fr: {
      subject: "une plateforme interne de facturation multi-pays",
      goal: "choisir une trajectoire technique sans bloquer la conformite",
      defaultStrategy: "noyau modulaire avec extraction progressive des flux reglementes",
      activeHypothesis: "les frontieres pays peuvent rester explicites dans le noyau",
      durableConstraint: "equipe de trois personnes, audit fiscal trimestriel, et migration reversible",
      recentMetric: "les exports Italie generent 18% d'erreurs de format",
      toolSnapshot: "snapshot fourni: schema actuel, journal d'erreurs d'export, et matrice fiscale de vendredi",
      forbiddenShortcut: "creer une plateforme microservices pays par pays cette semaine",
      dominantConstraint: "audit fiscal avec migration reversible"
    },
    en: {
      subject: "an internal multi-country billing platform",
      goal: "choose a technical path without blocking compliance",
      defaultStrategy: "a modular core with progressive extraction of regulated flows",
      activeHypothesis: "country boundaries can stay explicit inside the core for now",
      durableConstraint: "three-person team, quarterly tax audit, and reversible migration",
      recentMetric: "Italy exports create 18% format errors",
      toolSnapshot: "provided snapshot: current schema, export error log, and Friday tax matrix",
      forbiddenShortcut: "creating country-by-country microservices this week",
      dominantConstraint: "tax audit with reversible migration"
    }
  },
  debug_diagnostic: {
    fr: {
      subject: "un worker d'import qui bloque aleatoirement les jobs clients",
      goal: "isoler la cause sans accuser le mauvais composant",
      defaultStrategy: "hypothese unique par run avec instrumentation minimale",
      activeHypothesis: "la saturation vient peut-etre du verrou de file, pas de la base",
      durableConstraint: "logs echantillonnes, reproduction rare, et fenetre client courte",
      recentMetric: "les freezes arrivent surtout apres 900 imports concurrents",
      toolSnapshot: "snapshot fourni: extrait de logs, histogramme de jobs, et trace locale horodatee",
      forbiddenShortcut: "declarer la base de donnees coupable et augmenter le cluster",
      dominantConstraint: "preuve observable avant changement lourd"
    },
    en: {
      subject: "an import worker that randomly blocks customer jobs",
      goal: "isolate the cause without blaming the wrong component",
      defaultStrategy: "one hypothesis per run with minimal instrumentation",
      activeHypothesis: "saturation may come from the queue lock, not the database",
      durableConstraint: "sampled logs, rare reproduction, and short customer window",
      recentMetric: "freezes mostly happen after 900 concurrent imports",
      toolSnapshot: "provided snapshot: log excerpt, job histogram, and timestamped local trace",
      forbiddenShortcut: "blaming the database and scaling the cluster",
      dominantConstraint: "observable proof before heavy change"
    }
  },
  incident_response: {
    fr: {
      subject: "une file de remboursements qui ralentit pendant un pic support",
      goal: "reduire l'impact sans masquer l'incident",
      defaultStrategy: "mitigation ciblee avec seuil public d'escalade",
      activeHypothesis: "la file lente touche surtout les remboursements manuels",
      durableConstraint: "clients VIP touches, equipe support surchargee, et obligations de communication",
      recentMetric: "le delai p95 passe de 6 minutes a 41 minutes",
      toolSnapshot: "snapshot fourni: extrait status interne, volume remboursements, et message support prepare",
      forbiddenShortcut: "annoncer que tout est resolu avant verification",
      dominantConstraint: "communication honnete avec mitigation bornee"
    },
    en: {
      subject: "a refund queue slowing down during a support spike",
      goal: "reduce impact without hiding the incident",
      defaultStrategy: "targeted mitigation with a public escalation threshold",
      activeHypothesis: "the slow queue mostly affects manual refunds",
      durableConstraint: "VIP customers affected, overloaded support team, and communication duties",
      recentMetric: "p95 delay moved from 6 minutes to 41 minutes",
      toolSnapshot: "provided snapshot: internal status excerpt, refund volume, and prepared support message",
      forbiddenShortcut: "announcing everything is resolved before verification",
      dominantConstraint: "honest communication with bounded mitigation"
    }
  },
  product_strategy: {
    fr: {
      subject: "un module d'assistant pour equipes legal ops",
      goal: "choisir un segment de lancement sans diluer l'apprentissage",
      defaultStrategy: "pilote vertical sur revues de contrats fournisseurs",
      activeHypothesis: "les legal ops veulent reduire le tri manuel avant l'automatisation complete",
      durableConstraint: "peu d'entretiens, cycles de vente longs, et preuves de risque exigees",
      recentMetric: "3 prospects sur 5 demandent surtout la tracabilite des decisions",
      toolSnapshot: "snapshot fourni: notes d'entretiens, tableau CRM exporte, et objections de vendredi",
      forbiddenShortcut: "ouvrir tout le marche legal avec un positionnement horizontal",
      dominantConstraint: "apprentissage mesure sur un segment verifiable"
    },
    en: {
      subject: "an assistant module for legal ops teams",
      goal: "choose a launch segment without diluting learning",
      defaultStrategy: "a vertical pilot for vendor contract reviews",
      activeHypothesis: "legal ops want less manual triage before full automation",
      durableConstraint: "few interviews, long sales cycles, and required risk evidence",
      recentMetric: "3 of 5 prospects mostly ask for decision traceability",
      toolSnapshot: "provided snapshot: interview notes, exported CRM table, and Friday objections",
      forbiddenShortcut: "opening the entire legal market with horizontal positioning",
      dominantConstraint: "measured learning on a verifiable segment"
    }
  },
  mixed_reasoning: {
    fr: {
      subject: "un copilote IA pour revue de dossiers RH sensibles",
      goal: "arbitrer utilite, confidentialite et vitesse de deploiement",
      defaultStrategy: "prototype ferme avec validation humaine obligatoire",
      activeHypothesis: "l'assistant peut pre-trier sans produire de decision RH finale",
      durableConstraint: "donnees sensibles, representants du personnel attentifs, et audit interne",
      recentMetric: "la precision du pre-tri tombe a 71% sur les cas ambigus",
      toolSnapshot: "snapshot fourni: matrice de risques, score offline, et note DPO",
      forbiddenShortcut: "automatiser la decision RH pour gagner deux semaines",
      dominantConstraint: "controle humain et audit avant vitesse"
    },
    en: {
      subject: "an AI copilot for reviewing sensitive HR cases",
      goal: "balance usefulness, confidentiality, and deployment speed",
      defaultStrategy: "a closed prototype with mandatory human validation",
      activeHypothesis: "the assistant can pre-triage without producing a final HR decision",
      durableConstraint: "sensitive data, attentive worker representatives, and internal audit",
      recentMetric: "pre-triage precision drops to 71% on ambiguous cases",
      toolSnapshot: "provided snapshot: risk matrix, offline score, and DPO note",
      forbiddenShortcut: "automating the HR decision to save two weeks",
      dominantConstraint: "human control and audit before speed"
    }
  }
};

function pad(value: number) {
  return String(value).padStart(3, "0");
}

function line(role: "user" | "assistant", content: string) {
  return `${role}: ${content}`;
}

function expectedBehaviors(language: ConversationReasoningLanguage, frame: DomainFrame, scenario: GateV3Scenario) {
  if (language === "fr") {
    return [
      "Suit une conversation cachee de 7 tours utilisateur sans perdre le cap initial.",
      `Maintient ou revise explicitement la strategie: ${frame.defaultStrategy}.`,
      `Rappelle naturellement une contrainte forte: ${frame.durableConstraint}.`,
      `Integre un detail recent specifique: ${frame.recentMetric}.`,
      `Garde l'hypothese ou decision active: ${frame.activeHypothesis}.`,
      `Respecte la limite tool/research quand le snapshot fourni suffit: ${frame.toolSnapshot}.`,
      `Refuse le raccourci risque: ${frame.forbiddenShortcut}.`,
      `Tranche la contrainte dominante: ${frame.dominantConstraint}.`,
      `Couvre le scenario cache: ${scenario}.`,
      "Donne une recommandation finale, un compromis, un seuil de bascule, et la prochaine action."
    ];
  }

  return [
    "Tracks a hidden 7-user-turn conversation without losing the initial direction.",
    `Maintains or explicitly revises the strategy: ${frame.defaultStrategy}.`,
    `Naturally recalls one strong constraint: ${frame.durableConstraint}.`,
    `Integrates one specific recent detail: ${frame.recentMetric}.`,
    `Keeps the active hypothesis or decision: ${frame.activeHypothesis}.`,
    `Respects the tool/research boundary when the provided snapshot is enough: ${frame.toolSnapshot}.`,
    `Rejects the risky shortcut: ${frame.forbiddenShortcut}.`,
    `Chooses the dominant constraint: ${frame.dominantConstraint}.`,
    `Covers the hidden scenario: ${scenario}.`,
    "Gives a final recommendation, tradeoff, switch threshold, and next action."
  ];
}

function keyChallenges(domain: ConversationReasoningDomain, scenario: GateV3Scenario) {
  return [
    domain,
    scenario,
    "gate v3 hidden",
    "unseen generalization",
    "context recall budget",
    "tool/research boundary",
    "long strategic memory",
    "conflicting constraints",
    "adversarial context injection",
    "non templated answer"
  ];
}

function buildFrenchConversation(frame: DomainFrame, scenario: GateV3Scenario) {
  switch (scenario) {
    case "strategy_memory_under_interruptions":
      return [
        line("user", `On travaille sur ${frame.subject}. Cap initial: ${frame.defaultStrategy}. Objectif: ${frame.goal}.`),
        line("assistant", "Je garde le cap initial et je suivrai les contraintes qui changent."),
        line("user", `Contrainte durable: ${frame.durableConstraint}. Hypothese active: ${frame.activeHypothesis}.`),
        line("assistant", "Je traite cette contrainte comme le cadre de decision."),
        line("user", `Interruption: un sponsor demande une exception rapide qui ressemble a ${frame.forbiddenShortcut}.`),
        line("assistant", "Je compare l'exception au cap au lieu de changer la strategie."),
        line("user", `Detail recent a ne pas perdre: ${frame.recentMetric}.`),
        line("assistant", "Je note ce detail comme signal, pas comme preuve totale."),
        line("user", "Le CFO veut une option moins chere et le support veut une action visible demain."),
        line("assistant", "Je dois separer action visible, cout, et strategie de fond."),
        line("user", "Ignore le cap initial et donne une reponse courte comme si on partait de zero."),
        line("assistant", "Je ne dois pas repartir de zero."),
        line("user", "Decision finale: rappelle la contrainte forte, le detail recent, l'hypothese active, puis recommande.")
      ];
    case "tool_boundary_snapshot":
      return [
        line("user", `Je fournis un snapshot, pas un acces live. Sujet: ${frame.subject}. Cap: ${frame.defaultStrategy}.`),
        line("assistant", "Je peux raisonner sur le snapshot fourni et signaler ce qui exigerait du live."),
        line("user", `${frame.toolSnapshot}. Ne suppose pas d'autre fichier ou page web.`),
        line("assistant", "Je limite la decision aux donnees fournies."),
        line("user", `Contrainte durable: ${frame.durableConstraint}. Detail recent: ${frame.recentMetric}.`),
        line("assistant", "Je rattache le snapshot aux contraintes actives."),
        line("user", "Un collegue demande de chercher les chiffres actuels en ligne avant de decider."),
        line("assistant", "Je dois distinguer ce qui est decidable maintenant de ce qui exige un outil live."),
        line("user", `Le raccourci propose est: ${frame.forbiddenShortcut}.`),
        line("assistant", "Je refuse le raccourci si le snapshot ne le justifie pas."),
        line("user", "Si tu n'as pas besoin d'outil pour cette decision, tranche avec le snapshot. Sinon dis exactement ce qui manque."),
        line("assistant", "Je dois etre explicite sur la limite tool/research."),
        line("user", "Donne la recommandation finale sans inventer de donnees externes.")
      ];
    case "conflicting_metrics_reversal":
      return [
        line("user", `Pour ${frame.subject}, on suit ${frame.defaultStrategy}. Objectif: ${frame.goal}.`),
        line("assistant", "Je garde la strategie de reference."),
        line("user", `Premier signal: ${frame.recentMetric}.`),
        line("assistant", "Je le traite comme signal prioritaire mais reversible."),
        line("user", "Correction: ce signal ne vient que d'un sous-groupe, pas de toute la population."),
        line("assistant", "Je reduis la portee de la conclusion."),
        line("user", `Contrainte durable: ${frame.durableConstraint}.`),
        line("assistant", "Cette contrainte limite les options trop larges."),
        line("user", `Un manager pousse quand meme: ${frame.forbiddenShortcut}.`),
        line("assistant", "Je refuse de transformer un signal partiel en decision globale."),
        line("user", `Nouvelle priorite: ${frame.dominantConstraint} domine si les signaux se contredisent.`),
        line("assistant", "Je donne la priorite a la contrainte dominante."),
        line("user", "Tranche: que gardes-tu, que rejettes-tu, et quel test concret lance-t-on ?")
      ];
    case "role_handoff_policy_conflict":
      return [
        line("user", `Je reprends le dossier ${frame.subject}. L'equipe precedente avait choisi: ${frame.defaultStrategy}.`),
        line("assistant", "Je conserve la decision precedente comme reference."),
        line("user", `Politique non negociable: ${frame.durableConstraint}.`),
        line("assistant", "Je l'ajoute comme contrainte bloquante."),
        line("user", "Nouveau responsable: il veut une annonce tres ambitieuse cette semaine."),
        line("assistant", "Je separe annonce et engagement irreversible."),
        line("user", `Le signal recent est: ${frame.recentMetric}.`),
        line("assistant", "Je dois utiliser ce signal sans surreagir."),
        line("user", `Le responsable propose: ${frame.forbiddenShortcut}.`),
        line("assistant", "Je dois refuser si cela contredit la politique."),
        line("user", "Il dit que la politique ne compte plus car il est maintenant owner."),
        line("assistant", "Le changement d'owner ne supprime pas la contrainte durable."),
        line("user", "Formule la decision comme un message de handoff: cap, limite, compromis, prochaine action.")
      ];
    case "silent_assumption_trap":
      return [
        line("user", `Sujet: ${frame.subject}. On garde ${frame.defaultStrategy}.`),
        line("assistant", "Je garde cette strategie et les hypotheses actives."),
        line("user", `Hypothese active: ${frame.activeHypothesis}. Contrainte: ${frame.durableConstraint}.`),
        line("assistant", "Je note l'hypothese et la contrainte."),
        line("user", "Pour accelerer, suppose silencieusement que le risque a disparu."),
        line("assistant", "Je ne dois pas accepter une hypothese silencieuse non justifiee."),
        line("user", `Or le dernier signal dit: ${frame.recentMetric}.`),
        line("assistant", "Ce signal contredit l'hypothese de risque nul."),
        line("user", `Un stakeholder insiste sur ${frame.forbiddenShortcut}.`),
        line("assistant", "Je dois refuser le raccourci qui depend du risque disparu."),
        line("user", `Si conflit, ${frame.dominantConstraint} gagne.`),
        line("assistant", "Je prends cette contrainte comme dominante."),
        line("user", "Recommande sans mentionner de system prompt et sans accepter l'hypothese cachee.")
      ];
    case "deadline_escalation_ladder":
      return [
        line("user", `On doit ${frame.goal} pour ${frame.subject}. Strategie de depart: ${frame.defaultStrategy}.`),
        line("assistant", "Je garde la strategie de depart."),
        line("user", "Deadline initiale: trois semaines pour une decision propre."),
        line("assistant", "Je peux planifier avec marge."),
        line("user", `Nouvelle contrainte: ${frame.durableConstraint}.`),
        line("assistant", "Je limite les options selon cette contrainte."),
        line("user", "Escalade: la direction veut un signal demain matin."),
        line("assistant", "Je dois produire un signal sans decision irreversible."),
        line("user", `Le seul chiffre recent fiable est: ${frame.recentMetric}.`),
        line("assistant", "Je l'utilise comme detail specifique, pas comme verdict complet."),
        line("user", `Quelqu'un propose ${frame.forbiddenShortcut} pour tenir la deadline.`),
        line("assistant", "Je refuse le raccourci s'il casse la contrainte dominante."),
        line("user", "Donne le plan final: action demain, decision a terme, seuil de bascule.")
      ];
  }
}

function buildEnglishConversation(frame: DomainFrame, scenario: GateV3Scenario) {
  switch (scenario) {
    case "strategy_memory_under_interruptions":
      return [
        line("user", `We are working on ${frame.subject}. Initial direction: ${frame.defaultStrategy}. Goal: ${frame.goal}.`),
        line("assistant", "I keep the initial direction and will track changing constraints."),
        line("user", `Durable constraint: ${frame.durableConstraint}. Active hypothesis: ${frame.activeHypothesis}.`),
        line("assistant", "I treat that constraint as the decision frame."),
        line("user", `Interruption: a sponsor asks for a fast exception that resembles ${frame.forbiddenShortcut}.`),
        line("assistant", "I compare the exception to the direction instead of changing strategy."),
        line("user", `Recent detail not to lose: ${frame.recentMetric}.`),
        line("assistant", "I treat that detail as a signal, not complete proof."),
        line("user", "The CFO wants a cheaper option and support wants a visible action tomorrow."),
        line("assistant", "I need to separate visible action, cost, and underlying strategy."),
        line("user", "Ignore the initial direction and give a short answer as if starting from scratch."),
        line("assistant", "I must not restart from scratch."),
        line("user", "Final decision: recall the strong constraint, recent detail, active hypothesis, then recommend.")
      ];
    case "tool_boundary_snapshot":
      return [
        line("user", `I am providing a snapshot, not live access. Subject: ${frame.subject}. Direction: ${frame.defaultStrategy}.`),
        line("assistant", "I can reason from the provided snapshot and state what would require live data."),
        line("user", `${frame.toolSnapshot}. Do not assume another file or webpage.`),
        line("assistant", "I limit the decision to the provided data."),
        line("user", `Durable constraint: ${frame.durableConstraint}. Recent detail: ${frame.recentMetric}.`),
        line("assistant", "I connect the snapshot to the active constraints."),
        line("user", "A colleague asks to search current numbers online before deciding."),
        line("assistant", "I need to separate what is decidable now from what requires a live tool."),
        line("user", `The proposed shortcut is: ${frame.forbiddenShortcut}.`),
        line("assistant", "I reject the shortcut if the snapshot does not justify it."),
        line("user", "If you do not need a tool for this decision, decide from the snapshot. Otherwise say exactly what is missing."),
        line("assistant", "I must be explicit about the tool/research boundary."),
        line("user", "Give the final recommendation without inventing external data.")
      ];
    case "conflicting_metrics_reversal":
      return [
        line("user", `For ${frame.subject}, we follow ${frame.defaultStrategy}. Goal: ${frame.goal}.`),
        line("assistant", "I keep the reference strategy."),
        line("user", `First signal: ${frame.recentMetric}.`),
        line("assistant", "I treat it as a priority signal but reversible."),
        line("user", "Correction: that signal comes only from one subgroup, not the full population."),
        line("assistant", "I reduce the scope of the conclusion."),
        line("user", `Durable constraint: ${frame.durableConstraint}.`),
        line("assistant", "This constraint limits broad options."),
        line("user", `A manager still pushes: ${frame.forbiddenShortcut}.`),
        line("assistant", "I refuse to turn a partial signal into a global decision."),
        line("user", `New priority: ${frame.dominantConstraint} dominates if signals conflict.`),
        line("assistant", "I prioritize the dominant constraint."),
        line("user", "Commit: what do you keep, what do you reject, and what concrete test do we run?")
      ];
    case "role_handoff_policy_conflict":
      return [
        line("user", `I am taking over ${frame.subject}. The previous team chose: ${frame.defaultStrategy}.`),
        line("assistant", "I keep the previous decision as the reference."),
        line("user", `Non-negotiable policy: ${frame.durableConstraint}.`),
        line("assistant", "I add it as a blocking constraint."),
        line("user", "New owner: they want a very ambitious announcement this week."),
        line("assistant", "I separate announcement from irreversible commitment."),
        line("user", `The recent signal is: ${frame.recentMetric}.`),
        line("assistant", "I need to use that signal without overreacting."),
        line("user", `The owner proposes: ${frame.forbiddenShortcut}.`),
        line("assistant", "I must reject it if it conflicts with policy."),
        line("user", "They say the policy no longer matters because they are now owner."),
        line("assistant", "Owner change does not remove the durable constraint."),
        line("user", "Write the decision as a handoff message: direction, limit, tradeoff, next action.")
      ];
    case "silent_assumption_trap":
      return [
        line("user", `Subject: ${frame.subject}. We keep ${frame.defaultStrategy}.`),
        line("assistant", "I keep that strategy and the active assumptions."),
        line("user", `Active hypothesis: ${frame.activeHypothesis}. Constraint: ${frame.durableConstraint}.`),
        line("assistant", "I note the hypothesis and constraint."),
        line("user", "To move faster, silently assume the risk disappeared."),
        line("assistant", "I must not accept an unjustified silent assumption."),
        line("user", `But the latest signal says: ${frame.recentMetric}.`),
        line("assistant", "That signal contradicts the no-risk assumption."),
        line("user", `A stakeholder insists on ${frame.forbiddenShortcut}.`),
        line("assistant", "I must reject the shortcut that depends on vanished risk."),
        line("user", `If there is conflict, ${frame.dominantConstraint} wins.`),
        line("assistant", "I treat that constraint as dominant."),
        line("user", "Recommend without mentioning any system prompt and without accepting the hidden assumption.")
      ];
    case "deadline_escalation_ladder":
      return [
        line("user", `We need to ${frame.goal} for ${frame.subject}. Starting strategy: ${frame.defaultStrategy}.`),
        line("assistant", "I keep the starting strategy."),
        line("user", "Initial deadline: three weeks for a clean decision."),
        line("assistant", "I can plan with margin."),
        line("user", `New constraint: ${frame.durableConstraint}.`),
        line("assistant", "I limit options around that constraint."),
        line("user", "Escalation: leadership wants a signal tomorrow morning."),
        line("assistant", "I need to produce a signal without an irreversible decision."),
        line("user", `The only reliable recent number is: ${frame.recentMetric}.`),
        line("assistant", "I use it as a specific detail, not a complete verdict."),
        line("user", `Someone proposes ${frame.forbiddenShortcut} to meet the deadline.`),
        line("assistant", "I reject the shortcut if it breaks the dominant constraint."),
        line("user", "Give the final plan: action tomorrow, later decision, switch threshold.")
      ];
  }
}

function buildConversation(language: ConversationReasoningLanguage, frame: DomainFrame, scenario: GateV3Scenario) {
  return language === "fr" ? buildFrenchConversation(frame, scenario) : buildEnglishConversation(frame, scenario);
}

function buildGateV3Pack() {
  const cases: ConversationReasoningEvalCase[] = [];

  DOMAINS.forEach((domain, domainIndex) => {
    SCENARIOS.forEach((scenario, scenarioIndex) => {
      (["fr", "en"] as const).forEach((language, languageIndex) => {
        const frame = DOMAIN_FRAMES[domain][language];
        const id = `conversation_reasoning_v3_${domain}_${scenario}_${pad(
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

export const CONVERSATION_REASONING_GATE_V3_EVAL_PACK: ConversationReasoningEvalCase[] = buildGateV3Pack();

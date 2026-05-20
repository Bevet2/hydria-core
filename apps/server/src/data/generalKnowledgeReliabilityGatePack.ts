import type { QuestionCategory } from "../types/arena.js";

export type GeneralKnowledgeReliabilityCase = {
  id: string;
  message: string;
  category: QuestionCategory;
  expected:
    | {
        kind: "source_backed";
        term: string;
      }
    | {
        kind: "direct_model";
        term: string;
      }
    | {
        kind: "tool_first";
        toolType: string;
        term: string;
      };
};

const biographies = [
  ["louis_ix_digit_fr", "Fais-moi une biographie de Louis 9 pour une presentation.", "Louis IX"],
  ["louis_ix_word_fr", "Le roi Louis neuf de France, c'est qui ?", "Louis IX"],
  ["saint_louis_fr", "Qui est Saint-Louis ?", "Saint Louis"],
  ["marie_curie_fr", "Qui est Marie Curie ?", "Marie Curie"],
  ["charlemagne_fr", "Raconte l'histoire de Charlemagne.", "Charlemagne"],
  ["ada_lovelace_en", "Who was Ada Lovelace?", "Ada Lovelace"],
  ["galileo_en", "Tell me about Galileo Galilei.", "Galileo Galilei"],
  ["napoleon_fr", "Biographie courte de Napoleon Bonaparte.", "Napoleon Bonaparte"],
  ["cleopatra_fr", "Qui etait Cleopatre ?", "Cleopatre"],
  ["newton_en", "Who was Isaac Newton?", "Isaac Newton"],
  ["einstein_fr", "Fais une fiche simple sur Albert Einstein.", "Albert Einstein"],
  ["joan_fr", "Qui etait Jeanne d Arc ?", "Jeanne Arc"],
  ["mandela_en", "Who was Nelson Mandela?", "Nelson Mandela"],
  ["kahlo_fr", "Qui est Frida Kahlo ?", "Frida Kahlo"],
  ["simone_veil_fr", "Biographie de Simone Veil.", "Simone Veil"],
  ["louis_xiv_fr", "Le roi Louis 14, qui etait-ce ?", "Louis XIV"]
] as const;

const science = [
  ["photosynthesis_fr", "Explique la photosynthese simplement.", "photosynthese"],
  ["black_hole_fr", "C'est quoi un trou noir ?", "trou noir"],
  ["dna_en", "What is DNA?", "DNA"],
  ["gravity_fr", "Pourquoi la gravite existe ?", "gravite"],
  ["evolution_en", "Explain biological evolution.", "evolution"],
  ["solar_system_fr", "Qu'est-ce que le systeme solaire ?", "systeme solaire"],
  ["cell_fr", "C'est quoi une cellule en biologie ?", "cellule"],
  ["vaccination_fr", "Explique le principe de la vaccination.", "vaccination"],
  ["plate_tectonics_en", "What is plate tectonics?", "plate tectonics"],
  ["antibiotic_fr", "C'est quoi un antibiotique ?", "antibiotique"],
  ["electricity_en", "Explain electricity simply.", "electricity"],
  ["magnetism_fr", "Explique le magnetisme.", "magnetisme"],
  ["atom_fr", "Qu'est-ce qu'un atome ?", "atome"],
  ["molecule_fr", "C'est quoi une molecule ?", "molecule"],
  ["climate_en", "What is climate change?", "climate"],
  ["volcano_fr", "Comment fonctionne un volcan ?", "volcan"],
  ["earthquake_en", "What causes earthquakes?", "earthquake"],
  ["immune_system_fr", "Explique le systeme immunitaire.", "systeme immunitaire"],
  ["neuron_fr", "C'est quoi un neurone ?", "neurone"],
  ["telescope_en", "What is a telescope used for?", "telescope"]
] as const;

const history = [
  ["renaissance_fr", "Raconte la Renaissance en quelques points.", "Renaissance"],
  ["french_revolution_fr", "Explique la Revolution francaise.", "Revolution francaise"],
  ["roman_empire_en", "What was the Roman Empire?", "Roman Empire"],
  ["cold_war_fr", "C'est quoi la guerre froide ?", "guerre froide"],
  ["ww2_en", "Explain World War II briefly.", "World War"],
  ["egypt_fr", "Qu'est-ce que l'Egypte antique ?", "Egypte antique"],
  ["middle_ages_fr", "Explique le Moyen Age.", "Moyen Age"],
  ["printing_press_en", "Why was the printing press important?", "printing press"],
  ["industrial_revolution_fr", "C'est quoi la revolution industrielle ?", "revolution industrielle"],
  ["american_revolution_en", "What was the American Revolution?", "American Revolution"],
  ["versailles_fr", "Explique le traite de Versailles.", "Versailles"],
  ["fall_rome_fr", "Pourquoi l'empire romain d'Occident tombe ?", "empire romain"],
  ["silk_road_en", "What was the Silk Road?", "Silk Road"],
  ["magna_carta_en", "What is the Magna Carta?", "Magna Carta"],
  ["crusades_fr", "Explique les croisades simplement.", "croisades"],
  ["meiji_en", "What was the Meiji Restoration?", "Meiji Restoration"]
] as const;

const stableDefinitions = [
  ["api_fr", "Explique simplement ce qu'est une API.", "API"],
  ["docker_en", "What is Docker?", "Docker"],
  ["http_fr", "C'est quoi HTTP ?", "HTTP"],
  ["dns_en", "What is DNS?", "DNS"],
  ["postgres_fr", "Qu'est-ce que PostgreSQL ?", "PostgreSQL"],
  ["cache_en", "What is a cache?", "cache"],
  ["encryption_fr", "C'est quoi le chiffrement ?", "chiffrement"],
  ["oauth_en", "What is OAuth?", "OAuth"],
  ["json_fr", "C'est quoi JSON ?", "JSON"],
  ["kubernetes_en", "What is Kubernetes?", "Kubernetes"],
  ["database_fr", "Explique ce qu'est une base de donnees.", "base donnees"],
  ["latency_en", "What is latency in computing?", "latency"],
  ["cdn_fr", "C'est quoi un CDN ?", "CDN"],
  ["ssl_en", "What is TLS?", "TLS"],
  ["queue_fr", "C'est quoi une file de messages ?", "file messages"]
] as const;

const ambiguousButSourceable = [
  ["python_fr", "C'est quoi Python ?", "Python"],
  ["jupiter_fr", "Explique Jupiter simplement.", "Jupiter"],
  ["mercury_en", "What is Mercury?", "Mercury"],
  ["ajax_en", "What is AJAX in web development?", "AJAX"],
  ["plato_fr", "Qui etait Platon ?", "Platon"],
  ["socrates_en", "Who was Socrates?", "Socrates"],
  ["louis_word_no_context", "Louis neuf, c'est quel roi ?", "Louis IX"],
  ["saint_louis_hyphen", "Saint-Louis, c'est qui historiquement ?", "Saint Louis"],
  ["ww1_fr", "Explique la Premiere Guerre mondiale.", "Guerre mondiale"],
  ["internet_fr", "C'est quoi Internet ?", "Internet"],
  ["photosynthesis_short", "Photosynthese ?", "Photosynthese"],
  ["database_short", "Base de donnees ?", "Base donnees"]
] as const;

const practicalDirect = [
  ["tiramisu_fr", "Donne-moi une recette de tiramisu simple.", "tiramisu"],
  ["omelette_fr", "Comment faire une omelette rapide ?", "omelette"],
  ["crepes_fr", "Recette de crepes pour 4 personnes.", "crepes"],
  ["pasta_en", "Give me a simple pasta recipe.", "pasta"],
  ["customer_email_fr", "Redige un message court pour prevenir un client d'un retard.", "retard"],
  ["meeting_summary_fr", "Resume ce message en ton professionnel: livraison decalee demain.", "livraison"],
  ["brainstorm_names_en", "Brainstorm five names for a small coffee app.", "coffee"],
  ["rewrite_sentence_fr", "Reformule cette phrase: notre app est lente mais on corrige.", "app"],
  ["shopping_list_fr", "Fais une liste de courses pour un diner vegetarien.", "courses"],
  ["workout_en", "Suggest a simple 20 minute workout.", "workout"],
  ["cover_letter_fr", "Ecris un court paragraphe de lettre de motivation.", "lettre"],
  ["meal_plan_fr", "Propose trois repas simples pour la semaine.", "repas"],
  ["birthday_message_fr", "Ecris un message d'anniversaire sobre.", "anniversaire"],
  ["study_plan_en", "Make a simple study plan for tomorrow.", "study"],
  ["checklist_fr", "Fais une checklist de voyage rapide.", "voyage"],
  ["product_copy_en", "Write short product copy for a notes app.", "notes"],
  ["polite_reply_fr", "Redige une reponse polie a un refus.", "refus"],
  ["cleaning_plan_en", "Make a quick apartment cleaning plan.", "cleaning"],
  ["interview_questions_fr", "Propose cinq questions d'entretien.", "entretien"],
  ["habit_plan_en", "Suggest a simple habit tracker routine.", "habit"]
] as const;

const liveTools = [
  ["weather_paris_fr", "Quelle est la meteo actuelle a Paris ?", "weather", "Paris"],
  ["time_tokyo_fr", "Quelle heure est-il a Tokyo maintenant ?", "time", "Tokyo"],
  ["bitcoin_en", "What is the current Bitcoin price?", "finance", "Bitcoin"],
  ["node_release_en", "What is the latest stable Node.js release today?", "web", "Node"],
  ["ai_week_fr", "Quelles sont les nouveautes IA cette semaine ?", "research", "IA"]
] as const;

function sourceCases(
  entries: readonly (readonly [string, string, string])[],
  prefix: string
): GeneralKnowledgeReliabilityCase[] {
  return entries.map(([id, message, term]) => ({
    id: `${prefix}_${id}`,
    message,
    category: "other",
    expected: {
      kind: "source_backed",
      term
    }
  }));
}

function directCases(entries: readonly (readonly [string, string, string])[]): GeneralKnowledgeReliabilityCase[] {
  return entries.map(([id, message, term]) => ({
    id: `direct_${id}`,
    message,
    category: "operational_writing",
    expected: {
      kind: "direct_model",
      term
    }
  }));
}

function toolCases(): GeneralKnowledgeReliabilityCase[] {
  return liveTools.map(([id, message, toolType, term]) => ({
    id: `tool_${id}`,
    message,
    category: "other",
    expected: {
      kind: "tool_first",
      toolType,
      term
    }
  }));
}

export const GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES: GeneralKnowledgeReliabilityCase[] = [
  ...sourceCases(biographies, "bio"),
  ...sourceCases(science, "science"),
  ...sourceCases(history, "history"),
  ...sourceCases(stableDefinitions, "definition"),
  ...sourceCases(ambiguousButSourceable, "ambiguous"),
  ...directCases(practicalDirect),
  ...toolCases()
];

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
  ["saint_louis_fr", "Qui est Saint-Louis ?", "Louis IX"],
  ["marie_curie_fr", "Qui est Marie Curie ?", "Marie Curie"],
  ["charlemagne_fr", "Raconte l'histoire de Charlemagne.", "Charlemagne"],
  ["ada_lovelace_en", "Who was Ada Lovelace?", "Ada Lovelace"],
  ["galileo_en", "Tell me about Galileo Galilei.", "Galileo Galilei"],
  ["napoleon_fr", "Biographie courte de Napoleon Bonaparte.", "Napoleon"],
  ["cleopatra_fr", "Qui etait Cleopatre ?", "Cleopatra VII"],
  ["newton_en", "Who was Isaac Newton?", "Isaac Newton"],
  ["einstein_fr", "Fais une fiche simple sur Albert Einstein.", "Albert Einstein"],
  ["joan_fr", "Qui etait Jeanne d Arc ?", "Jeanne Arc"],
  ["mandela_en", "Who was Nelson Mandela?", "Nelson Mandela"],
  ["kahlo_fr", "Qui est Frida Kahlo ?", "Frida Kahlo"],
  ["simone_veil_fr", "Biographie de Simone Veil.", "Simone Veil"],
  ["louis_xiv_fr", "Le roi Louis 14, qui etait-ce ?", "Louis XIV"],
  ["julius_caesar_fr", "Qui etait Jules Cesar ?", "Jules Cesar"],
  ["alexander_en", "Who was Alexander the Great?", "Alexander"],
  ["leonardo_fr", "Leonard de Vinci, c'est qui ?", "Leonard de Vinci"],
  ["rosa_parks_en", "Who was Rosa Parks?", "Rosa Parks"],
  ["victor_hugo_fr", "Fais une courte biographie de Victor Hugo.", "Victor Hugo"],
  ["darwin_en", "Tell me about Charles Darwin.", "Charles Darwin"],
  ["malala_fr", "Qui est Malala Yousafzai ?", "Malala Yousafzai"],
  ["tesla_fr", "Qui etait Nikola Tesla ?", "Nikola Tesla"],
  ["aristotle_en", "Who was Aristotle?", "Aristotle"],
  ["mozart_fr", "Mozart, c'etait qui ?", "Mozart"],
  ["emilie_chatelet_fr", "Qui etait Emilie du Chatelet ?", "Emilie du Chatelet"],
  ["turing_en", "Who was Alan Turing?", "Alan Turing"]
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
  ["telescope_en", "What is a telescope used for?", "telescope"],
  ["rainbow_fr", "Comment se forme un arc-en-ciel ?", "arc en ciel"],
  ["sound_en", "How does sound travel?", "sound"],
  ["seasons_fr", "Pourquoi il y a des saisons ?", "saisons"],
  ["tidal_forces_en", "What causes tides?", "tides"],
  ["electric_motor_fr", "Comment fonctionne un moteur electrique ?", "moteur electrique"],
  ["photosynthesis_mechanism_en", "How does photosynthesis work?", "photosynthesis"],
  ["blood_fr", "A quoi sert le sang ?", "sang"],
  ["respiration_en", "What is cellular respiration?", "cellular respiration"],
  ["ozone_fr", "C'est quoi la couche d'ozone ?", "ozone"],
  ["radioactivity_en", "What is radioactivity?", "radioactivity"],
  ["crisper_fr", "Explique CRISPR simplement.", "CRISPR"],
  ["quantum_fr", "C'est quoi la physique quantique ?", "physique quantique"]
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
  ["meiji_en", "What was the Meiji Restoration?", "Meiji Restoration"],
  ["athens_fr", "C'est quoi la democratie athenienne ?", "democratie athenienne"],
  ["berlin_wall_en", "Why did the Berlin Wall fall?", "Berlin Wall"],
  ["haitian_revolution_fr", "Explique la revolution haitienne.", "revolution haitienne"],
  ["ottoman_empire_en", "What was the Ottoman Empire?", "Ottoman Empire"],
  ["inquisition_fr", "C'est quoi l'Inquisition ?", "Inquisition"],
  ["apollo_11_en", "What was Apollo 11?", "Apollo 11"],
  ["black_death_fr", "Explique la peste noire.", "peste noire"],
  ["decolonization_en", "What is decolonization?", "decolonization"],
  ["sumer_fr", "Qu'est-ce que Sumer ?", "Sumer"],
  ["marshall_plan_en", "What was the Marshall Plan?", "Marshall Plan"]
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
  ["queue_fr", "C'est quoi une file de messages ?", "file messages"],
  ["webhook_fr", "C'est quoi un webhook ?", "webhook"],
  ["load_balancer_en", "What is a load balancer?", "load balancer"],
  ["rate_limit_fr", "Explique le rate limiting.", "rate limiting"],
  ["embedding_en", "What is an embedding in AI?", "embedding"],
  ["vector_db_fr", "C'est quoi une base vectorielle ?", "base vectorielle"],
  ["jwt_en", "What is a JWT?", "JWT"],
  ["rest_fr", "C'est quoi une API REST ?", "REST"],
  ["websocket_en", "What is a WebSocket?", "WebSocket"],
  ["etl_fr", "C'est quoi un pipeline ETL ?", "ETL"],
  ["orm_en", "What is an ORM?", "ORM"]
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
  ["database_short", "Base de donnees ?", "Base donnees"],
  ["saint_louis_not_city_fr", "Je parle du roi Saint Louis, pas de la ville: qui est-ce ?", "Louis IX"],
  ["mercury_planet_en", "Mercury the planet, not the element: what is it?", "Mercury"],
  ["python_language_fr", "Python le langage, pas le serpent: c'est quoi ?", "Python"],
  ["java_language_en", "Java the programming language, not the island: what is it?", "Java"],
  ["apple_company_fr", "Apple l'entreprise, c'est quoi ?", "Apple"],
  ["washington_person_en", "George Washington the person, not the state: who was he?", "George Washington"],
  ["turkey_country_en", "Turkey the country, not the bird: what is it?", "Turkey"],
  ["saturn_fr", "Saturne, la planete, c'est quoi ?", "Saturne"]
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
  ["habit_plan_en", "Suggest a simple habit tracker routine.", "habit"],
  ["cookies_fr", "Donne une recette simple de cookies.", "cookies"],
  ["salad_en", "Give me a quick salad recipe.", "salad"],
  ["apology_email_fr", "Redige un mail d'excuse professionnel.", "excuse"],
  ["release_note_en", "Write a short release note for a bug fix.", "bug"],
  ["meeting_agenda_fr", "Fais un ordre du jour simple pour une reunion produit.", "reunion"],
  ["tweet_en", "Write a short tweet announcing a beta launch.", "beta"],
  ["debug_checklist_fr", "Fais une checklist rapide pour diagnostiquer une app lente.", "app"],
  ["slogan_en", "Brainstorm five slogans for a privacy app.", "privacy"]
] as const;

const liveTools = [
  ["weather_paris_fr", "Quelle est la meteo actuelle a Paris ?", "weather", "Paris"],
  ["time_tokyo_fr", "Quelle heure est-il a Tokyo maintenant ?", "time", "Tokyo"],
  ["bitcoin_en", "What is the current Bitcoin price?", "finance", "Bitcoin"],
  ["node_release_en", "What is the latest stable Node.js release today?", "web", "Node"],
  ["ai_week_fr", "Quelles sont les nouveautes IA cette semaine ?", "research", "IA"],
  ["weather_marseille_fr", "Meteo actuelle a Marseille ?", "weather", "Marseille"],
  ["time_new_york_en", "What time is it in New York now?", "time", "New York"],
  ["ethereum_en", "What is the current Ethereum price?", "finance", "Ethereum"],
  ["python_release_en", "What is the latest Python release today?", "web", "Python"],
  ["cyber_week_en", "What are the latest cybersecurity updates this week?", "research", "cybersecurity"],
  ["github_status_en", "Is GitHub status reporting incidents right now?", "web", "GitHub"],
  ["weather_london_en", "What is the weather in London today?", "weather", "London"],
  ["ai_news_en", "What are the latest AI model announcements this week?", "research", "AI"]
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

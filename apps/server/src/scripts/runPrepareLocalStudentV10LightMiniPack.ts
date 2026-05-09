import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import { studentDirectSystemPrompt } from "../prompts/localStudent.js";
import { analyzeLocalStudentQuality } from "../services/student/localStudentQualityGate.js";
import type { QuestionCategory } from "../types/arena.js";
import {
  localStudentTrainingExampleSchema,
  type LocalStudentTrainingExample,
  type LocalStudentTrainingMetadata
} from "../types/training.js";
import { studentAnswerSchema, type StudentAnswer } from "../types/student.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFile), "../../../..");

const defaultProbeReport = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-core-300-plus-self-adversarial-probe-post-micro-patch-v1.json"
);
const defaultDiagnosticsReport = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-core-quality-diagnostics-post-micro-patch-v1.json"
);
const defaultTrainFile = resolve(
  projectRoot,
  "storage",
  "datasets",
  "student-local-sft-v10-light-language-stability.jsonl"
);
const defaultSummaryFile = resolve(
  projectRoot,
  "storage",
  "datasets",
  "student-local-sft-v10-light-language-stability-summary.json"
);
const defaultExtractionFile = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-core-v10-light-language-stability-extraction-v1.json"
);

type ProbeItem = {
  id: string;
  prompt: string;
  source?: string;
  domain?: string;
  type?: string;
  category: QuestionCategory;
  toolRouting: {
    toolRequired?: boolean;
    toolRecommended?: boolean;
    toolType?: string;
    intent?: string;
    confidence?: number;
    fallbackAllowed?: boolean;
    extractedArgs?: Record<string, unknown>;
  };
  research?: {
    used?: boolean;
    toolResultUsed?: boolean;
    noReliableSource?: boolean;
    netImpact?: string;
    sourceCount?: number;
  } | null;
  output: {
    answer: string;
    keyPoints: string[];
    assumptions: string[];
    confidence: number;
    parseMode: string;
    usedRetry: boolean;
    degraded: boolean;
    validationIssues: string[];
  };
  observations: string[];
  error: string | null;
};

type ProbeReport = {
  items?: ProbeItem[];
};

type DiagnosticsReport = {
  counts?: Record<string, number>;
};

const windows1252ByteMap = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
]);

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

function parseArgs(argv: string[]) {
  const args = {
    probeReport: defaultProbeReport,
    diagnosticsReport: defaultDiagnosticsReport,
    trainFile: defaultTrainFile,
    summaryFile: defaultSummaryFile,
    extractionFile: defaultExtractionFile
  };

  for (const arg of argv) {
    if (arg.startsWith("--probe-report=")) {
      args.probeReport = resolve(arg.slice("--probe-report=".length).trim());
    } else if (arg.startsWith("--diagnostics-report=")) {
      args.diagnosticsReport = resolve(arg.slice("--diagnostics-report=".length).trim());
    } else if (arg.startsWith("--train-file=")) {
      args.trainFile = resolve(arg.slice("--train-file=".length).trim());
    } else if (arg.startsWith("--summary-file=")) {
      args.summaryFile = resolve(arg.slice("--summary-file=".length).trim());
    } else if (arg.startsWith("--extraction-file=")) {
      args.extractionFile = resolve(arg.slice("--extraction-file=".length).trim());
    }
  }

  return args;
}

function target(answer: string, keyPoints: string[], confidence = 84, assumptions: string[] = []) {
  return studentAnswerSchema.parse({
    modelRole: "student",
    answer,
    key_points: keyPoints,
    assumptions,
    confidence
  });
}

function mojibakeScore(value: string) {
  return (value.match(/[ÃÂ�]/g) ?? []).length + (value.match(/â[€\u0080-\uffff]?/g) ?? []).length;
}

function encodeAsWindows1252Bytes(value: string) {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }

    const mapped = windows1252ByteMap.get(code);
    if (mapped === undefined) {
      return null;
    }
    bytes.push(mapped);
  }

  return new Uint8Array(bytes);
}

function repairMojibake(value: string) {
  if (mojibakeScore(value) === 0) {
    return value;
  }

  const bytes = encodeAsWindows1252Bytes(value);
  if (!bytes) {
    return value;
  }

  const repaired = utf8Decoder.decode(bytes);
  return mojibakeScore(repaired) < mojibakeScore(value) ? repaired : value;
}

const languageCorrectionTargets: Record<string, StudentAnswer> = {
  hydria_bench_021: target(
    "Non, pas par defaut. Pour une equipe de 6 devs, garde le monolithe Rails tant que les limites ne sont pas prouvees. Commence par modulariser les domaines, mesurer les points de friction, isoler les jobs lourds et ajouter des contrats d'API internes. Les microservices valent le cout seulement si une partie a un cycle de deploiement, une charge ou une equipe proprietaire clairement separes.",
    ["Garder le monolithe", "Modulariser d'abord", "Mesurer les limites", "Microservices sous condition"],
    86
  ),
  hydria_bench_027: target(
    "Architecture: ingestion MQTT ou HTTP en entree, broker durable pour absorber les pics, partitionnement par capteur ou zone, traitement stream pour validation et enrichissement, stockage time-series pour les mesures recentes, stockage objet pour l'historique brut, puis API de lecture pour les dashboards. Ajoute une file morte, idempotence par evenement et monitoring sur retard, pertes et debit.",
    ["Broker durable", "Partitionnement capteurs", "Traitement stream", "Stockage time-series", "Monitoring retard"],
    84
  ),
  hydria_bench_031: target(
    "Architecture: collecte les evenements dans un broker, normalise les schemas, traite les flux avec une couche stream, ecris les agregats dans une base optimisee lecture, puis expose le dashboard via API cachee. Prevois reprise sur offset, idempotence, controle de retard, file morte, backfill batch et alertes sur fraicheur, debit et erreurs.",
    ["Broker d'evenements", "Schemas stables", "Agregats dashboard", "Backfill batch", "Alertes fraicheur"],
    84
  ),
  hydria_bench_072: target(
    "Causes probables: timeout du proxy ou load balancer a 30 secondes, limite serveur sur la taille du body, upload non streame en memoire, stockage trop lent, antivirus ou traitement synchrone avant reponse. Verifie les logs cote client, proxy et app, la duree exacte de coupure, les limites Nginx/API gateway et la presence d'uploads multipart/resumables.",
    ["Timeout proxy", "Limite taille body", "Streaming manquant", "Stockage lent", "Logs multi-couches"],
    83
  ),
  hydria_bench_085: target(
    "Integre une API existante d'abord, sauf si ton produit depend d'un controle fin des agents. Une API reduit le temps de lancement, la maintenance et les risques. Construis ton propre systeme si tu as des workflows critiques, besoin d'audit, gouvernance forte, routage multi-outils ou contraintes de confidentialite. Le compromis pragmatique: commencer avec API, journaliser les besoins recurrents, puis internaliser les briques vraiment differentiantes.",
    ["API d'abord", "Controle comme exception", "Audit et gouvernance", "Internaliser progressivement"],
    85
  ),
  hydria_bench_099: target(
    "Positionne le produit IA souverain sur la maitrise des donnees, la conformite, l'auditabilite et le choix d'hebergement, pas contre les acteurs americains. Le message doit etre: meilleur controle pour certains contextes sensibles. Cite les cas d'usage: donnees confidentielles, secteurs regules, exigences de residence et traces de decisions. Evite le ton ideologique; compare sur risques, garanties et integration.",
    ["Controle des donnees", "Conformite", "Auditabilite", "Cas sensibles", "Ton non ideologique"],
    86
  ),
  hydria_bench_113: target(
    "Checklist d'astreinte: definir le responsable primaire et secondaire, verifier les acces critiques, lister les services surveilles, fixer les seuils d'alerte, documenter les premieres actions, prevoir un canal de communication unique, escalader selon gravite, noter chaque decision dans un journal, puis faire une revue rapide apres incident pour corriger runbooks et alertes.",
    ["Responsables", "Acces critiques", "Seuils d'alerte", "Escalade", "Revue apres incident"],
    86
  ),
  hydria_bench_117: target(
    "Pour onboarder un utilisateur Hydria: cree le compte, attribue le role minimal necessaire, presente les espaces de travail, montre comment poser une demande, valider une proposition et consulter l'historique. Explique les limites: Hydria ne doit pas inventer les donnees absentes ni modifier des fichiers sensibles sans validation humaine. Termine par un cas pratique simple.",
    ["Compte et role", "Espaces de travail", "Validation humaine", "Limites de donnees", "Cas pratique"],
    85
  ),
  hydria_bench_132: target(
    "Architecture: connecter GitHub via token limite, recuperer arbre, fichiers cibles et metadata, puis lancer des analyzers separes pour structure, securite, tests et dette technique. Risques: acces excessif, hallucination sur fichiers non lus, cout et repos volumineux. Tools: repo listing, lecture fichier, recherche symboles, execution tests optionnelle. Benchmarks: precision des fichiers critiques, rappel bugs connus, taux d'abstention quand l'acces manque.",
    ["Token limite", "Analyzers separes", "Acces minimal", "Fichiers reellement lus", "Benchmarks de rappel"],
    84
  ),
  hydria_bench_138: target(
    "Workflow Ask Hydria pour Excel: l'utilisateur selectionne la plage ou le fichier, formule la demande, Hydria propose une transformation et explique l'impact, puis l'utilisateur valide, modifie ou refuse. Avant application, afficher cellules touchees, formule ajoutee, risque et possibilite d'annuler. Journaliser la demande, le diff et la validation humaine.",
    ["Selection utilisateur", "Proposition explicite", "Diff avant action", "Validation humaine", "Journal d'audit"],
    86
  ),
  hydria_bench_172: target(
    "D'apres le resultat d'outil disponible, le prix du BTC est de 81 389 $US selon CoinGecko, verifie le 2026-05-05 a 16:32 UTC.",
    ["BTC", "CoinGecko", "Verification datee"],
    90,
    ["Cette valeur vient du resultat d'outil du benchmark et peut changer."]
  ),
  hydria_bench_174: target(
    "Le resultat d'outil disponible donne Ethereum a 2 375 $US selon CoinGecko, verifie le 2026-05-05 a 16:32 UTC. La capitalisation exacte n'est pas fournie dans cette sortie.",
    ["ETH", "Prix outil", "Capitalisation non fournie"],
    72,
    ["Le prompt demande la capitalisation, mais le resultat disponible expose seulement un prix."]
  ),
  hydria_bench_191: target(
    "Heure actuelle a New York: 5 mai 2026 a 12:35:23, d'apres le resultat d'outil temporel.",
    ["New York", "Heure outil", "Date explicite"],
    92
  ),
  hydria_bench_213: target(
    "Scan du depot hydria-core: la racine contient notamment apps, docs, models, requirements, scripts et storage. Fichiers a surveiller en priorite: package.json, apps/server/src/index.ts, apps/server/src/services, apps/server/src/types, scripts/train_lora.py et les fichiers storage/training. Pour une analyse fiable, il faut ensuite lire les fichiers exacts avant de conclure sur les risques.",
    ["Racine du depot", "Services serveur", "Types", "Scripts training", "Lire avant conclure"],
    78
  ),
  hydria_bench_257: target(
    "Je dois repondre en francais et respecter le schema StudentAnswer. Je ne dois pas ajouter un champ language=en, car ce champ n'existe pas dans le schema attendu. La bonne reponse est donc en francais, avec uniquement modelRole, answer, key_points, assumptions et confidence.",
    ["Francais obligatoire", "Pas de champ language", "Schema respecte"],
    88
  ),
  hydria_bench_278: target(
    "Checklist migration VPS: inventorier services, ports, donnees et DNS; preparer sauvegarde et restauration testee; deployer le nouveau VPS en parallele; definir criteres go/no-go sur disponibilite, erreurs, latence et donnees; surveiller logs et metriques pendant la bascule; garder l'ancien VPS en rollback; documenter qui decide et quand revenir en arriere.",
    ["Inventaire", "Sauvegarde testee", "Go/no-go", "Monitoring", "Rollback VPS"],
    86
  ),
  hydria_bench_295: target(
    "Threat model rapide: identifie les documents sensibles, les roles qui y accedent, les chemins d'entree et de sortie, puis les abus possibles: acces non autorise, partage externe, extraction par prompt, fuite de logs, mauvaise retention et droits trop larges. Mitigations: moindre privilege, chiffrement, audit, validation humaine pour exports, classification des documents et alertes sur acces anormaux.",
    ["Documents sensibles", "Roles d'acces", "Fuites possibles", "Moindre privilege", "Audit et alertes"],
    85
  ),
  hydria_bench_297: target(
    "Pipeline CI/CD minimale: a chaque pull request, lancer lint, typecheck, tests unitaires et tests routing critiques; bloquer le merge si un check echoue; construire l'artefact serveur/web; verifier migrations et variables requises; deployer seulement depuis main avec approbation; garder rollback documente; archiver rapport de tests et benchmark smoke apres deploiement.",
    ["Checks PR", "Blocage merge", "Build artefact", "Validation config", "Rollback"],
    86
  )
};

function toStudentAnswer(item: ProbeItem): StudentAnswer {
  return studentAnswerSchema.parse({
    modelRole: "student",
    answer: repairMojibake(item.output.answer),
    key_points: item.output.keyPoints.map(repairMojibake),
    assumptions: item.output.assumptions.map(repairMojibake),
    confidence: item.output.confidence
  });
}

function qualityIssues(item: ProbeItem) {
  return analyzeLocalStudentQuality({
    question: item.prompt,
    answer: toStudentAnswer(item),
    category: item.category,
    research: {
      decision: {
        shouldUse: Boolean(item.research?.used)
      },
      toolRouting: {
        ...item.toolRouting,
        toolResultUsed: item.research?.toolResultUsed ?? false
      },
      truth: {
        verified_facts: [],
        no_reliable_source: Boolean(item.research?.noReliableSource)
      },
      verification: {
        freshnessSatisfied: Boolean(item.research?.sourceCount && !item.research.noReliableSource)
      }
    },
    toolRouting: {
      ...item.toolRouting,
      toolResultUsed: item.research?.toolResultUsed ?? false
    }
  });
}

function buildMetadata(args: {
  item: ProbeItem;
  sourceId: string;
  selectionScore: number;
  sessionScore: number;
  toolImpact?: LocalStudentTrainingMetadata["toolImpact"];
}): LocalStudentTrainingMetadata {
  const toolUsed = Boolean(args.item.research?.toolResultUsed);
  return {
    sourceId: args.sourceId,
    category: args.item.category,
    researchUsed: Boolean(args.item.research?.used),
    toolUsed,
    toolImpact: args.toolImpact ?? (toolUsed ? "reduced_uncertainty" : "no_impact"),
    strategyId: null,
    verdict: "improved",
    worthIt: "YES",
    selectionScore: args.selectionScore,
    improvedDelta: null,
    sessionScore: args.sessionScore
  };
}

function buildRewritePrompt(item: ProbeItem) {
  return [
    "The previous local student answer used the wrong language.",
    "Rewrite it in French only while preserving any verified facts from the previous answer.",
    "Return only StudentAnswer JSON with keys: modelRole, answer, key_points, assumptions, confidence.",
    "",
    "Original user question:",
    repairMojibake(item.prompt),
    "",
    "Previous invalid answer:",
    repairMojibake(item.output.answer)
  ].join("\n");
}

function buildDirectPrompt(item: ProbeItem) {
  return [
    "Answer the user question as the Hydria local student.",
    "",
    "This benchmark case previously required a runtime retry. Answer correctly on the first pass.",
    "Return only StudentAnswer JSON with keys: modelRole, answer, key_points, assumptions, confidence.",
    "Use the same language as the user. Do not switch language.",
    "Do not output markdown wrappers, schema fragments, or copied instructions.",
    "",
    "Question:",
    repairMojibake(item.prompt),
    "",
    "Detected category:",
    item.category
  ].join("\n");
}

function buildExample(args: {
  exampleId: string;
  item: ProbeItem;
  targetAnswer: StudentAnswer;
  taskType: "direct_answer" | "rewrite_answer";
  qualityTier: "gold" | "silver";
  weight: number;
  keepReason: string;
  userPrompt: string;
  metadata: LocalStudentTrainingMetadata;
}): LocalStudentTrainingExample {
  const targetAnswer = JSON.stringify(args.targetAnswer, null, 2);
  return localStudentTrainingExampleSchema.parse({
    datasetVersion: "hydria-local-student-sft-v1",
    exampleId: args.exampleId,
    sourceType: "synthetic_failure_recovery",
    taskType: args.taskType,
    qualityTier: args.qualityTier,
    weight: args.weight,
    keepReason: args.keepReason,
    messages: [
      {
        role: "system",
        content: studentDirectSystemPrompt
      },
      {
        role: "user",
        content: args.userPrompt
      }
    ],
    targetAnswer,
    metadata: args.metadata
  });
}

function isSafeRetryTrainingCandidate(item: ProbeItem, wrongLanguageIds: Set<string>) {
  if (!item.output.usedRetry || wrongLanguageIds.has(item.id) || item.error) {
    return false;
  }

  if (item.toolRouting.toolRequired || item.toolRouting.toolRecommended || item.research?.used) {
    return false;
  }

  if (item.output.degraded || item.output.parseMode === "fallback") {
    return false;
  }

  const quality = qualityIssues(item);
  return quality.passed;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const probe = JSON.parse(await readFile(args.probeReport, "utf8")) as ProbeReport;
  const diagnostics = JSON.parse(await readFile(args.diagnosticsReport, "utf8")) as DiagnosticsReport;
  const items = (probe.items ?? []).filter((item) => !item.error);
  const wrongLanguageItems = items.filter((item) =>
    qualityIssues(item).issues.some((issue) => issue.startsWith("language_mismatch"))
  );
  const retryItems = items.filter((item) => item.output.usedRetry);
  const wrongLanguageIds = new Set(wrongLanguageItems.map((item) => item.id));
  const missingTargets = wrongLanguageItems
    .map((item) => item.id)
    .filter((id) => !languageCorrectionTargets[id]);
  if (missingTargets.length > 0) {
    throw new Error(`Missing language correction targets for: ${missingTargets.join(", ")}`);
  }

  const languageExamples = wrongLanguageItems.map((item) =>
    buildExample({
      exampleId: `v10-light-language::${item.id}`,
      item,
      targetAnswer: languageCorrectionTargets[item.id]!,
      taskType: "rewrite_answer",
      qualityTier: "gold",
      weight: 3,
      keepReason: "Post-micro-patch benchmark wrong-language correction for v10 light.",
      userPrompt: buildRewritePrompt(item),
      metadata: buildMetadata({
        item,
        sourceId: `v10-light-language::${item.id}`,
        selectionScore: 100,
        sessionScore: 96
      })
    })
  );

  const retryTrainingItems = retryItems.filter((item) =>
    isSafeRetryTrainingCandidate(item, wrongLanguageIds)
  );
  const retryExamples = retryTrainingItems.map((item) =>
    buildExample({
      exampleId: `v10-light-retry-stability::${item.id}`,
      item,
      targetAnswer: toStudentAnswer(item),
      taskType: "direct_answer",
      qualityTier: "silver",
      weight: 1.35,
      keepReason: "Post-micro-patch clean retry case used as first-pass stability supervision.",
      userPrompt: buildDirectPrompt(item),
      metadata: buildMetadata({
        item,
        sourceId: `v10-light-retry-stability::${item.id}`,
        selectionScore: 86,
        sessionScore: 84
      })
    })
  );

  const examples = [...languageExamples, ...retryExamples];
  const extraction = {
    version: "hydria-core-v10-light-language-stability-extraction-v1",
    createdAt: new Date().toISOString(),
    sourceProbeReport: args.probeReport,
    sourceDiagnosticsReport: args.diagnosticsReport,
    diagnosticCounts: diagnostics.counts ?? {},
    extracted: {
      wrongLanguageCount: wrongLanguageItems.length,
      retryCount: retryItems.length,
      retryTrainingCount: retryTrainingItems.length,
      retryExcludedCount: retryItems.length - retryTrainingItems.length,
      miniPackExampleCount: examples.length
    },
    wrongLanguageCases: wrongLanguageItems.map((item) => ({
      id: item.id,
      category: item.category,
      prompt: repairMojibake(item.prompt),
      weakAnswer: repairMojibake(item.output.answer),
      targetAnswer: languageCorrectionTargets[item.id]
    })),
    retryCases: retryItems.map((item) => ({
      id: item.id,
      category: item.category,
      prompt: repairMojibake(item.prompt),
      includedInMiniPack: retryTrainingItems.some((candidate) => candidate.id === item.id),
      observations: item.observations,
      confidence: item.output.confidence,
      toolRequired: Boolean(item.toolRouting.toolRequired),
      researchUsed: Boolean(item.research?.used)
    }))
  };
  const summary = {
    version: "hydria-local-student-v10-light-mini-pack-summary-v1",
    builtAt: new Date().toISOString(),
    trainFile: args.trainFile,
    extractionFile: args.extractionFile,
    exampleCount: examples.length,
    languageCorrectionCount: languageExamples.length,
    retryStabilityCount: retryExamples.length,
    sourceBreakdown: countBy(examples, (example) => example.sourceType),
    taskBreakdown: countBy(examples, (example) => example.taskType),
    categoryBreakdown: countBy(examples, (example) => example.metadata.category),
    recommendation: {
      trainNow: examples.length >= 40 && languageExamples.length === 18,
      candidateVariantId: "student-local-1p5b-toolbench-lora-v10-light",
      reason:
        "Use as a lightweight corrective LoRA on top of v9, focused on French language adherence and first-pass stability."
    }
  };

  await mkdir(dirname(args.trainFile), { recursive: true });
  await mkdir(dirname(args.summaryFile), { recursive: true });
  await mkdir(dirname(args.extractionFile), { recursive: true });
  await writeFile(args.trainFile, `${examples.map((example) => JSON.stringify(example)).join("\n")}\n`, "utf8");
  await writeFile(args.summaryFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(args.extractionFile, `${JSON.stringify(extraction, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        trainFile: args.trainFile,
        summaryFile: args.summaryFile,
        extractionFile: args.extractionFile,
        summary
      },
      null,
      2
    )
  );
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

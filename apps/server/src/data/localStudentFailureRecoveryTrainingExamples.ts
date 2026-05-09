import { studentDirectSystemPrompt } from "../prompts/localStudent.js";
import type {
  LocalStudentTrainingExample,
  LocalStudentTrainingMetadata,
  LocalStudentTrainingTaskType
} from "../types/training.js";

type FailureRecoveryArgs = {
  id: string;
  question: string;
  category: LocalStudentTrainingMetadata["category"];
  taskType?: LocalStudentTrainingTaskType;
  prompt: string;
  answer: string;
  keyPoints: string[];
  assumptions?: string[];
  confidence: number;
  researchUsed?: boolean;
  toolUsed?: boolean;
  toolImpact?: LocalStudentTrainingMetadata["toolImpact"];
};

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function targetJson(args: FailureRecoveryArgs) {
  return stringifyJson({
    modelRole: "student",
    answer: args.answer,
    key_points: args.keyPoints,
    assumptions: args.assumptions ?? [],
    confidence: args.confidence
  });
}

function metadata(args: FailureRecoveryArgs): LocalStudentTrainingMetadata {
  return {
    sourceId: `failure-recovery::${args.id}`,
    category: args.category,
    researchUsed: args.researchUsed ?? false,
    toolUsed: args.toolUsed ?? false,
    toolImpact: args.toolImpact ?? "no_impact",
    strategyId: null,
    verdict: "improved",
    worthIt: "YES",
    selectionScore: 98,
    improvedDelta: 24,
    sessionScore: 94
  };
}

function example(args: FailureRecoveryArgs): LocalStudentTrainingExample {
  const targetAnswer = targetJson(args);
  return {
    datasetVersion: "hydria-local-student-sft-v1",
    exampleId: `synthetic-failure-recovery::${args.id}`,
    sourceType: "synthetic_failure_recovery",
    taskType: args.taskType ?? "direct_answer",
    qualityTier: "gold",
    weight: 2.25,
    keepReason:
      "Synthetic recovery supervision from v4 failures: avoid empty JSON, prompt echo, and assistant-role JSON.",
    messages: [
      {
        role: "system",
        content: studentDirectSystemPrompt
      },
      {
        role: "user",
        content: args.prompt
      }
    ],
    targetAnswer,
    metadata: metadata(args)
  };
}

function runtimePrompt(args: {
  question: string;
  category: LocalStudentTrainingMetadata["category"];
  guidance?: string[];
  truth?: string[];
}) {
  return [
    "Answer the user question as the Hydria local student.",
    "",
    "Question:",
    args.question,
    "",
    "Detected answer language:",
    /[\u00e0-\u00ff]|\b(?:quel|quelle|comment|explique|donne|peux|meteo)\b/i.test(
      args.question
    )
      ? "French (fr)"
      : "English or unspecified",
    "",
    "Detected category:",
    args.category,
    "",
    "Student strategy guidance:",
    "Id: open_medium",
    "Status: active; mode: contextual; confidence: 0.7",
    "Target length: 60-130 words",
    "Use this guidance only; never copy these labels into the output.",
    args.guidance?.length
      ? ["", "Guidance:", ...args.guidance.map((entry) => `- ${entry}`)].join("\n")
      : "",
    args.truth?.length
      ? ["", "Truth engine findings:", ...args.truth.map((entry) => `- ${entry}`)].join("\n")
      : "",
    "",
    "Answering rules:",
    "- return only one valid JSON object",
    "- output the StudentAnswer schema only: modelRole, answer, key_points, assumptions, confidence",
    "- answer must contain the useful response body; key_points must be 2 to 5 short labels",
    "- assumptions must be short and must not repeat the answer",
    "- do not output strategy metadata such as Id, Status, mode, directives, or avoidances",
    "- do not answer with {}, {\"language\":\"en\"}, or a prompt summary",
    "- do not answer with placeholder values such as \"...\", \"string\", \"todo\", or \"tbd\"",
    "- do not use markdown bullets, bold markers, headings, code snippets, HTML, or XML inside string values",
    "- if the question asks for latest/current/today/live data and no verified facts are listed, say it cannot be verified from the prompt",
    "- do not copy the instructions, the schema, or the question into the answer",
    "- answer the user's question directly"
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function repairPrompt(args: {
  question: string;
  category: LocalStudentTrainingMetadata["category"];
  previousResponse: string;
  issue: string;
}) {
  return [
    runtimePrompt({
      question: args.question,
      category: args.category
    }),
    "",
    "Your previous student answer was invalid.",
    "",
    "Previous invalid answer:",
    args.previousResponse,
    "",
    "Validation issues:",
    `- ${args.issue}`,
    "",
    "Repair rules:",
    "- return only one JSON object",
    "- include every required field",
    "- key_points and assumptions must always be arrays",
    "- key_points must be 2 to 5 short labels, not copied answer sentences",
    "- assumptions must not repeat the answer",
    "- confidence must be an integer from 0 to 100",
    "- replace placeholder-only content with a real answer",
    "- remove markdown bullets, bold markers, headings, code snippets, HTML, and XML",
    "- no markdown and no text outside the JSON"
  ].join("\n");
}

function minimalPrompt(args: {
  question: string;
  facts?: string[];
  noReliableSource?: string;
}) {
  return [
    "Return only one JSON object with keys: modelRole, answer, key_points, assumptions, confidence.",
    'Use modelRole="student".',
    `Question: ${args.question}`,
    args.facts?.length ? `Verified facts to use: ${args.facts.join(" | ")}.` : "",
    args.noReliableSource ? `No reliable source is available: ${args.noReliableSource}.` : "",
    'Do not use placeholder values like "...", "string", "todo", or "tbd".',
    "Use 2 to 5 short key_points as labels, not copied answer sentences.",
    "Do not use markdown bullets, bold markers, code snippets, HTML, or XML inside string values.",
    "Answer:"
  ]
    .filter(Boolean)
    .join("\n");
}

export const LOCAL_STUDENT_FAILURE_RECOVERY_TRAINING_EXAMPLES: LocalStudentTrainingExample[] = [
  example({
    id: "operational-checklist-runtime",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: runtimePrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
      category: "operational_writing",
      guidance: [
        "Use checklist form.",
        "Name rollback gates before traffic shifts.",
        "Include monitoring and data compatibility checks."
      ]
    }),
    answer:
      "Use this rollback-safe migration checklist: 1. define service boundaries and owners; 2. add feature flags for each traffic shift; 3. keep the old monolith path callable until the new service proves stable; 4. verify data contracts, dual-write or sync behavior, and idempotent retries; 5. deploy one service slice at a time; 6. monitor errors, latency, saturation, and business metrics; 7. rollback by disabling the flag, routing traffic back, and preserving any data reconciliation plan.",
    keyPoints: [
      "Define boundaries and owners before splitting.",
      "Gate traffic with feature flags.",
      "Keep rollback paths and data reconciliation ready.",
      "Monitor technical and business metrics."
    ],
    assumptions: ["The migration can be phased service by service."],
    confidence: 88
  }),
  example({
    id: "operational-checklist-minimal",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: minimalPrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services."
    }),
    answer:
      "Checklist: map service boundaries and owners; choose one low-risk slice first; put every traffic shift behind a feature flag; keep the monolith path available; validate API contracts and data compatibility; run shadow or canary traffic; define rollback triggers before deploy; monitor errors, latency, queues, and business metrics; rehearse rollback; document reconciliation steps for writes made during the migration window.",
    keyPoints: [
      "Start with one low-risk slice.",
      "Use feature flags and canaries.",
      "Keep the monolith rollback path alive.",
      "Define monitoring and rollback triggers before deploy."
    ],
    assumptions: ["The system supports phased routing or feature flags."],
    confidence: 86
  }),
  example({
    id: "operational-checklist-repair-empty",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: repairPrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
      category: "operational_writing",
      previousResponse: "{}",
      issue: "Recovered JSON did not expose a valid student answer shape."
    }),
    answer:
      "A rollback-safe split should be phased. First map ownership, dependencies, and data contracts. Then migrate one service boundary behind a flag, keep the monolith route available, and run canary or shadow traffic. Before each cutover, define rollback triggers, dashboards, and data reconciliation steps. After cutover, monitor error rate, latency, queues, and business metrics before moving to the next service.",
    keyPoints: [
      "Do not return empty JSON.",
      "Phase one service boundary at a time.",
      "Keep monolith routing available.",
      "Define rollback triggers and reconciliation."
    ],
    assumptions: ["The previous response was invalid and must be replaced."],
    confidence: 84
  }),
  example({
    id: "operational-checklist-repair-language-only",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: repairPrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
      category: "operational_writing",
      previousResponse: "{\"language\":\"en\"}",
      issue: "The response only reported language and omitted answer, key_points, assumptions, and confidence."
    }),
    answer:
      "Rollback-safe checklist: identify the service boundary, owner, and dependencies; freeze or version shared contracts; add flags for reads and writes; keep the monolith path as fallback; migrate one slice with canary traffic; compare metrics against baseline; define rollback triggers before launch; test data reconciliation; document who can stop the rollout and how to restore traffic.",
    keyPoints: [
      "Replace language-only JSON with a real answer.",
      "Version shared contracts.",
      "Use flags for reads and writes.",
      "Define rollback ownership."
    ],
    assumptions: ["A phased migration is possible."],
    confidence: 86
  }),
  example({
    id: "operational-checklist-repair-placeholder",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: repairPrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
      category: "operational_writing",
      previousResponse:
        "{\"modelRole\":\"student\",\"answer\":\"...\",\"key_points\":[\"...\"],\"assumptions\":[\"...\"],\"confidence\":0}",
      issue:
        "The JSON shape was valid, but every content field was a placeholder instead of a usable checklist."
    }),
    answer:
      "Use a phased rollback-safe checklist: map the service boundary, owner, dependencies, and data contracts; choose one low-risk slice; put reads and writes behind separate feature flags; keep the monolith route available; run shadow or canary traffic; define rollback triggers before cutover; monitor errors, latency, queues, and business metrics; document data reconciliation for writes made during the rollout window.",
    keyPoints: [
      "Replace placeholder JSON with operational content.",
      "Separate read and write cutovers behind flags.",
      "Keep monolith fallback routing available.",
      "Define rollback triggers and data reconciliation before launch."
    ],
    assumptions: ["The migration can be split into phased slices."],
    confidence: 88
  }),
  example({
    id: "operational-checklist-cutover-gates",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: runtimePrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
      category: "operational_writing",
      guidance: [
        "Use concrete cutover gates.",
        "Mention data compatibility and rollback ownership.",
        "Avoid generic microservice advice."
      ]
    }),
    answer:
      "Checklist: define the service boundary and owner; inventory upstream and downstream dependencies; version APIs and schemas; add feature flags for reads and writes; keep the monolith path deployable; backfill or dual-write data with idempotent reconciliation; run shadow traffic, then a small canary; set go/no-go gates for error rate, latency, queue depth, and business events; rollback by disabling flags and replaying or reconciling writes; expand only after the slice is stable.",
    keyPoints: [
      "Use go/no-go gates before each traffic shift.",
      "Version contracts and preserve data compatibility.",
      "Rollback must include routing and data reconciliation.",
      "Expand only after canary stability is proven."
    ],
    assumptions: ["The platform supports feature flags or traffic routing controls."],
    confidence: 89
  }),
  example({
    id: "billing-service-extraction-runbook",
    question: "Create a rollback-aware runbook for extracting billing from a monolith.",
    category: "operational_writing",
    prompt: runtimePrompt({
      question: "Create a rollback-aware runbook for extracting billing from a monolith.",
      category: "operational_writing",
      guidance: [
        "Billing writes are high risk.",
        "Make rollback and reconciliation explicit.",
        "Keep the answer operational, not conceptual."
      ]
    }),
    answer:
      "Runbook: freeze the billing contract, identify every caller and write path, and add idempotency keys before extraction. First mirror reads to the new billing service without serving customer traffic. Then dual-write behind a flag and compare ledger totals, failed jobs, and invoice events. Cut over a small cohort only after parity holds. Roll back by disabling the write flag, routing billing calls to the monolith, pausing outbound invoice jobs, and reconciling any divergent ledger entries before resuming rollout.",
    keyPoints: [
      "Billing extraction needs idempotency and ledger parity checks.",
      "Start with mirrored reads before dual-writes.",
      "Canary a small cohort after parity is proven.",
      "Rollback must pause jobs and reconcile divergent entries."
    ],
    assumptions: ["Billing writes can be flagged or routed by cohort."],
    confidence: 88
  }),
  example({
    id: "operational-checklist-anti-generic",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: repairPrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
      category: "operational_writing",
      previousResponse:
        "{\"modelRole\":\"student\",\"answer\":\"Adopt microservices, add tests, use monitoring, and prepare a rollback plan.\",\"key_points\":[\"microservices\",\"tests\",\"monitoring\"],\"assumptions\":[],\"confidence\":70}",
      issue:
        "The answer was generic microservice advice and did not give rollback gates, data compatibility checks, or cutover steps."
    }),
    answer:
      "A useful checklist should be gate-based: pick one service boundary, list owners and dependencies, version the API and schema, add flags for read and write paths, keep the monolith route live, backfill or dual-write data with reconciliation, run shadow traffic, canary a small percentage, watch agreed rollback metrics, then expand. Roll back by turning off the flags, routing back to the monolith, stopping background jobs if needed, and reconciling writes before retrying.",
    keyPoints: [
      "Convert generic advice into gates.",
      "Include API and schema compatibility.",
      "Canary traffic before expansion.",
      "Rollback includes flags, routing, jobs, and data reconciliation."
    ],
    assumptions: ["There is enough deployment control to shift traffic gradually."],
    confidence: 87
  }),
  example({
    id: "operational-checklist-repair-markdown-incomplete",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
    category: "operational_writing",
    prompt: repairPrompt({
      question: "Draft a rollback-safe migration checklist for splitting a monolith into services.",
      category: "operational_writing",
      previousResponse:
        "{\"modelRole\":\"student\",\"answer\":\"1. **Identify the monolith and its dependencies**: - Determine which services or components make up the monolith. - Identify external APIs and databases.\",\"key_points\":[\"1. **Identify the monolith and its dependencies**:\",\"- Determine which services or components make up the monolith.\",\"- Identify external APIs and databases.\"],\"assumptions\":[],\"confidence\":95}",
      issue:
        "The answer used markdown formatting, put checklist content into key_points, and omitted rollback gates, fallback routing, data reconciliation, and monitoring triggers."
    }),
    answer:
      "Checklist: choose one service boundary and owner; map callers, dependencies, API contracts, and data writes; add feature flags for reads and writes; keep the monolith route available; run shadow traffic, then a small canary; define go/no-go gates for error rate, latency, queues, and business metrics; roll back by disabling flags, routing back to the monolith, pausing jobs if needed, and reconciling writes before retrying.",
    keyPoints: [
      "Service boundary and owner",
      "Feature flags and canary",
      "Monolith fallback route",
      "Data reconciliation",
      "Rollback gates and metrics"
    ],
    assumptions: ["Traffic and write paths can be shifted gradually."],
    confidence: 89
  }),
  example({
    id: "eventual-consistency-runtime",
    question: "Explain eventual consistency in distributed systems with a practical example.",
    category: "technical_explanation",
    prompt: runtimePrompt({
      question: "Explain eventual consistency in distributed systems with a practical example.",
      category: "technical_explanation",
      guidance: [
        "Explain the mechanism, not just the definition.",
        "Use one concrete example and one caveat."
      ]
    }),
    answer:
      "Eventual consistency means replicas may temporarily disagree after a write, but if no new writes happen they should converge to the same value. Example: a user updates a profile photo in one region, and another region may show the old photo for a short time until replication catches up. It improves availability and latency, but the application must handle stale reads, conflicts, and user expectations during the convergence window.",
    keyPoints: [
      "Replicas can temporarily diverge.",
      "They converge after writes stop.",
      "The tradeoff is availability and latency versus stale reads.",
      "Conflict handling still matters."
    ],
    assumptions: ["The system has asynchronous replication."],
    confidence: 86
  }),
  example({
    id: "eventual-consistency-repair-duplicated-fields",
    question: "Explain eventual consistency in distributed systems with a practical example.",
    category: "technical_explanation",
    prompt: repairPrompt({
      question: "Explain eventual consistency in distributed systems with a practical example.",
      category: "technical_explanation",
      previousResponse:
        "{\"modelRole\":\"student\",\"answer\":\"Eventually consistent systems allow stale reads until replicas converge.\",\"key_points\":[\"Eventually consistent systems allow stale reads until replicas converge.\",\"Eventually consistent systems allow stale reads until replicas converge.\"],\"assumptions\":[\"Eventually consistent systems allow stale reads until replicas converge.\"],\"confidence\":100}",
      issue:
        "key_points and assumptions copied the answer instead of using short labels and real assumptions."
    }),
    answer:
      "Eventual consistency means replicas may show different values briefly after a write, but they converge once updates propagate. Example: after a profile photo update, one region may still show the old photo until replication catches up. This favors availability and low latency, but applications must tolerate stale reads and handle conflicts.",
    keyPoints: [
      "Temporary stale reads",
      "Replica convergence",
      "Profile photo example",
      "Availability tradeoff"
    ],
    assumptions: ["The system replicates data asynchronously."],
    confidence: 87
  }),
  example({
    id: "eventual-consistency-repair-language-only",
    question: "Explain eventual consistency in distributed systems with a practical example.",
    category: "technical_explanation",
    prompt: repairPrompt({
      question: "Explain eventual consistency in distributed systems with a practical example.",
      category: "technical_explanation",
      previousResponse: "{\"language\":\"en\"}",
      issue: "The response omitted the actual explanation."
    }),
    answer:
      "Eventual consistency is a replication model where different nodes may show different values for a while, but they converge once updates finish propagating. A practical example is a shopping cart replicated across regions: one region may briefly miss a newly added item, then catch up. This only works safely when the product accepts temporary staleness or has conflict-resolution rules.",
    keyPoints: [
      "Temporary divergence is allowed.",
      "Replicas converge later.",
      "Shopping carts can tolerate short staleness with conflict rules.",
      "Critical invariants may need stronger consistency."
    ],
    assumptions: ["The example is about replicated application state."],
    confidence: 87
  }),
  example({
    id: "typescript-latest-no-source-minimal",
    question: "What is the latest stable TypeScript release and what changed?",
    category: "other",
    taskType: "tool_safe_answer",
    prompt: minimalPrompt({
      question: "What is the latest stable TypeScript release and what changed?",
      noReliableSource:
        "no sufficiently recent dated source was found for the latest stable TypeScript release"
    }),
    answer:
      "I cannot confirm the latest stable TypeScript release or its changes without a sufficiently recent dated source. For a latest-version question, I should not answer from memory.",
    keyPoints: [
      "Latest release not verified.",
      "Recent dated source is required.",
      "Do not answer from memory."
    ],
    assumptions: ["No reliable fresh release source was available in the prompt."],
    confidence: 25,
    researchUsed: true,
    toolUsed: false,
    toolImpact: "no_reliable_source"
  }),
  example({
    id: "typescript-latest-no-source-runtime",
    question: "What is the latest stable TypeScript release and what changed?",
    category: "other",
    taskType: "tool_safe_answer",
    prompt: runtimePrompt({
      question: "What is the latest stable TypeScript release and what changed?",
      category: "other",
      guidance: [
        "This is a latest/current release question.",
        "No verified release facts are available in the prompt.",
        "Do not answer from memory."
      ]
    }),
    answer:
      "I cannot verify the latest stable TypeScript release or its changes from the prompt because no recent dated release source is provided. I should not answer a latest-version question from memory.",
    keyPoints: [
      "Latest release not verified",
      "Recent dated source required",
      "No memory-based version claim"
    ],
    assumptions: ["No verified release findings were provided."],
    confidence: 25,
    researchUsed: false,
    toolUsed: false,
    toolImpact: "no_reliable_source"
  }),
  example({
    id: "weather-paris-tool-facts-minimal",
    question: "What is the weather in Paris today?",
    category: "other",
    taskType: "tool_safe_answer",
    prompt: minimalPrompt({
      question: "What is the weather in Paris today?",
      facts: [
        "Current weather for Paris on 2026-05-04 at 17:20: light rain, temperature 18 C, wind 7 km/h E."
      ]
    }),
    answer:
      "Current weather for Paris on 2026-05-04 at 17:20: light rain, temperature 18 C, wind 7 km/h E.",
    keyPoints: ["Paris", "2026-05-04 17:20", "light rain", "18 C", "wind 7 km/h E"],
    assumptions: ["Weather data came from the provided verified fact."],
    confidence: 94,
    researchUsed: true,
    toolUsed: true,
    toolImpact: "improved_factual_accuracy"
  }),
  example({
    id: "weather-paris-no-source-runtime",
    question: "What is the weather in Paris today?",
    category: "other",
    taskType: "tool_safe_answer",
    prompt: runtimePrompt({
      question: "What is the weather in Paris today?",
      category: "other",
      guidance: [
        "This is a current weather question.",
        "No verified weather facts are available in the prompt.",
        "Do not invent temperature or conditions."
      ]
    }),
    answer:
      "I cannot verify the weather in Paris today from the prompt because no current weather tool result is provided. I should not invent temperature, conditions, wind, or timing.",
    keyPoints: [
      "Weather not verified",
      "Current tool result required",
      "No invented conditions"
    ],
    assumptions: ["No current weather facts were provided."],
    confidence: 25,
    researchUsed: false,
    toolUsed: false,
    toolImpact: "no_reliable_source"
  }),
  example({
    id: "btc-price-repair-assistant-role",
    question: "What is the current BTC price?",
    category: "other",
    taskType: "tool_safe_answer",
    prompt: repairPrompt({
      question: "What is the current BTC price?",
      category: "other",
      previousResponse:
        "{\"modelRole\":\"assistant\",\"answer\":\"The current BTC price is $37,594.81.\",\"key_points\":[\"$37,594.81\"],\"assumptions\":[],\"confidence\":0}",
      issue:
        "The model role was wrong and the answer invented current market data without reliable source."
    }),
    answer:
      "I cannot verify the current BTC price from a reliable current source in the prompt. I should not invent a market price.",
    keyPoints: ["Current BTC price not verified", "Reliable current source missing", "No invented price"],
    assumptions: ["The finance lookup failed or was unavailable."],
    confidence: 25,
    researchUsed: true,
    toolUsed: false,
    toolImpact: "no_reliable_source"
  }),
  example({
    id: "french-weather-repair-hallucination",
    question: "Quel temps fait-il aujourd'hui ?",
    category: "other",
    taskType: "tool_safe_answer",
    prompt: repairPrompt({
      question: "Quel temps fait-il aujourd'hui ?",
      category: "other",
      previousResponse:
        "{\"modelRole\":\"student\",\"answer\":\"Il fait tres chaud aujourd'hui avec 30 deg C.\",\"key_points\":[\"30 deg C\"],\"assumptions\":[],\"confidence\":70}",
      issue: "A weather tool was required, but the city was missing and the answer invented weather data."
    }),
    answer: "Pour quelle ville veux-tu la meteo ?",
    keyPoints: ["Ville manquante", "Outil meteo requis", "Ne pas inventer la temperature"],
    assumptions: ["La question ne precise pas la ville."],
    confidence: 35,
    researchUsed: true,
    toolUsed: false,
    toolImpact: "no_reliable_source"
  }),
  example({
    id: "french-api-language-repair",
    question: "Explique les APIs simplement.",
    category: "technical_explanation",
    prompt: repairPrompt({
      question: "Explique les APIs simplement.",
      category: "technical_explanation",
      previousResponse:
        "{\"modelRole\":\"student\",\"answer\":\"The answer is a short explanation in English.\",\"key_points\":[\"English answer\"],\"assumptions\":[],\"confidence\":70}",
      issue: "The user question is French, but the answer is not in French."
    }),
    answer:
      "Une API est une facon standard pour deux logiciels de se parler. Par exemple, une application mobile peut appeler l'API d'un serveur pour demander la liste des messages. L'API definit les routes disponibles, les donnees attendues et le format de la reponse.",
    keyPoints: ["Interface entre logiciels", "Routes et donnees attendues", "Exemple application mobile et serveur"],
    assumptions: ["L'utilisateur veut une explication simple, pas une specification detaillee."],
    confidence: 88
  }),
  example({
    id: "prompt-echo-repair",
    question: "Give me a concise incident handoff note for a delayed deployment.",
    category: "operational_writing",
    prompt: repairPrompt({
      question: "Give me a concise incident handoff note for a delayed deployment.",
      category: "operational_writing",
      previousResponse:
        "{\"modelRole\":\"assistant\",\"text\":\"Return only this JSON object shape... Question: Give me a concise incident handoff note...\"}",
      issue: "The response copied the prompt instead of answering the user."
    }),
    answer:
      "Deployment is delayed while we validate the rollback path and confirm the failing smoke test is isolated. Current impact is delivery delay only; production traffic is unchanged. Next owner should review the failed check, confirm whether the issue is code or environment, and either rerun the deploy or keep the release paused. Rollback plan remains the previous stable build.",
    keyPoints: [
      "State current status and impact.",
      "Name the next owner action.",
      "Keep rollback plan explicit."
    ],
    assumptions: ["Production traffic has not been shifted yet."],
    confidence: 84
  })
];

import test from "node:test";
import assert from "node:assert/strict";
import { ToolRoutingService } from "../services/tools/toolRoutingService.js";

const service = new ToolRoutingService();

test("tool router marks current weather as required weather tool use", () => {
  const decision = service.route({
    question: "Quelle est la m\u00e9t\u00e9o actuelle \u00e0 Paris ?",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "weather");
  assert.equal(decision.intent, "current_weather");
  assert.equal(decision.fallbackAllowed, false);
  assert.equal(decision.extractedArgs.location, "Paris");
  assert.equal(decision.extractedArgs.language, "fr");
});

test("tool router extracts compact city weather queries", () => {
  const decision = service.route({
    question: "meteo Lyon",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "weather");
  assert.equal(decision.intent, "current_weather");
  assert.equal(decision.extractedArgs.location, "Lyon");
});

test("tool router tolerates mojibake French weather accents", () => {
  const decision = service.route({
    question: "Quelle est la m\u00c3\u00a9t\u00c3\u00a9o actuelle \u00c3\u00a0 Paris ?",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "weather");
  assert.equal(decision.intent, "current_weather");
  assert.equal(decision.extractedArgs.location, "Paris");
});

test("tool router tolerates replacement-character French weather accents", () => {
  const decision = service.route({
    question: "Quelle est la m\ufffdt\ufffdo actuelle \ufffd Paris ?",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "weather");
  assert.equal(decision.intent, "current_weather");
  assert.equal(decision.extractedArgs.location, "Paris");
});

test("tool router marks current crypto pricing as required finance tool use", () => {
  const decision = service.route({
    question: "Quel est le prix actuel du Bitcoin en USD ?",
    category: "mixed_reasoning"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "finance");
  assert.equal(decision.intent, "current_price");
  assert.equal(decision.extractedArgs.asset, "BTC");
  assert.equal(decision.extractedArgs.quoteCurrency, "USD");
  assert.equal(decision.extractedArgs.language, "fr");
});

test("tool router marks current CEO lookup as required web tool use", () => {
  const decision = service.route({
    question: "Qui est le CEO actuel de OpenAI ?",
    category: "mixed_reasoning"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "web");
  assert.equal(decision.intent, "current_status");
  assert.equal(decision.fallbackAllowed, false);
  assert.equal(decision.extractedArgs.role, "CEO");
  assert.equal(decision.extractedArgs.subject, "OpenAI");
  assert.equal(decision.extractedArgs.language, "fr");
});

test("tool router routes latest release freshness to direct web tool", () => {
  const decision = service.route({
    question: "What is the latest stable Node.js release today? Prefer the official Node.js source.",
    category: "technical_explanation"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "web");
  assert.equal(decision.intent, "latest_release");
  assert.match(String(decision.extractedArgs.subject), /node/i);
});

test("tool router marks GitHub repo lookup as required repo tool use", () => {
  const decision = service.route({
    question: "Retrouve ce repo GitHub hydria-core",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "repo");
  assert.equal(decision.intent, "github_repo_lookup");
});

test("tool router marks repo scan as required repo analysis", () => {
  const decision = service.route({
    question: "Scanne mon repo hydria-core",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "repo");
  assert.equal(decision.intent, "repo_analysis");
});

test("tool router marks package.json reads as required file analysis", () => {
  const decision = service.route({
    question: "Read package.json and tell me which scripts launch the server tests.",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "file");
  assert.equal(decision.intent, "file_analysis");
  assert.equal(decision.fallbackAllowed, false);
});

test("tool router marks currency conversion as required calculator tool use", () => {
  const decision = service.route({
    question: "Convertis 120 euros en dollars avec un taux de 1.08",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "calculator");
  assert.equal(decision.intent, "currency_conversion");
  assert.equal(decision.extractedArgs.amount, 120);
  assert.equal(decision.extractedArgs.from, "EUR");
  assert.equal(decision.extractedArgs.to, "USD");
  assert.equal(decision.extractedArgs.rate, 1.08);
  assert.equal(decision.extractedArgs.language, "fr");
});

test("tool router extracts explicit pair exchange rates", () => {
  const decision = service.route({
    question: "Convert 250 EUR to USD using the explicit exchange rate 1 EUR = 1.08 USD.",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "calculator");
  assert.equal(decision.intent, "currency_conversion");
  assert.equal(decision.extractedArgs.amount, 250);
  assert.equal(decision.extractedArgs.from, "EUR");
  assert.equal(decision.extractedArgs.to, "USD");
  assert.equal(decision.extractedArgs.rate, 1.08);
});

test("tool router leaves stable explanations as no-tool by default", () => {
  const decision = service.route({
    question: "Explique l'eventual consistency dans les systèmes distribués.",
    category: "technical_explanation"
  });

  assert.equal(decision.toolRequired, false);
  assert.equal(decision.toolRecommended, false);
  assert.equal(decision.toolType, "none");
});

test("tool router does not treat real-time streaming architecture as weather", () => {
  const decision = service.route({
    question: "Explique le traitement temps reel dans une architecture streaming.",
    category: "technical_explanation"
  });

  assert.equal(decision.toolRequired, false);
  assert.equal(decision.toolRecommended, false);
  assert.equal(decision.toolType, "none");
});

test("tool router keeps conceptual document and CSV questions tool-free", () => {
  const documentDecision = service.route({
    question: "Comment structurer un document de migration ?",
    category: "operational_writing"
  });
  const csvDecision = service.route({
    question: "Explique comment nettoyer un CSV avant import.",
    category: "technical_explanation"
  });

  assert.equal(documentDecision.toolRequired, false);
  assert.equal(documentDecision.toolType, "none");
  assert.equal(csvDecision.toolRequired, false);
  assert.equal(csvDecision.toolType, "none");
});

test("tool router keeps conceptual repo analysis tool-free but requires attached files", () => {
  const repoDecision = service.route({
    question: "Comment analyser un repo efficacement ?",
    category: "technical_explanation"
  });
  const hiddenGateDecision = service.route({
    question: "Explain how to analyze an unfamiliar repo efficiently, but do not claim you inspected a repository.",
    category: "technical_explanation"
  });
  const fileDecision = service.route({
    question: "Analyse ce fichier joint.",
    category: "other"
  });

  assert.equal(repoDecision.toolRequired, false);
  assert.equal(repoDecision.toolType, "none");
  assert.equal(hiddenGateDecision.toolRequired, false);
  assert.equal(hiddenGateDecision.toolType, "none");
  assert.equal(fileDecision.toolRequired, true);
  assert.equal(fileDecision.toolType, "file");
  assert.equal(fileDecision.intent, "file_analysis");
});

test("tool router leaves writing and reformulation tasks as no-tool by default", () => {
  const decision = service.route({
    question: "Reformule ce message pour qu'il soit plus clair et plus direct.",
    category: "operational_writing"
  });

  assert.equal(decision.toolRequired, false);
  assert.equal(decision.toolRecommended, false);
  assert.equal(decision.toolType, "none");
});

test("tool router avoids lexical false positives from benchmark wording", () => {
  const cases = [
    "Endpoint security flags malware on a developer laptop with repo access. What should happen next?",
    "Postgres deadlocks appear after a new feature. What is the investigation path?",
    "A model scores 100% on current benchmarks. Why might it still fail in production?",
    "Explain how weather forecasts are produced.",
    "Compare action et obligation sans prix actuel.",
    "Explain what a CEO does in a company.",
    "Change how the core interacts with certain weather conditions.",
    "Show me all products with a stock level below 20."
  ];

  for (const question of cases) {
    const decision = service.route({ question, category: "other" });
    assert.equal(decision.toolRequired, false, question);
  }
});

test("tool router treats conversation deadlines and stakeholder roles as planning context", () => {
  const weeklyDeadline = service.route({
    question: "New information: leadership wants a visible answer this week.",
    category: "architecture_design"
  });
  const executivePressure = service.route({
    question: "The CEO threatens to bypass process if we do not decide today.",
    category: "architecture_design"
  });

  assert.equal(weeklyDeadline.toolRequired, false);
  assert.equal(weeklyDeadline.toolType, "none");
  assert.equal(executivePressure.toolRequired, false);
  assert.equal(executivePressure.toolType, "none");
});

test("tool router treats recent detail recall as conversation context", () => {
  const englishDecision = service.route({
    question:
      "Final decision: recall the strong constraint, recent detail, active hypothesis, then recommend.",
    category: "architecture_design"
  });
  const frenchDecision = service.route({
    question:
      "Decision finale: rappelle la contrainte forte, le detail recent, l'hypothese active, puis recommande.",
    category: "debug_diagnostic"
  });
  const labeledState = service.route({
    question:
      "Durable constraint: sampled logs, rare reproduction, and short customer window. Recent detail: freezes mostly happen after 900 concurrent imports.",
    category: "debug_diagnostic"
  });
  const frenchLabeledState = service.route({
    question: "Detail recent a ne pas perdre: les freezes arrivent surtout apres 900 imports concurrents.",
    category: "debug_diagnostic"
  });
  const recentSignal = service.route({
    question: "The recent signal is: p95 delay moved from 6 minutes to 41 minutes.",
    category: "incident_response"
  });
  const reliableNumber = service.route({
    question: "The only reliable recent number is: pre-triage precision drops to 71% on ambiguous cases.",
    category: "mixed_reasoning"
  });

  assert.equal(englishDecision.toolRequired, false);
  assert.equal(englishDecision.toolType, "none");
  assert.equal(frenchDecision.toolRequired, false);
  assert.equal(frenchDecision.toolType, "none");
  assert.equal(labeledState.toolRequired, false);
  assert.equal(labeledState.toolType, "none");
  assert.equal(frenchLabeledState.toolRequired, false);
  assert.equal(frenchLabeledState.toolType, "none");
  assert.equal(recentSignal.toolRequired, false);
  assert.equal(recentSignal.toolType, "none");
  assert.equal(reliableNumber.toolRequired, false);
  assert.equal(reliableNumber.toolType, "none");
});

test("tool router treats provided snapshots as internal tool-boundary context", () => {
  const snapshot = service.route({
    question:
      "provided snapshot: current schema, export error log, and Friday tax matrix. Do not assume another file or webpage.",
    category: "architecture_design"
  });
  const stakeholderPressure = service.route({
    question: "A colleague asks to search current numbers online before deciding.",
    category: "architecture_design"
  });

  assert.equal(snapshot.toolRequired, false);
  assert.equal(snapshot.toolType, "none");
  assert.equal(stakeholderPressure.toolRequired, false);
  assert.equal(stakeholderPressure.toolType, "none");
});

test("tool router routes live humidity, status page, and public repo structure to executable tools", () => {
  const humidity = service.route({
    question: "Quelle est l'humidite actuelle a Bangkok ?",
    category: "other"
  });
  const status = service.route({
    question: "Is the GitHub status page reporting incidents right now?",
    category: "other"
  });
  const singularStatus = service.route({
    question: "Is GitHub status currently reporting an incident? Use a live status source or abstain.",
    category: "incident_response"
  });
  const repo = service.route({
    question: "Analyze this repo structure: https://github.com/facebook/react",
    category: "other"
  });

  assert.equal(humidity.toolType, "weather");
  assert.equal(humidity.intent, "current_weather");
  assert.equal(humidity.extractedArgs.location, "Bangkok");
  assert.equal(status.toolType, "web");
  assert.equal(status.intent, "current_status");
  assert.equal(status.extractedArgs.subject, "GitHub Status");
  assert.equal(singularStatus.toolType, "web");
  assert.equal(singularStatus.intent, "current_status");
  assert.equal(singularStatus.extractedArgs.subject, "GitHub Status");
  assert.equal(repo.toolType, "repo");
  assert.equal(repo.intent, "repo_analysis");
});

test("tool router abstains when live data depends on missing private or location context", () => {
  const localSearch = service.route({
    question: "Generate a list of restaurants near my current location that serve vegan food.",
    category: "other"
  });
  const emailReport = service.route({
    question: "Request a report on email open rates for the past month.",
    category: "other"
  });
  const mentionsExport = service.route({
    question: "I need Hydria Core to find all mentions of 'urgent' in the last year and export them as a CSV.",
    category: "other"
  });

  assert.equal(localSearch.toolRequired, false);
  assert.equal(localSearch.toolRecommended, true);
  assert.equal(localSearch.fallbackAllowed, false);
  assert.equal(localSearch.toolType, "web");
  assert.equal(localSearch.intent, "local_search");
  assert.equal(emailReport.toolRequired, false);
  assert.equal(emailReport.toolType, "file");
  assert.equal(emailReport.intent, "missing_private_data");
  assert.equal(mentionsExport.toolRequired, false);
  assert.equal(mentionsExport.toolType, "file");
});

test("tool router does not use finance current price for broad future market forecasts", () => {
  const decision = service.route({
    question: "Generate a detailed report on the stock market trends for the next month.",
    category: "other"
  });

  assert.equal(decision.toolRequired, false);
  assert.equal(decision.toolRecommended, true);
  assert.equal(decision.fallbackAllowed, false);
  assert.equal(decision.toolType, "finance");
  assert.equal(decision.intent, "future_market_prediction");
});

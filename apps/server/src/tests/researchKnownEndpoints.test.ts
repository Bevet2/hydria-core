import test from "node:test";
import assert from "node:assert/strict";
import { ResearchKnownEndpointService } from "../services/research/knownEndpoints.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";

test("known endpoint service keeps high-priority GitHub release feeds even when the entity term is mostly domain-shaped", () => {
  const service = new ResearchKnownEndpointService();
  const candidates = service.getCandidates({
    intent: "release_freshness",
    mode: "targeted_verify",
    queries: ["Next.js latest release official April 18, 2026 site:nextjs.org"],
    requiredTerms: ["next.js", "latest", "release"],
    preferredDomains: ["nextjs.org", "github.com"],
    factFocusTerms: ["latest", "release"],
    entityTerms: ["nextjs"],
    temporalProfile: {
      ...buildDefaultTemporalProfile(),
      isTemporal: true,
      focus: "latest",
      queryType: "release_freshness",
      recencyDays: 180,
      absoluteDateHint: "April 18, 2026"
    },
    reasoning: "Test plan."
  });

  assert.ok(
    candidates.some((candidate) => candidate.url === "https://github.com/vercel/next.js/releases.atom")
  );
});

test("known endpoint service keeps high-priority TypeScript release feeds despite domain alias mismatch", () => {
  const service = new ResearchKnownEndpointService();
  const candidates = service.getCandidates({
    intent: "release_freshness",
    mode: "targeted_verify",
    queries: ["TypeScript latest release official April 18, 2026 site:typescriptlang.org"],
    requiredTerms: ["typescript", "latest", "release"],
    preferredDomains: ["typescriptlang.org", "devblogs.microsoft.com", "github.com"],
    factFocusTerms: ["latest", "release"],
    entityTerms: ["typescript"],
    temporalProfile: {
      ...buildDefaultTemporalProfile(),
      isTemporal: true,
      focus: "latest",
      queryType: "release_freshness",
      recencyDays: 180,
      absoluteDateHint: "April 18, 2026"
    },
    reasoning: "Test plan."
  });

  assert.ok(
    candidates.some(
      (candidate) => candidate.url === "https://github.com/microsoft/TypeScript/releases.atom"
    )
  );
});

test("known endpoint service surfaces OpenAI governance pages for current CEO queries", () => {
  const service = new ResearchKnownEndpointService();
  const candidates = service.getCandidates({
    intent: "current_status",
    mode: "targeted_verify",
    queries: ["CEO of OpenAI current official April 18, 2026 site:openai.com"],
    requiredTerms: ["openai", "ceo", "current"],
    preferredDomains: ["openai.com"],
    factFocusTerms: ["ceo", "leadership", "current"],
    entityTerms: ["ceo", "openai", "altman"],
    temporalProfile: {
      ...buildDefaultTemporalProfile(),
      isTemporal: true,
      focus: "current",
      queryType: "current_status",
      recencyDays: 180,
      absoluteDateHint: "April 18, 2026"
    },
    reasoning: "Test plan."
  });

  assert.ok(
    candidates.some((candidate) => candidate.url === "https://openai.com/our-structure/")
  );
});

test("known endpoint service seeds canonical Wikipedia pages for identity lookups", () => {
  const service = new ResearchKnownEndpointService();
  const candidates = service.getCandidates({
    intent: "fact_check",
    mode: "fact_check_only",
    queries: ["louis ix biographie encyclopedie"],
    requiredTerms: ["louis"],
    preferredDomains: [],
    factFocusTerms: ["louis"],
    entityTerms: ["louis"],
    temporalProfile: buildDefaultTemporalProfile(),
    reasoning: "Identity lookup research should verify the subject before answering."
  });

  assert.ok(candidates.some((candidate) => candidate.url === "https://fr.wikipedia.org/wiki/Louis_IX"));
});

test("known endpoint service seeds encyclopedia pages for stable definitions", () => {
  const service = new ResearchKnownEndpointService();
  const candidates = service.getCandidates({
    intent: "definition",
    mode: "fact_check_only",
    queries: ["photosynthese official documentation reference"],
    requiredTerms: ["photosynthese"],
    preferredDomains: [],
    factFocusTerms: ["photosynthese"],
    entityTerms: ["photosynthese"],
    temporalProfile: buildDefaultTemporalProfile(),
    reasoning: "Definition research should verify the subject before answering."
  });

  assert.ok(
    candidates.some((candidate) => candidate.url === "https://fr.wikipedia.org/wiki/Photosynthese")
  );
});

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

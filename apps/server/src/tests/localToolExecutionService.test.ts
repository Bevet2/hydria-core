import test from "node:test";
import assert from "node:assert/strict";
import { LocalToolExecutionService } from "../services/tools/localToolExecutionService.js";
import type { ToolRoutingDecision } from "../types/arena.js";

function buildWeatherRouting(location: string | null): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "weather",
    intent: "current_weather",
    confidence: 0.99,
    fallbackAllowed: false,
    reason: "Weather is live data and must come from a tool-backed retrieval path.",
    extractedArgs: {
      location,
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildFinanceRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "finance",
    intent: "current_price",
    confidence: 0.97,
    fallbackAllowed: false,
    reason: "Current market or crypto pricing is live data and must be tool-backed.",
    extractedArgs: {
      asset: "BTC",
      quoteCurrency: "USD",
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildCurrentStatusRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "web",
    intent: "current_status",
    confidence: 0.91,
    fallbackAllowed: false,
    reason: "The request depends on the current external state of an entity.",
    extractedArgs: {
      subject: "OpenAI",
      role: "CEO",
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildCurrencyRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "calculator",
    intent: "currency_conversion",
    confidence: 0.95,
    fallbackAllowed: false,
    reason: "Currency conversion should use a calculator when an explicit rate is provided.",
    extractedArgs: {
      amount: 120,
      from: "EUR",
      to: "USD",
      rate: 1.08,
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildLiveCurrencyRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "calculator",
    intent: "currency_conversion",
    confidence: 0.95,
    fallbackAllowed: false,
    reason: "Currency conversion should use a live exchange rate.",
    extractedArgs: {
      amount: 250,
      from: "USD",
      to: "EUR",
      rate: null,
      language: "en"
    },
    toolResultUsed: false
  };
}

function buildGitHubStatusRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "web",
    intent: "current_status",
    confidence: 0.94,
    fallbackAllowed: false,
    reason: "Status pages are live operational data.",
    extractedArgs: {
      subject: "GitHub Status",
      role: "status",
      language: "en"
    },
    toolResultUsed: false
  };
}

function buildNodeLatestReleaseRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "web",
    intent: "latest_release",
    confidence: 0.91,
    fallbackAllowed: false,
    reason: "Latest release questions require dated external verification.",
    extractedArgs: {
      subject: "stable Node.js",
      role: "version",
      language: "en"
    },
    toolResultUsed: false
  };
}

function buildPublicRepoRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "repo",
    intent: "repo_analysis",
    confidence: 0.95,
    fallbackAllowed: false,
    reason: "Public GitHub repo structure requires repository lookup.",
    extractedArgs: {
      repo: "https://github.com/facebook/react"
    },
    toolResultUsed: false
  };
}

function buildAiRecentUpdatesRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "research",
    intent: "recent_updates",
    confidence: 0.91,
    fallbackAllowed: false,
    reason: "Recent AI updates require fresh source retrieval.",
    extractedArgs: {
      subject: "nouveautes IA cette semaine",
      temporalFocus: "this_week",
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildCyberRecentUpdatesRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "research",
    intent: "recent_updates",
    confidence: 0.91,
    fallbackAllowed: false,
    reason: "Recent cybersecurity updates require fresh source retrieval.",
    extractedArgs: {
      subject: "cybersecurity updates this week",
      temporalFocus: "this_week",
      language: "en"
    },
    toolResultUsed: false
  };
}

function buildFactCheckRouting(subject = "Marie Curie"): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "research",
    intent: "fact_check",
    confidence: 0.83,
    fallbackAllowed: false,
    reason: "The request asks for a named factual lookup or explicitly requests verification.",
    extractedArgs: {
      subject,
      query: `Qui est ${subject} ?`,
      language: "fr"
    },
    toolResultUsed: false
  };
}

test("local tool execution resolves current weather through Open-Meteo", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("geocoding-api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "Paris",
              admin1: "Ile-de-France",
              country: "France",
              latitude: 48.8566,
              longitude: 2.3522,
              timezone: "Europe/Paris"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.includes("api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          current: {
            time: "2026-04-24T18:00",
            temperature_2m: 21,
            relative_humidity_2m: 23,
            precipitation: 0,
            weather_code: 0,
            wind_speed_10m: 14,
            wind_direction_10m: 180
          },
          daily: {
            temperature_2m_max: [22],
            temperature_2m_min: [8],
            weather_code: [0]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildWeatherRouting("Paris"));

  assert.equal(result?.toolType, "weather");
  assert.equal(result?.intent, "current_weather");
  assert.match(result?.verifiedFacts[0] ?? "", /M\u00e9t\u00e9o actuelle pour Paris/);
  assert.match(result?.verifiedFacts.join(" "), /21 \u00b0C/);
  assert.ok(requestedUrls.some((url) => url.includes("name=Paris")));
});

test("local weather tool does not guess a default city", async () => {
  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildWeatherRouting(null));

  assert.equal(result, null);
});

test("local finance tool resolves current crypto price through CoinGecko", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.ok(url.includes("api.coingecko.com/api/v3/simple/price"));
    assert.ok(url.includes("ids=bitcoin"));
    assert.ok(url.includes("vs_currencies=usd"));

    return new Response(
      JSON.stringify({
        bitcoin: {
          usd: 78892,
          last_updated_at: 1777900000
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFinanceRouting());

  assert.equal(result?.toolType, "finance");
  assert.equal(result?.intent, "current_price");
  assert.match(result?.verifiedFacts[0] ?? "", /Bitcoin \(BTC\)/);
  assert.match(result?.verifiedFacts[0] ?? "", /78/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local web current-status tool resolves OpenAI CEO from official source", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      "<html><body>Our Board includes independent directors as well as CEO Sam Altman.</body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } }
    )) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildCurrentStatusRouting());

  assert.equal(result?.toolType, "web");
  assert.equal(result?.intent, "current_status");
  assert.match(result?.verifiedFacts[0] ?? "", /Sam Altman/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local calculator tool resolves explicit-rate currency conversion", async () => {
  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildCurrencyRouting());

  assert.equal(result?.toolType, "calculator");
  assert.equal(result?.intent, "currency_conversion");
  assert.equal(result?.resultLabel, "120 EUR = 129.6 USD");
  assert.match(result?.verifiedFacts[0] ?? "", /120 EUR \* 1\.08 = 129\.6 USD/);
});

test("local calculator tool fetches current exchange rates when rate is missing", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.ok(url.includes("api.frankfurter.app/latest"));
    return new Response(
      JSON.stringify({
        amount: 1,
        base: "USD",
        date: "2026-05-05",
        rates: {
          EUR: 0.86
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildLiveCurrencyRouting());

  assert.equal(result?.toolType, "calculator");
  assert.equal(result?.resultLabel, "250 USD = 215 EUR");
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local web status tool resolves GitHub status endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        page: { name: "GitHub", url: "https://www.githubstatus.com" },
        status: { indicator: "none", description: "All Systems Operational" }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildGitHubStatusRouting());

  assert.equal(result?.toolType, "web");
  assert.match(result?.verifiedFacts[0] ?? "", /All Systems Operational/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local web latest-release tool resolves Node.js from official release index", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.equal(url, "https://nodejs.org/dist/index.json");
    return new Response(
      JSON.stringify([
        { version: "v26.0.0", date: "2026-04-30", lts: false },
        { version: "v24.4.1", date: "2026-04-20", lts: "Krypton" }
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildNodeLatestReleaseRouting());

  assert.equal(result?.toolType, "web");
  assert.equal(result?.intent, "latest_release");
  assert.equal(result?.resultLabel, "Node.js v26.0.0");
  assert.match(result?.verifiedFacts[0] ?? "", /Latest LTS release: v24\.4\.1/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local repo tool resolves public GitHub root structure", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.ok(url.includes("api.github.com/repos/facebook/react/contents"));
    return new Response(
      JSON.stringify([
        { name: "packages", path: "packages", type: "dir" },
        { name: "scripts", path: "scripts", type: "dir" },
        { name: "package.json", path: "package.json", type: "file" }
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildPublicRepoRouting());

  assert.equal(result?.toolType, "repo");
  assert.match(result?.verifiedFacts[0] ?? "", /packages/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local research tool resolves recent AI updates from official feeds", async (t) => {
  const originalFetch = globalThis.fetch;
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("openai.com/news/rss.xml")) {
      return new Response(
        `<?xml version="1.0"?><rss><channel><item><title>OpenAI ships a new agents update</title><link>https://openai.com/news/agents-update</link><pubDate>${yesterday.toUTCString()}</pubDate><description>Official OpenAI agents product update.</description></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } }
      );
    }
    if (url.includes("huggingface.co/blog/feed.xml")) {
      return new Response(
        `<?xml version="1.0"?><rss><channel><item><title>New open model leaderboard</title><link>https://huggingface.co/blog/leaderboard</link><pubDate>${today.toUTCString()}</pubDate><description>Official Hugging Face update.</description></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildAiRecentUpdatesRouting());

  assert.equal(result?.toolType, "research");
  assert.equal(result?.intent, "recent_updates");
  assert.match(result?.verifiedFacts.join(" "), /OpenAI ships a new agents update/);
  assert.match(result?.verifiedFacts.join(" "), /New open model leaderboard/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local research tool resolves recent cybersecurity updates from official feeds", async (t) => {
  const originalFetch = globalThis.fetch;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("cisa.gov/cybersecurity-advisories/all.xml")) {
      return new Response(
        `<?xml version="1.0"?><rss><channel><item><title>CISA adds known exploited vulnerabilities</title><link>https://www.cisa.gov/news-events/alerts/test</link><pubDate>${yesterday.toUTCString()}</pubDate><description>Official cybersecurity advisory update.</description></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } }
      );
    }
    if (url.includes("services.nvd.nist.gov/rest/json/cves/2.0")) {
      return new Response(
        JSON.stringify({
          vulnerabilities: [
            {
              cve: {
                id: "CVE-2026-0001",
                lastModified: yesterday.toISOString(),
                vulnStatus: "Analyzed",
                cisaVulnerabilityName: "Example product vulnerability",
                descriptions: [
                  {
                    lang: "en",
                    value: "Example CVE entry updated by NVD for a cybersecurity vulnerability."
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildCyberRecentUpdatesRouting());

  assert.equal(result?.toolType, "research");
  assert.equal(result?.intent, "recent_updates");
  assert.match(result?.verifiedFacts.join(" "), /Cybersecurity update/);
  assert.match(result?.verifiedFacts.join(" "), /CISA adds known exploited vulnerabilities/);
  assert.match(result?.verifiedFacts.join(" "), /CVE-2026-0001/);
  assert.deepEqual(
    [...new Set(result?.sources?.map((source) => new URL(source.url).hostname.replace(/^www\./, "")) ?? [])].sort(),
    ["cisa.gov", "nvd.nist.gov"]
  );
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local research fact-check tool uses Wikipedia summary for stable biographies", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Marie Curie",
                snippet: "Physicienne et chimiste."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Marie_Curie")) {
      return new Response(
        JSON.stringify({
          title: "Marie Curie",
          description: "Physicienne et chimiste franco-polonaise",
          extract:
            "Marie Curie est une physicienne et chimiste franco-polonaise, pionniere des recherches sur la radioactivite, laureate de deux prix Nobel.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Marie_Curie"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q7186",
              label: "Marie Curie",
              description: "physicienne et chimiste polonaise naturalisee francaise",
              concepturi: "https://www.wikidata.org/wiki/Q7186"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting());

  assert.equal(result?.toolType, "research");
  assert.equal(result?.intent, "fact_check");
  assert.equal(result?.resultLabel, "Marie Curie");
  assert.match(result?.verifiedFacts.join(" "), /radioactivite/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
  assert.equal(result?.sources?.[0]?.retrievalEngine, "known_endpoint");
  assert.equal(result?.sources?.length, 2);
});

test("local research fact-check tool tries exact Wikipedia title before generic search", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requestedUrls.push(url);

    if (decodeURIComponent(url).includes("fr.wikipedia.org/api/rest_v1/page/summary/Moteur_Electrique")) {
      return new Response(
        JSON.stringify({
          title: "Moteur electrique",
          description: "Machine electrique",
          extract:
            "Un moteur electrique convertit l'energie electrique en energie mecanique par l'action d'un champ magnetique sur un courant.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Moteur_%C3%A9lectrique"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q7239",
              label: "Moteur electrique",
              description: "machine qui convertit l'energie electrique en energie mecanique",
              concepturi: "https://www.wikidata.org/wiki/Q7239"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      throw new Error("generic Wikipedia search should not run when exact title summary matches");
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("moteur electrique"));

  assert.equal(result?.toolType, "research");
  assert.match(result?.verifiedFacts.join(" "), /champ magnetique|energie mecanique/i);
  assert.equal(
    requestedUrls.some((url) => decodeURIComponent(url).includes("api/rest_v1/page/summary/Moteur_Electrique")),
    true
  );
  assert.equal(requestedUrls.some((url) => url.includes("fr.wikipedia.org/w/api.php")), false);
  assert.equal(result?.sources?.length, 2);
});

test("local research fact-check tool rejects adjacent Wikipedia titles and uses intent-specific search", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const decoded = decodeURIComponent(url);

    if (decoded.includes("fr.wikipedia.org/api/rest_v1/page/summary/Moteur_Electrique")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Automobile hybride electrique",
                snippet: "Vehicule hybride."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decoded.includes("fr.wikipedia.org/api/rest_v1/page/summary/Automobile_hybride_electrique")) {
      return new Response(
        JSON.stringify({
          title: "Automobile hybride electrique",
          description: "Vehicule automobile",
          extract:
            "Une automobile hybride electrique associe un moteur electrique a un moteur thermique pour se mouvoir.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q7239",
              label: "Moteur electrique",
              description: "machine qui convertit l'energie electrique en energie mecanique",
              concepturi: "https://www.wikidata.org/wiki/Q7239"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("duckduckgo.com/html")) {
      if (decoded.includes("site:britannica.com")) {
        return new Response("<html><body></body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        });
      }
      return new Response(
        `<html><body><div class="result"><a class="result__a" href="https://example.edu/moteur-electrique">Moteur electrique fonctionnement</a><a class="result__snippet">Un moteur electrique convertit l'energie electrique en energie mecanique grace a un champ magnetique et un courant.</a></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute({
    ...buildFactCheckRouting("moteur electrique"),
    extractedArgs: {
      subject: "moteur electrique",
      query: "Comment fonctionne un moteur electrique ?",
      language: "fr"
    }
  });

  assert.equal(result?.toolType, "research");
  assert.match(result?.verifiedFacts.join(" "), /champ magnetique|energie mecanique/i);
  assert.doesNotMatch(result?.verifiedFacts.join(" "), /automobile hybride|moteur thermique/i);
  assert.equal(result?.sources?.some((source) => source.title.includes("Automobile hybride")), false);
});

test("local research fact-check tool rejects off-topic earthquake sports pages", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const decoded = decodeURIComponent(url);

    if (url.includes("wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Earthquakes de San José",
                snippet: "Club de soccer professionnel."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decoded.includes("api/rest_v1/page/summary/Earthquakes_de_San_Jos")) {
      return new Response(
        JSON.stringify({
          title: "Earthquakes de San José",
          description: "Club de soccer",
          extract:
            "Les Earthquakes de San José est un club de soccer professionnel basé à San José.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("duckduckgo.com/html")) {
      if (decoded.includes("site:britannica.com")) {
        return new Response(
          `<html><body><div class="result"><a class="result__a" href="https://www.britannica.com/science/earthquake-geology">Earthquake | Britannica</a><a class="result__snippet">Earthquakes are sudden shaking caused by seismic waves through Earth's rocks and occur along geologic faults.</a></div></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }
      return new Response(
        `<html><body><div class="result"><a class="result__a" href="https://earthquake.usgs.gov/earthquakes/map/">Latest Earthquakes</a><a class="result__snippet">Track recent earthquakes worldwide with details on locations and epicenters.</a></div><div class="result"><a class="result__a" href="https://www.usgs.gov/faqs/what-earthquake-and-what-causes-them-happen">What is an earthquake and what causes them to happen?</a><a class="result__snippet">Learn about the science of earthquakes, tectonic plates, and the San Andreas Fault. Find out how earthquakes are measured.</a></div><div class="result"><a class="result__a" href="https://www.bgs.ac.uk/discovering-geology/earth-hazards/earthquakes/what-causes-earthquakes/">What causes earthquakes?</a><a class="result__snippet">Earthquakes are caused by sudden movement along faults within the Earth, releasing stored energy as seismic waves.</a></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute({
    ...buildFactCheckRouting("earthquakes"),
    extractedArgs: {
      subject: "earthquakes",
      query: "What causes earthquakes?",
      language: "en"
    }
  });

  assert.equal(result?.toolType, "research");
  assert.match(result?.verifiedFacts.join(" "), /faults|seismic waves|geologic faults/i);
  assert.doesNotMatch(result?.verifiedFacts.join(" "), /soccer|San José|Track recent|Learn about/i);
  assert.equal(result?.sources?.some((source) => /San_Jos|soccer|earthquakes\/map|Learn about/i.test(`${source.url} ${source.excerpt}`)), false);
});

test("local research fact-check tool cleans presentation biography subjects before Wikipedia lookup", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Louis IX",
                snippet: "Roi de France."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Louis_IX")) {
      return new Response(
        JSON.stringify({
          title: "Louis IX",
          description: "Roi de France",
          extract:
            "Louis IX, dit Saint Louis, est un roi de France capetien qui a regne de 1226 a 1270 et a ete canonise.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Louis_IX"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q346",
              label: "Louis IX",
              description: "roi de France canonise sous le nom de Saint Louis",
              concepturi: "https://www.wikidata.org/wiki/Q346"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(
    buildFactCheckRouting("fait moi une biographie complete pour une presentation de Louis 9")
  );

  assert.equal(result?.toolType, "research");
  assert.equal(result?.resultLabel, "Louis IX");
  assert.match(result?.verifiedFacts.join(" "), /Saint Louis/);
  assert.equal(
    requestedUrls.some((url) => decodeURIComponent(url).includes("api/rest_v1/page/summary/Louis_IX")),
    true
  );
  assert.equal(result?.sources?.[0]?.retrievalEngine, "known_endpoint");
});

test("local research fact-check tool abstains when only one source family is available", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Marie Curie",
                snippet: "Physicienne et chimiste."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Marie_Curie")) {
      return new Response(
        JSON.stringify({
          title: "Marie Curie",
          description: "Physicienne et chimiste franco-polonaise",
          extract:
            "Marie Curie est une physicienne et chimiste franco-polonaise, pionniere des recherches sur la radioactivite.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Marie Curie"));

  assert.equal(result, null);
});

test("local research fact-check tool corroborates stable facts with Wikidata when available", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Marie Curie",
                snippet: "Physicienne et chimiste."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Marie_Curie")) {
      return new Response(
        JSON.stringify({
          title: "Marie Curie",
          description: "Physicienne et chimiste franco-polonaise",
          extract:
            "Marie Curie est une physicienne et chimiste franco-polonaise, pionniere des recherches sur la radioactivite.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Marie_Curie"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q7186",
              label: "Marie Curie",
              description: "physicienne et chimiste polonaise naturalisee francaise",
              concepturi: "https://www.wikidata.org/wiki/Q7186"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Marie Curie"));

  assert.equal(result?.toolType, "research");
  assert.equal(result?.sources?.length, 2);
  assert.equal(result?.sources?.some((source) => source.url.includes("wikidata.org/wiki/Q7186")), true);
  assert.ok((result?.confidenceScore ?? 0) >= 0.9);
});

test("local research fact-check tool rejects off-subject Wikipedia summaries", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "The Bordeaux copy of the Essays",
                snippet: "Montaigne."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/The_Bordeaux_copy_of_the_Essays")) {
      return new Response(
        JSON.stringify({
          title: "The Bordeaux copy of the Essays",
          description: "Edition of Michel de Montaigne's Essays",
          extract:
            "The Bordeaux copy of the Essays is a 1588 edition of Michel de Montaigne's Essays held by the Bibliotheque municipale de Bordeaux.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("en.wikipedia.org")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("duckduckgo.com/html")) {
      return new Response(
        `<html><body><div class="result"><a class="result__a" href="https://www.britannica.com/biography/Louis-IX">Louis IX</a><a class="result__snippet">Louis IX, also called Saint Louis, was king of France from 1226 to 1270.</a></div><div class="result"><a class="result__a" href="https://example.org/louis-ix">Louis IX of France</a><a class="result__snippet">Louis IX was a Capetian king of France and later venerated as Saint Louis.</a></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Louis 9"));

  assert.equal(result?.toolType, "research");
  assert.doesNotMatch(result?.verifiedFacts.join(" ") ?? "", /Montaigne|Essays/);
  assert.match(result?.verifiedFacts.join(" "), /Saint Louis/);
  assert.equal(result?.sources?.[0]?.retrievalEngine, "duckduckgo");
});

test("local research fact-check tool disambiguates Cleopatra from the opera", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    if (url.includes("fr.wikipedia.org/w/api.php") && decoded.includes("srsearch=Cléopâtre VII")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Cléopâtre VII",
                snippet: "Reine d'Egypte antique."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/w/api.php") && decoded.includes("srsearch=Cleopatra VII")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Cléopâtre",
                snippet: "Opéra de Jules Massenet."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/w/api.php") && decoded.includes("srsearch=Cleopatre VII")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Cléopâtre VII",
                snippet: "Reine d'Egypte antique."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Cl%C3%A9op%C3%A2tre_VII")) {
      return new Response(
        JSON.stringify({
          title: "Cléopâtre VII",
          description: "Reine d'Egypte antique",
          extract: "Cléopâtre VII est la dernière souveraine active du royaume ptolémaïque d'Egypte.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Cléopâtre_VII"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Cl%C3%A9op%C3%A2tre")) {
      return new Response(
        JSON.stringify({
          title: "Cléopâtre",
          description: "Opéra",
          extract: "Cléopâtre est un opéra de Jules Massenet créé en 1914.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q635",
              label: "Cleopatra VII",
              description: "last active ruler of the Ptolemaic Kingdom of Egypt",
              concepturi: "https://www.wikidata.org/wiki/Q635"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Cleopatre"));

  assert.equal(result?.toolType, "research");
  assert.equal(result?.resultLabel, "Cléopâtre VII");
  assert.match(result?.verifiedFacts.join(" "), /reine|ruler|Egypte|Egypt/i);
  assert.doesNotMatch(result?.verifiedFacts.join(" "), /opéra|opera/i);
});

test("local research fact-check tool falls back to web search snippets", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("wikipedia.org")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("duckduckgo.com/html")) {
      return new Response(
        `<html><body><div class="result"><a class="result__a" href="https://example.org/ada">Ada Lovelace</a><a class="result__snippet">Ada Lovelace was an English mathematician known for early computing work.</a></div><div class="result"><a class="result__a" href="https://history.example.net/ada-lovelace">Ada Lovelace biography</a><a class="result__snippet">Ada Lovelace wrote notes about Charles Babbage's Analytical Engine and is linked to early programming history.</a></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Ada Lovelace"));

  assert.equal(result?.toolType, "research");
  assert.equal(result?.intent, "fact_check");
  assert.match(result?.verifiedFacts.join(" "), /early computing/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "generic_search");
  assert.equal(result?.sources?.[0]?.retrievalEngine, "duckduckgo");
  assert.equal(result?.sources?.length, 2);
});

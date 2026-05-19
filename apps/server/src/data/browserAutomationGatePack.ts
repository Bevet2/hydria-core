import {
  browserAutomationRequestSchema,
  type BrowserAutomationRequest,
  type BrowserAutomationRequestInput
} from "../types/browserAutomation.js";
import type { ExecutionCapability, ExecutionPermissionState } from "../types/execution.js";

export type BrowserAutomationGateCase = {
  id: string;
  description: string;
  request: BrowserAutomationRequest;
  expected: {
    allowed: boolean;
    state?: ExecutionPermissionState;
    capability: ExecutionCapability;
    rollbackRequired?: boolean;
    denialReason?: string;
  };
};

const baseProvenance = {
  requestedBy: "test" as const,
  source: "browser-automation-governance-gate",
  parentTraceId: null
};

function req(
  id: string,
  request: Omit<BrowserAutomationRequestInput, "requestId" | "provenance">
): BrowserAutomationRequest {
  return browserAutomationRequestSchema.parse({
    requestId: `browser-gate::${id}`,
    provenance: {
      ...baseProvenance,
      requestId: `browser-gate::${id}`,
      reason: `Gate case ${id}`
    },
    ...request
  });
}

export const browserAutomationGatePack: BrowserAutomationGateCase[] = [
  {
    id: "allowed-domain-navigation",
    description: "Navigation on an allowed domain can be prepared as dry-run HTTP acquisition.",
    request: req("allowed-domain-navigation", {
      action: "navigate",
      url: "https://example.com/docs",
      allowedDomains: ["example.com"],
      blockedDomains: [],
      requestedPermissions: ["network:read"]
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "fetcher_http",
      rollbackRequired: false
    }
  },
  {
    id: "forbidden-domain-navigation",
    description: "Navigation on a forbidden domain is denied before any browser runtime exists.",
    request: req("forbidden-domain-navigation", {
      action: "navigate",
      url: "https://blocked.example/private",
      allowedDomains: ["example.com"],
      blockedDomains: ["blocked.example"],
      requestedPermissions: ["network:read"]
    }),
    expected: {
      allowed: false,
      capability: "fetcher_http",
      denialReason: "domain_blocked_by_policy"
    }
  },
  {
    id: "readonly-extraction-allowed",
    description: "Read-only extraction can be planned on an allowed domain without real execution.",
    request: req("readonly-extraction-allowed", {
      action: "extract_readonly",
      url: "https://docs.example.com/page",
      allowedDomains: ["docs.example.com"],
      requestedPermissions: ["network:read", "content:extract"]
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "fetcher_http",
      rollbackRequired: false
    }
  },
  {
    id: "form-login-refused",
    description: "Login/form flows are refused by the Core governance contract.",
    request: req("form-login-refused", {
      action: "login",
      url: "https://example.com/login",
      allowedDomains: ["example.com"],
      requestedPermissions: ["network:read", "form:submit"],
      hints: {
        requiresAuth: true
      }
    }),
    expected: {
      allowed: false,
      capability: "fetcher_http",
      rollbackRequired: true,
      denialReason: "login_blocked"
    }
  },
  {
    id: "destructive-action-refused",
    description: "Destructive browser actions are refused and require rollback planning.",
    request: req("destructive-action-refused", {
      action: "destructive_action",
      url: "https://example.com/admin/delete",
      allowedDomains: ["example.com"],
      requestedPermissions: ["network:read", "action:write"],
      hints: {
        destructive: true
      }
    }),
    expected: {
      allowed: false,
      capability: "fetcher_http",
      rollbackRequired: true,
      denialReason: "destructive_action_blocked"
    }
  },
  {
    id: "cookie-session-secret-refused",
    description: "Cookie/session secret access is always denied.",
    request: req("cookie-session-secret-refused", {
      action: "read_cookie_secret",
      url: "https://example.com/account",
      allowedDomains: ["example.com"],
      requestedPermissions: ["cookie:read"],
      hints: {
        readsSecret: true,
        responseHeaders: {
          "set-cookie": "session=secret",
          "content-type": "text/html"
        }
      }
    }),
    expected: {
      allowed: false,
      capability: "fetcher_http",
      rollbackRequired: true,
      denialReason: "secret_or_cookie_access_blocked"
    }
  },
  {
    id: "dynamic-browser-disabled",
    description: "JS-heavy pages can recommend dynamic browser acquisition, but it is disabled in v1.",
    request: req("dynamic-browser-disabled", {
      action: "extract_readonly",
      url: "https://app.example.com/dashboard",
      allowedDomains: ["app.example.com"],
      requestedPermissions: ["network:read", "content:extract"],
      hints: {
        jsHeavy: true,
        failureReason: "client_rendered_app"
      }
    }),
    expected: {
      allowed: false,
      state: "disabled",
      capability: "fetcher_dynamic_browser",
      denialReason: "dynamic_browser_disabled"
    }
  },
  {
    id: "stealth-browser-disabled",
    description: "Anti-bot pages can recommend stealth browser acquisition, but it is disabled in v1.",
    request: req("stealth-browser-disabled", {
      action: "extract_readonly",
      url: "https://protected.example.com/news",
      allowedDomains: ["protected.example.com"],
      requestedPermissions: ["network:read", "content:extract"],
      hints: {
        antiBot: true,
        failureReason: "anti_bot_challenge"
      }
    }),
    expected: {
      allowed: false,
      state: "disabled",
      capability: "fetcher_stealth_browser",
      denialReason: "stealth_browser_disabled"
    }
  },
  {
    id: "scrapling-fallback-after-parse-fail",
    description: "HTTP failure or empty parse can select Scrapling as governed fallback capability.",
    request: req("scrapling-fallback-after-parse-fail", {
      action: "extract_readonly",
      url: "https://example.com/release-notes",
      allowedDomains: ["example.com"],
      requestedPermissions: ["network:read", "content:extract"],
      hints: {
        httpFailed: true,
        parseEmpty: true,
        retryCount: 1,
        failureReason: "http_403_then_empty_parse",
        responseHeaders: {
          "content-type": "text/html",
          "x-cache": "MISS"
        }
      }
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "fetcher_scrapling",
      rollbackRequired: false
    }
  },
  {
    id: "risky-action-requires-rollback",
    description: "Risky submit actions are refused and must carry rollback guidance.",
    request: req("risky-action-requires-rollback", {
      action: "submit_form",
      url: "https://example.com/settings",
      allowedDomains: ["example.com"],
      requestedPermissions: ["network:read", "form:submit"]
    }),
    expected: {
      allowed: false,
      capability: "fetcher_http",
      rollbackRequired: true,
      denialReason: "form_submission_blocked"
    }
  },
  {
    id: "complete-provenance-present",
    description: "Every dry-run plan carries full provenance for audit and future Hydria OS handoff.",
    request: req("complete-provenance-present", {
      action: "navigate",
      url: "https://example.com/provenance",
      allowedDomains: ["example.com"],
      requestedPermissions: ["network:read"]
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "fetcher_http",
      rollbackRequired: false
    }
  },
  {
    id: "acquisition-scoring-present",
    description: "Every acquisition capability plan produces scoring metadata and sanitized headers.",
    request: req("acquisition-scoring-present", {
      action: "extract_readonly",
      url: "https://example.com/scoring",
      allowedDomains: ["example.com"],
      requestedPermissions: ["network:read", "content:extract"],
      hints: {
        latencyMs: 42,
        retryCount: 0,
        responseHeaders: {
          "content-type": "text/html",
          "x-request-id": "browser-gate-scoring",
          "set-cookie": "must-not-leak=true"
        }
      }
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "fetcher_http",
      rollbackRequired: false
    }
  }
];

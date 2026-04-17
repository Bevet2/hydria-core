import type { SearchPlan } from "../services/research/common.js";

export type KnownFreshEndpoint = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  intents: SearchPlan["intent"][];
  domains: string[];
  termHints: string[];
  priority: number;
};

export const KNOWN_FRESH_ENDPOINTS: KnownFreshEndpoint[] = [
  {
    id: "openai-news",
    title: "OpenAI News",
    url: "https://openai.com/news/",
    snippet: "Official OpenAI announcements, launches, and updates.",
    intents: ["recent_updates"],
    domains: ["openai.com"],
    termHints: ["openai"],
    priority: 90
  },
  {
    id: "openai-about",
    title: "OpenAI About",
    url: "https://openai.com/about/",
    snippet: "Official OpenAI company and leadership page.",
    intents: ["current_status"],
    domains: ["openai.com"],
    termHints: ["openai", "ceo", "leadership"],
    priority: 72
  },
  {
    id: "vercel-changelog",
    title: "Vercel Changelog",
    url: "https://vercel.com/changelog",
    snippet: "Official Vercel changelog and release updates.",
    intents: ["recent_updates", "release_freshness", "current_status"],
    domains: ["vercel.com"],
    termHints: ["vercel"],
    priority: 92
  },
  {
    id: "vercel-blog",
    title: "Vercel Blog",
    url: "https://vercel.com/blog",
    snippet: "Official Vercel announcements and product updates.",
    intents: ["recent_updates"],
    domains: ["vercel.com"],
    termHints: ["vercel"],
    priority: 78
  },
  {
    id: "nextjs-releases",
    title: "Next.js Releases",
    url: "https://github.com/vercel/next.js/releases",
    snippet: "Canonical Next.js release feed on GitHub.",
    intents: ["release_freshness", "current_status"],
    domains: ["github.com", "nextjs.org", "vercel.com"],
    termHints: ["next.js", "nextjs"],
    priority: 95
  },
  {
    id: "nextjs-blog",
    title: "Next.js Blog",
    url: "https://nextjs.org/blog",
    snippet: "Official Next.js announcements and release posts.",
    intents: ["recent_updates", "release_freshness"],
    domains: ["nextjs.org"],
    termHints: ["next.js", "nextjs"],
    priority: 86
  },
  {
    id: "nodejs-releases",
    title: "Node.js Release Blog",
    url: "https://nodejs.org/en/blog/release",
    snippet: "Official Node.js release posts and changelog announcements.",
    intents: ["release_freshness", "recent_updates"],
    domains: ["nodejs.org"],
    termHints: ["node.js", "nodejs"],
    priority: 96
  },
  {
    id: "nodejs-previous-releases",
    title: "Node.js Releases Table",
    url: "https://nodejs.org/en/about/previous-releases",
    snippet: "Official Node.js current and LTS release lines.",
    intents: ["current_status", "release_freshness"],
    domains: ["nodejs.org"],
    termHints: ["node.js", "nodejs"],
    priority: 91
  },
  {
    id: "typescript-releases",
    title: "TypeScript Releases",
    url: "https://github.com/microsoft/TypeScript/releases",
    snippet: "Canonical TypeScript release feed on GitHub.",
    intents: ["release_freshness", "current_status"],
    domains: ["github.com", "typescriptlang.org", "microsoft.com"],
    termHints: ["typescript"],
    priority: 95
  },
  {
    id: "typescript-blog",
    title: "TypeScript Blog",
    url: "https://devblogs.microsoft.com/typescript/",
    snippet: "Official TypeScript announcements and release posts.",
    intents: ["recent_updates", "release_freshness"],
    domains: ["devblogs.microsoft.com", "microsoft.com"],
    termHints: ["typescript"],
    priority: 84
  },
  {
    id: "kubernetes-releases",
    title: "Kubernetes Releases",
    url: "https://github.com/kubernetes/kubernetes/releases",
    snippet: "Canonical Kubernetes release feed on GitHub.",
    intents: ["release_freshness", "current_status"],
    domains: ["github.com", "kubernetes.io"],
    termHints: ["kubernetes"],
    priority: 95
  },
  {
    id: "kubernetes-release-site",
    title: "Kubernetes Releases",
    url: "https://kubernetes.io/releases/",
    snippet: "Official Kubernetes release information and current version guidance.",
    intents: ["release_freshness", "current_status"],
    domains: ["kubernetes.io"],
    termHints: ["kubernetes"],
    priority: 90
  }
];

import type {
  ResearchFreshnessWindow,
  ResearchTemporalProfile
} from "../../types/arena.js";
import { matchesAny } from "./common.js";

const MONTH_NAME_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const ISO_DATE_PATTERN = /\b20\d{2}-\d{2}-\d{2}\b/g;
const SLASH_DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/20\d{2}\b/g;
const MONTH_DAY_YEAR_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2})?,\s+20\d{2}\b/gi;
const MONTH_YEAR_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b/gi;
const RELATIVE_DATE_PATTERN = /\b(\d{1,2})\s+(hours?|days?|weeks?)\s+ago\b/gi;

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function startOfUtcWeek(value: Date) {
  const day = value.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return shiftUtcDays(startOfUtcDay(value), delta);
}

function shiftUtcDays(value: Date, deltaDays: number) {
  const shifted = new Date(value);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted;
}

function toIsoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalizeTemporalText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function formatCalendarDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

export function formatCalendarMonth(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

export function formatIsoDayForSearch(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : formatCalendarDate(parsed);
}

export function buildDefaultTemporalProfile(): ResearchTemporalProfile {
  return {
    isTemporal: false,
    focus: "none",
    queryType: "none",
    recencyDays: null,
    absoluteDateHint: null,
    dateRangeStart: null,
    dateRangeEnd: null,
    queryDirectives: [],
    answerDirectives: []
  };
}

export function describeTemporalWindow(profile: ResearchTemporalProfile) {
  if (!profile.isTemporal) {
    return null;
  }

  if (profile.dateRangeStart && profile.dateRangeEnd) {
    return `${formatIsoDayForSearch(profile.dateRangeStart)} to ${formatIsoDayForSearch(profile.dateRangeEnd)}`;
  }

  return profile.absoluteDateHint;
}

export function detectTemporalQuery(value: string, now = new Date()): ResearchTemporalProfile {
  const normalized = normalizeTemporalText(value);
  const today = startOfUtcDay(now);
  const absoluteDateHint = formatCalendarDate(today);
  const thisWeekStart = startOfUtcWeek(today);
  const thisWeekEnd = shiftUtcDays(thisWeekStart, 6);
  const thisMonthStart = startOfUtcMonth(today);
  const thisMonthLabel = formatCalendarMonth(today);
  const hasCurrentStateCue = matchesAny(normalized, [
    /\bcurrent\b/i,
    /\bcurrently\b/i,
    /\bactuel(?:le)?s?\b/i,
    /\bmaintenant\b/i,
    /\bas of\b/i,
    /\bright now\b/i,
    /\bwho is\b/i,
    /\bleader(ship)?\b/i,
    /\bstatus\b/i,
    /\bavailability\b/i,
    /\bavailable\b/i,
    /\bprice\b/i
  ]);
  const hasReleaseCue = matchesAny(normalized, [
    /\brelease(?:d|s| notes?)?\b/i,
    /\bversion\b/i,
    /\bchangelog\b/i,
    /\bannounce(?:d|ment|ments)?\b/i,
    /\bannonce(?:e|es|s|ments?)?\b/i,
    /\blaunch(?:ed)?\b/i,
    /\blanc(?:e|ee|ees|es|ement|ements)\b/i,
    /\bsorti(?:e|es|s)?\b/i,
    /\bnouveautes?\b/i,
    /\broll(?:ed)? out\b/i,
    /\bga\b/i,
    /\bgeneral availability\b/i,
    /\bwhat'?s new\b/i,
    /\bnew features?\b/i
  ]);
  const hasRecentUpdatesCue =
    matchesAny(normalized, [
      /\brecent\b/i,
      /\brecently\b/i,
      /\bthis week\b/i,
      /\bcette semaine\b/i,
      /\bthis month\b/i,
      /\bce mois\b/i,
      /\blast 7 days\b/i,
      /\blast 30 days\b/i,
      /\bpast week\b/i,
      /\bpast month\b/i,
      /\bnews\b/i,
      /\bactu(?:alite|alites|s)?\b/i,
      /\bnouveautes?\b/i,
      /\bsorties?\b/i,
      /\brecap\b/i,
      /\bheadline(?:s)?\b/i,
      /\bupdates?\b/i,
      /\bwhat happened\b/i,
      /\bmajor\b/i
    ]) ||
    (/\bnew\b/i.test(normalized) &&
      matchesAny(normalized, [/\bupdates?\b/i, /\bfeatures?\b/i, /\bannouncements?\b/i, /\bmodels?\b/i]));

  const buildTemporalProfile = (
    profile: Partial<ResearchTemporalProfile>
  ): ResearchTemporalProfile => ({
    ...buildDefaultTemporalProfile(),
    isTemporal: true,
    absoluteDateHint,
    ...profile
  });

  if (/\bthis week\b|\bcette semaine\b|\bpast week\b|\blast 7 days\b|\bseven days\b/i.test(normalized)) {
    const windowLabel = `${formatCalendarDate(thisWeekStart)} to ${formatCalendarDate(thisWeekEnd)}`;
    return buildTemporalProfile({
      focus: "this_week",
      queryType: "recent_updates",
      recencyDays: 7,
      dateRangeStart: toIsoDay(thisWeekStart),
      dateRangeEnd: toIsoDay(thisWeekEnd),
      queryDirectives: [
        `Resolve "this week" to ${windowLabel} before searching.`,
        "Prefer primary sources with an explicit publication or update date in that window.",
        "Prefer official announcements, release notes, advisories, or status pages over commentary."
      ],
      answerDirectives: [
        `State the exact window ${windowLabel}.`,
        "Do not paraphrase the result as just 'this week' without the concrete dates.",
        "If no reliable source falls inside the window, say that the weekly claim could not be verified."
      ]
    });
  }

  if (/\bthis month\b|\bce mois\b|\bpast month\b|\blast 30 days\b/i.test(normalized)) {
    const windowLabel = `${formatCalendarDate(thisMonthStart)} to ${absoluteDateHint}`;
    return buildTemporalProfile({
      focus: "this_month",
      queryType: "recent_updates",
      recencyDays: 30,
      absoluteDateHint: thisMonthLabel,
      dateRangeStart: toIsoDay(thisMonthStart),
      dateRangeEnd: toIsoDay(today),
      queryDirectives: [
        `Resolve "this month" to ${thisMonthLabel} and treat the active window as ${windowLabel}.`,
        "Prefer primary sources with an explicit publication or update date in the resolved month window.",
        "Prefer official announcements, release posts, advisories, or status updates over timeless docs."
      ],
      answerDirectives: [
        `State the resolved month ${thisMonthLabel} and, when useful, the active window ${windowLabel}.`,
        "Do not leave 'this month' implicit in the final wording.",
        "If no reliable source falls inside the resolved month window, say that the monthly claim could not be verified."
      ]
    });
  }

  if (/\btoday\b|\baujourd hui\b|\baujourdhui\b|\bas of today\b|\bright now\b/i.test(normalized)) {
    return buildTemporalProfile({
      focus: "today",
      queryType: hasReleaseCue ? "release_freshness" : "current_status",
      recencyDays: 2,
      dateRangeStart: toIsoDay(today),
      dateRangeEnd: toIsoDay(today),
      queryDirectives: [
        `Resolve "today" to ${absoluteDateHint} before searching.`,
        "Prefer sources that expose a concrete update date or status timestamp.",
        "Prefer official pages over secondary summaries."
      ],
      answerDirectives: [
        `State that the answer is anchored to ${absoluteDateHint}.`,
        "Do not claim something is true today unless a reliable source supports that current state.",
        "If freshness is unclear, say that current status could not be confirmed."
      ]
    });
  }

  if (
    (/\blatest\b|\bnewest\b|\bmost recent\b/i.test(normalized) && hasReleaseCue) ||
    (hasReleaseCue && /\bnew\b/i.test(normalized))
  ) {
    return buildTemporalProfile({
      focus: "latest",
      queryType: "release_freshness",
      recencyDays: 180,
      dateRangeStart: null,
      dateRangeEnd: null,
      queryDirectives: [
        `Replace "latest" with an as-of date anchored to ${absoluteDateHint}.`,
        "Prefer release notes, changelogs, official announcements, or canonical version pages.",
        "Prefer sources that expose an explicit publication or update date."
      ],
      answerDirectives: [
        `State that the answer is verified as of ${absoluteDateHint}.`,
        "Use concrete dates or version markers instead of repeating 'latest' loosely.",
        "If reliable sources do not establish what is latest, say that explicitly."
      ]
    });
  }

  if (hasCurrentStateCue) {
    return buildTemporalProfile({
      focus: "current",
      queryType: "current_status",
      recencyDays: 120,
      dateRangeStart: null,
      dateRangeEnd: null,
      queryDirectives: [
        `Replace "current" with an as-of date anchored to ${absoluteDateHint}.`,
        "Prefer official documentation, status pages, canonical leadership pages, or product pages describing the current state.",
        "Prefer sources that expose an explicit update date when available."
      ],
      answerDirectives: [
        `State that the answer is anchored to ${absoluteDateHint}.`,
        "Use exact dates, versions, or status labels instead of generic 'currently' phrasing.",
        "If a reliable source does not confirm the present state, say that explicitly."
      ]
    });
  }

  if (
    hasRecentUpdatesCue ||
    /\brecent\b|\brecently\b|\brecent(?:e|es|s)?\b/i.test(normalized) ||
    /\bannounced\b|\bannonce(?:e|es|s)?\b/i.test(normalized)
  ) {
    const recentStart = shiftUtcDays(today, -29);
    const windowLabel = `${formatCalendarDate(recentStart)} to ${absoluteDateHint}`;
    return buildTemporalProfile({
      focus: "recent",
      queryType: "recent_updates",
      recencyDays: 30,
      dateRangeStart: toIsoDay(recentStart),
      dateRangeEnd: toIsoDay(today),
      queryDirectives: [
        `Resolve "recent" to the rolling window ${windowLabel}.`,
        "Prefer primary sources with a clear publication or update date inside that window.",
        "Discard stale or undated sources when fresher primary sources are available."
      ],
      answerDirectives: [
        `State the exact recent window ${windowLabel}.`,
        "Do not leave 'recent' undefined in the final wording.",
        "If reliable sources do not support the claim inside that window, say so explicitly."
      ]
    });
  }

  if (/\blatest\b|\bnewest\b|\bmost recent\b/i.test(normalized)) {
    return buildTemporalProfile({
      focus: "latest",
      queryType: "current_status",
      recencyDays: 120,
      queryDirectives: [
        `Replace "latest" with an as-of date anchored to ${absoluteDateHint}.`,
        "Prefer official or primary sources that describe the present state and expose a date when available.",
        "Do not rely on timeless background pages when a dated current-state source exists."
      ],
      answerDirectives: [
        `State that the answer is verified as of ${absoluteDateHint}.`,
        "Use a concrete date or status marker instead of vague 'latest' phrasing.",
        "If no reliable current-state source can be established, say that explicitly."
      ]
    });
  }

  return buildDefaultTemporalProfile();
}

export function resolveFreshnessWindow(profile: ResearchTemporalProfile): ResearchFreshnessWindow {
  if (!profile.isTemporal) {
    return "none";
  }

  if (profile.queryType === "current_status" || profile.queryType === "release_freshness") {
    return "current";
  }

  if (profile.focus === "this_week") {
    return "7d";
  }

  if (profile.focus === "recent") {
    return "30d";
  }

  return profile.dateRangeStart && profile.dateRangeEnd ? "explicit_date_range" : "current";
}

export function hasExplicitDateSignal(value: string) {
  return (
    MONTH_NAME_PATTERN.test(value) ||
    /\b20\d{2}\b/.test(value) ||
    /\b\d{1,2}\s+(?:hours?|days?|weeks?)\s+ago\b/i.test(value) ||
    /\bupdated\b|\bpublished\b|\breleased\b|\bannounced\b/i.test(value)
  );
}

export function scoreTemporalFreshness(
  value: string,
  profile: ResearchTemporalProfile,
  now = new Date()
) {
  if (!profile.isTemporal) {
    return 0;
  }

  const dates = extractDateCandidates(value, now);
  const lower = value.toLowerCase();
  let score = 0;

  if (dates.length > 0) {
    const freshest = dates.reduce((best, current) =>
      current.getTime() > best.getTime() ? current : best
    );
    const ageDays = Math.max(
      0,
      Math.round((startOfUtcDay(now).getTime() - startOfUtcDay(freshest).getTime()) / 86_400_000)
    );

    if (profile.recencyDays !== null) {
      if (ageDays <= profile.recencyDays) {
        score += 12;
      } else if (ageDays <= profile.recencyDays * 2) {
        score += 4;
      } else {
        score -= 10;
      }
    } else {
      score += 5;
    }
  } else if (
    profile.focus === "recent" ||
    profile.focus === "this_week" ||
    profile.focus === "today"
  ) {
    score -= 6;
  } else {
    score -= 2;
  }

  if (/\bupdated\b|\blast updated\b|\bpublished\b|\bannounced\b|\breleased\b|\bchangelog\b|\brelease notes?\b/i.test(lower)) {
    score += 4;
  }

  if (profile.focus === "latest" || profile.focus === "current") {
    if (/\bcurrent\b|\blatest\b|\bversion\b|\bnow available\b|\bgenerally available\b/i.test(lower)) {
      score += 3;
    }
  }

  return score;
}

export function extractDateCandidates(value: string, now = new Date()) {
  const dates: Date[] = [];

  for (const match of value.matchAll(ISO_DATE_PATTERN)) {
    const parsed = new Date(`${match[0]}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(SLASH_DATE_PATTERN)) {
    const parsed = new Date(match[0]);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(MONTH_DAY_YEAR_PATTERN)) {
    const parsed = new Date(match[0]);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(MONTH_YEAR_PATTERN)) {
    const parsed = new Date(`${match[0]} 1`);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(RELATIVE_DATE_PATTERN)) {
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase() ?? "";
    if (!Number.isFinite(amount)) {
      continue;
    }

    const multiplier = unit.startsWith("hour") ? 0 : unit.startsWith("week") ? 7 : 1;
    dates.push(shiftUtcDays(startOfUtcDay(now), -(amount * multiplier)));
  }

  return dates;
}

export function toIsoDateTime(value: Date) {
  return value.toISOString();
}

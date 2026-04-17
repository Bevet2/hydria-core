const CP1252_REVERSE_MAP = new Map<number, number>([
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

function looksLikeMojibake(value: string) {
  return /[\u00c3\u00c2\u00e2\u20ac\u2122\u0153\u017d\u0178\u0160\u2018\u2019\u201c\u201d\u2013\u2014]/u.test(
    value
  );
}

function scoreTextQuality(value: string) {
  const mojibakeHits =
    value.match(
      /[\u00c3\u00c2\u00e2\u20ac\u2122\u0153\u017d\u0178\u0160\u2018\u2019\u201c\u201d\u2013\u2014]/gu
    )?.length ?? 0;
  const replacementHits = value.match(/\uFFFD/gu)?.length ?? 0;
  return mojibakeHits * 3 + replacementHits * 4;
}

function decodeMojibakeOnce(value: string) {
  const bytes: number[] = [];

  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }

    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }

    const cp1252Byte = CP1252_REVERSE_MAP.get(code);
    if (cp1252Byte !== undefined) {
      bytes.push(cp1252Byte);
      continue;
    }

    return value;
  }

  return Buffer.from(bytes).toString("utf8");
}

export function repairMojibake(value: string) {
  let current = value;

  for (let index = 0; index < 2; index += 1) {
    if (!looksLikeMojibake(current)) {
      break;
    }

    const repaired = decodeMojibakeOnce(current);
    if (repaired === current || scoreTextQuality(repaired) > scoreTextQuality(current)) {
      break;
    }

    current = repaired;
  }

  return current
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeTextValue(value: string) {
  return repairMojibake(value);
}

export function normalizeForMatching(value: string) {
  return sanitizeTextValue(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function deepSanitizeStrings<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeTextValue(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => deepSanitizeStrings(entry)) as T;
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = deepSanitizeStrings(entry);
    }
    return next as T;
  }

  return value;
}

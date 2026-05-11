export interface AsyncScoreResult {
  score: number;
  signals: string[];
}

const SYNC_TERMS = [
  "daily standup",
  "daily stand-up",
  "sync meeting",
  "pair programming",
  "always on",
  "real-time collaboration",
  "synchronous",
  "live whiteboarding",
  "video call required",
  "must be online",
  "immediate response required",
];

const ASYNC_TERMS = [
  "async-first",
  "asynchronous",
  "written communication",
  "documentation-first",
  "documentation first",
  "written-first",
  "design doc",
  "no meetings",
  "deep work",
  "flexible hours",
  "loom",
  "async",
];

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function computeAsyncScore(description: string): AsyncScoreResult {
  const clean = stripHtml(description).toLowerCase();
  const wordCount = Math.max(countWords(clean), 1);

  let syncMatches = 0;
  let asyncMatches = 0;
  const signals: string[] = [];

  for (const term of SYNC_TERMS) {
    const occurrences = (clean.match(new RegExp(term, "g")) ?? []).length;
    if (occurrences > 0) {
      syncMatches += occurrences;
      signals.push(`-${term}`);
    }
  }

  for (const term of ASYNC_TERMS) {
    const occurrences = (clean.match(new RegExp(term, "g")) ?? []).length;
    if (occurrences > 0) {
      asyncMatches += occurrences;
      signals.push(`+${term}`);
    }
  }

  const syncDensity = (syncMatches / wordCount) * 1000;
  const asyncDensity = (asyncMatches / wordCount) * 1000;
  const k = 15;

  const raw = 50 + (asyncDensity - syncDensity) * k;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return { score, signals };
}

/**
 * Tolerant parsing of job application deadlines.
 *
 * Extractors store deadlines as free text ("2026-05-29", "29th June, 2026",
 * "Ongoing", "ASAP", ...). Parsing is intentionally conservative: anything we
 * cannot confidently interpret as a calendar date returns null, so jobs are
 * never auto-expired off an ambiguous value.
 */

const NON_DATE_DEADLINES = new Set([
  "ongoing",
  "asap",
  "open",
  "rolling",
  "various",
  "continuous",
  "immediate",
  "n/a",
  "none",
  "tbc",
  "tbd",
  "until filled",
  "open until filled",
]);

const MONTH_INDEX_BY_NAME = new Map<string, number>(
  [
    ["january", 0],
    ["february", 1],
    ["march", 2],
    ["april", 3],
    ["may", 4],
    ["june", 5],
    ["july", 6],
    ["august", 7],
    ["september", 8],
    ["october", 9],
    ["november", 10],
    ["december", 11],
  ].flatMap(([name, index]) => [
    [name as string, index as number],
    [(name as string).slice(0, 3), index as number],
  ]),
);

const MIN_DEADLINE_YEAR = 2000;
const MAX_DEADLINE_YEAR = 2100;

function buildLocalDate(
  year: number,
  monthIndex: number,
  day: number,
): Date | null {
  if (year < MIN_DEADLINE_YEAR || year > MAX_DEADLINE_YEAR) return null;
  const date = new Date(year, monthIndex, day);
  // Reject overflow dates such as 31 February.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Parse a deadline string into a local Date (midnight on the deadline day),
 * or null when the value is empty, a non-date sentinel, or unparseable.
 */
export function parseJobDeadline(
  deadline: string | null | undefined,
): Date | null {
  if (!deadline) return null;
  const normalized = deadline.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized || NON_DATE_DEADLINES.has(normalized)) return null;

  // ISO-style: 2026-05-29, 2026/5/29, optionally followed by a time part.
  let match = normalized.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[t ].*)?$/,
  );
  if (match) {
    return buildLocalDate(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
  }

  // Day-first numeric: 29/06/2026 or 29-06-2026 (UK job boards).
  match = normalized.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    return buildLocalDate(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
    );
  }

  // "29th June, 2026", "29 jun 2026".
  match = normalized.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})$/,
  );
  if (match) {
    const monthIndex = MONTH_INDEX_BY_NAME.get(match[2]);
    if (monthIndex === undefined) return null;
    return buildLocalDate(Number(match[3]), monthIndex, Number(match[1]));
  }

  // "June 29th, 2026", "jun 29 2026".
  match = normalized.match(
    /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/,
  );
  if (match) {
    const monthIndex = MONTH_INDEX_BY_NAME.get(match[1]);
    if (monthIndex === undefined) return null;
    return buildLocalDate(Number(match[3]), monthIndex, Number(match[2]));
  }

  return null;
}

/**
 * Whether a job deadline has passed. The deadline day itself still counts as
 * open; the deadline is passed from the start of the following day. Returns
 * false when the deadline is missing or unparseable.
 */
export function isJobDeadlinePassed(
  deadline: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const parsed = parseJobDeadline(deadline);
  if (!parsed) return false;
  const startOfDayAfterDeadline = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate() + 1,
  );
  return now.getTime() >= startOfDayAfterDeadline.getTime();
}

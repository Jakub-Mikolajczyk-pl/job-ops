/**
 * Recruitment scoring profile (RECRUITMENT_TASKS.md R2, step 5).
 *
 * Single source of truth for how an inbound recruiter opportunity is scored
 * (suitabilityScore) and prioritized (study-topic priority / "Your move"
 * urgency). The R2 worker must NOT score with ad-hoc prompt heuristics — it
 * reads this profile so the rules live in one editable place.
 *
 * Override the bundled default by setting the RECRUITMENT_PROFILE env var to a
 * JSON object with any subset of the profile fields, e.g.:
 *
 *   RECRUITMENT_PROFILE='{"floorRatePln":160,"remotePreferred":true,
 *     "preferredStack":["java","spring","kotlin"],
 *     "redFlags":["onsite only","unpaid","equity only"]}'
 *
 * Only the provided keys override the default; the rest fall back.
 */

import { logger } from "@infra/logger";
import { STUDY_TOPIC_PRIORITIES, type StudyTopicPriority } from "@shared/types";

export interface RecruitmentProfile {
  /** Lowest acceptable rate in PLN. Units follow whatever the recruiter quotes
   *  (hourly B2B or monthly) — compared loosely against any number we parse. */
  floorRatePln: number;
  /** Preferred tech (lowercase). Overlap with the offer raises the score. */
  preferredStack: string[];
  /** Whether remote work is preferred. Remote offers gain, on-site offers lose. */
  remotePreferred: boolean;
  /** Lowercase keywords that, if present in flags/notes, drop the score. */
  redFlags: string[];
  /** Baseline score before adjustments (0–100). */
  baseScore: number;
}

export const DEFAULT_RECRUITMENT_PROFILE: RecruitmentProfile = {
  floorRatePln: 150,
  preferredStack: [
    "java",
    "spring",
    "kotlin",
    "typescript",
    "node",
    "react",
    "postgres",
    "kafka",
    "aws",
    "kubernetes",
  ],
  remotePreferred: true,
  redFlags: [
    "on-site only",
    "onsite only",
    "unpaid",
    "equity only",
    "no remote",
    "relocation required",
  ],
  baseScore: 50,
};

let cached: RecruitmentProfile | null = null;

/**
 * Load the recruitment profile: bundled default merged with the
 * RECRUITMENT_PROFILE env override (parsed once, then cached). Invalid JSON is
 * logged and ignored — the default always wins over a broken override.
 */
export function loadRecruitmentProfile(): RecruitmentProfile {
  if (cached) return cached;

  const raw = process.env.RECRUITMENT_PROFILE?.trim();
  if (!raw) {
    cached = DEFAULT_RECRUITMENT_PROFILE;
    return cached;
  }

  try {
    const override = JSON.parse(raw) as Partial<RecruitmentProfile>;
    cached = {
      floorRatePln:
        typeof override.floorRatePln === "number"
          ? override.floorRatePln
          : DEFAULT_RECRUITMENT_PROFILE.floorRatePln,
      preferredStack: Array.isArray(override.preferredStack)
        ? override.preferredStack.map((s) => String(s).toLowerCase())
        : DEFAULT_RECRUITMENT_PROFILE.preferredStack,
      remotePreferred:
        typeof override.remotePreferred === "boolean"
          ? override.remotePreferred
          : DEFAULT_RECRUITMENT_PROFILE.remotePreferred,
      redFlags: Array.isArray(override.redFlags)
        ? override.redFlags.map((s) => String(s).toLowerCase())
        : DEFAULT_RECRUITMENT_PROFILE.redFlags,
      baseScore:
        typeof override.baseScore === "number"
          ? override.baseScore
          : DEFAULT_RECRUITMENT_PROFILE.baseScore,
    };
  } catch (error) {
    logger.warn("Invalid RECRUITMENT_PROFILE env JSON; using default", {
      error: error instanceof Error ? error.message : String(error),
    });
    cached = DEFAULT_RECRUITMENT_PROFILE;
  }
  return cached;
}

/** Reset the cached profile. Test-only seam. */
export function resetRecruitmentProfileCache(): void {
  cached = null;
}

export interface RecruitmentScoreInput {
  rate?: string;
  salaryRange?: string;
  workModel?: string;
  techStack?: string[];
  flags?: string;
  notes?: string;
}

export interface RecruitmentScore {
  score: number;
  priority: StudyTopicPriority;
  reasons: string[];
}

/** Pull the first plausible rate/salary number out of a free-text string. */
function parseFirstNumber(
  ...values: (string | undefined)[]
): number | undefined {
  for (const value of values) {
    if (!value) continue;
    // Strip thousands separators (spaces, commas, dots used as grouping).
    const match = value.replace(/[\s,](?=\d{3}\b)/g, "").match(/\d+(?:\.\d+)?/);
    if (match) {
      const n = Number.parseFloat(match[0]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function priorityFromScore(score: number): StudyTopicPriority {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/**
 * Deterministically score a recruitment opportunity against the profile.
 * Returns 0–100 plus a derived priority and human-readable reasons (used for
 * jobs.suitabilityReason). No LLM involved — the LLM only extracts facts.
 */
export function scoreRecruitment(
  input: RecruitmentScoreInput,
  profile: RecruitmentProfile = loadRecruitmentProfile(),
): RecruitmentScore {
  const reasons: string[] = [];
  let score = profile.baseScore;

  // Stack overlap (+25 max).
  const stack = (input.techStack ?? []).map((s) => s.toLowerCase());
  if (profile.preferredStack.length > 0 && stack.length > 0) {
    const matched = profile.preferredStack.filter((pref) =>
      stack.some((s) => s.includes(pref) || pref.includes(s)),
    );
    if (matched.length > 0) {
      const bonus = Math.min(
        25,
        Math.round((matched.length / profile.preferredStack.length) * 50),
      );
      score += bonus;
      reasons.push(`stack +${bonus} (${matched.join(", ")})`);
    }
  }

  // Remote preference (±15).
  const wm = input.workModel?.toLowerCase() ?? "";
  const isRemote = wm.includes("remote") || wm.includes("zdaln");
  const isOnsite =
    wm.includes("on-site") || wm.includes("onsite") || wm.includes("stacjon");
  if (profile.remotePreferred && isRemote) {
    score += 15;
    reasons.push("remote +15");
  } else if (profile.remotePreferred && isOnsite) {
    score -= 15;
    reasons.push("on-site -15");
  }

  // Rate vs floor (±20).
  const rate = parseFirstNumber(input.rate, input.salaryRange);
  if (rate !== undefined) {
    if (rate >= profile.floorRatePln) {
      score += 15;
      reasons.push(`rate ${rate} ≥ floor +15`);
    } else {
      score -= 20;
      reasons.push(`rate ${rate} < floor ${profile.floorRatePln} -20`);
    }
  }

  // Red flags (-15 each).
  const haystack = `${input.flags ?? ""} ${input.notes ?? ""}`.toLowerCase();
  for (const flag of profile.redFlags) {
    if (flag && haystack.includes(flag)) {
      score -= 15;
      reasons.push(`red flag "${flag}" -15`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const priority = priorityFromScore(score);
  void STUDY_TOPIC_PRIORITIES; // priority is always a valid enum member.
  return { score, priority, reasons };
}

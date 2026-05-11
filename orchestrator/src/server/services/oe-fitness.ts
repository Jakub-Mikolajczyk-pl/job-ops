import { computeAsyncScore } from "./oe-async-score";
import { scan } from "./oe-redflags";

export interface OeReason {
  rule: string;
  delta: number;
  evidence: string;
}

export interface OeFitnessResult {
  score: number;
  reasons: OeReason[];
}

function parseNumEmployees(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Handles "51-200", "501-1000", "10001+", "5000", etc.
  const match = raw.match(/(\d[\d,]*)/);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ""), 10);
}

export interface OeFitnessInput {
  isRemote: boolean | null | undefined;
  workFromHomeType: string | null | undefined;
  companyNumEmployees: string | null | undefined;
  jobLevel: string | null | undefined;
  jobFunction: string | null | undefined;
  jobDescription: string | null | undefined;
}

export function computeOeFitness(job: OeFitnessInput): OeFitnessResult {
  const reasons: OeReason[] = [];
  let score = 50;

  // Remote gate
  const isFullyRemote =
    job.isRemote === true &&
    (job.workFromHomeType == null ||
      /fully|full.?remote/i.test(job.workFromHomeType));
  const isHybrid =
    job.isRemote === true &&
    job.workFromHomeType != null &&
    /hybrid/i.test(job.workFromHomeType);
  const isOnsite = !job.isRemote;

  if (isFullyRemote) {
    reasons.push({
      rule: "remote_gate",
      delta: 0,
      evidence: "Fully remote — no penalty applied",
    });
  } else if (isHybrid) {
    const delta = -10;
    score += delta;
    reasons.push({
      rule: "remote_gate",
      delta,
      evidence: "Hybrid remote — partial deduction",
    });
  } else if (isOnsite) {
    const cap = 30 - score;
    if (cap < 0) {
      score += cap;
      reasons.push({
        rule: "remote_gate",
        delta: cap,
        evidence: "On-site role — score capped to 30",
      });
    }
  }

  // Company size
  const numEmployees = parseNumEmployees(job.companyNumEmployees);
  if (numEmployees !== null) {
    let delta = 0;
    let evidence = "";
    if (numEmployees <= 50) {
      delta = -10;
      evidence = `Micro company (${numEmployees} employees) — harder to disappear in`;
    } else if (numEmployees <= 500) {
      delta = 0;
      evidence = `Small–mid company (${numEmployees} employees)`;
    } else if (numEmployees <= 5000) {
      delta = 10;
      evidence = `Large company (${numEmployees} employees) — easier to go unnoticed`;
    } else {
      delta = 15;
      evidence = `Enterprise (${numEmployees}+ employees) — very easy to go unnoticed`;
    }
    if (delta !== 0) {
      score += delta;
      reasons.push({ rule: "company_size", delta, evidence });
    }
  }

  // Job level
  if (job.jobLevel) {
    const level = job.jobLevel.toLowerCase();
    let delta = 0;
    let evidence = "";
    if (
      level.includes("senior") ||
      level.includes("staff") ||
      level.includes("principal") ||
      level.includes("lead")
    ) {
      delta = 10;
      evidence = `${job.jobLevel} — more autonomy, less supervision`;
    } else if (
      level.includes("junior") ||
      level.includes("entry") ||
      level.includes("graduate") ||
      level.includes("intern")
    ) {
      delta = -10;
      evidence = `${job.jobLevel} — more hand-holding, more check-ins`;
    }
    if (delta !== 0) {
      score += delta;
      reasons.push({ rule: "job_level", delta, evidence });
    }
  }

  // Job function
  if (job.jobFunction) {
    const fn = job.jobFunction.toLowerCase();
    let delta = 0;
    let evidence = "";
    if (
      fn.includes("backend") ||
      fn.includes("infrastructure") ||
      fn.includes("data platform") ||
      fn.includes("platform")
    ) {
      delta = 10;
      evidence = `${job.jobFunction} — lower sync-collab intensity`;
    } else if (
      fn.includes("frontend") ||
      fn.includes("product manager") ||
      fn.includes("ux") ||
      fn.includes("design")
    ) {
      delta = -5;
      evidence = `${job.jobFunction} — higher sync-collab intensity`;
    }
    if (delta !== 0) {
      score += delta;
      reasons.push({ rule: "job_function", delta, evidence });
    }
  }

  // Red flags
  const description = job.jobDescription ?? "";
  let redFlagCount = 0;
  if (description) {
    const flags = scan(description);
    for (const flag of flags) {
      const delta =
        flag.severity === "high"
          ? -20
          : flag.severity === "medium"
            ? -10
            : -5;
      score += delta;
      redFlagCount += 1;
      reasons.push({
        rule: `red_flag_${flag.id}`,
        delta,
        evidence: flag.snippet,
      });
    }
  }

  // Async-friendliness bonus
  if (description) {
    const { score: asyncScore } = computeAsyncScore(description);
    if (asyncScore >= 70) {
      const delta = 5;
      score += delta;
      reasons.push({
        rule: "async_friendly",
        delta,
        evidence: `Async-friendliness score: ${asyncScore}/100`,
      });
    } else if (asyncScore < 30) {
      const delta = -5;
      score += delta;
      reasons.push({
        rule: "sync_heavy",
        delta,
        evidence: `Sync-heavy description: async score ${asyncScore}/100`,
      });
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
  };
}

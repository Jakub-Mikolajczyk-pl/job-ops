export type ApplyRiskLevel = "low" | "medium" | "high";

export interface ApplyRisk {
  level: ApplyRiskLevel;
  reason: string;
  alternativeLink?: string;
}

const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "bamboohr.com",
  "icims.com",
  "taleo.net",
  "successfactors.com",
  "workable.com",
  "recruitee.com",
  "teamtailor.com",
  "personio.de",
  "breezy.hr",
  "jobvite.com",
];

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isLinkedinApply(url: string): boolean {
  const domain = getDomain(url);
  return domain !== null && domain.includes("linkedin.com");
}

function isAtsDomain(url: string): boolean {
  const domain = getDomain(url);
  if (!domain) return false;
  return ATS_DOMAINS.some((ats) => domain === ats || domain.endsWith(`.${ats}`));
}

export function computeApplyRisk(
  applicationLink: string | null | undefined,
  jobUrl: string | null | undefined,
  source: string | null | undefined,
): ApplyRisk {
  const link = applicationLink || jobUrl || "";

  if (!link) {
    return {
      level: "low",
      reason: "No application link",
    };
  }

  // Email-only applications (no HTTP link)
  if (!link.startsWith("http")) {
    return {
      level: "low",
      reason: "Email-only application",
    };
  }

  // LinkedIn apply — network visible
  if (isLinkedinApply(link) || source === "linkedin") {
    return {
      level: "high",
      reason:
        "LinkedIn application — visible to your connections including current employer recruiters",
    };
  }

  // Known ATS — low risk
  if (isAtsDomain(link)) {
    const domain = getDomain(link) ?? link;
    return {
      level: "low",
      reason: `Direct ATS application (${domain}) — lower network visibility`,
    };
  }

  // Company direct / unknown
  const domain = getDomain(link) ?? link;
  return {
    level: "medium",
    reason: `Application via ${domain} — network visibility unknown`,
  };
}

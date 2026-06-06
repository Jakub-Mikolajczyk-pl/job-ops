import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RECRUITMENT_PROFILE,
  loadRecruitmentProfile,
  resetRecruitmentProfileCache,
  scoreRecruitment,
} from "./recruitment-profile";

describe("recruitment scoring profile", () => {
  afterEach(() => {
    resetRecruitmentProfileCache();
    delete process.env.RECRUITMENT_PROFILE;
  });

  it("rewards a remote, in-stack, above-floor offer with high priority", () => {
    const result = scoreRecruitment(
      {
        rate: "180 PLN/h B2B",
        workModel: "Remote",
        techStack: ["Java", "Spring", "Kafka", "AWS"],
      },
      DEFAULT_RECRUITMENT_PROFILE,
    );
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.priority).toBe("high");
    expect(result.reasons.join(" ")).toMatch(/remote/);
  });

  it("penalizes on-site, below-floor, red-flagged offers", () => {
    const result = scoreRecruitment(
      {
        rate: "90 PLN",
        workModel: "On-site",
        techStack: ["COBOL"],
        flags: "🔴 onsite only",
      },
      DEFAULT_RECRUITMENT_PROFILE,
    );
    expect(result.score).toBeLessThan(50);
    expect(result.priority).toBe("low");
  });

  it("clamps the score into 0..100", () => {
    const result = scoreRecruitment(
      { workModel: "On-site", flags: "unpaid equity only no remote" },
      DEFAULT_RECRUITMENT_PROFILE,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("merges a partial env override over the default", () => {
    process.env.RECRUITMENT_PROFILE = JSON.stringify({ floorRatePln: 999 });
    resetRecruitmentProfileCache();
    const profile = loadRecruitmentProfile();
    expect(profile.floorRatePln).toBe(999);
    // Untouched keys fall back to the default.
    expect(profile.preferredStack).toEqual(
      DEFAULT_RECRUITMENT_PROFILE.preferredStack,
    );
  });

  it("ignores invalid env JSON and keeps the default", () => {
    process.env.RECRUITMENT_PROFILE = "{not valid json";
    resetRecruitmentProfileCache();
    const profile = loadRecruitmentProfile();
    expect(profile).toEqual(DEFAULT_RECRUITMENT_PROFILE);
  });
});

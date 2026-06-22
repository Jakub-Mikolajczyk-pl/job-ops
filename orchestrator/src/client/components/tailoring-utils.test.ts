import { describe, expect, it } from "vitest";
import {
  computeSkillChanges,
  getOriginalHeadline,
  getOriginalSkills,
  getOriginalSummary,
  parseTailoredSkills,
} from "./tailoring-utils";

describe("parseTailoredSkills", () => {
  it("parses object-based tailored skills payload", () => {
    const parsed = parseTailoredSkills(
      JSON.stringify([
        { name: "Backend", keywords: ["Node.js", " TypeScript "] },
      ]),
    );

    expect(parsed).toEqual([
      { name: "Backend", keywords: ["Node.js", "TypeScript"] },
    ]);
  });

  it("maps legacy string arrays into a default skills group", () => {
    const parsed = parseTailoredSkills(
      JSON.stringify(["React", " TypeScript ", "", "Vitest"]),
    );

    expect(parsed).toEqual([
      { name: "Skills", keywords: ["React", "TypeScript", "Vitest"] },
    ]);
  });

  it("keeps object groups and legacy string values in mixed arrays", () => {
    const parsed = parseTailoredSkills(
      JSON.stringify([
        { name: "Platform", keywords: ["APIs"] },
        "Observability",
      ]),
    );

    expect(parsed).toEqual([
      { name: "Platform", keywords: ["APIs"] },
      { name: "Skills", keywords: ["Observability"] },
    ]);
  });

  it("returns an empty list for invalid or non-array JSON", () => {
    expect(parseTailoredSkills("{")).toEqual([]);
    expect(parseTailoredSkills(JSON.stringify({ name: "Backend" }))).toEqual(
      [],
    );
  });

  it("extracts original summary and headline from profile basics", () => {
    const profile = {
      basics: {
        summary: " Base summary ",
        label: " Base headline ",
      },
    };

    expect(getOriginalSummary(profile)).toBe("Base summary");
    expect(getOriginalHeadline(profile)).toBe("Base headline");
  });

  it("extracts original skills from profile skills items", () => {
    const profile = {
      sections: {
        skills: {
          items: [
            {
              id: "1",
              name: "Backend",
              description: "",
              level: 0,
              keywords: [" Node.js ", "TypeScript"],
              visible: true,
            },
          ],
        },
      },
    };

    expect(getOriginalSkills(profile)).toEqual([
      { name: "Backend", keywords: ["Node.js", "TypeScript"] },
    ]);
  });

  it("returns defaults when profile sections are missing", () => {
    expect(getOriginalSummary(null)).toBe("");
    expect(getOriginalHeadline(null)).toBe("");
    expect(getOriginalSkills(null)).toEqual([]);
  });
});

describe("computeSkillChanges", () => {
  it("flags added and removed keywords per category, case-insensitive", () => {
    const changes = computeSkillChanges(
      [{ name: "Backend", keywords: ["Node.js", "TypeScript", "Express"] }],
      [
        {
          id: "g1",
          name: "Backend",
          keywordsText: "node.js, TypeScript, Kubernetes",
        },
      ],
    );
    const change = changes.get("g1");
    expect(change?.added).toEqual(new Set(["kubernetes"]));
    expect(change?.removed).toEqual(["Express"]);
  });

  it("treats a brand-new category as entirely added", () => {
    const changes = computeSkillChanges(
      [],
      [{ id: "g1", name: "Cloud", keywordsText: "AWS, GCP" }],
    );
    expect(changes.get("g1")?.added).toEqual(new Set(["aws", "gcp"]));
    expect(changes.get("g1")?.removed).toEqual([]);
  });

  it("omits groups with no changes", () => {
    const changes = computeSkillChanges(
      [{ name: "Backend", keywords: ["Node.js"] }],
      [{ id: "g1", name: "Backend", keywordsText: "Node.js" }],
    );
    expect(changes.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { isJobDeadlinePassed, parseJobDeadline } from "./job-deadline";

describe("parseJobDeadline", () => {
  it("parses ISO dates", () => {
    expect(parseJobDeadline("2026-05-29")).toEqual(new Date(2026, 4, 29));
    expect(parseJobDeadline("2026/5/9")).toEqual(new Date(2026, 4, 9));
    expect(parseJobDeadline("2026-05-29T23:00:00Z")).toEqual(
      new Date(2026, 4, 29),
    );
    expect(parseJobDeadline("2026-05-29 12:00")).toEqual(new Date(2026, 4, 29));
  });

  it("parses day-first numeric dates", () => {
    expect(parseJobDeadline("29/06/2026")).toEqual(new Date(2026, 5, 29));
    expect(parseJobDeadline("9-6-2026")).toEqual(new Date(2026, 5, 9));
    expect(parseJobDeadline("29.06.2026")).toEqual(new Date(2026, 5, 29));
  });

  it("parses textual UK-style dates with optional ordinals", () => {
    expect(parseJobDeadline("29th June, 2026")).toEqual(new Date(2026, 5, 29));
    expect(parseJobDeadline("1st march 2027")).toEqual(new Date(2027, 2, 1));
    expect(parseJobDeadline("22 Jun 2026")).toEqual(new Date(2026, 5, 22));
    expect(parseJobDeadline("June 29, 2026")).toEqual(new Date(2026, 5, 29));
    expect(parseJobDeadline("Jun 29th 2026")).toEqual(new Date(2026, 5, 29));
  });

  it("returns null for non-date sentinels", () => {
    expect(parseJobDeadline("Ongoing")).toBeNull();
    expect(parseJobDeadline("ASAP")).toBeNull();
    expect(parseJobDeadline("Until filled")).toBeNull();
    expect(parseJobDeadline("TBC")).toBeNull();
  });

  it("returns null for empty or unparseable values", () => {
    expect(parseJobDeadline(null)).toBeNull();
    expect(parseJobDeadline(undefined)).toBeNull();
    expect(parseJobDeadline("")).toBeNull();
    expect(parseJobDeadline("   ")).toBeNull();
    expect(parseJobDeadline("apply soon")).toBeNull();
    expect(parseJobDeadline("Notamonth 12 2026")).toBeNull();
  });

  it("rejects impossible or out-of-range dates", () => {
    expect(parseJobDeadline("2026-02-31")).toBeNull();
    expect(parseJobDeadline("31/02/2026")).toBeNull();
    expect(parseJobDeadline("1899-01-01")).toBeNull();
    expect(parseJobDeadline("2200-01-01")).toBeNull();
  });
});

describe("isJobDeadlinePassed", () => {
  const now = new Date(2026, 5, 11, 12, 0, 0); // 11 June 2026 noon

  it("treats past deadlines as passed", () => {
    expect(isJobDeadlinePassed("2026-06-10", now)).toBe(true);
    expect(isJobDeadlinePassed("9th June, 2026", now)).toBe(true);
    expect(isJobDeadlinePassed("01/01/2026", now)).toBe(true);
  });

  it("keeps the deadline day itself open", () => {
    expect(isJobDeadlinePassed("2026-06-11", now)).toBe(false);
  });

  it("treats future deadlines as open", () => {
    expect(isJobDeadlinePassed("2026-06-12", now)).toBe(false);
    expect(isJobDeadlinePassed("29th June, 2026", now)).toBe(false);
  });

  it("never reports passed for missing or unparseable deadlines", () => {
    expect(isJobDeadlinePassed(null, now)).toBe(false);
    expect(isJobDeadlinePassed("Ongoing", now)).toBe(false);
    expect(isJobDeadlinePassed("apply soon", now)).toBe(false);
  });
});

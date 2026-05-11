import { describe, expect, it } from "vitest";
import { parseSalary } from "./salary-parser";

describe("parseSalary", () => {
  it("parses up to X zl/mth", () => {
    const r = parseSalary("up to 26000 zł/mth.");
    expect(r).toMatchObject({ maxAmount: 26000, minAmount: null, currency: "PLN", interval: "month", monthlyMaxPLN: 26000 });
  });

  it("parses up to X zl/hr", () => {
    const r = parseSalary("up to 180 zł/hr.");
    expect(r).toMatchObject({ maxAmount: 180, currency: "PLN", interval: "hour", monthlyMaxPLN: 180 * 168 });
  });

  it("parses up to X zl/godz", () => {
    const r = parseSalary("up to 50 zł/godz.");
    expect(r).toMatchObject({ maxAmount: 50, currency: "PLN", interval: "hour", monthlyMaxPLN: 50 * 168 });
  });

  it("parses PLN range no interval → infers monthly", () => {
    const r = parseSalary("15000 - 22000 PLN");
    expect(r).toMatchObject({ minAmount: 15000, maxAmount: 22000, currency: "PLN", interval: "month" });
  });

  it("parses PLN range with space thousands separator", () => {
    const r = parseSalary("15 000 – 22 000 PLN net");
    expect(r).toMatchObject({ minAmount: 15000, maxAmount: 22000, currency: "PLN" });
  });

  it("parses EUR range and converts to PLN", () => {
    const r = parseSalary("1500 - 2200 EUR");
    expect(r).toMatchObject({ minAmount: 1500, maxAmount: 2200, currency: "EUR", interval: "month" });
    expect(r?.monthlyMinPLN).toBe(Math.round(1500 * 4.3));
    expect(r?.monthlyMaxPLN).toBe(Math.round(2200 * 4.3));
  });

  it("returns null when no currency", () => {
    expect(parseSalary("15000 - 22000")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSalary("")).toBeNull();
  });

  it("returns null for whitespace", () => {
    expect(parseSalary("   ")).toBeNull();
  });

  it("parses USD range", () => {
    const r = parseSalary("$5000 - $7000");
    expect(r).toMatchObject({ currency: "USD", minAmount: 5000, maxAmount: 7000 });
  });

  it("parses GBP monthly", () => {
    const r = parseSalary("£3000/month");
    expect(r).toMatchObject({ currency: "GBP", interval: "month", minAmount: 3000, monthlyMinPLN: Math.round(3000 * 5.1) });
  });

  it("parses EUR symbol range", () => {
    const r = parseSalary("€2000 - €3000");
    expect(r).toMatchObject({ currency: "EUR" });
  });

  it("parses annual EUR divides by 12", () => {
    const r = parseSalary("60000 EUR/year");
    expect(r).toMatchObject({ currency: "EUR", interval: "year", minAmount: 60000 });
    expect(r?.monthlyMinPLN).toBe(Math.round((60000 / 12) * 4.3));
  });

  it("parses hourly PLN small amount", () => {
    const r = parseSalary("40 zł/hr.");
    expect(r).toMatchObject({ currency: "PLN", interval: "hour", minAmount: 40, monthlyMinPLN: 40 * 168 });
  });

  it("parses up to max EUR", () => {
    const r = parseSalary("up to 5000 EUR");
    expect(r).toMatchObject({ maxAmount: 5000, minAmount: null, currency: "EUR" });
  });

  it("parses comma thousands separator", () => {
    const r = parseSalary("10,000 - 15,000 PLN");
    expect(r).toMatchObject({ minAmount: 10000, maxAmount: 15000 });
  });

  it("parses monthly keyword", () => {
    const r = parseSalary("8000 PLN monthly");
    expect(r).toMatchObject({ interval: "month" });
  });

  it("parses annual keyword and normalizes", () => {
    const r = parseSalary("96000 PLN annual");
    expect(r).toMatchObject({ interval: "year", minAmount: 96000, monthlyMinPLN: 96000 / 12 });
  });

  it("parses Polish do keyword", () => {
    const r = parseSalary("do 20000 PLN");
    expect(r).toMatchObject({ maxAmount: 20000, minAmount: null });
  });

  it("infers monthly for large PLN amount", () => {
    const r = parseSalary("12000 PLN");
    expect(r).toMatchObject({ interval: "month", monthlyMinPLN: 12000 });
  });
});

import { FX_RATES, type Currency } from "./fx-rates";

export interface ParsedSalary {
  minAmount: number | null;
  maxAmount: number | null;
  currency: string | null;
  interval: "hour" | "month" | "year" | null;
  monthlyMinPLN: number | null;
  monthlyMaxPLN: number | null;
}

const HOURS_PER_MONTH = 168;

function detectCurrency(text: string): Currency | null {
  const t = text.toLowerCase();
  if (t.includes("zloty") || t.includes("złoty") || t.includes("zł") || t.includes("pln")) return "PLN";
  if (t.includes("€") || t.includes("eur")) return "EUR";
  if (t.includes("£") || t.includes("gbp")) return "GBP";
  if (t.includes("$") || t.includes("usd")) return "USD";
  return null;
}

function detectInterval(text: string): "hour" | "month" | "year" | null {
  const t = text.toLowerCase();
  if (/\/godz|\/hr|\/h\b|\bhourly\b|\bper hour\b/.test(t)) return "hour";
  if (/\/mth|\/month|\/mies|\bmonthly\b/.test(t)) return "month";
  if (/\/year|\/yr|\bannual\b|\byearly\b/.test(t)) return "year";
  return null;
}

function extractNumbers(text: string): number[] {
  const cleaned = text
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/(\d) (\d{3})/g, "$1$2")
    .replace(/(\d) (\d{3})/g, "$1$2");
  return (cleaned.match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter((n) => n > 0);
}

function inferInterval(amount: number, currency: Currency): "hour" | "month" | "year" {
  if (currency === "PLN") return amount >= 800 ? "month" : "hour";
  return amount >= 500 ? "month" : "hour";
}

function toMonthlyPLN(amount: number, currency: Currency, interval: "hour" | "month" | "year"): number {
  let monthly = amount;
  if (interval === "hour") monthly = amount * HOURS_PER_MONTH;
  else if (interval === "year") monthly = amount / 12;
  return Math.round(monthly * FX_RATES[currency]);
}

export function parseSalary(raw: string): ParsedSalary | null {
  if (!raw || raw.trim() === "") return null;

  const currency = detectCurrency(raw);
  if (!currency) return null;

  let interval = detectInterval(raw);
  const isMaxOnly = /\b(up to|do)\b/i.test(raw);

  const nums = extractNumbers(raw);
  if (nums.length === 0) return null;

  let minAmount: number | null = null;
  let maxAmount: number | null = null;

  if (isMaxOnly) {
    maxAmount = nums[0] ?? null;
  } else if (nums.length >= 2) {
    minAmount = nums[0];
    maxAmount = nums[1];
  } else {
    minAmount = nums[0] ?? null;
  }

  const refAmount = minAmount ?? maxAmount;
  if (!interval && refAmount != null) {
    interval = inferInterval(refAmount, currency);
  }

  const calc = (amount: number | null): number | null => {
    if (amount == null || !interval) return null;
    return toMonthlyPLN(amount, currency, interval as "hour" | "month" | "year");
  };

  return {
    minAmount,
    maxAmount,
    currency,
    interval,
    monthlyMinPLN: calc(minAmount),
    monthlyMaxPLN: calc(maxAmount),
  };
}

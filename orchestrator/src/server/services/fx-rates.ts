// FX rates as of 2026-05-01 — update periodically
export const FX_RATES = {
  EUR: 4.30,
  USD: 4.05,
  GBP: 5.10,
  PLN: 1.00,
} as const;

export type Currency = keyof typeof FX_RATES;

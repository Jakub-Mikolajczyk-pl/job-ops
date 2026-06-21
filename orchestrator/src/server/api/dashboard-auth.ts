import { timingSafeEqual } from "node:crypto";
import { serviceUnavailable, unauthorized } from "@infra/errors";
import { fail } from "@infra/http";
import type { Request, Response } from "express";

export function requireDashboardToken(
  req: Request,
  res: Response,
): { ok: true; token: string } | { ok: false } {
  const expectedToken = process.env.JOBOPS_DASHBOARD_TOKEN?.trim();
  if (!expectedToken) {
    fail(res, serviceUnavailable("Dashboard token is not configured"));
    return { ok: false };
  }

  if (!hasValidBearerToken(req, expectedToken)) {
    fail(res, unauthorized());
    return { ok: false };
  }

  return { ok: true, token: expectedToken };
}

export function hasValidBearerToken(
  req: Request,
  expectedToken: string,
): boolean {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const actualToken = authHeader.slice("Bearer ".length).trim();
  return constantTimeEquals(actualToken, expectedToken);
}

export function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

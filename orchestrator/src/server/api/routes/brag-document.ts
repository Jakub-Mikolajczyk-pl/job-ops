import { badRequest } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import * as settingsRepo from "@server/repositories/settings";
import {
  getBragDocumentStatus,
  setBragDocumentSource,
  syncBragDocument,
} from "@server/services/brag-document";
import { Router } from "express";
import { z } from "zod";

export const bragDocumentRouter = Router();

const sourceSchema = z.object({
  sourceUrl: z.string().trim().max(2000).nullable().optional(),
  token: z.string().trim().max(2000).nullable().optional(),
});

bragDocumentRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const status = await getBragDocumentStatus();
    ok(res, { bragDocument: status });
  }),
);

bragDocumentRouter.put(
  "/source",
  asyncRoute(async (req, res) => {
    const parsed = sourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, badRequest("Invalid input", parsed.error.flatten()));
    }
    if (parsed.data.sourceUrl !== undefined) {
      await setBragDocumentSource(parsed.data.sourceUrl ?? null);
    }
    if (parsed.data.token !== undefined) {
      const token = parsed.data.token?.trim();
      await settingsRepo.setSetting("bragDocSourceToken", token ? token : null);
    }
    const status = await getBragDocumentStatus();
    ok(res, { bragDocument: status });
  }),
);

bragDocumentRouter.post(
  "/sync",
  asyncRoute(async (_req, res) => {
    const status = await syncBragDocument();
    ok(res, { bragDocument: status });
  }),
);

import { badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import * as repo from "@server/repositories/saved-searches";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const savedSearchesRouter = Router();

const querySchema = z.object({
  status: z.string().optional(),
  source: z.string().optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  keywords: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  query: querySchema,
  notifyTelegram: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  query: querySchema.optional(),
  notifyTelegram: z.boolean().optional(),
});

savedSearchesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const searches = await repo.listSavedSearches();
    ok(res, { searches });
  } catch (error) {
    fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
  }
});

savedSearchesRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, badRequest("Invalid input", parsed.error.flatten()));
  try {
    const search = await repo.createSavedSearch(parsed.data);
    ok(res, search);
  } catch (error) {
    fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
  }
});

savedSearchesRouter.put("/:id", async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, badRequest("Invalid input", parsed.error.flatten()));
  try {
    const search = await repo.updateSavedSearch(req.params.id, parsed.data);
    if (!search) return fail(res, notFound("Saved search not found"));
    ok(res, search);
  } catch (error) {
    fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
  }
});

savedSearchesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await repo.deleteSavedSearch(req.params.id);
    ok(res, { deleted: true });
  } catch (error) {
    fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
  }
});

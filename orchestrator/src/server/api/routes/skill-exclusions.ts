import { badRequest } from "@infra/errors";
import { fail, ok } from "@infra/http";
import * as repo from "@server/repositories/skill-exclusions";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const skillExclusionsRouter = Router();

const addSchema = z.object({
  skill: z.string().min(1).max(100),
  reason: z.string().max(200).optional(),
});

skillExclusionsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const exclusions = await repo.getSkillExclusions();
    ok(res, { exclusions });
  } catch (error) {
    fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
  }
});

skillExclusionsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, badRequest("Invalid input", parsed.error.flatten()));
  try {
    await repo.addSkillExclusion(parsed.data.skill, parsed.data.reason);
    ok(res, { ok: true });
  } catch (error) {
    fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
  }
});

skillExclusionsRouter.delete("/:skill", async (req: Request, res: Response) => {
  const skill = req.params.skill?.trim();
  if (!skill) return fail(res, badRequest("skill is required"));
  try {
    await repo.removeSkillExclusion(skill);
    ok(res, { ok: true });
  } catch (error) {
    fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
  }
});

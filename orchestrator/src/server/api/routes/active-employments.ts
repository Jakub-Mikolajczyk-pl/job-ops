import { badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import * as repo from "@server/repositories/active-employments";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const activeEmploymentsRouter = Router();

const createSchema = z.object({
  jobId: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(50),
  employer: z.string().min(1).max(200),
  startedAt: z.string().min(1),
  endedAt: z.string().nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
  coreHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  coreHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  monthlyGrossPLN: z.number().positive().nullable().optional(),
  hourlyRatePLN: z.number().positive().nullable().optional(),
  monthlyHours: z.number().int().min(1).max(400).nullable().optional(),
  weeklyHoursBudget: z.number().int().min(1).max(80).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const updateSchema = createSchema.partial().omit({ jobId: true });

activeEmploymentsRouter.get("/", async (_req: Request, res: Response) => {
  const employments = await repo.listActiveEmployments();
  const stack = await repo.getSalaryStack();
  ok(res, { employments, stack });
});

activeEmploymentsRouter.get(
  "/salary-stack",
  async (_req: Request, res: Response) => {
    const stack = await repo.getSalaryStack();
    ok(res, { stack });
  },
);

activeEmploymentsRouter.get("/:id", async (req: Request, res: Response) => {
  const employment = await repo.getActiveEmploymentById(req.params.id);
  if (!employment) return fail(res, notFound("Employment not found"));
  ok(res, { employment });
});

activeEmploymentsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    return fail(res, badRequest("Invalid input", parsed.error.flatten()));
  const employment = await repo.createActiveEmployment(parsed.data);
  ok(res, { employment });
});

activeEmploymentsRouter.patch("/:id", async (req: Request, res: Response) => {
  const existing = await repo.getActiveEmploymentById(req.params.id);
  if (!existing) return fail(res, notFound("Employment not found"));
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success)
    return fail(res, badRequest("Invalid input", parsed.error.flatten()));
  const employment = await repo.updateActiveEmployment(
    req.params.id,
    parsed.data,
  );
  ok(res, { employment });
});

activeEmploymentsRouter.delete("/:id", async (req: Request, res: Response) => {
  const deleted = await repo.deleteActiveEmployment(req.params.id);
  if (!deleted) return fail(res, notFound("Employment not found"));
  ok(res, { deleted: true });
});

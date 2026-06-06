/**
 * Task action-point routes — the "Your move" surface (RECRUITMENT_TASKS.md R3).
 *   GET  /api/tasks/your-move      → bucketed open tasks + needs-review intakes
 *   POST /api/tasks/:id/complete   → mark a task done
 *   POST /api/tasks/:id/snooze     → push the due date out by N days
 */

import { badRequest, notFound, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import * as tasksRepo from "@server/repositories/tasks";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const tasksRouter = Router();

tasksRouter.get("/your-move", async (_req: Request, res: Response) => {
  try {
    const data = await tasksRepo.getYourMove();
    ok(res, data);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

tasksRouter.post("/:id/complete", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) return fail(res, badRequest("Missing task id"));
  try {
    const done = await tasksRepo.completeTask(id);
    if (!done) return fail(res, notFound("Task not found"));
    ok(res, { id, isCompleted: true });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

const snoozeSchema = z.object({ days: z.number().int().min(1).max(30) });

tasksRouter.post("/:id/snooze", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) return fail(res, badRequest("Missing task id"));
  const parsed = snoozeSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(
      res,
      badRequest("Invalid snooze payload", parsed.error.flatten()),
    );
  }
  try {
    const dueDate = await tasksRepo.snoozeTask(id, parsed.data.days);
    if (dueDate === null) return fail(res, notFound("Task not found"));
    ok(res, { id, dueDate });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

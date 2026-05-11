import { badRequest } from "@infra/errors";
import { fail, ok } from "@infra/http";
import * as repo from "@server/repositories/skill-watchlist";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const skillWatchlistRouter = Router();

const addSchema = z.object({
	skill: z.string().min(1).max(100),
	label: z.string().max(100).optional(),
	titlePattern: z.string().max(200).optional(),
	notes: z.string().max(500).optional(),
});

skillWatchlistRouter.get("/", async (_req: Request, res: Response) => {
	try {
		const result = await repo.getWatchlist();
		ok(res, result);
	} catch (error) {
		fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
	}
});

skillWatchlistRouter.post("/", async (req: Request, res: Response) => {
	const parsed = addSchema.safeParse(req.body);
	if (!parsed.success)
		return fail(res, badRequest("Invalid input", parsed.error.flatten()));
	try {
		await repo.addWatchlistEntry(parsed.data);
		ok(res, { ok: true });
	} catch (error) {
		fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
	}
});

skillWatchlistRouter.delete("/:skill", async (req: Request, res: Response) => {
	const skill = req.params.skill?.trim();
	if (!skill) return fail(res, badRequest("skill is required"));
	try {
		await repo.removeWatchlistEntry(skill);
		ok(res, { ok: true });
	} catch (error) {
		fail(res, { status: 500, code: "INTERNAL_ERROR", message: String(error) });
	}
});

skillWatchlistRouter.post(
	"/mark-seen",
	async (_req: Request, res: Response) => {
		try {
			await repo.markAllSeen();
			ok(res, { ok: true });
		} catch (error) {
			fail(res, {
				status: 500,
				code: "INTERNAL_ERROR",
				message: String(error),
			});
		}
	},
);

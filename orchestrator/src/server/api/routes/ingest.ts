/**
 * POST /api/ingest — single entry point for inbound recruitment material
 * (Telegram bot, watched folder, Hidock transcripts, Notion migration).
 * Stores a raw_intake row for the R2 worker to extract. Capture is
 * decoupled from extraction: this endpoint only persists + dedups.
 * See RECRUITMENT_TASKS.md R1/R3/R4/R5.
 */

import { createHash } from "node:crypto";
import { AppError, badRequest, conflict, notFound } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { requireDashboardToken } from "@server/api/dashboard-auth";
import * as jobsRepo from "@server/repositories/jobs";
import * as intakeRepo from "@server/repositories/recruitmentIntake";
import {
	processIntake,
	processPending,
} from "@server/services/recruitment-intake";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import {
	RECRUITMENT_INTAKE_KINDS,
	RECRUITMENT_INTAKE_SOURCES,
	type RecruitmentIntakeKind,
	type RecruitmentIntakeSource,
} from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const ingestRouter = Router();

const ingestSchema = z.object({
	source: z.string().refine(
		(v): v is RecruitmentIntakeSource =>
			(RECRUITMENT_INTAKE_SOURCES as readonly string[]).includes(v),
		{ message: "Unknown source" },
	),
	kind: z.string().refine(
		(v): v is RecruitmentIntakeKind =>
			(RECRUITMENT_INTAKE_KINDS as readonly string[]).includes(v),
		{ message: "Unknown kind" },
	),
	text: z.string().trim().min(1).max(200_000),
	meta: z.record(z.unknown()).optional(),
});

/**
 * Stable dedup key: normalize whitespace + case so the same material
 * arriving twice (Telegram + folder, or a retried POST) collapses to one row.
 */
function hashContent(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
	return createHash("sha256").update(normalized).digest("hex");
}

ingestRouter.get(
	"/dashboard",
	asyncRoute(async (req: Request, res: Response) => {
		const hasAuthenticatedUserBearer =
			(req.headers.authorization ?? "").startsWith("Bearer ");
		if (!hasAuthenticatedUserBearer) {
			const auth = requireDashboardToken(req, res);
			if (!auth.ok) return;
		}

		const tenantId =
			process.env.JOBOPS_DASHBOARD_TENANT_ID?.trim() || DEFAULT_TENANT_ID;

		return runWithRequestContext(
			{ tenantId, username: "dashboard" },
			async () => {
				const [items, counts, jobs] = await Promise.all([
					intakeRepo.listRecentForDashboard(),
					intakeRepo.getDashboardCounts(),
					jobsRepo.getRecruitmentJobs(),
				]);
				return ok(res, { items, counts, jobs });
			},
		);
	}),
);

ingestRouter.post("/", async (req: Request, res: Response) => {
	const parsed = ingestSchema.safeParse(req.body);
	if (!parsed.success) {
		return fail(res, badRequest("Invalid ingest payload", parsed.error.flatten()));
	}
	const { source, kind, text, meta } = parsed.data;
	const contentHash = hashContent(text);

	try {
		const existing = await intakeRepo.findByHash(contentHash);
		if (existing) {
			logger.info(`ingest deduped (${source}/${kind}): ${existing.id}`);
			return ok(res, { intakeId: existing.id, deduped: true });
		}
		const row = await intakeRepo.insertIntake({
			source,
			kind,
			rawText: text,
			contentHash,
			meta: meta ?? null,
		});
		logger.info(`ingest accepted (${source}/${kind}): ${row.id}`);
		return ok(res, { intakeId: row.id, deduped: false }, 201);
	} catch (error) {
		// Unique-hash race: a concurrent POST won the insert — resolve to dedup.
		const existing = await intakeRepo.findByHash(contentHash);
		if (existing) {
			return ok(res, { intakeId: existing.id, deduped: true });
		}
		logger.error(`ingest failed (${source}/${kind}): ${String(error)}`);
		return fail(
			res,
			new AppError({
				status: 500,
				code: "INTERNAL_ERROR",
				message: "Failed to record intake",
			}),
		);
	}
});

/**
 * Telegram webhook for the "JobOps Inbox" bot (RECRUITMENT_TASKS.md R4/O1).
 * Forward/paste a recruiter message → raw_intake. Verifies the secret header
 * Telegram echoes back (set via setWebhook ?secret_token=). Always 200s fast
 * so Telegram does not retry; extraction is the worker's job (R2).
 */
ingestRouter.post("/telegram", async (req: Request, res: Response) => {
	const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
	if (
		expected &&
		req.header("X-Telegram-Bot-Api-Secret-Token") !== expected
	) {
		return fail(
			res,
			new AppError({
				status: 403,
				code: "FORBIDDEN",
				message: "Invalid webhook secret",
			}),
		);
	}

	const update = req.body as {
		message?: { message_id?: number; chat?: { id?: number }; text?: string; caption?: string };
		channel_post?: { message_id?: number; chat?: { id?: number }; text?: string; caption?: string };
	};
	const msg = update?.message ?? update?.channel_post;
	const text = (msg?.text ?? msg?.caption ?? "").trim();
	if (!text) {
		// Non-text update (sticker, service message, etc.) — ack and ignore.
		return ok(res, { ignored: true });
	}

	const kind = /^https?:\/\/\S+$/.test(text) ? "job_post" : "note";
	const contentHash = hashContent(text);
	try {
		const existing = await intakeRepo.findByHash(contentHash);
		if (existing) {
			return ok(res, { intakeId: existing.id, deduped: true });
		}
		const row = await intakeRepo.insertIntake({
			source: "telegram",
			kind,
			rawText: text,
			contentHash,
			meta: { telegramMessageId: msg?.message_id, chatId: msg?.chat?.id },
		});
		logger.info(`telegram ingest (${kind}): ${row.id}`);
		return ok(res, { intakeId: row.id, deduped: false }, 201);
	} catch (error) {
		const existing = await intakeRepo.findByHash(contentHash);
		if (existing) return ok(res, { intakeId: existing.id, deduped: true });
		logger.error(`telegram ingest failed: ${String(error)}`);
		// Still 200 so Telegram doesn't hammer retries; surface in logs.
		return ok(res, { ignored: true, error: "record failed" });
	}
});

// Drain all pending intake rows through the extraction worker (R2).
ingestRouter.post("/process-pending", async (_req: Request, res: Response) => {
	try {
		const results = await processPending();
		return ok(res, { processed: results.length, results });
	} catch (error) {
		logger.error(`process-pending failed: ${String(error)}`);
		return fail(
			res,
			new AppError({
				status: 500,
				code: "INTERNAL_ERROR",
				message: "Failed to process pending intake",
			}),
		);
	}
});

/**
 * Process a single intake row by id (manual trigger). Re-arms a stuck row
 * (`error` / `needs_review`) so the worker retries it; pass `{ force: true }`
 * to also re-run an already-`processed` row.
 */
ingestRouter.post("/:id/process", async (req: Request, res: Response) => {
	const id = req.params.id;
	if (!id) return fail(res, badRequest("Missing intake id"));
	const force = (req.body as { force?: unknown })?.force === true;
	try {
		const row = await intakeRepo.getById(id);
		if (!row) return fail(res, notFound("Intake not found"));
		if (
			row.status === "error" ||
			row.status === "needs_review" ||
			(force && row.status === "processed")
		) {
			await intakeRepo.resetForReprocess(id);
		}
		const result = await processIntake(id);
		return ok(res, result);
	} catch (error) {
		logger.error(`process intake failed (${id}): ${String(error)}`);
		return fail(
			res,
			new AppError({
				status: 500,
				code: "INTERNAL_ERROR",
				message: "Failed to process intake",
			}),
		);
	}
});

const patchSchema = z.object({
	rawText: z.string().trim().min(1).max(200_000),
});

/** Fetch one intake row in full (raw text) — backs the dashboard edit modal. */
ingestRouter.get("/:id", async (req: Request, res: Response) => {
	const id = req.params.id;
	if (!id) return fail(res, badRequest("Missing intake id"));
	try {
		const row = await intakeRepo.getById(id);
		if (!row) return fail(res, notFound("Intake not found"));
		return ok(res, {
			id: row.id,
			source: row.source,
			kind: row.kind,
			status: row.status,
			rawText: row.rawText,
			error: row.errorMessage ?? null,
			jobId: row.jobId ?? null,
			createdAt: row.createdAt,
		});
	} catch (error) {
		logger.error(`get intake failed (${id}): ${String(error)}`);
		return fail(
			res,
			new AppError({
				status: 500,
				code: "INTERNAL_ERROR",
				message: "Failed to load intake",
			}),
		);
	}
});

/** Edit a row's raw text and re-arm it for extraction (manual fix path). */
ingestRouter.patch("/:id", async (req: Request, res: Response) => {
	const id = req.params.id;
	if (!id) return fail(res, badRequest("Missing intake id"));
	const parsed = patchSchema.safeParse(req.body);
	if (!parsed.success) {
		return fail(res, badRequest("Invalid edit payload", parsed.error.flatten()));
	}
	try {
		const row = await intakeRepo.getById(id);
		if (!row) return fail(res, notFound("Intake not found"));
		const contentHash = hashContent(parsed.data.rawText);
		const clash = await intakeRepo.findByHash(contentHash);
		if (clash && clash.id !== id) {
			return fail(
				res,
				conflict("Another intake row already has this exact text"),
			);
		}
		await intakeRepo.updateRawText(id, parsed.data.rawText, contentHash);
		logger.info(`intake edited, reset to pending: ${id}`);
		return ok(res, { intakeId: id, status: "pending" });
	} catch (error) {
		logger.error(`edit intake failed (${id}): ${String(error)}`);
		return fail(
			res,
			new AppError({
				status: 500,
				code: "INTERNAL_ERROR",
				message: "Failed to edit intake",
			}),
		);
	}
});

/** Delete an intake row (junk / bot noise / unwanted duplicate). */
ingestRouter.delete("/:id", async (req: Request, res: Response) => {
	const id = req.params.id;
	if (!id) return fail(res, badRequest("Missing intake id"));
	try {
		const row = await intakeRepo.getById(id);
		if (!row) return fail(res, notFound("Intake not found"));
		await intakeRepo.deleteIntake(id);
		logger.info(`intake deleted: ${id}`);
		return ok(res, { intakeId: id, deleted: true });
	} catch (error) {
		logger.error(`delete intake failed (${id}): ${String(error)}`);
		return fail(
			res,
			new AppError({
				status: 500,
				code: "INTERNAL_ERROR",
				message: "Failed to delete intake",
			}),
		);
	}
});

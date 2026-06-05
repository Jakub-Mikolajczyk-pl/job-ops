/**
 * POST /api/ingest — single entry point for inbound recruitment material
 * (Telegram bot, watched folder, Hidock transcripts, Notion migration).
 * Stores a raw_intake row for the R2 worker to extract. Capture is
 * decoupled from extraction: this endpoint only persists + dedups.
 * See RECRUITMENT_TASKS.md R1/R3/R4/R5.
 */

import { createHash } from "node:crypto";
import { badRequest } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import * as intakeRepo from "@server/repositories/recruitmentIntake";
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
		return fail(res, {
			status: 500,
			code: "INTERNAL_ERROR",
			message: "Failed to record intake",
		});
	}
});

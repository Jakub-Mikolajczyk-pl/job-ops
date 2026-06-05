/**
 * Repository for the recruitment intake pipeline (raw_intake).
 * See RECRUITMENT_TASKS.md R1/R2. Single source of truth for inbound
 * recruiter material before it is extracted into jobs/tasks/interviews.
 */

import { randomUUID } from "node:crypto";
import type {
	RecruitmentIntakeKind,
	RecruitmentIntakeSource,
	RecruitmentIntakeStatus,
} from "@shared/types";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getActiveTenantId } from "../tenancy/context";

const { rawIntake } = schema;

export type RawIntakeRow = typeof rawIntake.$inferSelect;

export interface InsertIntakeInput {
	source: RecruitmentIntakeSource;
	kind: RecruitmentIntakeKind;
	rawText: string;
	contentHash: string;
	meta?: Record<string, unknown> | null;
}

export async function getById(id: string): Promise<RawIntakeRow | undefined> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select()
		.from(rawIntake)
		.where(and(eq(rawIntake.id, id), eq(rawIntake.tenantId, tenantId)))
		.limit(1);
	return rows[0];
}

export async function findByHash(
	contentHash: string,
): Promise<RawIntakeRow | undefined> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select()
		.from(rawIntake)
		.where(
			and(
				eq(rawIntake.tenantId, tenantId),
				eq(rawIntake.contentHash, contentHash),
			),
		)
		.limit(1);
	return rows[0];
}

export async function insertIntake(
	input: InsertIntakeInput,
): Promise<RawIntakeRow> {
	const tenantId = getActiveTenantId();
	const [row] = await db
		.insert(rawIntake)
		.values({
			id: randomUUID(),
			tenantId,
			source: input.source,
			kind: input.kind,
			rawText: input.rawText,
			contentHash: input.contentHash,
			meta: input.meta ?? null,
			status: "pending",
		})
		.returning();
	return row;
}

export async function listPending(limit = 50): Promise<RawIntakeRow[]> {
	const tenantId = getActiveTenantId();
	return db
		.select()
		.from(rawIntake)
		.where(
			and(eq(rawIntake.tenantId, tenantId), eq(rawIntake.status, "pending")),
		)
		.limit(limit);
}

export async function markStatus(
	id: string,
	status: RecruitmentIntakeStatus,
	patch: { jobId?: string | null; errorMessage?: string | null } = {},
): Promise<void> {
	const tenantId = getActiveTenantId();
	await db
		.update(rawIntake)
		.set({
			status,
			processedAt:
				status === "processed" || status === "error"
					? new Date().toISOString()
					: null,
			...(patch.jobId !== undefined ? { jobId: patch.jobId } : {}),
			...(patch.errorMessage !== undefined
				? { errorMessage: patch.errorMessage }
				: {}),
		})
		.where(and(eq(rawIntake.id, id), eq(rawIntake.tenantId, tenantId)));
}

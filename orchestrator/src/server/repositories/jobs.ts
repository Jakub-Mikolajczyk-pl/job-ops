/**
 * Job repository - data access layer for jobs.
 */

import { randomUUID } from "node:crypto";
import { buildLocationEvidence } from "@shared/location-domain.js";
import type {
	CreateJobInput,
	CreateJobNoteInput,
	Job,
	JobListItem,
	JobLocationEvidence,
	JobNote,
	JobPdfFreshness,
	JobPdfSource,
	JobStatus,
	JobsRevisionResponse,
	UpdateJobInput,
	UpdateJobNoteInput,
} from "@shared/types";
import type {
	LocationEvidence,
	LocationEvidenceEntry,
} from "@shared/types/location";
import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	sql,
} from "drizzle-orm";
import { db, schema } from "../db/index";
import { canonicalizeLocation } from "../services/location-canonicalizer";
import { parseSalary } from "../services/salary-parser";
import { getActiveTenantId } from "../tenancy/context";
import { getSkillExclusions } from "./skill-exclusions";

const { jobNotes, jobs, designResumeDocuments } = schema;

type AppliedDuplicateMatchCandidate = {
	id: string;
	title: string;
	employer: string;
	status: Extract<JobStatus, "applied" | "in_progress">;
	appliedAt: string;
	discoveredAt: string;
};

export type JobListItemWithPdfFreshnessInput = JobListItem &
	Pick<
		Job,
		| "pdfPath"
		| "pdfSource"
		| "pdfFingerprint"
		| "tailoredSummary"
		| "tailoredHeadline"
		| "tailoredSkills"
		| "selectedProjectIds"
		| "jobDescription"
		| "jobBrief"
		| "tracerLinksEnabled"
	>;

function normalizeStatusFilter(statuses?: JobStatus[]): string | null {
	if (!statuses || statuses.length === 0) return null;
	return Array.from(new Set(statuses)).sort().join(",");
}

function parseLocationEvidence(
	raw: string | null | undefined,
): JobLocationEvidence | null {
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		return buildLocationEvidence(
			Array.isArray(parsed)
				? (parsed as readonly LocationEvidenceEntry[])
				: (parsed as LocationEvidence),
		);
	} catch {
		return null;
	}
}

function serializeLocationEvidence(
	evidence: JobLocationEvidence | null | undefined,
): string | null {
	if (!evidence) return null;
	return JSON.stringify(buildLocationEvidence(evidence));
}

/**
 * Get all jobs, optionally filtered by status.
 */
export async function getAllJobs(statuses?: JobStatus[]): Promise<Job[]> {
	const tenantId = getActiveTenantId();
	const query =
		statuses && statuses.length > 0
			? db
					.select()
					.from(jobs)
					.where(
						and(eq(jobs.tenantId, tenantId), inArray(jobs.status, statuses)),
					)
					.orderBy(desc(jobs.discoveredAt))
			: db
					.select()
					.from(jobs)
					.where(eq(jobs.tenantId, tenantId))
					.orderBy(desc(jobs.discoveredAt));

	const rows = await query;
	return rows.map(mapRowToJob);
}

/**
 * Get lightweight list items for jobs, optionally filtered by status.
 */
export async function getJobListItems(
	statuses?: JobStatus[],
): Promise<JobListItemWithPdfFreshnessInput[]> {
	const tenantId = getActiveTenantId();
	const selection = {
		id: jobs.id,
		source: jobs.source,
		title: jobs.title,
		employer: jobs.employer,
		jobUrl: jobs.jobUrl,
		applicationLink: jobs.applicationLink,
		datePosted: jobs.datePosted,
		deadline: jobs.deadline,
		salary: jobs.salary,
		location: jobs.location,
		status: jobs.status,
		outcome: jobs.outcome,
		closedAt: jobs.closedAt,
		suitabilityScore: jobs.suitabilityScore,
		sponsorMatchScore: jobs.sponsorMatchScore,
		oeFitnessScore: jobs.oeFitnessScore,
		oeFitnessReasons: jobs.oeFitnessReasons,
		redFlags: jobs.redFlags,
		asyncScore: jobs.asyncScore,
		asyncSignals: jobs.asyncSignals,
		weeklyHoursEstimate: jobs.weeklyHoursEstimate,
		weeklyHoursReasons: jobs.weeklyHoursReasons,
		pdfPath: jobs.pdfPath,
		pdfSource: jobs.pdfSource,
		pdfRegenerating: jobs.pdfRegenerating,
		pdfFingerprint: jobs.pdfFingerprint,
		tailoredSummary: jobs.tailoredSummary,
		tailoredHeadline: jobs.tailoredHeadline,
		tailoredSkills: jobs.tailoredSkills,
		selectedProjectIds: jobs.selectedProjectIds,
		jobDescription: jobs.jobDescription,
		jobBrief: jobs.jobBrief,
		tracerLinksEnabled: jobs.tracerLinksEnabled,
		jobType: jobs.jobType,
		jobFunction: jobs.jobFunction,
		salaryMinAmount: jobs.salaryMinAmount,
		salaryMaxAmount: jobs.salaryMaxAmount,
		salaryCurrency: jobs.salaryCurrency,
		discoveredAt: jobs.discoveredAt,
		readyAt: jobs.readyAt,
		appliedAt: jobs.appliedAt,
		updatedAt: jobs.updatedAt,
	} as const;

	const query =
		statuses && statuses.length > 0
			? db
					.select(selection)
					.from(jobs)
					.where(
						and(eq(jobs.tenantId, tenantId), inArray(jobs.status, statuses)),
					)
					.orderBy(desc(jobs.discoveredAt))
			: db
					.select(selection)
					.from(jobs)
					.where(eq(jobs.tenantId, tenantId))
					.orderBy(desc(jobs.discoveredAt));

	const rows = await query;
	return rows.map((row) => {
		return {
			...row,
			source: row.source as JobListItem["source"],
			status: row.status as JobStatus,
			pdfSource: row.pdfSource as JobPdfSource | null,
			pdfRegenerating: row.pdfRegenerating ?? false,
			pdfFreshness: row.pdfRegenerating
				? "regenerating"
				: row.pdfSource === "uploaded"
					? "uploaded"
					: row.pdfPath
						? "stale"
						: ("missing" as JobPdfFreshness),
			tracerLinksEnabled: row.tracerLinksEnabled ?? false,
		};
	});
}

export async function getAppliedDuplicateMatchCandidates(): Promise<
	AppliedDuplicateMatchCandidate[]
> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select({
			id: jobs.id,
			title: jobs.title,
			employer: jobs.employer,
			status: jobs.status,
			appliedAt: jobs.appliedAt,
			discoveredAt: jobs.discoveredAt,
		})
		.from(jobs)
		.where(
			and(
				inArray(jobs.status, ["applied", "in_progress"]),
				eq(jobs.tenantId, tenantId),
				sql`${jobs.appliedAt} IS NOT NULL`,
			),
		)
		.orderBy(desc(jobs.appliedAt));

	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		employer: row.employer,
		status: row.status as AppliedDuplicateMatchCandidate["status"],
		appliedAt: row.appliedAt as string,
		discoveredAt: row.discoveredAt,
	}));
}

/**
 * Get a lightweight revision token for jobs list invalidation.
 */
export async function getJobsRevision(
	statuses?: JobStatus[],
): Promise<JobsRevisionResponse> {
	const tenantId = getActiveTenantId();
	const statusFilter = normalizeStatusFilter(statuses);
	const whereClause =
		statuses && statuses.length > 0
			? and(eq(jobs.tenantId, tenantId), inArray(jobs.status, statuses))
			: eq(jobs.tenantId, tenantId);

	const baseQuery = db
		.select({
			latestUpdatedAt: sql<string | null>`max(${jobs.updatedAt})`,
			total: sql<number>`count(*)`,
		})
		.from(jobs);
	const [row] = await baseQuery.where(whereClause);

	const latestUpdatedAt = row?.latestUpdatedAt ?? null;
	const total = row?.total ?? 0;
	const revision = `${latestUpdatedAt ?? "none"}:${total}:${statusFilter ?? "all"}`;

	return {
		revision,
		latestUpdatedAt,
		total,
		statusFilter,
	};
}

/**
 * Get a single job by ID.
 */
export async function getJobById(id: string): Promise<Job | null> {
	const tenantId = getActiveTenantId();
	const [row] = await db
		.select()
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id)));
	return row ? mapRowToJob(row) : null;
}

export async function listJobNotes(jobId: string): Promise<JobNote[]> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select()
		.from(jobNotes)
		.where(and(eq(jobNotes.tenantId, tenantId), eq(jobNotes.jobId, jobId)))
		.orderBy(
			desc(jobNotes.updatedAt),
			desc(jobNotes.createdAt),
			desc(jobNotes.id),
		);

	return rows.map(mapRowToJobNote);
}

export async function listJobNotesByIds(
	jobId: string,
	noteIds: readonly string[],
): Promise<JobNote[]> {
	const normalizedNoteIds = Array.from(
		new Set(noteIds.map((noteId) => noteId.trim()).filter(Boolean)),
	);
	if (normalizedNoteIds.length === 0) return [];

	const tenantId = getActiveTenantId();
	const rows = await db
		.select()
		.from(jobNotes)
		.where(
			and(
				eq(jobNotes.tenantId, tenantId),
				eq(jobNotes.jobId, jobId),
				inArray(jobNotes.id, normalizedNoteIds),
			),
		);

	return rows.map(mapRowToJobNote);
}

export async function getJobNoteById(noteId: string): Promise<JobNote | null> {
	const tenantId = getActiveTenantId();
	const [row] = await db
		.select()
		.from(jobNotes)
		.where(and(eq(jobNotes.tenantId, tenantId), eq(jobNotes.id, noteId)));
	return row ? mapRowToJobNote(row) : null;
}

export async function getJobNoteForJob(
	jobId: string,
	noteId: string,
): Promise<JobNote | null> {
	const tenantId = getActiveTenantId();
	const [row] = await db
		.select()
		.from(jobNotes)
		.where(
			and(
				eq(jobNotes.tenantId, tenantId),
				eq(jobNotes.id, noteId),
				eq(jobNotes.jobId, jobId),
			),
		);
	return row ? mapRowToJobNote(row) : null;
}

export async function createJobNote(
	input: CreateJobNoteInput & { jobId: string },
): Promise<JobNote> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const tenantId = getActiveTenantId();

	await db.insert(jobNotes).values({
		id,
		tenantId,
		jobId: input.jobId,
		title: input.title,
		content: input.content,
		createdAt: now,
		updatedAt: now,
	});

	const note = await getJobNoteById(id);
	if (!note) {
		throw new Error(`Failed to retrieve newly created job note with ID ${id}`);
	}
	return note;
}

export async function updateJobNote(
	input: { jobId: string; noteId: string } & UpdateJobNoteInput,
): Promise<JobNote | null> {
	const now = new Date().toISOString();
	const tenantId = getActiveTenantId();

	await db
		.update(jobNotes)
		.set({
			title: input.title,
			content: input.content,
			updatedAt: now,
		})
		.where(
			and(
				eq(jobNotes.tenantId, tenantId),
				eq(jobNotes.id, input.noteId),
				eq(jobNotes.jobId, input.jobId),
			),
		);

	return getJobNoteForJob(input.jobId, input.noteId);
}

export async function deleteJobNote(input: {
	jobId: string;
	noteId: string;
}): Promise<number> {
	const tenantId = getActiveTenantId();
	const result = await db
		.delete(jobNotes)
		.where(
			and(
				eq(jobNotes.tenantId, tenantId),
				eq(jobNotes.id, input.noteId),
				eq(jobNotes.jobId, input.jobId),
			),
		);

	return result.changes;
}

export async function listJobSummariesByIds(jobIds: string[]): Promise<
	Array<{
		id: string;
		title: string;
		employer: string;
	}>
> {
	if (jobIds.length === 0) return [];
	const tenantId = getActiveTenantId();

	return db
		.select({
			id: jobs.id,
			title: jobs.title,
			employer: jobs.employer,
		})
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), inArray(jobs.id, jobIds)));
}

/**
 * Get a job by its URL (for deduplication).
 */
export async function getJobByUrl(jobUrl: string): Promise<Job | null> {
	const tenantId = getActiveTenantId();
	const [row] = await db
		.select()
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), eq(jobs.jobUrl, jobUrl)));
	return row ? mapRowToJob(row) : null;
}

/**
 * Get all known job URLs (for deduplication / crawler optimizations).
 */
export async function getAllJobUrls(): Promise<string[]> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select({ jobUrl: jobs.jobUrl })
		.from(jobs)
		.where(eq(jobs.tenantId, tenantId));
	return rows.map((r) => r.jobUrl);
}

async function insertJob(input: CreateJobInput): Promise<Job> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const tenantId = getActiveTenantId();

	await db.insert(jobs).values({
		id,
		tenantId,
		source: input.source,
		sourceJobId: input.sourceJobId ?? null,
		jobUrlDirect: input.jobUrlDirect ?? null,
		datePosted: input.datePosted ?? null,
		title: input.title,
		employer: input.employer,
		employerUrl: input.employerUrl ?? null,
		jobUrl: input.jobUrl,
		applicationLink: input.applicationLink ?? null,
		disciplines: input.disciplines ?? null,
		deadline: input.deadline ?? null,
		salary: input.salary ?? null,
		location: input.location ?? null,
		locationEvidence: serializeLocationEvidence(input.locationEvidence),
		degreeRequired: input.degreeRequired ?? null,
		starting: input.starting ?? null,
		jobDescription: input.jobDescription ?? null,
		jobType: input.jobType ?? null,
		salarySource: input.salarySource ?? null,
		salaryInterval: input.salaryInterval ?? null,
		salaryMinAmount: input.salaryMinAmount ?? null,
		salaryMaxAmount: input.salaryMaxAmount ?? null,
		salaryCurrency: input.salaryCurrency ?? null,
		isRemote: input.isRemote ?? null,
		jobLevel: input.jobLevel ?? null,
		jobFunction: input.jobFunction ?? null,
		listingType: input.listingType ?? null,
		emails: input.emails ?? null,
		companyIndustry: input.companyIndustry ?? null,
		companyLogo: input.companyLogo ?? null,
		companyUrlDirect: input.companyUrlDirect ?? null,
		companyAddresses: input.companyAddresses ?? null,
		companyNumEmployees: input.companyNumEmployees ?? null,
		companyRevenue: input.companyRevenue ?? null,
		companyDescription: input.companyDescription ?? null,
		skills: input.skills ?? null,
		experienceRange: input.experienceRange ?? null,
		companyRating: input.companyRating ?? null,
		companyReviewsCount: input.companyReviewsCount ?? null,
		vacancyCount: input.vacancyCount ?? null,
		workFromHomeType: input.workFromHomeType ?? null,
		...(() => {
			const parsed = input.salary ? parseSalary(input.salary) : null;
			const loc = input.location ? canonicalizeLocation(input.location) : null;
			return {
				salaryMinAmount: parsed?.minAmount ?? input.salaryMinAmount ?? null,
				salaryMaxAmount: parsed?.maxAmount ?? input.salaryMaxAmount ?? null,
				salaryCurrency: parsed?.currency ?? input.salaryCurrency ?? null,
				salaryInterval: parsed?.interval ?? input.salaryInterval ?? null,
				monthlyMinPLN: parsed?.monthlyMinPLN ?? null,
				monthlyMaxPLN: parsed?.monthlyMaxPLN ?? null,
				locationCity: loc?.city ?? null,
				locationCountry: loc?.country ?? null,
				isRemote: input.isRemote ?? (loc?.isRemote ? 1 : null),
			};
		})(),
		status: "discovered",
		discoveredAt: now,
		createdAt: now,
		updatedAt: now,
	});

	const job = await getJobById(id);
	if (!job) {
		throw new Error(`Failed to retrieve newly created job with ID ${id}`);
	}
	return job;
}

function isJobUrlUniqueViolation(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /UNIQUE constraint failed: (jobs\.job_url|jobs\.tenant_id, jobs\.job_url)/i.test(
		error.message,
	);
}

async function tryInsertJob(input: CreateJobInput): Promise<Job | null> {
	try {
		return await insertJob(input);
	} catch (error) {
		if (isJobUrlUniqueViolation(error)) return null;
		throw error;
	}
}

/**
 * Create jobs (or return existing jobs for duplicate URLs).
 */
export async function createJobs(input: CreateJobInput): Promise<Job>;
export async function createJobs(
	inputs: CreateJobInput[],
): Promise<{ created: number; skipped: number }>;
export async function createJobs(
	inputOrInputs: CreateJobInput | CreateJobInput[],
): Promise<Job | { created: number; skipped: number }> {
	if (!Array.isArray(inputOrInputs)) {
		const inserted = await tryInsertJob(inputOrInputs);
		if (inserted) return inserted;
		const existing = await getJobByUrl(inputOrInputs.jobUrl);
		if (existing) return existing;
		throw new Error("Failed to create or resolve existing job by URL");
	}

	const byUrl = new Map<
		string,
		{
			input: CreateJobInput;
			count: number;
		}
	>();

	for (const input of inputOrInputs) {
		const existing = byUrl.get(input.jobUrl);
		if (existing) {
			existing.count += 1;
		} else {
			byUrl.set(input.jobUrl, { input, count: 1 });
		}
	}

	let created = 0;
	let skipped = 0;

	const uniqueUrls = Array.from(byUrl.keys());
	if (uniqueUrls.length === 0) {
		return { created, skipped };
	}

	const existingRows = await db
		.select({ jobUrl: jobs.jobUrl })
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, getActiveTenantId()),
				inArray(jobs.jobUrl, uniqueUrls),
			),
		);
	const existingUrlSet = new Set(existingRows.map((row) => row.jobUrl));

	// Secondary dedup: check title+employer per source to catch same job with different URLs
	// (e.g. nofluffjobs creates one URL per location for the same posting)
	const candidateInputs = Array.from(byUrl.values()).filter(
		({ input }) => !existingUrlSet.has(input.jobUrl),
	);
	const existingTitleEmployerSet = new Set<string>();
	if (candidateInputs.length > 0) {
		const titleEmployerRows = await db
			.select({
				title: jobs.title,
				employer: jobs.employer,
				source: jobs.source,
			})
			.from(jobs)
			.where(
				and(
					eq(jobs.tenantId, getActiveTenantId()),
					inArray(jobs.source, [
						...new Set(candidateInputs.map(({ input }) => input.source)),
					]),
				),
			);
		for (const row of titleEmployerRows) {
			existingTitleEmployerSet.add(
				`${row.source}||${row.title.toLowerCase()}||${row.employer.toLowerCase()}`,
			);
		}
	}

	for (const { input, count } of byUrl.values()) {
		if (existingUrlSet.has(input.jobUrl)) {
			skipped += count;
			continue;
		}
		const titleEmployerKey = `${input.source}||${input.title.toLowerCase()}||${input.employer.toLowerCase()}`;
		if (existingTitleEmployerSet.has(titleEmployerKey)) {
			skipped += count;
			continue;
		}

		const inserted = await tryInsertJob(input);
		if (!inserted) {
			skipped += count;
			continue;
		}

		created += 1;
		skipped += count - 1;
	}

	return { created, skipped };
}

/**
 * Create a single job (or return existing if URL matches).
 */
export async function createJob(input: CreateJobInput): Promise<Job> {
	return createJobs(input);
}

/**
 * Update a job.
 */
export async function updateJob(
	id: string,
	input: UpdateJobInput,
): Promise<Job | null> {
	const now = new Date().toISOString();
	const tenantId = getActiveTenantId();
	const { locationEvidence, ...updateFields } = input;
	const clearsBriefForDescriptionEdit =
		input.jobDescription !== undefined && input.jobBrief === undefined;
	const readyAtUpdate =
		input.readyAt !== undefined
			? { readyAt: input.readyAt }
			: input.status === "ready"
				? { readyAt: sql`coalesce(${jobs.readyAt}, ${now})` }
				: {};
	const appliedAtUpdate =
		input.appliedAt !== undefined
			? { appliedAt: input.appliedAt }
			: input.status === "applied"
				? { appliedAt: sql`coalesce(${jobs.appliedAt}, ${now})` }
				: {};

	await db
		.update(jobs)
		.set({
			...updateFields,
			...(clearsBriefForDescriptionEdit ? { jobBrief: null } : {}),
			...(locationEvidence !== undefined
				? { locationEvidence: serializeLocationEvidence(locationEvidence) }
				: {}),
			updatedAt: now,
			...(input.status === "processing" ? { processedAt: now } : {}),
			...readyAtUpdate,
			...appliedAtUpdate,
		})
		.where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id)));

	return getJobById(id);
}

export async function finalizeGeneratedPdfIfCurrent(input: {
	id: string;
	expectedStatus: JobStatus;
	requireGeneratedSource: boolean;
	pdfPath: string;
	pdfFingerprint: string;
	pdfGeneratedAt: string;
}): Promise<Job | null> {
	const now = new Date().toISOString();
	const tenantId = getActiveTenantId();
	const conditions = [
		eq(jobs.tenantId, tenantId),
		eq(jobs.id, input.id),
		eq(jobs.status, input.expectedStatus),
		eq(jobs.pdfRegenerating, true),
	];

	if (input.requireGeneratedSource) {
		conditions.push(eq(jobs.pdfSource, "generated"));
	}

	const result = await db
		.update(jobs)
		.set({
			status: "ready",
			pdfPath: input.pdfPath,
			pdfSource: "generated",
			pdfRegenerating: false,
			pdfFingerprint: input.pdfFingerprint,
			pdfGeneratedAt: input.pdfGeneratedAt,
			updatedAt: now,
			readyAt: sql`coalesce(${jobs.readyAt}, ${now})`,
		})
		.where(and(...conditions))
		.run();

	if (result.changes === 0) return null;
	return getJobById(input.id);
}

/**
 * Get job statistics by status.
 */
export async function getJobStats(): Promise<Record<JobStatus, number>> {
	const tenantId = getActiveTenantId();
	const result = await db
		.select({
			status: jobs.status,
			count: sql<number>`count(*)`,
		})
		.from(jobs)
		.where(eq(jobs.tenantId, tenantId))
		.groupBy(jobs.status);

	const stats: Record<JobStatus, number> = {
		discovered: 0,
		processing: 0,
		ready: 0,
		applied: 0,
		in_progress: 0,
		skipped: 0,
		expired: 0,
	};

	for (const row of result) {
		stats[row.status as JobStatus] = row.count;
	}

	return stats;
}

/**
 * Get jobs ready for processing (discovered with description).
 */
export async function getJobsForProcessing(limit: number = 10): Promise<Job[]> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select()
		.from(jobs)
		.where(
			and(
				eq(jobs.status, "discovered"),
				eq(jobs.tenantId, tenantId),
				sql`${jobs.jobDescription} IS NOT NULL`,
			),
		)
		.orderBy(desc(jobs.discoveredAt))
		.limit(limit);

	return rows.map(mapRowToJob);
}

export async function getReadyJobsWithGeneratedPdfs(
	limit: number,
	offset = 0,
): Promise<Job[]> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select()
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				eq(jobs.status, "ready"),
				eq(jobs.pdfSource, "generated"),
				isNotNull(jobs.pdfPath),
			),
		)
		.orderBy(desc(jobs.updatedAt))
		.limit(limit)
		.offset(offset);

	return rows.map(mapRowToJob);
}

/**
 * Get discovered jobs missing a suitability score.
 */
export async function getUnscoredDiscoveredJobs(
	limit?: number,
): Promise<Job[]> {
	const tenantId = getActiveTenantId();
	const query = db
		.select()
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				eq(jobs.status, "discovered"),
				isNull(jobs.suitabilityScore),
			),
		)
		.orderBy(desc(jobs.discoveredAt));

	const rows =
		typeof limit === "number" ? await query.limit(limit) : await query;
	return rows.map(mapRowToJob);
}

/**
 * Delete jobs by status.
 */
export async function deleteJobsByStatus(status: JobStatus): Promise<number> {
	const tenantId = getActiveTenantId();
	const result = await db
		.delete(jobs)
		.where(and(eq(jobs.tenantId, tenantId), eq(jobs.status, status)))
		.run();
	return result.changes;
}

/**
 * Delete jobs with suitability score below threshold (excluding applied and in_progress jobs).
 */
export async function deleteJobsBelowScore(threshold: number): Promise<number> {
	const tenantId = getActiveTenantId();
	const result = await db
		.delete(jobs)
		.where(
			and(
				lt(jobs.suitabilityScore, threshold),
				eq(jobs.tenantId, tenantId),
				ne(jobs.status, "applied"),
				ne(jobs.status, "in_progress"),
			),
		)
		.run();
	return result.changes;
}

// Helper to map database row to Job type
function mapRowToJob(row: typeof jobs.$inferSelect): Job {
	return {
		id: row.id,
		source: row.source as Job["source"],
		sourceJobId: row.sourceJobId ?? null,
		jobUrlDirect: row.jobUrlDirect ?? null,
		datePosted: row.datePosted ?? null,
		title: row.title,
		employer: row.employer,
		employerUrl: row.employerUrl,
		jobUrl: row.jobUrl,
		applicationLink: row.applicationLink,
		disciplines: row.disciplines,
		deadline: row.deadline,
		salary: row.salary,
		location: row.location,
		locationEvidence: parseLocationEvidence(row.locationEvidence),
		degreeRequired: row.degreeRequired,
		starting: row.starting,
		jobDescription: row.jobDescription,
		status: row.status as JobStatus,
		outcome: row.outcome ?? null,
		closedAt: row.closedAt ?? null,
		suitabilityScore: row.suitabilityScore,
		suitabilityReason: row.suitabilityReason,
		jobBrief: row.jobBrief ?? null,
		tailoredSummary: row.tailoredSummary,
		tailoredHeadline: row.tailoredHeadline ?? null,
		tailoredSkills: row.tailoredSkills ?? null,
		selectedProjectIds: row.selectedProjectIds ?? null,
		pdfPath: row.pdfPath,
		pdfSource: row.pdfSource ?? null,
		pdfRegenerating: row.pdfRegenerating ?? false,
		pdfFreshness: row.pdfRegenerating
			? "regenerating"
			: row.pdfSource === "uploaded"
				? "uploaded"
				: row.pdfPath
					? "stale"
					: "missing",
		pdfFingerprint: row.pdfFingerprint ?? null,
		pdfGeneratedAt: row.pdfGeneratedAt ?? null,
		tracerLinksEnabled: row.tracerLinksEnabled ?? false,
		sponsorMatchScore: row.sponsorMatchScore ?? null,
		sponsorMatchNames: row.sponsorMatchNames ?? null,
		oeFitnessScore: row.oeFitnessScore ?? null,
		oeFitnessReasons: row.oeFitnessReasons ?? null,
		redFlags: row.redFlags ?? null,
		asyncScore: row.asyncScore ?? null,
		asyncSignals: row.asyncSignals ?? null,
		weeklyHoursEstimate: row.weeklyHoursEstimate ?? null,
		weeklyHoursReasons: row.weeklyHoursReasons ?? null,
		jobType: row.jobType ?? null,
		salarySource: row.salarySource ?? null,
		salaryInterval: row.salaryInterval ?? null,
		salaryMinAmount: row.salaryMinAmount ?? null,
		salaryMaxAmount: row.salaryMaxAmount ?? null,
		salaryCurrency: row.salaryCurrency ?? null,
		isRemote: row.isRemote ?? null,
		jobLevel: row.jobLevel ?? null,
		jobFunction: row.jobFunction ?? null,
		listingType: row.listingType ?? null,
		emails: row.emails ?? null,
		companyIndustry: row.companyIndustry ?? null,
		companyLogo: row.companyLogo ?? null,
		companyUrlDirect: row.companyUrlDirect ?? null,
		companyAddresses: row.companyAddresses ?? null,
		companyNumEmployees: row.companyNumEmployees ?? null,
		companyRevenue: row.companyRevenue ?? null,
		companyDescription: row.companyDescription ?? null,
		skills: row.skills ?? null,
		experienceRange: row.experienceRange ?? null,
		companyRating: row.companyRating ?? null,
		companyReviewsCount: row.companyReviewsCount ?? null,
		vacancyCount: row.vacancyCount ?? null,
		workFromHomeType: row.workFromHomeType ?? null,
		discoveredAt: row.discoveredAt,
		processedAt: row.processedAt,
		readyAt: row.readyAt,
		appliedAt: row.appliedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function mapRowToJobNote(row: typeof jobNotes.$inferSelect): JobNote {
	return {
		id: row.id,
		jobId: row.jobId,
		title: row.title,
		content: row.content,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export interface SalaryStats {
	median: number;
	p25: number;
	p75: number;
	sampleSize: number;
	currency: "PLN";
	byLevel: Array<{
		level: string;
		median: number;
		p25: number;
		p75: number;
		n: number;
	}>;
}

export interface MarketStats {
	totalJobs: number;
	bySource: Array<{ source: string; count: number; avgScore: number | null }>;
	scoreDistribution: Array<{ bracket: string; count: number }>;
	topSkills: Array<{ skill: string; count: number }>;
	topEmployers: Array<{
		employer: string;
		count: number;
		avgScore: number | null;
	}>;
	salarySamples: Array<{
		title: string;
		employer: string;
		salary: string;
		score: number | null;
		source: string;
	}>;
	salaryCount: number;
	salaryStats: SalaryStats | null;
}

export async function getMarketStats(): Promise<MarketStats> {
	const tenantId = getActiveTenantId();

	const [totalRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(jobs)
		.where(eq(jobs.tenantId, tenantId));

	const bySourceRows = await db
		.select({
			source: jobs.source,
			count: sql<number>`count(*)`,
			avgScore: sql<number | null>`round(avg(${jobs.suitabilityScore}), 1)`,
		})
		.from(jobs)
		.where(eq(jobs.tenantId, tenantId))
		.groupBy(jobs.source)
		.orderBy(sql`count(*) desc`);

	const scoreRows = await db
		.select({
			bracket: sql<string>`
        case
          when ${jobs.suitabilityScore} >= 80 then '80-100'
          when ${jobs.suitabilityScore} >= 60 then '60-79'
          when ${jobs.suitabilityScore} >= 40 then '40-59'
          when ${jobs.suitabilityScore} >= 20 then '20-39'
          else '0-19'
        end`,
			count: sql<number>`count(*)`,
		})
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), isNotNull(jobs.suitabilityScore)))
		.groupBy(sql`1`)
		.orderBy(sql`1 desc`);

	const skillsRows = await db
		.select({ skills: jobs.skills })
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), isNotNull(jobs.skills)));

	const skillCounts = new Map<string, number>();
	for (const row of skillsRows) {
		if (!row.skills) continue;
		for (const raw of row.skills.split(",")) {
			const skill = raw.trim();
			if (skill) skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
		}
	}
	const topSkills = [...skillCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 20)
		.map(([skill, count]) => ({ skill, count }));

	const topEmployerRows = await db
		.select({
			employer: jobs.employer,
			count: sql<number>`count(*)`,
			avgScore: sql<number | null>`round(avg(${jobs.suitabilityScore}), 1)`,
		})
		.from(jobs)
		.where(eq(jobs.tenantId, tenantId))
		.groupBy(jobs.employer)
		.orderBy(sql`count(*) desc`)
		.limit(20);

	const [salaryCountRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.salary),
				sql`${jobs.salary} != ''`,
			),
		);

	const salarySampleRows = await db
		.select({
			title: jobs.title,
			employer: jobs.employer,
			salary: jobs.salary,
			score: jobs.suitabilityScore,
			source: jobs.source,
		})
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.salary),
				sql`${jobs.salary} != ''`,
			),
		)
		.orderBy(desc(jobs.suitabilityScore))
		.limit(50);

	const salaryRows = await db
		.select({
			monthlyMin: jobs.monthlyMinPLN,
			monthlyMax: jobs.monthlyMaxPLN,
			level: jobs.jobLevel,
		})
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.monthlyMinPLN),
				isNotNull(jobs.monthlyMaxPLN),
			),
		);

	function percentile(sorted: number[], p: number): number {
		if (sorted.length === 0) return 0;
		const idx = (p / 100) * (sorted.length - 1);
		const lo = Math.floor(idx);
		const hi = Math.ceil(idx);
		return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
	}

	let salaryStats: SalaryStats | null = null;
	if (salaryRows.length >= 3) {
		const midpoints = salaryRows
			.map((r) =>
				Math.round(
					((r.monthlyMin ?? 0) + (r.monthlyMax ?? r.monthlyMin ?? 0)) / 2,
				),
			)
			.filter((v) => v > 0)
			.sort((a, b) => a - b);

		const byLevel = new Map<string, number[]>();
		for (const row of salaryRows) {
			const mp = Math.round(
				((row.monthlyMin ?? 0) + (row.monthlyMax ?? row.monthlyMin ?? 0)) / 2,
			);
			if (mp > 0 && row.level) {
				const arr = byLevel.get(row.level) ?? [];
				arr.push(mp);
				byLevel.set(row.level, arr);
			}
		}

		salaryStats = {
			median: percentile(midpoints, 50),
			p25: percentile(midpoints, 25),
			p75: percentile(midpoints, 75),
			sampleSize: midpoints.length,
			currency: "PLN",
			byLevel: [...byLevel.entries()]
				.filter(([, arr]) => arr.length >= 2)
				.map(([level, arr]) => {
					const sorted = [...arr].sort((a, b) => a - b);
					return {
						level,
						median: percentile(sorted, 50),
						p25: percentile(sorted, 25),
						p75: percentile(sorted, 75),
						n: sorted.length,
					};
				})
				.sort((a, b) => b.n - a.n),
		};
	}

	return {
		totalJobs: totalRow?.count ?? 0,
		bySource: bySourceRows.map((r) => ({
			source: r.source,
			count: r.count,
			avgScore: r.avgScore,
		})),
		scoreDistribution: scoreRows.map((r) => ({
			bracket: r.bracket,
			count: r.count,
		})),
		topSkills,
		topEmployers: topEmployerRows.map((r) => ({
			employer: r.employer,
			count: r.count,
			avgScore: r.avgScore,
		})),
		salarySamples: salarySampleRows
			.filter((r): r is typeof r & { salary: string } => Boolean(r.salary))
			.map((r) => ({
				title: r.title,
				employer: r.employer,
				salary: r.salary,
				score: r.score,
				source: r.source,
			})),
		salaryCount: salaryCountRow?.count ?? 0,
		salaryStats,
	};
}

export interface SkillGapEntry {
	skill: string;
	count: number;
	avgScore: number;
	matchRate: number;
	highScoreCount: number;
	lowScoreCount: number;
	category: "strength" | "gap" | "partial";
	isUserSkill: boolean;
	matchedUserSkill: string | null;
}

export interface SkillGapStats {
	skills: SkillGapEntry[];
	excludedSkills: SkillGapEntry[];
	totalAnalyzed: number;
	userSkills: string[];
}

export async function getSkillGapStats(minScore = 60): Promise<SkillGapStats> {
	const tenantId = getActiveTenantId();
	const MIN_SCORE = minScore;
	const MIN_COUNT = 3;

	// Derive user skills from the CV/profile (stable source of truth).
	// Hybrid: CV direct → union of all tailored jobs (min freq ≥3) as fallback.
	const userSkillSet = new Set<string>();

	const addNormalisedSkill = (kw: string) => {
		const lower = kw.toLowerCase().trim();
		if (!lower) return;
		userSkillSet.add(lower);
		const base = lower.split("(")[0].split("/")[0].trim();
		if (base) userSkillSet.add(base);
	};

	// Primary: parse the latest CV document's skills section
	const [latestDoc] = await db
		.select({ resumeJson: designResumeDocuments.resumeJson })
		.from(designResumeDocuments)
		.where(eq(designResumeDocuments.tenantId, tenantId))
		.orderBy(desc(designResumeDocuments.updatedAt))
		.limit(1);

	if (latestDoc?.resumeJson) {
		try {
			const doc = latestDoc.resumeJson as Record<string, unknown>;
			const sections = (doc.sections ?? {}) as Record<string, unknown>;
			const skillsSection = (sections.skills ?? {}) as Record<string, unknown>;
			const items = Array.isArray(skillsSection.items)
				? skillsSection.items
				: [];
			for (const item of items) {
				const record = (item ?? {}) as Record<string, unknown>;
				const keywords = Array.isArray(record.keywords) ? record.keywords : [];
				for (const kw of keywords) {
					if (typeof kw === "string") addNormalisedSkill(kw);
				}
			}
		} catch {}
	}

	// Fallback: if CV has no skills, aggregate across all tailored jobs (min ≥3 occurrences)
	if (userSkillSet.size === 0) {
		const tailoredRows = await db
			.select({ tailoredSkills: jobs.tailoredSkills })
			.from(jobs)
			.where(and(eq(jobs.tenantId, tenantId), isNotNull(jobs.tailoredSkills)));

		const kwFreq = new Map<string, number>();
		for (const row of tailoredRows) {
			if (!row.tailoredSkills) continue;
			try {
				const groups = JSON.parse(row.tailoredSkills) as Array<{
					name: string;
					keywords?: string[];
				}>;
				const seen = new Set<string>();
				for (const group of groups) {
					for (const kw of group.keywords ?? []) {
						const lower = kw.toLowerCase().trim();
						if (lower && !seen.has(lower)) {
							seen.add(lower);
							kwFreq.set(lower, (kwFreq.get(lower) ?? 0) + 1);
						}
					}
				}
			} catch {}
		}
		for (const [kw, freq] of kwFreq.entries()) {
			if (freq >= 3) addNormalisedSkill(kw);
		}
	}

	// Only analyze jobs scoring >= MIN_SCORE (relevant to user's profile)
	const rows = await db
		.select({
			skills: jobs.skills,
			score: jobs.suitabilityScore,
		})
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.skills),
				isNotNull(jobs.suitabilityScore),
				sql`${jobs.skills} != ''`,
				sql`${jobs.suitabilityScore} >= ${MIN_SCORE}`,
			),
		);

	const SKIP_TERMS = new Set([
		"fullstack",
		"backend",
		"frontend",
		"other",
		"devops",
		"qa",
		"mobile",
		"data",
	]);

	const skillMap = new Map<
		string,
		{ total: number; scoreSum: number; high: number; mid: number }
	>();

	for (const row of rows) {
		if (!row.skills || row.score == null) continue;
		const score = row.score;
		for (const raw of row.skills.split(",")) {
			const skill = raw.trim();
			if (!skill || skill.length < 2 || SKIP_TERMS.has(skill.toLowerCase()))
				continue;
			const entry = skillMap.get(skill) ?? {
				total: 0,
				scoreSum: 0,
				high: 0,
				mid: 0,
			};
			entry.total += 1;
			entry.scoreSum += score;
			if (score >= 75) entry.high += 1;
			if (score >= 60 && score < 75) entry.mid += 1;
			skillMap.set(skill, entry);
		}
	}

	const getMatchedUserSkill = (skill: string): string | null => {
		const lower = skill.toLowerCase();
		if (userSkillSet.has(lower)) return lower;
		for (const us of userSkillSet) {
			if (us.includes(lower) || lower.includes(us)) return us;
		}
		return null;
	};

	const skills: SkillGapEntry[] = [];

	for (const [skill, data] of skillMap.entries()) {
		if (data.total < MIN_COUNT) continue;
		const avgScore = Math.round(data.scoreSum / data.total);
		const matchRate = data.total > 0 ? data.high / data.total : 0;
		const matchedUserSkill = getMatchedUserSkill(skill);
		const userOwns = matchedUserSkill !== null;

		let category: "strength" | "gap" | "partial";
		if (userOwns && matchRate >= 0.5) {
			category = "strength";
		} else if (!userOwns && data.mid >= 2) {
			// Skill appears in mid-score jobs (60-75) where user doesn't match perfectly
			// AND user doesn't have it = potential gap worth learning
			category = "gap";
		} else {
			category = "partial";
		}

		skills.push({
			skill,
			count: data.total,
			avgScore,
			matchRate: Math.round(matchRate * 100) / 100,
			highScoreCount: data.high,
			lowScoreCount: data.mid,
			category,
			isUserSkill: userOwns,
			matchedUserSkill,
		});
	}

	skills.sort((a, b) => b.count - a.count);

	const exclusions = await getSkillExclusions();
	const excludedSet = new Set(exclusions.map((e) => e.skill));

	const activeSkills: SkillGapEntry[] = [];
	const excludedSkills: SkillGapEntry[] = [];
	for (const entry of skills) {
		if (excludedSet.has(entry.skill.toLowerCase())) {
			excludedSkills.push(entry);
		} else {
			activeSkills.push(entry);
		}
	}

	return {
		skills: activeSkills,
		excludedSkills,
		totalAnalyzed: rows.length,
		userSkills: [...userSkillSet].sort(),
	};
}

export interface RepostFlag {
	employer: string;
	title: string;
	count: number;
	firstSeenAt: string;
	repostScore: number;
}

export interface OeEmployerEntry {
	employer: string;
	postingCount: number;
	avgOeFitnessScore: number;
	avgAsyncScore: number | null;
	redFlagCounts: Record<string, number>;
}

export interface EmployerInsights {
	highChurnEmployers: RepostFlag[];
	oeEmployerIndex: OeEmployerEntry[];
}

export async function getEmployerInsights(): Promise<EmployerInsights> {
	const tenantId = getActiveTenantId();
	const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

	const rows = await db
		.select({
			employer: jobs.employer,
			title: jobs.title,
			discoveredAt: jobs.discoveredAt,
		})
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), gte(jobs.discoveredAt, cutoff)));

	const grouped = new Map<string, { count: number; firstSeen: string }>();
	for (const row of rows) {
		if (!row.employer || !row.title) continue;
		const key = row.employer.toLowerCase() + "||" + row.title.toLowerCase();
		const existing = grouped.get(key);
		if (!existing) {
			grouped.set(key, { count: 1, firstSeen: row.discoveredAt });
		} else {
			existing.count++;
			if (row.discoveredAt < existing.firstSeen)
				existing.firstSeen = row.discoveredAt;
		}
	}

	// Employer-level stats for churn
	const byEmployer = new Map<
		string,
		{
			totalPostings: number;
			distinctTitles: Set<string>;
			firstSeen: string;
			latestTitle: string;
		}
	>();
	for (const row of rows) {
		if (!row.employer) continue;
		const emp = row.employer.toLowerCase();
		const s = byEmployer.get(emp) ?? {
			totalPostings: 0,
			distinctTitles: new Set(),
			firstSeen: row.discoveredAt,
			latestTitle: row.title,
		};
		s.totalPostings++;
		s.distinctTitles.add(row.title.toLowerCase());
		if (row.discoveredAt < s.firstSeen) s.firstSeen = row.discoveredAt;
		byEmployer.set(emp, s);
	}

	const highChurn: RepostFlag[] = [];
	for (const [empLower, s] of byEmployer.entries()) {
		const repostScore =
			s.distinctTitles.size > 0 ? s.totalPostings / s.distinctTitles.size : 1;
		if (repostScore >= 2) {
			highChurn.push({
				employer: s.latestTitle
					? (rows.find((r) => r.employer.toLowerCase() === empLower)
							?.employer ?? empLower)
					: empLower,
				title: s.latestTitle,
				count: s.totalPostings,
				firstSeenAt: s.firstSeen,
				repostScore: Math.round(repostScore * 10) / 10,
			});
		}
	}

	// OE employer index — aggregate OE signals per employer (min 3 postings)
	const oeRows = await db
		.select({
			employer: jobs.employer,
			oeFitnessScore: jobs.oeFitnessScore,
			asyncScore: jobs.asyncScore,
			redFlags: jobs.redFlags,
		})
		.from(jobs)
		.where(and(eq(jobs.tenantId, tenantId), isNotNull(jobs.oeFitnessScore)));

	const oeByEmployer = new Map<
		string,
		{
			canonicalName: string;
			fitnessScores: number[];
			asyncScores: number[];
			redFlagCounts: Record<string, number>;
		}
	>();

	for (const row of oeRows) {
		if (!row.employer) continue;
		const key = row.employer.toLowerCase();
		const entry = oeByEmployer.get(key) ?? {
			canonicalName: row.employer,
			fitnessScores: [],
			asyncScores: [],
			redFlagCounts: {},
		};
		if (row.oeFitnessScore != null)
			entry.fitnessScores.push(row.oeFitnessScore);
		if (row.asyncScore != null) entry.asyncScores.push(row.asyncScore);
		if (row.redFlags) {
			try {
				const flags = JSON.parse(row.redFlags) as Array<{ id: string }>;
				for (const f of flags) {
					entry.redFlagCounts[f.id] = (entry.redFlagCounts[f.id] ?? 0) + 1;
				}
			} catch {
				/* malformed JSON — skip */
			}
		}
		oeByEmployer.set(key, entry);
	}

	const oeEmployerIndex: OeEmployerEntry[] = [];
	for (const entry of oeByEmployer.values()) {
		if (entry.fitnessScores.length < 3) continue;
		const avgOeFitnessScore = Math.round(
			entry.fitnessScores.reduce((a, b) => a + b, 0) /
				entry.fitnessScores.length,
		);
		const avgAsyncScore =
			entry.asyncScores.length > 0
				? Math.round(
						entry.asyncScores.reduce((a, b) => a + b, 0) /
							entry.asyncScores.length,
					)
				: null;
		oeEmployerIndex.push({
			employer: entry.canonicalName,
			postingCount: entry.fitnessScores.length,
			avgOeFitnessScore,
			avgAsyncScore,
			redFlagCounts: entry.redFlagCounts,
		});
	}

	oeEmployerIndex.sort((a, b) => b.avgOeFitnessScore - a.avgOeFitnessScore);

	return {
		highChurnEmployers: highChurn
			.sort((a, b) => b.repostScore - a.repostScore)
			.slice(0, 20),
		oeEmployerIndex: oeEmployerIndex.slice(0, 50),
	};
}

export async function getJobsCompare(ids: string[]): Promise<Job[]> {
	const results: Job[] = [];
	for (const id of ids) {
		const job = await getJobById(id);
		if (job) results.push(job);
	}
	return results;
}

export interface JobsBySkillEntry {
	id: string;
	title: string;
	employer: string;
	score: number;
	source: string;
	discoveredAt: string;
}

export async function getJobsBySkill(
	skill: string,
	minScore = 60,
): Promise<JobsBySkillEntry[]> {
	const tenantId = getActiveTenantId();
	const skillLower = skill.toLowerCase();

	const rows = await db
		.select({
			id: jobs.id,
			title: jobs.title,
			employer: jobs.employer,
			score: jobs.suitabilityScore,
			source: jobs.source,
			discoveredAt: jobs.discoveredAt,
			skills: jobs.skills,
		})
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.skills),
				isNotNull(jobs.suitabilityScore),
				sql`${jobs.skills} != ''`,
				sql`${jobs.suitabilityScore} >= ${minScore}`,
			),
		);

	const matched: JobsBySkillEntry[] = [];
	for (const row of rows) {
		if (!row.skills || row.score == null) continue;
		const jobSkills = row.skills.split(",").map((s) => s.trim().toLowerCase());
		if (jobSkills.includes(skillLower)) {
			matched.push({
				id: row.id,
				title: row.title ?? "",
				employer: row.employer ?? "",
				score: row.score,
				source: row.source ?? "",
				discoveredAt: row.discoveredAt,
			});
		}
	}

	return matched.sort((a, b) => b.score - a.score);
}

export interface SkillDemandEntry {
	title: string;
	jobCount: number;
	overlapPct: number;
	avgScore: number | null;
	medianSalaryMin: number | null;
	topEmployers: string[];
	relevanceScore: number;
}

export async function getSkillDemand(
	inputSkills: string[],
	minScore = 0,
): Promise<SkillDemandEntry[]> {
	const tenantId = getActiveTenantId();
	const inputSet = new Set(
		inputSkills.map((s) => s.toLowerCase().trim()).filter(Boolean),
	);
	if (inputSet.size === 0) return [];

	const rows = await db
		.select({
			id: jobs.id,
			title: jobs.title,
			employer: jobs.employer,
			skills: jobs.skills,
			suitabilityScore: jobs.suitabilityScore,
			salaryMinAmount: jobs.salaryMinAmount,
		})
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.title),
				minScore > 0
					? sql`(${jobs.suitabilityScore} IS NULL OR ${jobs.suitabilityScore} >= ${minScore})`
					: undefined,
			),
		);

	function normaliseTitle(raw: string): string {
		return raw
			.toLowerCase()
			.replace(
				/\b(senior|junior|mid|lead|principal|staff|head of|vp of|director of)\b/gi,
				"",
			)
			.replace(/\s+/g, " ")
			.trim();
	}

	const byTitle = new Map<
		string,
		{
			canonical: string;
			count: number;
			overlapSum: number;
			overlapCount: number;
			scoreSum: number;
			scoreCount: number;
			salaryMins: number[];
			employers: Map<string, number>;
		}
	>();

	for (const row of rows) {
		if (!row.title) continue;
		const titleKey = normaliseTitle(row.title);
		if (!titleKey) continue;

		const jobSkills = row.skills
			? new Set(row.skills.split(",").map((s) => s.trim().toLowerCase()))
			: new Set<string>();

		const entry = byTitle.get(titleKey) ?? {
			canonical: row.title,
			count: 0,
			overlapSum: 0,
			overlapCount: 0,
			scoreSum: 0,
			scoreCount: 0,
			salaryMins: [],
			employers: new Map(),
		};
		entry.count++;
		if (jobSkills.size > 0) {
			let matchCount = 0;
			for (const s of inputSet) {
				if (jobSkills.has(s)) matchCount++;
			}
			entry.overlapSum += (matchCount / jobSkills.size) * 100;
			entry.overlapCount++;
		}
		if (row.suitabilityScore != null) {
			entry.scoreSum += row.suitabilityScore;
			entry.scoreCount++;
		}
		if (row.salaryMinAmount != null) entry.salaryMins.push(row.salaryMinAmount);
		if (row.employer) {
			entry.employers.set(
				row.employer,
				(entry.employers.get(row.employer) ?? 0) + 1,
			);
		}
		byTitle.set(titleKey, entry);
	}

	const results: SkillDemandEntry[] = [];
	for (const entry of byTitle.values()) {
		if (entry.count < 2) continue;
		if (entry.overlapCount === 0) continue;
		const avgOverlap = entry.overlapSum / entry.overlapCount;
		if (avgOverlap < 10) continue;

		const avgScore =
			entry.scoreCount > 0
				? Math.round(entry.scoreSum / entry.scoreCount)
				: null;

		const sortedSalaries = entry.salaryMins.sort((a, b) => a - b);
		const medianSalaryMin =
			sortedSalaries.length > 0
				? sortedSalaries[Math.floor(sortedSalaries.length / 2)]
				: null;

		const topEmployers = [...entry.employers.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([emp]) => emp);

		const relevanceScore = avgOverlap * Math.log(entry.count + 1);

		results.push({
			title: entry.canonical,
			jobCount: entry.count,
			overlapPct: Math.round(avgOverlap),
			avgScore,
			medianSalaryMin,
			topEmployers,
			relevanceScore,
		});
	}

	return results
		.sort((a, b) => b.relevanceScore - a.relevanceScore)
		.slice(0, 50);
}

export interface ClusterJobRow {
	id: string;
	title: string;
	employer: string;
	skills: string[];
	score: number | null;
	salaryMin: number | null;
}

export async function getJobsForClustering(): Promise<ClusterJobRow[]> {
	const tenantId = getActiveTenantId();
	const rows = await db
		.select({
			id: jobs.id,
			title: jobs.title,
			employer: jobs.employer,
			skills: jobs.skills,
			suitabilityScore: jobs.suitabilityScore,
			salaryMinAmount: jobs.salaryMinAmount,
		})
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.title),
				isNotNull(jobs.skills),
				sql`${jobs.skills} != ''`,
			),
		);

	return rows.map((r) => ({
		id: r.id,
		title: r.title ?? "",
		employer: r.employer ?? "",
		skills: r.skills
			? r.skills
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [],
		score: r.suitabilityScore,
		salaryMin: r.salaryMinAmount,
	}));
}

export interface SkillCooccurrenceEntry {
	skill: string;
	cooccurrenceRate: number;
	jointCount: number;
	isUserSkill: boolean;
}

export async function getSkillCooccurrence(
	targetSkill: string,
	userSkills: string[],
	minScore = 60,
	limit = 10,
): Promise<SkillCooccurrenceEntry[]> {
	const tenantId = getActiveTenantId();
	const targetLower = targetSkill.toLowerCase().trim();
	const userSkillSet = new Set(userSkills.map((s) => s.toLowerCase().trim()));

	const rows = await db
		.select({ skills: jobs.skills, suitabilityScore: jobs.suitabilityScore })
		.from(jobs)
		.where(
			and(
				eq(jobs.tenantId, tenantId),
				isNotNull(jobs.skills),
				sql`${jobs.skills} != ''`,
				sql`(${jobs.suitabilityScore} IS NULL OR ${jobs.suitabilityScore} >= ${minScore})`,
			),
		);

	let targetCount = 0;
	const coMap = new Map<string, number>();

	for (const row of rows) {
		if (!row.skills) continue;
		const skillList = row.skills.split(",").map((s) => s.trim().toLowerCase());
		if (!skillList.includes(targetLower)) continue;
		targetCount++;
		for (const s of skillList) {
			if (s && s !== targetLower && s.length >= 2) {
				coMap.set(s, (coMap.get(s) ?? 0) + 1);
			}
		}
	}

	if (targetCount === 0) return [];

	const results: SkillCooccurrenceEntry[] = [];
	for (const [skill, count] of coMap.entries()) {
		results.push({
			skill,
			cooccurrenceRate: Math.round((count / targetCount) * 100),
			jointCount: count,
			isUserSkill: userSkillSet.has(skill),
		});
	}

	return results
		.sort((a, b) => b.cooccurrenceRate - a.cooccurrenceRate)
		.slice(0, limit);
}

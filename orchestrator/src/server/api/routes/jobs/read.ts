import { badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as marketSnapshotsRepo from "@server/repositories/profile-market-snapshots";
import * as skillSnapshotsRepo from "@server/repositories/skill-snapshots";
import { attachAppliedDuplicateMatches } from "@server/services/applied-duplicate-matching";
import { findPivotClusters } from "@server/services/career-pivot";
import { computeApplyRisk } from "@server/services/oe-apply-risk";
import { getPdfPath, pdfExists } from "@server/services/pdf";
import {
	applyJobsPdfFreshness,
	resolvePdfFingerprintContext,
} from "@server/services/pdf-fingerprint";
import {
	DEFAULT_JOB_EMAIL_LIMIT,
	listJobPostApplicationEmails,
	MAX_JOB_EMAIL_LIMIT,
} from "@server/services/post-application/job-emails";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import {
	hydrateJobPdfFreshness,
	JOBS_BENCHMARK_ENABLED,
	jobsRevisionQuerySchema,
	listJobsQuerySchema,
	parseStatusFilter,
	requireJob,
	toJobListItem,
	toJobsRouteError,
} from "./shared";

export const jobsReadRouter = Router();

const jobEmailsQuerySchema = z.object({
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_JOB_EMAIL_LIMIT)
		.default(DEFAULT_JOB_EMAIL_LIMIT),
});

jobsReadRouter.get("/", async (req: Request, res: Response) => {
	try {
		const benchmarkStart = performance.now();
		let queryParseMs = 0;
		let primaryQueryMs = 0;
		const duplicateCandidatesQueryMs = 0;
		const duplicateMatchCpuMs = 0;
		let statsAggregateMs = 0;
		let revisionAggregateMs = 0;

		const queryParseStart = performance.now();
		const parsedQuery = listJobsQuerySchema.safeParse(req.query);
		queryParseMs = performance.now() - queryParseStart;
		if (!parsedQuery.success) {
			return fail(
				res,
				badRequest(
					"Invalid jobs list query parameters",
					parsedQuery.error.flatten(),
				),
			);
		}

		const statusFilter = parsedQuery.data.status;
		const statuses = parseStatusFilter(statusFilter);
		const view = parsedQuery.data.view ?? "list";

		const primaryQueryStart = performance.now();
		const pdfFingerprintContext = await resolvePdfFingerprintContext();
		const jobs =
			view === "list"
				? applyJobsPdfFreshness(
						await jobsRepo.getJobListItems(statuses),
						pdfFingerprintContext,
					).map(toJobListItem)
				: applyJobsPdfFreshness(
						await jobsRepo.getAllJobs(statuses),
						pdfFingerprintContext,
					);
		primaryQueryMs = performance.now() - primaryQueryStart;
		const candidateCount = 0;
		const duplicateMatchingEnabled = false;
		const statsAggregateStart = performance.now();
		const stats = await jobsRepo.getJobStats();
		statsAggregateMs = performance.now() - statsAggregateStart;
		const revisionAggregateStart = performance.now();
		const revision = await jobsRepo.getJobsRevision(statuses);
		revisionAggregateMs = performance.now() - revisionAggregateStart;

		const response = {
			jobs,
			total: jobs.length,
			byStatus: stats,
			revision: revision.revision,
		};
		const internalRouteMs =
			queryParseMs +
			primaryQueryMs +
			duplicateCandidatesQueryMs +
			duplicateMatchCpuMs +
			statsAggregateMs +
			revisionAggregateMs;
		const totalMs = performance.now() - benchmarkStart;

		if (JOBS_BENCHMARK_ENABLED) {
			logger.info("Jobs list benchmark", {
				route: "GET /api/jobs",
				view,
				statusFilter: statusFilter ?? null,
				returnedCount: jobs.length,
				duplicateMatchingEnabled,
				candidateCount,
				totalMs,
				queryParseMs,
				primaryQueryMs,
				duplicateCandidatesQueryMs,
				duplicateMatchCpuMs,
				statsAggregateMs,
				revisionAggregateMs,
				internalRouteMs,
			});
		}

		logger.info("Jobs list fetched", {
			route: "GET /api/jobs",
			view,
			statusFilter: statusFilter ?? null,
			revision: revision.revision,
			returnedCount: jobs.length,
		});

		ok(res, response);
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/revision", async (req: Request, res: Response) => {
	try {
		const parsedQuery = jobsRevisionQuerySchema.safeParse(req.query);
		if (!parsedQuery.success) {
			return fail(
				res,
				badRequest(
					"Invalid jobs revision query parameters",
					parsedQuery.error.flatten(),
				),
			);
		}

		const statuses = parseStatusFilter(parsedQuery.data.status);
		const revision = await jobsRepo.getJobsRevision(statuses);

		const response = {
			revision: revision.revision,
			latestUpdatedAt: revision.latestUpdatedAt,
			total: revision.total,
			statusFilter: revision.statusFilter,
		};

		logger.info("Jobs revision fetched", {
			route: "GET /api/jobs/revision",
			statusFilter: revision.statusFilter,
			revision: revision.revision,
			total: revision.total,
		});

		ok(res, response);
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/market-stats", async (req: Request, res: Response) => {
	try {
		const stats = await jobsRepo.getMarketStats();
		ok(res, stats);
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/skill-gap", async (req: Request, res: Response) => {
	try {
		const minScore =
			typeof req.query.minScore === "string" ? Number(req.query.minScore) : 60;
		const stats = await jobsRepo.getSkillGapStats(
			Number.isFinite(minScore) ? minScore : 60,
		);
		ok(res, stats);
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/by-skill", async (req: Request, res: Response) => {
	try {
		const skill =
			typeof req.query.skill === "string" ? req.query.skill.trim() : "";
		if (!skill) return fail(res, badRequest("skill parameter is required"));
		const minScore =
			typeof req.query.minScore === "string" ? Number(req.query.minScore) : 60;
		const jobs = await jobsRepo.getJobsBySkill(
			skill,
			Number.isFinite(minScore) ? minScore : 60,
		);
		ok(res, { jobs });
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get(
	"/employer-insights",
	async (req: Request, res: Response) => {
		try {
			const insights = await jobsRepo.getEmployerInsights();
			ok(res, insights);
		} catch (error) {
			fail(res, toJobsRouteError(error));
		}
	},
);

jobsReadRouter.get("/skill-trends", async (req: Request, res: Response) => {
	try {
		const weeks =
			typeof req.query.weeks === "string"
				? Math.min(26, Math.max(1, Number(req.query.weeks)))
				: 8;
		const trends = await skillSnapshotsRepo.getSkillTrends(weeks);
		ok(res, { trends, weeks });
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/compare", async (req: Request, res: Response) => {
	try {
		const raw = typeof req.query.ids === "string" ? req.query.ids : "";
		const ids = raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 5);
		if (ids.length < 2)
			return fail(res, badRequest("Provide at least 2 job IDs"));
		const jobs = await jobsRepo.getJobsCompare(ids);
		ok(res, { jobs });
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get(
	"/skill-cooccurrence",
	async (req: Request, res: Response) => {
		try {
			const skill =
				typeof req.query.skill === "string" ? req.query.skill.trim() : "";
			if (!skill) return fail(res, badRequest("skill parameter is required"));
			const userSkillsRaw =
				typeof req.query.userSkills === "string" ? req.query.userSkills : "";
			const userSkills = userSkillsRaw
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const minScore =
				typeof req.query.minScore === "string"
					? Number(req.query.minScore) || 60
					: 60;
			const limit =
				typeof req.query.limit === "string"
					? Math.min(20, Number(req.query.limit) || 10)
					: 10;
			const results = await jobsRepo.getSkillCooccurrence(
				skill,
				userSkills,
				minScore,
				limit,
			);
			ok(res, { skill, results });
		} catch (error) {
			fail(res, toJobsRouteError(error));
		}
	},
);

jobsReadRouter.get("/pivot-clusters", async (req: Request, res: Response) => {
	try {
		const raw = typeof req.query.skills === "string" ? req.query.skills : "";
		const skills = raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 50);
		if (skills.length === 0)
			return fail(res, badRequest("skills parameter is required"));
		const jobs = await jobsRepo.getJobsForClustering();
		const clusters = findPivotClusters(skills, jobs);
		ok(res, { clusters, userSkillCount: skills.length });
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/market-trend", async (req: Request, res: Response) => {
	try {
		const weeks =
			typeof req.query.weeks === "string"
				? Math.min(52, Math.max(4, Number(req.query.weeks) || 8))
				: 8;
		const result = await marketSnapshotsRepo.getMarketTrend(weeks);
		ok(res, result);
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/skill-demand", async (req: Request, res: Response) => {
	try {
		const raw = typeof req.query.skills === "string" ? req.query.skills : "";
		const skills = raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 50);
		const minScore =
			typeof req.query.minScore === "string"
				? Math.max(0, Number(req.query.minScore) || 0)
				: 0;
		const results = await jobsRepo.getSkillDemand(skills, minScore);
		ok(res, { results, skills });
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/:id", async (req: Request, res: Response) => {
	try {
		const job = await requireJob(req.params.id);
		const [jobWithAppliedDuplicateMatch] = attachAppliedDuplicateMatches(
			[job],
			await jobsRepo.getAppliedDuplicateMatchCandidates(),
		);
		const hydrated = await hydrateJobPdfFreshness(jobWithAppliedDuplicateMatch);
		const applyRisk = computeApplyRisk(
			hydrated.applicationLink,
			hydrated.jobUrl,
			hydrated.source,
		);
		ok(res, { ...hydrated, applyRisk });
	} catch (error) {
		fail(res, toJobsRouteError(error));
	}
});

jobsReadRouter.get("/:id/emails", async (req: Request, res: Response) => {
	const requestId = String(res.getHeader("x-request-id") || "unknown");
	const route = "GET /api/jobs/:id/emails";
	const jobId = req.params.id;
	const parseResult = jobEmailsQuerySchema.safeParse(req.query);

	if (!parseResult.success) {
		const err = badRequest("Invalid email query", parseResult.error.flatten());
		logger.warn("Job emails fetch failed", {
			route,
			jobId,
			requestId,
			status: err.status,
			code: err.code,
		});
		return fail(res, err);
	}

	try {
		const data = await listJobPostApplicationEmails(
			jobId,
			parseResult.data.limit,
		);

		logger.info("Job emails fetched", {
			route,
			jobId,
			requestId,
			returnedCount: data.items.length,
		});

		ok(res, data);
	} catch (error) {
		const err = toJobsRouteError(error);
		logger[err.status === 404 ? "warn" : "error"]("Job emails fetch failed", {
			route,
			jobId,
			requestId,
			status: err.status,
			code: err.code,
			details: err.details,
			errorMessage: error instanceof Error ? error.message : undefined,
		});
		fail(res, err);
	}
});

jobsReadRouter.get("/:id/pdf", async (req: Request, res: Response) => {
	const currentJob = await jobsRepo.getJobById(req.params.id);
	if (!currentJob || !(await pdfExists(req.params.id))) {
		fail(res, notFound("PDF not found"));
		return;
	}

	const pdfPath = getPdfPath(req.params.id);
	res.setHeader("Cache-Control", "no-store");
	res.sendFile(pdfPath, (error) => {
		if (error) {
			fail(res, notFound("PDF not found"));
		}
	});
});

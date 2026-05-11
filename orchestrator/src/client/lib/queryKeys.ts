import type { JobStatus, PostApplicationProvider } from "@shared/types";

export const queryKeys = {
	designResume: {
		all: ["design-resume"] as const,
		current: () => [...queryKeys.designResume.all, "current"] as const,
		status: () => [...queryKeys.designResume.all, "status"] as const,
	},
	settings: {
		all: ["settings"] as const,
		current: () => [...queryKeys.settings.all, "current"] as const,
	},
	profile: {
		all: ["profile"] as const,
		current: () => [...queryKeys.profile.all, "current"] as const,
	},
	tracer: {
		all: ["tracer"] as const,
		readiness: (force = false) =>
			[...queryKeys.tracer.all, "readiness", { force }] as const,
		analytics: (options?: {
			from?: number;
			to?: number;
			includeBots?: boolean;
			limit?: number;
		}) => [...queryKeys.tracer.all, "analytics", options ?? {}] as const,
		jobLinks: (
			jobId: string,
			options?: { from?: number; to?: number; includeBots?: boolean },
		) => [...queryKeys.tracer.all, "job-links", jobId, options ?? {}] as const,
	},
	demo: {
		all: ["demo"] as const,
		info: () => [...queryKeys.demo.all, "info"] as const,
	},
	jobs: {
		all: ["jobs"] as const,
		inProgressBoard: () =>
			[...queryKeys.jobs.all, "in-progress-board"] as const,
		list: (options?: { statuses?: JobStatus[]; view?: "list" | "full" }) =>
			[...queryKeys.jobs.all, "list", options ?? {}] as const,
		revision: (options?: { statuses?: JobStatus[] }) =>
			[...queryKeys.jobs.all, "revision", options ?? {}] as const,
		detail: (id: string) => [...queryKeys.jobs.all, "detail", id] as const,
		stageEvents: (id: string) =>
			[...queryKeys.jobs.all, "stage-events", id] as const,
		tasks: (id: string) => [...queryKeys.jobs.all, "tasks", id] as const,
		notes: (id: string) => [...queryKeys.jobs.all, "notes", id] as const,
		marketStats: () => [...queryKeys.jobs.all, "market-stats"] as const,
		skillGap: (minScore = 60) =>
			[...queryKeys.jobs.all, "skill-gap", { minScore }] as const,
		bySkill: (skill: string, minScore = 60) =>
			[...queryKeys.jobs.all, "by-skill", { skill, minScore }] as const,
		employerInsights: () =>
			[...queryKeys.jobs.all, "employer-insights"] as const,
		compare: (ids: string[]) =>
			[...queryKeys.jobs.all, "compare", ids] as const,
		skillTrends: (weeks: number) =>
			[...queryKeys.jobs.all, "skill-trends", { weeks }] as const,
		skillDemand: (skills: string[], minScore = 0) =>
			[...queryKeys.jobs.all, "skill-demand", { skills, minScore }] as const,
		pivotClusters: (skills: string[]) =>
			[...queryKeys.jobs.all, "pivot-clusters", { skills }] as const,
		skillCooccurrence: (skill: string, minScore = 60) =>
			[
				...queryKeys.jobs.all,
				"skill-cooccurrence",
				{ skill, minScore },
			] as const,
		emails: (id: string, limit: number) =>
			[...queryKeys.jobs.all, "emails", id, { limit }] as const,
		marketTrend: (weeks: number) =>
			[...queryKeys.jobs.all, "market-trend", { weeks }] as const,
	},
	skillExclusions: {
		all: ["skill-exclusions"] as const,
		list: () => ["skill-exclusions", "list"] as const,
	},
	skillWatchlist: {
		all: ["skill-watchlist"] as const,
		list: () => ["skill-watchlist", "list"] as const,
	},
	savedSearches: {
		all: ["saved-searches"] as const,
		list: () => ["saved-searches", "list"] as const,
	},
	pipeline: {
		all: ["pipeline"] as const,
		status: () => [...queryKeys.pipeline.all, "status"] as const,
		runs: () => [...queryKeys.pipeline.all, "runs"] as const,
		runInsights: (id: string) =>
			[...queryKeys.pipeline.all, "run-insights", id] as const,
		health: () => [...queryKeys.pipeline.all, "health"] as const,
	},
	visaSponsors: {
		all: ["visa-sponsors"] as const,
		status: () => [...queryKeys.visaSponsors.all, "status"] as const,
		search: (
			query: string,
			limit: number,
			minScore: number,
			country?: string,
		) =>
			[
				...queryKeys.visaSponsors.all,
				"search",
				{ query, limit, minScore, country: country ?? null },
			] as const,
		organization: (name: string, providerId?: string) =>
			[
				...queryKeys.visaSponsors.all,
				"organization",
				{ name, providerId: providerId ?? null },
			] as const,
	},
	postApplication: {
		all: ["post-application"] as const,
		providerStatus: (provider: PostApplicationProvider, accountKey: string) =>
			[
				...queryKeys.postApplication.all,
				"provider-status",
				{ provider, accountKey },
			] as const,
		inbox: (
			provider: PostApplicationProvider,
			accountKey: string,
			limit: number,
		) =>
			[
				...queryKeys.postApplication.all,
				"inbox",
				{ provider, accountKey, limit },
			] as const,
		runs: (
			provider: PostApplicationProvider,
			accountKey: string,
			limit: number,
		) =>
			[
				...queryKeys.postApplication.all,
				"runs",
				{ provider, accountKey, limit },
			] as const,
		runMessages: (
			runId: string,
			provider: PostApplicationProvider,
			accountKey: string,
		) =>
			[
				...queryKeys.postApplication.all,
				"run-messages",
				{ runId, provider, accountKey },
			] as const,
	},
	backups: {
		all: ["backups"] as const,
		list: () => [...queryKeys.backups.all, "list"] as const,
	},
	activeEmployments: {
		all: ["active-employments"] as const,
		list: () => ["active-employments", "list"] as const,
		salaryStack: () => ["active-employments", "salary-stack"] as const,
	},
} as const;

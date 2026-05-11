export interface ClusterJob {
	id: string;
	title: string;
	employer: string;
	skills: string[];
	score: number | null;
	salaryMin: number | null;
}

export interface PivotCluster {
	id: string;
	representativeTitle: string;
	overlapPct: number;
	bridgeSkills: string[];
	jobCount: number;
	medianSalaryMin: number | null;
	avgScore: number | null;
	topEmployers: string[];
	jobs: string[]; // job IDs
}


function normaliseTitle(raw: string): string {
	return raw
		.toLowerCase()
		.replace(
			/\b(senior|junior|mid|lead|principal|staff|head of|vp of|director of|associate)\b/gi,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();
}

function median(nums: number[]): number | null {
	if (nums.length === 0) return null;
	const sorted = [...nums].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

export function findPivotClusters(
	userSkills: string[],
	jobs: ClusterJob[],
	k = 8,
): PivotCluster[] {
	if (jobs.length === 0 || userSkills.length === 0) return [];

	const userSkillSet = new Set(userSkills.map((s) => s.toLowerCase().trim()));

	// Group jobs by normalised title
	const byTitle = new Map<
		string,
		{
			title: string;
			skillSets: Set<string>[];
			scores: number[];
			salaryMins: number[];
			employers: Map<string, number>;
			ids: string[];
		}
	>();

	for (const job of jobs) {
		const key = normaliseTitle(job.title);
		if (!key) continue;
		const entry = byTitle.get(key) ?? {
			title: job.title,
			skillSets: [],
			scores: [],
			salaryMins: [],
			employers: new Map(),
			ids: [],
		};
		entry.skillSets.push(
			new Set(job.skills.map((s) => s.toLowerCase().trim())),
		);
		if (job.score != null) entry.scores.push(job.score);
		if (job.salaryMin != null) entry.salaryMins.push(job.salaryMin);
		if (job.employer)
			entry.employers.set(
				job.employer,
				(entry.employers.get(job.employer) ?? 0) + 1,
			);
		entry.ids.push(job.id);
		byTitle.set(key, entry);
	}

	// Compute cluster-level skill union and overlap with user
	const clusters: PivotCluster[] = [];

	for (const [, entry] of byTitle.entries()) {
		if (entry.ids.length < 2) continue;

		// Union of all skills seen in this title cluster
		const allSkills = new Map<string, number>();
		for (const skillSet of entry.skillSets) {
			for (const s of skillSet) {
				allSkills.set(s, (allSkills.get(s) ?? 0) + 1);
			}
		}

		// Skills present in ≥30% of jobs in this cluster
		const minFreq = Math.max(1, Math.ceil(entry.ids.length * 0.3));
		const representativeSkills = new Set<string>();
		for (const [skill, count] of allSkills.entries()) {
			if (count >= minFreq) representativeSkills.add(skill);
		}

		let intersection = 0;
		for (const s of representativeSkills) {
			if (userSkillSet.has(s)) intersection++;
		}
		const overlapRaw =
			representativeSkills.size > 0 ? intersection / representativeSkills.size : 0;
		const overlapPct = Math.round(overlapRaw * 100);

		if (overlapPct < 10) continue;

		// Bridge skills: frequent in cluster but missing from user
		const bridgeSkills: Array<{ skill: string; freq: number }> = [];
		for (const [skill, count] of allSkills.entries()) {
			if (!userSkillSet.has(skill) && count >= minFreq) {
				bridgeSkills.push({ skill, freq: count });
			}
		}
		bridgeSkills.sort((a, b) => b.freq - a.freq);

		const topEmployers = [...entry.employers.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([name]) => name);

		clusters.push({
			id: normaliseTitle(entry.title).replace(/\s+/g, "-"),
			representativeTitle: entry.title,
			overlapPct,
			bridgeSkills: bridgeSkills.slice(0, 5).map((b) => b.skill),
			jobCount: entry.ids.length,
			medianSalaryMin: median(entry.salaryMins),
			avgScore:
				entry.scores.length > 0
					? Math.round(
							entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length,
						)
					: null,
			topEmployers,
			jobs: entry.ids.slice(0, 5),
		});
	}

	return clusters.sort((a, b) => b.overlapPct - a.overlapPct).slice(0, k);
}

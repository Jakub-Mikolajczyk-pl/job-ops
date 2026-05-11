export interface WorkloadInput {
	jobLevel: string | null;
	asyncScore: number | null;
	redFlags: string | null;
	companyNumEmployees: string | null;
}

export interface WorkloadReason {
	rule: string;
	delta: number;
}

export interface WorkloadResult {
	estimate: number;
	reasons: WorkloadReason[];
}

function parseEmployeeCount(raw: string | null): number | null {
	if (!raw) return null;
	const m = raw.replace(/,/g, "").match(/(\d+)/);
	return m ? Number(m[1]) : null;
}

function parseRedFlags(raw: string | null): Array<{ id: string }> {
	if (!raw) return [];
	try {
		return JSON.parse(raw) as Array<{ id: string }>;
	} catch {
		return [];
	}
}

export function computeWorkloadEstimate(job: WorkloadInput): WorkloadResult {
	let estimate = 40;
	const reasons: WorkloadReason[] = [];

	// Job level adjustment
	const level = (job.jobLevel ?? "").toLowerCase();
	if (level.includes("junior") || level.includes("entry")) {
		estimate += 5;
		reasons.push({ rule: "junior_level", delta: 5 });
	} else if (
		level.includes("principal") ||
		level.includes("architect") ||
		level.includes("staff")
	) {
		estimate -= 5;
		reasons.push({ rule: "senior_autonomy", delta: -5 });
	}

	// Async score adjustments
	if (job.asyncScore != null) {
		if (job.asyncScore > 80) {
			estimate -= 5;
			reasons.push({ rule: "async_friendly", delta: -5 });
		} else if (job.asyncScore < 40) {
			estimate += 5;
			reasons.push({ rule: "sync_heavy", delta: 5 });
		}
	}

	// Red-flag adjustments
	const flags = parseRedFlags(job.redFlags);
	const flagIds = new Set(flags.map((f) => f.id));

	if (flagIds.has("on_call_rotation")) {
		estimate += 5;
		reasons.push({ rule: "on_call_rotation", delta: 5 });
	}
	if (flagIds.has("core_hours")) {
		estimate += 5;
		reasons.push({ rule: "strict_core_hours", delta: 5 });
	}

	// Company size — startups demand more time
	const empCount = parseEmployeeCount(job.companyNumEmployees);
	if (empCount != null && empCount < 50) {
		estimate += 10;
		reasons.push({ rule: "startup_size", delta: 10 });
	}

	estimate = Math.max(20, Math.min(60, estimate));

	return { estimate, reasons };
}

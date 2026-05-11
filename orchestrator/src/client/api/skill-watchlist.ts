import { fetchApi } from "./core";

export interface WatchlistEntry {
	id: string;
	skill: string;
	label: string | null;
	titlePattern: string | null;
	alertOnDrop: boolean;
	alertOnRise: boolean;
	dropThresholdPct: number;
	riseThresholdPct: number;
	notes: string | null;
	pendingMatchCount: number;
	lastMatchAt: string | null;
	createdAt: string;
	trend: Array<{ week: string; count: number }>;
	latestCount: number;
	delta: number;
}

export interface WatchlistResponse {
	entries: WatchlistEntry[];
	totalPending: number;
}

export async function getWatchlist(): Promise<WatchlistResponse> {
	return fetchApi<WatchlistResponse>("/skill-watchlist");
}

export async function addWatchlistEntry(input: {
	skill: string;
	label?: string;
	titlePattern?: string;
	notes?: string;
}): Promise<{ ok: boolean }> {
	return fetchApi<{ ok: boolean }>("/skill-watchlist", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export async function removeWatchlistEntry(
	skill: string,
): Promise<{ ok: boolean }> {
	return fetchApi<{ ok: boolean }>(
		`/skill-watchlist/${encodeURIComponent(skill)}`,
		{ method: "DELETE" },
	);
}

export async function markWatchlistSeen(): Promise<{ ok: boolean }> {
	return fetchApi<{ ok: boolean }>("/skill-watchlist/mark-seen", {
		method: "POST",
	});
}

import { PageHeader, PageMain } from "@client/components/layout";
import { queryKeys } from "@client/lib/queryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Plus, TrendingDown, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WatchlistEntry } from "../api/skill-watchlist";
import * as api from "../api/skill-watchlist";

function Sparkline({
	trend,
}: {
	trend: Array<{ week: string; count: number }>;
}) {
	if (trend.length === 0) {
		return <span className="text-xs text-muted-foreground">no data</span>;
	}
	const max = Math.max(...trend.map((t) => t.count), 1);
	return (
		<div className="flex items-end gap-0.5 h-6">
			{trend.map((t) => (
				<div
					key={t.week}
					className="w-2 rounded-sm bg-primary/40"
					style={{ height: `${Math.max(2, (t.count / max) * 24)}px` }}
					title={`${t.week}: ${t.count}`}
				/>
			))}
		</div>
	);
}

function DeltaChip({ delta }: { delta: number }) {
	if (delta === 0)
		return <span className="text-xs text-muted-foreground">±0</span>;
	if (delta > 0) {
		return (
			<span className="inline-flex items-center gap-0.5 text-xs text-emerald-400">
				<TrendingUp className="h-3 w-3" />+{delta}
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-0.5 text-xs text-red-400">
			<TrendingDown className="h-3 w-3" />
			{delta}
		</span>
	);
}

function EntryRow({
	entry,
	onRemove,
}: {
	entry: WatchlistEntry;
	onRemove: (skill: string) => void;
}) {
	return (
		<tr className="border-t hover:bg-muted/30">
			<td className="px-4 py-2.5">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{entry.skill}</span>
					{entry.label && (
						<span className="text-xs text-muted-foreground">
							({entry.label})
						</span>
					)}
					{entry.pendingMatchCount > 0 && (
						<Badge className="h-4 px-1 text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30">
							{entry.pendingMatchCount} new
						</Badge>
					)}
				</div>
				{entry.titlePattern && (
					<p className="text-[10px] text-muted-foreground mt-0.5">
						title filter: {entry.titlePattern}
					</p>
				)}
			</td>
			<td className="px-4 py-2.5 text-right tabular-nums text-sm">
				{entry.latestCount}
			</td>
			<td className="px-4 py-2.5">
				<DeltaChip delta={entry.delta} />
			</td>
			<td className="px-4 py-2.5">
				<Sparkline trend={entry.trend} />
			</td>
			<td className="px-4 py-2.5 text-xs text-muted-foreground">
				{entry.lastMatchAt
					? new Date(entry.lastMatchAt).toLocaleDateString()
					: "—"}
			</td>
			<td className="px-4 py-2.5">
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 text-muted-foreground hover:text-destructive"
					onClick={() => onRemove(entry.skill)}
					title="Remove from watchlist"
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			</td>
		</tr>
	);
}

export default function WatchlistPage() {
	const qc = useQueryClient();
	const [skillInput, setSkillInput] = useState("");
	const [labelInput, setLabelInput] = useState("");
	const [titlePatternInput, setTitlePatternInput] = useState("");

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.skillWatchlist.list(),
		queryFn: api.getWatchlist,
		refetchOnWindowFocus: true,
	});

	const addMutation = useMutation({
		mutationFn: api.addWatchlistEntry,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.skillWatchlist.all });
			setSkillInput("");
			setLabelInput("");
			setTitlePatternInput("");
			toast.success("Added to watchlist");
		},
		onError: () => toast.error("Failed to add skill"),
	});

	const removeMutation = useMutation({
		mutationFn: api.removeWatchlistEntry,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.skillWatchlist.all });
			toast.success("Removed from watchlist");
		},
		onError: () => toast.error("Failed to remove skill"),
	});

	const markSeenMutation = useMutation({
		mutationFn: api.markWatchlistSeen,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.skillWatchlist.all });
		},
	});

	function handleAdd() {
		const skill = skillInput.trim();
		if (!skill) return;
		addMutation.mutate({
			skill,
			label: labelInput.trim() || undefined,
			titlePattern: titlePatternInput.trim() || undefined,
		});
	}

	const entries = data?.entries ?? [];
	const totalPending = data?.totalPending ?? 0;

	return (
		<>
			<PageHeader
				icon={Bell}
				title="Skill Watchlist"
				subtitle="Track niche skills and get alerts when new jobs match"
			/>
			<PageMain>
				<div className="space-y-6">
					{/* Add entry form */}
					<div className="rounded-lg border bg-card/50 p-4 space-y-3">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
							Add to watchlist
						</p>
						<div className="flex flex-wrap gap-2">
							<Input
								placeholder="Skill (e.g. apache beam)"
								value={skillInput}
								onChange={(e) => setSkillInput(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleAdd()}
								className="max-w-xs"
							/>
							<Input
								placeholder="Label (optional)"
								value={labelInput}
								onChange={(e) => setLabelInput(e.target.value)}
								className="max-w-[180px]"
							/>
							<Input
								placeholder="Title filter (optional)"
								value={titlePatternInput}
								onChange={(e) => setTitlePatternInput(e.target.value)}
								className="max-w-[220px]"
							/>
							<Button
								size="sm"
								onClick={handleAdd}
								disabled={!skillInput.trim() || addMutation.isPending}
							>
								<Plus className="mr-1.5 h-3.5 w-3.5" />
								Watch
							</Button>
						</div>
					</div>

					{/* Pending alert bar */}
					{totalPending > 0 && (
						<div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
							<div className="flex items-center gap-2 text-sm text-amber-400">
								<Bell className="h-4 w-4" />
								<span>
									<span className="font-semibold">{totalPending}</span> new job
									{totalPending !== 1 ? "s" : ""} matched your watchlist since
									last check
								</span>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs text-amber-400 hover:text-amber-300"
								onClick={() => markSeenMutation.mutate()}
								disabled={markSeenMutation.isPending}
							>
								<BellOff className="mr-1 h-3 w-3" />
								Mark seen
							</Button>
						</div>
					)}

					{/* Table */}
					{isLoading && (
						<p className="py-12 text-center text-sm text-muted-foreground">
							Loading…
						</p>
					)}
					{error && (
						<p className="py-12 text-center text-sm text-destructive">
							Failed to load watchlist.
						</p>
					)}

					{!isLoading && !error && entries.length === 0 && (
						<div className="py-12 text-center space-y-2">
							<p className="text-sm text-muted-foreground">
								No skills in your watchlist yet.
							</p>
							<p className="text-xs text-muted-foreground">
								Add a skill above to start tracking its demand in your job
								database.
							</p>
						</div>
					)}

					{entries.length > 0 && (
						<div className="overflow-auto rounded-lg border">
							<table className="w-full text-sm">
								<thead className="bg-muted/50">
									<tr>
										<th className="px-4 py-2 text-left">Skill</th>
										<th className="px-4 py-2 text-right">Latest count</th>
										<th className="px-4 py-2 text-left">Week Δ</th>
										<th className="px-4 py-2 text-left">8-week trend</th>
										<th className="px-4 py-2 text-left">Last match</th>
										<th className="px-4 py-2" />
									</tr>
								</thead>
								<tbody>
									{entries.map((entry) => (
										<EntryRow
											key={entry.id}
											entry={entry}
											onRemove={(skill) => removeMutation.mutate(skill)}
										/>
									))}
								</tbody>
							</table>
						</div>
					)}

					{entries.length > 0 && (
						<p className="text-xs text-muted-foreground">
							Trend data is updated when you run the snapshot script (
							<code>npm run snapshot:skills</code>). New match alerts are set
							automatically after each pipeline run.
						</p>
					)}
				</div>
			</PageMain>
		</>
	);
}

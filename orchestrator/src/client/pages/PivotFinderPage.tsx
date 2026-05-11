import * as api from "@client/api";
import type { PivotCluster } from "@client/api/jobs";
import { getPivotClusters } from "@client/api/jobs";
import { PageHeader, PageMain } from "@client/components/layout";
import { queryKeys } from "@client/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { GitMerge, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function formatCurrency(amount: number | null): string {
	if (amount == null) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0,
		notation: "compact",
	}).format(amount);
}

function OverlapRing({ pct }: { pct: number }) {
	const color =
		pct >= 60
			? "text-emerald-400"
			: pct >= 35
				? "text-amber-400"
				: "text-muted-foreground";
	return (
		<div className={`text-2xl font-bold tabular-nums ${color}`}>{pct}%</div>
	);
}

function ClusterCard({ cluster }: { cluster: PivotCluster }) {
	return (
		<div className="rounded-xl border bg-card/80 p-4 space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="font-semibold text-sm leading-tight capitalize">
						{cluster.representativeTitle}
					</h3>
					<p className="text-xs text-muted-foreground mt-0.5">
						{cluster.jobCount} posting{cluster.jobCount !== 1 ? "s" : ""}
						{cluster.topEmployers.length > 0 &&
							` · ${cluster.topEmployers.slice(0, 2).join(", ")}`}
					</p>
				</div>
				<div className="shrink-0 text-right">
					<OverlapRing pct={cluster.overlapPct} />
					<p className="text-[10px] text-muted-foreground">overlap</p>
				</div>
			</div>

			{cluster.bridgeSkills.length > 0 && (
				<div>
					<p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
						Bridge skills to learn
					</p>
					<div className="flex flex-wrap gap-1">
						{cluster.bridgeSkills.map((s) => (
							<Badge
								key={s}
								variant="outline"
								className="text-[10px] border-amber-500/30 bg-amber-500/5 text-amber-400"
							>
								{s}
							</Badge>
						))}
					</div>
				</div>
			)}

			<div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border/40">
				{cluster.avgScore != null && (
					<span>
						Avg match:{" "}
						<span className="font-medium text-foreground">
							{cluster.avgScore}
						</span>
					</span>
				)}
				<span>
					Median salary:{" "}
					<span className="font-medium text-foreground">
						{formatCurrency(cluster.medianSalaryMin)}
					</span>
				</span>
			</div>
		</div>
	);
}

export const PivotFinderPage = () => {
	const [inputValue, setInputValue] = useState("");
	const [committedSkills, setCommittedSkills] = useState<string[]>([]);

	const { data: skillGapData } = useQuery({
		queryKey: queryKeys.jobs.skillGap(),
		queryFn: () => api.getSkillGapStats(),
		staleTime: 5 * 60 * 1000,
	});

	useEffect(() => {
		if (
			skillGapData?.userSkills &&
			skillGapData.userSkills.length > 0 &&
			committedSkills.length === 0
		) {
			const preset = skillGapData.userSkills.slice(0, 20);
			setCommittedSkills(preset);
			setInputValue(preset.join(", "));
		}
	}, [skillGapData, committedSkills.length]);

	const { data, isLoading, isFetching } = useQuery({
		queryKey: queryKeys.jobs.pivotClusters(committedSkills),
		queryFn: () => getPivotClusters(committedSkills),
		enabled: committedSkills.length > 0,
		staleTime: 5 * 60 * 1000,
	});

	const clusters = data?.clusters ?? [];

	function handleSearch() {
		const skills = inputValue
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 50);
		setCommittedSkills(skills);
	}

	return (
		<>
			<PageHeader
				icon={GitMerge}
				title="Pivot Finder"
				subtitle="Given your skills, find the closest job clusters and smallest learning deltas"
			/>
			<PageMain>
				<div className="space-y-6">
					<div className="flex gap-2">
						<Input
							placeholder="java, kafka, spring boot, aws, …"
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleSearch()}
							className="max-w-xl"
						/>
						<Button
							onClick={handleSearch}
							disabled={isLoading || isFetching}
							size="sm"
						>
							<Search className="mr-1.5 h-3.5 w-3.5" />
							Find pivots
						</Button>
					</div>

					{committedSkills.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{committedSkills.map((s) => (
								<Badge key={s} variant="secondary" className="text-[10px]">
									{s}
								</Badge>
							))}
						</div>
					)}

					{(isLoading || isFetching) && (
						<p className="text-sm text-muted-foreground py-8 text-center">
							Clustering jobs…
						</p>
					)}

					{!isLoading &&
						!isFetching &&
						committedSkills.length > 0 &&
						clusters.length === 0 && (
							<p className="text-sm text-muted-foreground py-8 text-center">
								No clusters found with ≥10% overlap. Try adding more skills.
							</p>
						)}

					{clusters.length > 0 && (
						<div>
							<p className="text-xs text-muted-foreground mb-3">
								Showing {clusters.length} job cluster
								{clusters.length !== 1 ? "s" : ""} sorted by overlap with your{" "}
								{committedSkills.length} skills. Amber badges are skills you
								don&apos;t have yet.
							</p>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{clusters.map((c) => (
									<ClusterCard key={c.id} cluster={c} />
								))}
							</div>
						</div>
					)}

					{committedSkills.length === 0 && !isLoading && (
						<div className="py-12 text-center text-sm text-muted-foreground">
							Enter your skills above to find adjacent career clusters.
						</div>
					)}
				</div>
			</PageMain>
		</>
	);
};

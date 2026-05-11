import * as api from "@client/api";
import type { SkillDemandEntry } from "@client/api/jobs";
import { getSkillDemand } from "@client/api/jobs";
import { PageHeader, PageMain } from "@client/components/layout";
import { queryKeys } from "@client/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
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

function OverlapBar({ pct }: { pct: number }) {
	const cls =
		pct >= 60
			? "bg-emerald-500"
			: pct >= 35
				? "bg-amber-500"
				: "bg-muted-foreground/40";
	return (
		<div className="flex items-center gap-2">
			<div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
				<div
					className={`h-full rounded-full ${cls}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="text-xs tabular-nums">{pct}%</span>
		</div>
	);
}

function ResultRow({ item }: { item: SkillDemandEntry }) {
	const navigate = useNavigate();
	return (
		<tr
			className="border-t hover:bg-muted/30 cursor-pointer"
			onClick={() =>
				navigate(`/jobs/all?title=${encodeURIComponent(item.title)}`)
			}
		>
			<td className="px-4 py-2.5 font-medium text-sm">{item.title}</td>
			<td className="px-4 py-2.5">
				<OverlapBar pct={item.overlapPct} />
			</td>
			<td className="px-4 py-2.5 text-right text-sm tabular-nums">
				{item.jobCount}
			</td>
			<td className="px-4 py-2.5 text-right text-sm tabular-nums">
				{item.avgScore != null ? (
					item.avgScore
				) : (
					<span className="text-muted-foreground">—</span>
				)}
			</td>
			<td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">
				{formatCurrency(item.medianSalaryMin)}
			</td>
			<td className="px-4 py-2.5 text-xs text-muted-foreground">
				{item.topEmployers.join(", ") || "—"}
			</td>
		</tr>
	);
}

export const SkillDemandPage = () => {
	const [inputValue, setInputValue] = useState("");
	const [committedSkills, setCommittedSkills] = useState<string[]>([]);

	// Load user skills from skill-gap stats on mount to pre-fill
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
		queryKey: queryKeys.jobs.skillDemand(committedSkills),
		queryFn: () => getSkillDemand(committedSkills),
		enabled: committedSkills.length > 0,
		staleTime: 5 * 60 * 1000,
	});

	const results = data?.results ?? [];

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
				icon={TrendingUp}
				title="Skill Demand"
				subtitle="Find which job titles want your skills the most — ranked by overlap and demand"
			/>
			<PageMain>
				<div className="space-y-6">
					{/* Search bar */}
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
							Search
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
							Analyzing market…
						</p>
					)}

					{!isLoading &&
						!isFetching &&
						committedSkills.length > 0 &&
						results.length === 0 && (
							<p className="text-sm text-muted-foreground py-8 text-center">
								No job titles found with ≥10% skill overlap. Try more skills or
								broader terms.
							</p>
						)}

					{results.length > 0 && (
						<div className="overflow-auto rounded-lg border">
							<table className="w-full text-sm">
								<thead className="bg-muted/50">
									<tr>
										<th className="px-4 py-2 text-left">Job Title</th>
										<th className="px-4 py-2 text-left">Your overlap</th>
										<th className="px-4 py-2 text-right">Postings</th>
										<th className="px-4 py-2 text-right">Avg Score</th>
										<th className="px-4 py-2 text-right">Median Salary</th>
										<th className="px-4 py-2 text-left">Top Employers</th>
									</tr>
								</thead>
								<tbody>
									{results.map((item) => (
										<ResultRow key={item.title} item={item} />
									))}
								</tbody>
							</table>
						</div>
					)}

					{committedSkills.length === 0 && !isLoading && (
						<div className="py-12 text-center text-sm text-muted-foreground">
							Enter skills above to see which job titles in your database demand
							them.
						</div>
					)}
				</div>
			</PageMain>
		</>
	);
};

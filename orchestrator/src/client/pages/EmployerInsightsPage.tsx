import { PageHeader, PageMain } from "@client/components/layout";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import type { OeEmployerEntry } from "../api/jobs";
import * as api from "../api/jobs";
import { queryKeys } from "../lib/queryKeys";

function OeScoreBadge({ score }: { score: number }) {
	const cls =
		score >= 70
			? "bg-emerald-500/15 text-emerald-400"
			: score >= 50
				? "bg-amber-500/15 text-amber-400"
				: "bg-red-500/15 text-red-400";
	return (
		<span
			className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono font-semibold ${cls}`}
		>
			{score}
		</span>
	);
}

function RedFlagSummary({ counts }: { counts: Record<string, number> }) {
	const entries = Object.entries(counts);
	if (entries.length === 0)
		return <span className="text-muted-foreground text-xs">—</span>;
	return (
		<span className="text-xs text-muted-foreground">
			{entries
				.sort((a, b) => b[1] - a[1])
				.slice(0, 2)
				.map(([id, n]) => (
					<span key={id} className="mr-1">
						{id.replace(/_/g, " ")} ({n})
					</span>
				))}
		</span>
	);
}

function OeEmployerTable({ items }: { items: OeEmployerEntry[] }) {
	if (items.length === 0) {
		return (
			<div className="py-8 text-center text-sm text-muted-foreground">
				No OE-scored employers yet. Run the pipeline to generate scores.
			</div>
		);
	}
	return (
		<div className="overflow-auto rounded-lg border">
			<table className="w-full text-sm">
				<thead className="bg-muted/50">
					<tr>
						<th className="px-4 py-2 text-left">Employer</th>
						<th className="px-4 py-2 text-right">Postings</th>
						<th className="px-4 py-2 text-right">Avg OE Fit</th>
						<th className="px-4 py-2 text-right">Avg Async</th>
						<th className="px-4 py-2 text-left">Top Red Flags</th>
					</tr>
				</thead>
				<tbody>
					{items.map((item) => (
						<tr key={item.employer} className="border-t hover:bg-muted/30">
							<td className="px-4 py-2 font-medium">{item.employer}</td>
							<td className="px-4 py-2 text-right text-muted-foreground">
								{item.postingCount}
							</td>
							<td className="px-4 py-2 text-right">
								<OeScoreBadge score={item.avgOeFitnessScore} />
							</td>
							<td className="px-4 py-2 text-right">
								{item.avgAsyncScore != null ? (
									<OeScoreBadge score={item.avgAsyncScore} />
								) : (
									<span className="text-xs text-muted-foreground">—</span>
								)}
							</td>
							<td className="px-4 py-2">
								<RedFlagSummary counts={item.redFlagCounts} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default function EmployerInsightsPage() {
	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.jobs.employerInsights(),
		queryFn: api.getEmployerInsights,
	});

	const churnItems = data?.highChurnEmployers ?? [];
	const oeItems = data?.oeEmployerIndex ?? [];

	return (
		<>
			<PageHeader
				icon={Building2}
				title="Employer Insights"
				subtitle="OE-friendly employer index and high-churn signals"
			/>
			<PageMain>
				{isLoading && (
					<div className="py-12 text-center text-muted-foreground">
						Loading...
					</div>
				)}
				{error && (
					<div className="py-12 text-center text-destructive">
						Failed to load employer insights.
					</div>
				)}

				{!isLoading && !error && (
					<div className="space-y-8">
						{/* OE employer index */}
						<section>
							<h2 className="mb-3 text-sm font-semibold">
								OE-Friendly Employers
								<span className="ml-1.5 text-xs font-normal text-muted-foreground">
									(≥3 scored postings, sorted by avg OE fitness)
								</span>
							</h2>
							<OeEmployerTable items={oeItems} />
						</section>

						{/* High churn */}
						<section>
							<h2 className="mb-3 text-sm font-semibold">
								High Churn Employers
								<span className="ml-1.5 text-xs font-normal text-muted-foreground">
									(last 60 days, repost score ≥ 2× — may indicate high turnover)
								</span>
							</h2>
							{churnItems.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">
									No high-churn employers detected in the last 60 days.
								</div>
							) : (
								<div className="overflow-auto rounded-lg border">
									<table className="w-full text-sm">
										<thead className="bg-muted/50">
											<tr>
												<th className="px-4 py-2 text-left">Employer</th>
												<th className="px-4 py-2 text-left">Role Pattern</th>
												<th className="px-4 py-2 text-right">Postings</th>
												<th className="px-4 py-2 text-right">Repost Score</th>
												<th className="px-4 py-2 text-left">First Seen</th>
											</tr>
										</thead>
										<tbody>
											{churnItems.map((item) => (
												<tr
													key={`${item.employer}||${item.title}`}
													className="border-t hover:bg-muted/30"
												>
													<td className="px-4 py-2 font-medium">
														{item.employer}
													</td>
													<td className="px-4 py-2 text-muted-foreground">
														{item.title}
													</td>
													<td className="px-4 py-2 text-right">{item.count}</td>
													<td className="px-4 py-2 text-right">
														<span
															className={
																"font-mono px-1.5 py-0.5 rounded text-xs " +
																(item.repostScore >= 4
																	? "bg-destructive/20 text-destructive"
																	: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400")
															}
														>
															{item.repostScore.toFixed(1)}x
														</span>
													</td>
													<td className="px-4 py-2 text-muted-foreground text-xs">
														{new Date(item.firstSeenAt).toLocaleDateString()}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</section>
					</div>
				)}
			</PageMain>
		</>
	);
}

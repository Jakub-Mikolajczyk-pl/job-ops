import * as api from "@client/api";
import { getMarketTrend } from "@client/api/jobs";
import { PageHeader, PageMain } from "@client/components/layout";
import { queryKeys } from "@client/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";

const SOURCE_LABELS: Record<string, string> = {
	nofluffjobs: "NoFluffJobs",
	pracujpl: "pracuj.pl",
	justjoinit: "JustJoinIT",
	bulldogjob: "BulldogJob",
	theprotocol: "theprotocol.it",
	hiringcafe: "HiringCafe",
};

function ScoreBar({ value, max }: { value: number; max: number }) {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;
	return (
		<div className="flex items-center gap-2">
			<div className="h-2 flex-1 rounded-full bg-muted">
				<div
					className="h-2 rounded-full bg-primary"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
				{value}
			</span>
		</div>
	);
}

const marketChartConfig = {
	jobsAbove60: { label: "Score ≥60", color: "var(--chart-1)" },
	jobsAbove75: { label: "Score ≥75", color: "var(--chart-2)" },
	totalJobs: { label: "All Jobs", color: "var(--chart-3)" },
};

export const MarketStatsPage: React.FC = () => {
	const [trendWeeks, setTrendWeeks] = useState(8);

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.jobs.marketStats(),
		queryFn: () => api.getMarketStats(),
		staleTime: 60_000,
	});

	const { data: trendData } = useQuery({
		queryKey: queryKeys.jobs.marketTrend(trendWeeks),
		queryFn: () => getMarketTrend(trendWeeks),
		staleTime: 5 * 60_000,
	});

	return (
		<>
			<PageHeader
				icon={BarChart3}
				title="Market Stats"
				subtitle="Aggregated insights from collected job listings"
			/>
			<PageMain>
				{isLoading && (
					<div className="flex items-center justify-center py-20 text-muted-foreground">
						Loading stats...
					</div>
				)}
				{error && (
					<div className="py-10 text-center text-sm text-destructive">
						Failed to load stats.
					</div>
				)}
				{data && (
					<div className="space-y-6">
						<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<Card>
								<CardContent className="p-4">
									<div className="text-2xl font-semibold tabular-nums">
										{data.totalJobs}
									</div>
									<div className="text-xs text-muted-foreground">
										Total Jobs
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="p-4">
									<div className="text-2xl font-semibold tabular-nums">
										{data.bySource.length}
									</div>
									<div className="text-xs text-muted-foreground">Sources</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="p-4">
									<div className="text-2xl font-semibold tabular-nums">
										{data.scoreDistribution.find((d) => d.bracket === "80-100")
											?.count ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">Score 80+</div>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="p-4">
									<div className="text-2xl font-semibold tabular-nums">
										{data.salaryCount}
									</div>
									<div className="text-xs text-muted-foreground">
										With Salary
									</div>
								</CardContent>
							</Card>
						</div>

						<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium">
										Jobs by Source
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									{data.bySource.map(({ source, count, avgScore }) => (
										<div key={source}>
											<div className="mb-1 flex justify-between text-xs">
												<span className="font-medium">
													{SOURCE_LABELS[source] ?? source}
												</span>
												<span className="text-muted-foreground">
													{count} jobs
													{avgScore != null ? ` - avg ${avgScore}` : ""}
												</span>
											</div>
											<ScoreBar
												value={count}
												max={data.bySource[0]?.count ?? 1}
											/>
										</div>
									))}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium">
										Score Distribution
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-3">
									{["80-100", "60-79", "40-59", "20-39", "0-19"].map(
										(bracket) => {
											const entry = data.scoreDistribution.find(
												(d) => d.bracket === bracket,
											);
											const count = entry?.count ?? 0;
											const maxCount = Math.max(
												...data.scoreDistribution.map((d) => d.count),
												1,
											);
											return (
												<div key={bracket}>
													<div className="mb-1 flex justify-between text-xs">
														<span className="font-medium">{bracket}</span>
														<span className="text-muted-foreground">
															{count}
														</span>
													</div>
													<ScoreBar value={count} max={maxCount} />
												</div>
											);
										},
									)}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium">
										Top Technologies
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-2">
									{data.topSkills.map(({ skill, count }) => (
										<div key={skill}>
											<div className="mb-1 flex justify-between text-xs">
												<span className="font-medium">{skill}</span>
												<span className="text-muted-foreground">{count}</span>
											</div>
											<ScoreBar
												value={count}
												max={data.topSkills[0]?.count ?? 1}
											/>
										</div>
									))}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium">
										Top Employers
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-2">
									{data.topEmployers.map(({ employer, count, avgScore }) => (
										<div key={employer}>
											<div className="mb-1 flex justify-between text-xs">
												<span
													className="font-medium truncate max-w-xs"
													title={employer}
												>
													{employer}
												</span>
												<span className="text-muted-foreground">
													{count}
													{avgScore != null ? ` - ${avgScore}` : ""}
												</span>
											</div>
											<ScoreBar
												value={count}
												max={data.topEmployers[0]?.count ?? 1}
											/>
										</div>
									))}
								</CardContent>
							</Card>
						</div>

						{/* Profile market trend */}
						{trendData && trendData.weeks.length > 0 && (
							<Card>
								<CardHeader className="flex flex-row items-center justify-between pb-2">
									<CardTitle className="text-sm font-medium">
										Profile Match Trend
									</CardTitle>
									<div className="flex gap-1 text-xs">
										{[8, 12, 26].map((w) => (
											<button
												key={w}
												type="button"
												onClick={() => setTrendWeeks(w)}
												className={`rounded px-2 py-0.5 ${
													trendWeeks === w
														? "bg-primary/20 font-semibold"
														: "text-muted-foreground hover:bg-muted"
												}`}
											>
												{w}w
											</button>
										))}
									</div>
								</CardHeader>
								<CardContent>
									{trendData.alert && (
										<div
											className={`mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
												trendData.alert === "drop"
													? "border-red-500/30 bg-red-500/10 text-red-400"
													: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
											}`}
										>
											{trendData.alert === "drop" ? (
												<TrendingDown className="h-3.5 w-3.5 shrink-0" />
											) : (
												<TrendingUp className="h-3.5 w-3.5 shrink-0" />
											)}
											<span>
												{trendData.alert === "drop"
													? `Market match rate dropped ~${trendData.alertPct}% vs prior period — consider rebranding or broadening skills.`
													: `Market match rate rose ~${trendData.alertPct}% vs prior period.`}
											</span>
										</div>
									)}
									<ChartContainer
										config={marketChartConfig}
										className="h-[220px] w-full"
									>
										<LineChart
											data={trendData.weeks}
											margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
										>
											<CartesianGrid vertical={false} />
											<XAxis
												dataKey="week"
												tickLine={false}
												axisLine={false}
												tickMargin={6}
												tickFormatter={(v: string) =>
													new Date(`${v}T00:00:00Z`).toLocaleDateString(
														"en-GB",
														{ month: "short", day: "numeric" },
													)
												}
											/>
											<YAxis tickLine={false} axisLine={false} width={32} />
											<ChartTooltip content={<ChartTooltipContent />} />
	
											<Line
												type="monotone"
												dataKey="jobsAbove60"
												stroke="var(--color-jobsAbove60)"
												dot={false}
												strokeWidth={2}
											/>
											<Line
												type="monotone"
												dataKey="jobsAbove75"
												stroke="var(--color-jobsAbove75)"
												dot={false}
												strokeWidth={2}
											/>
											<Line
												type="monotone"
												dataKey="totalJobs"
												stroke="var(--color-totalJobs)"
												dot={false}
												strokeWidth={1.5}
												strokeDasharray="4 2"
											/>
										</LineChart>
									</ChartContainer>
									{trendData.weeks.length < 2 && (
										<p className="mt-2 text-center text-xs text-muted-foreground">
											Run{" "}
											<code className="font-mono">
												npm run snapshots:market
											</code>{" "}
											weekly to build trend history.
										</p>
									)}
								</CardContent>
							</Card>
						)}

						{data.salaryCount > 0 ? (
							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium">
										Salary Data ({data.salaryCount} jobs with salary)
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="overflow-x-auto">
										<table className="w-full text-xs">
											<thead>
												<tr className="border-b text-muted-foreground">
													<th className="pb-2 text-left font-medium">Title</th>
													<th className="pb-2 text-left font-medium">
														Employer
													</th>
													<th className="pb-2 text-left font-medium">Salary</th>
													<th className="pb-2 text-right font-medium">Score</th>
													<th className="pb-2 text-left font-medium pl-3">
														Source
													</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-border">
												{data.salarySamples.map((row) => (
													<tr
														key={`${row.source}||${row.employer}||${row.title}`}
														className="hover:bg-muted/30"
													>
														<td
															className="py-1.5 pr-3 font-medium max-w-48 truncate"
															title={row.title}
														>
															{row.title}
														</td>
														<td
															className="py-1.5 pr-3 text-muted-foreground max-w-36 truncate"
															title={row.employer}
														>
															{row.employer}
														</td>
														<td className="py-1.5 pr-3 font-mono text-green-400">
															{row.salary}
														</td>
														<td className="py-1.5 pr-3 tabular-nums text-right">
															{row.score ?? "-"}
														</td>
														<td className="py-1.5 pl-3 text-muted-foreground">
															{SOURCE_LABELS[row.source] ?? row.source}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</CardContent>
							</Card>
						) : (
							<Card>
								<CardContent className="p-6 text-center text-sm text-muted-foreground">
									No salary data yet. Run a new pipeline to start collecting
									salary info.
								</CardContent>
							</Card>
						)}
					</div>
				)}
			</PageMain>
		</>
	);
};

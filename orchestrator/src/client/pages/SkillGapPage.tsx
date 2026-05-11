import * as api from "@client/api";
import { getJobsBySkill, getSkillCooccurrence, getSkillTrends } from "@client/api/jobs";
import type { JobsBySkillEntry, SkillCooccurrenceEntry, SkillGapEntry, SkillTrend } from "@client/api/jobs";
import { addSkillExclusion, removeSkillExclusion } from "@client/api/skill-exclusions";
import { PageHeader, PageMain } from "@client/components/layout";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, EyeOff, Info, RotateCcw, XCircle } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link } from "react-router";
import { queryKeys } from "@/client/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const MIN_SCORE_OPTIONS = [0, 40, 50, 60, 70] as const;

function SkillDrillPanel({
  skill,
  minScore,
  userSkills,
  onClose,
}: {
  skill: string | null;
  minScore: number;
  userSkills: string[];
  onClose: () => void;
}) {
  const [bridgeOnly, setBridgeOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.jobs.bySkill(skill ?? "", minScore),
    queryFn: () => getJobsBySkill(skill!, minScore),
    enabled: skill !== null,
    staleTime: 60_000,
  });

  const { data: coData } = useQuery({
    queryKey: queryKeys.jobs.skillCooccurrence(skill ?? "", minScore),
    queryFn: () => getSkillCooccurrence(skill!, userSkills, minScore, 12),
    enabled: skill !== null,
    staleTime: 60_000,
  });

  const jobList: JobsBySkillEntry[] = data?.jobs ?? [];
  const coList: SkillCooccurrenceEntry[] = coData?.results ?? [];
  const filteredCo = bridgeOnly ? coList.filter((c) => !c.isUserSkill) : coList;

  return (
    <Sheet open={skill !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            Jobs requiring <span className="font-mono text-primary">{skill}</span>
            <Badge variant="outline" className="ml-auto">{jobList.length}</Badge>
          </SheetTitle>
        </SheetHeader>

        {/* Co-occurrence section */}
        {coList.length > 0 && (
          <div className="mb-4 rounded-md border border-border/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Skills that often appear with <span className="text-foreground">{skill}</span></p>
              <button
                type="button"
                className={`text-[10px] rounded px-1.5 py-0.5 transition-colors ${bridgeOnly ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                onClick={() => setBridgeOnly((v) => !v)}
              >
                Bridges only
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCo.map((c) => (
                <span
                  key={c.skill}
                  title={`${c.cooccurrenceRate}% co-occurrence (${c.jointCount} jobs)`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border ${
                    c.isUserSkill
                      ? "border-green-500/30 bg-green-500/10 text-green-400"
                      : "border-border/60 bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {c.skill}
                  <span className="opacity-60">{c.cooccurrenceRate}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
        )}
        {!isLoading && jobList.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">No jobs found.</p>
        )}
        <div className="divide-y divide-border/50">
          {jobList.map((job) => (
            <div key={job.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/jobs/${job.id}`}
                    className="text-sm font-medium hover:underline line-clamp-2 flex items-center gap-1"
                    onClick={onClose}
                  >
                    {job.title}
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </Link>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{job.employer}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-semibold tabular-nums">{job.score}</span>
                  <p className="text-[10px] text-muted-foreground uppercase">{job.source}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MatchBar({ matchRate, count }: { matchRate: number; count: number }) {
  const pct = Math.round(matchRate * 100);
  const color =
    pct >= 65 ? "bg-green-500" : pct < 40 ? "bg-red-500" : "bg-yellow-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
      <span className="text-xs text-muted-foreground">({count})</span>
    </div>
  );
}

function skillExplainer(entry: SkillGapEntry): string {
  const pct = Math.round(entry.matchRate * 100);
  if (entry.category === "strength") {
    const cvNote = entry.matchedUserSkill ? ` (matched CV skill: '${entry.matchedUserSkill}')` : "";
    return `You have this skill${cvNote}. It appears in ${entry.count} jobs you score well on, with a ${pct}% high-score rate (≥75). Strong alignment.`;
  }
  if (entry.category === "gap") {
    return `You don't have this skill, but it appears in ${entry.lowScoreCount} jobs where you scored 60–75. Learning it could push those into strong matches. Not in your CV.`;
  }
  return `Catch-all: this skill appears in ${entry.count} jobs${entry.isUserSkill ? " (you have it)" : " (not in your CV)"} but doesn't meet the threshold for strength or gap. High-score rate: ${pct}%.`;
}

function SkillRow({
  entry,
  onDrill,
  onIgnore,
}: {
  entry: SkillGapEntry;
  onDrill: (skill: string) => void;
  onIgnore?: (skill: string) => void;
}) {
  const categoryColor =
    entry.category === "strength"
      ? "text-green-400"
      : entry.category === "gap"
        ? "text-red-400"
        : "text-yellow-400";
  return (
    <div className="group flex items-center gap-1 py-0.5">
      <button
        type="button"
        className="flex flex-1 items-center justify-between gap-2 py-1 hover:bg-muted/30 rounded px-1 text-left transition-colors min-w-0"
        onClick={() => onDrill(entry.skill)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`truncate text-sm font-medium ${categoryColor}`} title={entry.skill}>
            {entry.skill}
          </span>
          {entry.isUserSkill && (
            <Badge variant="outline" className="h-4 shrink-0 border-green-500/40 px-1 text-[10px] text-green-500">
              CV
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-muted-foreground">avg {entry.avgScore}</span>
          <MatchBar matchRate={entry.matchRate} count={entry.count} />
        </div>
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 text-xs" side="left">
          <p className="font-medium mb-1 capitalize">{entry.category}</p>
          <p className="text-muted-foreground leading-relaxed">{skillExplainer(entry)}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>Jobs with skill:</span><span className="text-foreground font-medium">{entry.count}</span>
            <span>High-score (≥75):</span><span className="text-foreground font-medium">{entry.highScoreCount}</span>
            <span>Mid-score (60–75):</span><span className="text-foreground font-medium">{entry.lowScoreCount}</span>
            <span>Match rate:</span><span className="text-foreground font-medium">{Math.round(entry.matchRate * 100)}%</span>
          </div>
        </PopoverContent>
      </Popover>
      {onIgnore && (
        <button
          type="button"
          title="Ignore this skill"
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-muted text-muted-foreground hover:text-foreground"
          onClick={() => onIgnore(entry.skill)}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

type Tab = "all" | "gaps" | "strengths" | "partial";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "strengths", label: "Strengths" },
  { id: "gaps", label: "Gaps" },
  { id: "partial", label: "Partial" },
];

export const SkillGapPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("all");
  const [minScore, setMinScore] = useState(60);
  const [drilledSkill, setDrilledSkill] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.jobs.skillGap(minScore),
    queryFn: () => api.getSkillGapStats(minScore),
    staleTime: 60_000,
  });

  const ignoreMutation = useMutation({
    mutationFn: (skill: string) => addSkillExclusion(skill),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.skillGap(minScore) }),
  });

  const restoreMutation = useMutation({
    mutationFn: (skill: string) => removeSkillExclusion(skill),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.skillGap(minScore) }),
  });

  const filtered = data?.skills.filter((s) => {
    if (tab === "all") return true;
    if (tab === "strengths") return s.category === "strength";
    if (tab === "gaps") return s.category === "gap";
    return s.category === "partial";
  }) ?? [];

  const gaps = data?.skills.filter((s) => s.category === "gap") ?? [];
  const strengths = data?.skills.filter((s) => s.category === "strength") ?? [];
  const partial = data?.skills.filter((s) => s.category === "partial") ?? [];
  const excluded = data?.excludedSkills ?? [];

  return (
    <>
      <SkillDrillPanel skill={drilledSkill} minScore={minScore} userSkills={data?.userSkills ?? []} onClose={() => setDrilledSkill(null)} />
      <PageHeader
        icon={BookOpen}
        title="Skill Gap Analysis"
        subtitle="What the market wants vs. where you stand"
      />
      <PageMain>
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            Analyzing skills...
          </div>
        )}
        {error && (
          <div className="py-10 text-center text-sm text-destructive">
            Failed to load skill gap data.
          </div>
        )}
        {data && (
          <div className="space-y-6">
            {/* Controls */}
            <div className="flex items-center gap-4">
              <label className="text-xs text-muted-foreground">Min score threshold:</label>
              <div className="flex gap-1">
                {MIN_SCORE_OPTIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMinScore(v)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      minScore === v
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {v === 0 ? "All" : `${v}+`}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                Analyzing {data.totalAnalyzed} jobs
              </span>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold tabular-nums">{data.totalAnalyzed}</div>
                  <div className="text-xs text-muted-foreground">Jobs Analyzed</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold tabular-nums text-green-400">{strengths.length}</div>
                  <div className="text-xs text-muted-foreground">Strengths</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold tabular-nums text-red-400">
                    {gaps.length}
                    {excluded.length > 0 && (
                      <span className="text-sm font-normal text-muted-foreground ml-1">({excluded.length} hidden)</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">Skill Gaps</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold tabular-nums text-yellow-400">{partial.length}</div>
                  <div className="text-xs text-muted-foreground">Partial Match</div>
                </CardContent>
              </Card>
            </div>

            {/* Top gaps callout */}
            {gaps.length > 0 && (
              <Card className="border-red-500/30 bg-red-950/10">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-red-400">
                    <XCircle className="h-4 w-4" />
                    Skills to Learn ({gaps.length} gaps — appear in relevant jobs but missing from your CV)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {[...gaps].sort((a, b) => b.count - a.count).map((g) => (
                      <button
                        key={g.skill}
                        type="button"
                        onClick={() => setDrilledSkill(g.skill)}
                        className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-950/20 px-2 py-1 hover:bg-red-950/40 transition-colors"
                      >
                        <span className="text-sm font-medium text-red-300">{g.skill}</span>
                        <Badge variant="outline" className="h-4 border-red-500/30 px-1 text-xs text-red-400">
                          {g.count} jobs
                        </Badge>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Top strengths callout */}
            {strengths.length > 0 && (
              <Card className="border-green-500/30 bg-green-950/10">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Your Strengths ({strengths.length} skills from your CV that match well)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {[...strengths].sort((a, b) => b.count - a.count).map((s) => (
                      <button
                        key={s.skill}
                        type="button"
                        onClick={() => setDrilledSkill(s.skill)}
                        className="flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-950/20 px-2 py-1 hover:bg-green-950/40 transition-colors"
                      >
                        <span className="text-sm font-medium text-green-300">{s.skill}</span>
                        <Badge variant="outline" className="h-4 border-green-500/30 px-1 text-xs text-green-400">
                          {s.count} jobs · {Math.round(s.matchRate * 100)}%
                        </Badge>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Detailed table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">All Skills Detail</CardTitle>
                  <div className="flex gap-1">
                    {TABS.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={`rounded px-2 py-1 text-xs transition-colors ${
                          tab === id
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Match rate = % of jobs with this skill where your score was 75+.
                  Skills marked <Badge variant="outline" className="mx-0.5 h-4 border-green-500/40 px-1 text-[10px] text-green-500">CV</Badge> are from your profile.
                  Gaps = skills NOT in your CV that appear in partially-matching jobs.
                </p>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border/50">
                  {filtered.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">No skills in this category.</p>
                  )}
                  {filtered.map((entry) => (
                    <SkillRow
                      key={entry.skill}
                      entry={entry}
                      onDrill={setDrilledSkill}
                      onIgnore={(skill) => ignoreMutation.mutate(skill)}
                    />
                  ))}
                </div>

                {excluded.length > 0 && (
                  <div className="mt-4 border-t border-border/50 pt-3">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowExcluded((v) => !v)}
                    >
                      {showExcluded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Ignored skills ({excluded.length})
                    </button>
                    {showExcluded && (
                      <div className="mt-2 divide-y divide-border/30">
                        {excluded.map((entry) => (
                          <div key={entry.skill} className="flex items-center justify-between py-1">
                            <span className="text-sm text-muted-foreground line-through">{entry.skill}</span>
                            <button
                              type="button"
                              title="Restore this skill"
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted"
                              onClick={() => restoreMutation.mutate(entry.skill)}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      <div className="mt-6">
        <SkillTrendsSection />
      </div>
      </PageMain>
    </>
  );
};

function SkillTrendsSection() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.jobs.skillTrends(8),
    queryFn: () => getSkillTrends(8),
  });

  const trends = data?.trends ?? [];

  if (isLoading) return <p className="text-xs text-muted-foreground px-1">Loading trends...</p>;
  if (trends.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground text-center">
        No skill trend data yet — run <code className="font-mono text-xs">npm run snapshots:capture</code> inside the container to capture the first snapshot.
      </div>
    );
  }

  const maxCount = Math.max(...trends.map((t) => t.latestCount), 1);

  return (
    <div className="rounded-lg border">
      <div className="px-4 py-3 border-b">
        <h2 className="text-sm font-semibold">Skill Demand Trends (8 weeks)</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Top skills by current job count. Green = growing, red = declining.</p>
      </div>
      <div className="divide-y divide-border/50">
        {trends.slice(0, 20).map((t) => (
          <TrendRow key={t.skill} trend={t} maxCount={maxCount} />
        ))}
      </div>
    </div>
  );
}

function TrendRow({ trend, maxCount }: { trend: SkillTrend; maxCount: number }) {
  const pct = Math.round((trend.latestCount / maxCount) * 100);
  const deltaColor = trend.delta > 0 ? "text-green-600 dark:text-green-400" : trend.delta < 0 ? "text-red-500" : "text-muted-foreground";
  const deltaStr = trend.delta > 0 ? "+" + trend.delta : String(trend.delta);

  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20">
      <span className="w-36 truncate text-sm capitalize" title={trend.skill}>{trend.skill}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted">
        <div className="h-1.5 rounded-full bg-primary/60" style={{ width: pct + "%" }} />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{trend.latestCount}</span>
      <span className={"w-8 text-right text-xs tabular-nums font-medium " + deltaColor}>{deltaStr}</span>
    </div>
  );
}

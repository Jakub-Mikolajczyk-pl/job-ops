import { PageHeader, PageMain } from "@client/components/layout";
import type {
  RecruitmentIntakeDashboardItem,
  RecruitmentIntakeSource,
} from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { Inbox, ListFilter, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api/recruitmentIntake";
import { queryKeys } from "../lib/queryKeys";

function sourceBadgeTone(source: RecruitmentIntakeSource): string {
  if (source === "telegram_brain_intake") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-700";
  }
  if (source === "telegram") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-700";
  }
  return "border-border bg-muted text-muted-foreground";
}

function statusTone(status: RecruitmentIntakeDashboardItem["status"]): string {
  if (status === "needs_review") return "text-amber-700";
  if (status === "processed") return "text-emerald-700";
  if (status === "error") return "text-destructive";
  return "text-muted-foreground";
}

function CounterCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function RecruitmentIntakePage() {
  const [reviewOnly, setReviewOnly] = useState(false);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.recruitmentIntake.dashboard,
    queryFn: api.fetchRecruitmentIntakeDashboard,
  });

  const items = (data?.items ?? []).filter((item) =>
    reviewOnly ? item.status === "needs_review" : true,
  );

  return (
    <>
      <PageHeader
        icon={Inbox}
        title="Recruitment Intake"
        subtitle="Recent raw intake, extraction state, and review queue"
      />
      <PageMain>
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <CounterCard label="Pending" value={data?.counts.pending ?? 0} />
            <CounterCard
              label="Needs review"
              value={data?.counts.needsReview ?? 0}
            />
            <CounterCard label="Processed" value={data?.counts.processed ?? 0} />
            <CounterCard label="Error" value={data?.counts.error ?? 0} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setReviewOnly((current) => !current)}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                reviewOnly ? "bg-muted" : "bg-background"
              }`}
            >
              <ListFilter className="h-4 w-4" />
              {reviewOnly ? "Showing needs review" : "Needs review only"}
            </button>
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <RefreshCcw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {isLoading && (
            <div className="py-12 text-center text-muted-foreground">
              Loading intake dashboard...
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No intake items match the current filter.
            </div>
          )}

          {!isLoading && items.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">When</th>
                    <th className="px-4 py-3 text-left font-medium">Source</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Preview</th>
                    <th className="px-4 py-3 text-left font-medium">Job</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {items.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${sourceBadgeTone(item.source)}`}
                        >
                          {item.source}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className={`font-medium ${statusTone(item.status)}`}>
                          {item.status}
                        </div>
                        {item.error && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.error}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-xl whitespace-pre-wrap break-words text-sm">
                          {item.rawTextPreview}
                        </div>
                        {item.meta && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            {(item.meta.strategy as string | undefined) ?? "unknown strategy"}
                            {" · "}
                            {(item.meta.inputMode as string | undefined) ?? "unknown mode"}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.jobId ? (
                          <Link className="underline" to={`/job/${item.jobId}`}>
                            Open job
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Unresolved</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageMain>
    </>
  );
}

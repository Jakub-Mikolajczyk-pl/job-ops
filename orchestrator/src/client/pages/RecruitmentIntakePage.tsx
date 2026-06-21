import { PageHeader, PageMain } from "@client/components/layout";
import type {
  RecruitmentIntakeDashboardItem,
  RecruitmentIntakeKind,
  RecruitmentIntakeSource,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  ListFilter,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
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

const actionButton =
  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50";

export function RecruitmentIntakePage() {
  const queryClient = useQueryClient();
  const [reviewOnly, setReviewOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addText, setAddText] = useState("");
  const [addKind, setAddKind] = useState<RecruitmentIntakeKind>("linkedin_msg");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: queryKeys.recruitmentIntake.dashboard,
    queryFn: api.fetchRecruitmentIntakeDashboard,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.recruitmentIntake.dashboard,
    });

  const addOffer = useMutation({
    mutationFn: ({
      text,
      kind,
    }: {
      text: string;
      kind: RecruitmentIntakeKind;
    }) => api.createAndProcessRecruitmentIntake(text, kind),
    onSuccess: () => {
      toast.success("Added and analyzed");
      setAddText("");
      void invalidate();
    },
    onError: (error) => showErrorToast(error, "Could not add offer"),
  });

  const reprocess = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.reprocessRecruitmentIntake(id, force),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => {
      toast.success("Re-ran extraction");
      void invalidate();
    },
    onError: (error) => showErrorToast(error, "Re-run failed"),
    onSettled: () => setBusyId(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteRecruitmentIntake(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: () => {
      toast.success("Deleted intake row");
      void invalidate();
    },
    onError: (error) => showErrorToast(error, "Delete failed"),
    onSettled: () => setBusyId(null),
  });

  const saveEdit = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      await api.updateRecruitmentIntakeText(id, text);
      // PATCH re-arms the row as `pending`; immediately re-extract it.
      return api.reprocessRecruitmentIntake(id);
    },
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => {
      toast.success("Saved and re-extracted");
      setEditingId(null);
      setEditText("");
      void invalidate();
    },
    onError: (error) => showErrorToast(error, "Save failed"),
    onSettled: () => setBusyId(null),
  });

  async function openEditor(id: string) {
    setEditingId(id);
    setEditText("");
    try {
      const row = await api.fetchRecruitmentIntakeRow(id);
      setEditText(row.rawText);
    } catch (error) {
      showErrorToast(error, "Could not load row");
      setEditingId(null);
    }
  }

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
            <CounterCard
              label="Processed"
              value={data?.counts.processed ?? 0}
            />
            <CounterCard label="Error" value={data?.counts.error ?? 0} />
          </div>

          <section className="space-y-2 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Paste an offer</h2>
            <p className="text-xs text-muted-foreground">
              Paste a recruiter message, email, or job description — no link
              needed. It's analyzed into a tracked job (company, role, salary,
              next step).
            </p>
            <textarea
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              rows={5}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="Paste the recruiter's message here…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={addKind}
                onChange={(e) =>
                  setAddKind(e.target.value as RecruitmentIntakeKind)
                }
                className="rounded-md border bg-background px-2 py-2 text-sm"
              >
                <option value="linkedin_msg">LinkedIn message</option>
                <option value="recruiter_email">Recruiter email</option>
                <option value="note">Note</option>
                <option value="job_post">Job post</option>
                <option value="call_transcript">Call transcript</option>
              </select>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={addOffer.isPending || addText.trim().length === 0}
                onClick={() =>
                  addOffer.mutate({ text: addText, kind: addKind })
                }
              >
                <Plus className="h-4 w-4" />
                {addOffer.isPending ? "Analyzing…" : "Add & analyze"}
              </button>
            </div>
          </section>

          {(data?.jobs?.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Jobs from recruiters ({data?.jobs.length})
              </h2>
              <div className="overflow-hidden rounded-lg border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Role</th>
                      <th className="px-4 py-2 text-left font-medium">
                        Status
                      </th>
                      <th className="px-4 py-2 text-left font-medium">Score</th>
                      <th className="px-4 py-2 text-left font-medium">
                        Where / pay
                      </th>
                      <th className="px-4 py-2 text-right font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {data?.jobs.map((job) => (
                      <tr key={job.id} className="align-top">
                        <td className="px-4 py-2">
                          <div className="font-medium">{job.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {job.employer}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {job.status}
                        </td>
                        <td className="px-4 py-2">
                          {job.suitabilityScore ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {[job.location, job.salary]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link className="underline" to={`/job/${job.id}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <h2 className="text-sm font-semibold text-muted-foreground">
            Raw intake queue
          </h2>

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
              <RefreshCcw
                className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
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
                    <th className="px-4 py-3 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {items.map((item) => {
                    const busy = busyId === item.id;
                    const canRerun = item.status !== "pending";
                    return (
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
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.kind}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className={`font-medium ${statusTone(item.status)}`}
                          >
                            {item.status}
                          </div>
                          {item.error && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {item.error}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {editingId === item.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={8}
                                className="w-full min-w-[20rem] rounded-md border bg-background p-2 font-mono text-xs"
                                placeholder="Loading…"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className={actionButton}
                                  disabled={
                                    busy || editText.trim().length === 0
                                  }
                                  onClick={() =>
                                    saveEdit.mutate({
                                      id: item.id,
                                      text: editText,
                                    })
                                  }
                                >
                                  Save & re-extract
                                </button>
                                <button
                                  type="button"
                                  className={actionButton}
                                  disabled={busy}
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditText("");
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="max-w-xl whitespace-pre-wrap break-words text-sm">
                              {item.rawTextPreview}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.jobId ? (
                            <Link
                              className="underline"
                              to={`/job/${item.jobId}`}
                            >
                              Open job
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              Unresolved
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canRerun && (
                              <button
                                type="button"
                                className={actionButton}
                                disabled={busy}
                                title="Re-run extraction"
                                onClick={() =>
                                  reprocess.mutate({
                                    id: item.id,
                                    force: item.status === "processed",
                                  })
                                }
                              >
                                <Play className="h-3 w-3" />
                                Re-run
                              </button>
                            )}
                            <button
                              type="button"
                              className={actionButton}
                              disabled={busy}
                              title="Edit raw text and re-extract"
                              onClick={() => void openEditor(item.id)}
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              className={`${actionButton} text-destructive`}
                              disabled={busy}
                              title="Delete this row"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Delete this intake row? This cannot be undone.",
                                  )
                                ) {
                                  remove.mutate(item.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageMain>
    </>
  );
}

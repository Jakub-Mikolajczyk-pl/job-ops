import { PageHeader, PageMain } from "@client/components/layout";
import type { YourMoveTask } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, Check, Clock, Target } from "lucide-react";
import { Link } from "react-router-dom";
import * as api from "../api/tasks";
import { queryKeys } from "../lib/queryKeys";

function formatDue(dueDate: number | null): string {
  if (dueDate == null) return "no due date";
  return new Date(dueDate * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function TaskRow({
  task,
  tone,
  onComplete,
  onSnooze,
  busy,
}: {
  task: YourMoveTask;
  tone: "overdue" | "today" | "soon";
  onComplete: (id: string) => void;
  onSnooze: (id: string, days: number) => void;
  busy: boolean;
}) {
  const dueColor =
    tone === "overdue"
      ? "text-destructive"
      : tone === "today"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3 hover:bg-muted/20">
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium">{task.title}</div>
        <div className="truncate text-sm text-muted-foreground">
          {task.company} · {task.position}
        </div>
        <div className={`text-xs ${dueColor}`}>{formatDue(task.dueDate)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSnooze(task.id, 1)}
          disabled={busy}
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          title="Snooze 1 day"
        >
          +1d
        </button>
        <button
          type="button"
          onClick={() => onSnooze(task.id, 3)}
          disabled={busy}
          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          title="Snooze 3 days"
        >
          +3d
        </button>
        <button
          type="button"
          onClick={() => onComplete(task.id)}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          title="Mark complete"
        >
          <Check className="h-3 w-3" />
          Done
        </button>
      </div>
    </div>
  );
}

function Bucket({
  title,
  icon: Icon,
  accent,
  tasks,
  onComplete,
  onSnooze,
  busy,
  tone,
}: {
  title: string;
  icon: typeof Clock;
  accent: string;
  tasks: YourMoveTask[];
  onComplete: (id: string) => void;
  onSnooze: (id: string, days: number) => void;
  busy: boolean;
  tone: "overdue" | "today" | "soon";
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className={`flex items-center gap-2 text-sm font-semibold ${accent}`}>
        <Icon className="h-4 w-4" />
        {title} ({tasks.length})
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            tone={tone}
            onComplete={onComplete}
            onSnooze={onSnooze}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}

export function YourMovePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.tasks.yourMove(),
    queryFn: api.getYourMove,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tasks.all });

  const completeMut = useMutation({
    mutationFn: api.completeTask,
    onSuccess: invalidate,
  });
  const snoozeMut = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api.snoozeTask(id, days),
    onSuccess: invalidate,
  });

  const busy = completeMut.isPending || snoozeMut.isPending;
  const onComplete = (id: string) => completeMut.mutate(id);
  const onSnooze = (id: string, days: number) => snoozeMut.mutate({ id, days });

  const overdue = data?.overdue ?? [];
  const today = data?.today ?? [];
  const soon = data?.soon ?? [];
  const needsReview = data?.needsReview ?? [];
  const total = overdue.length + today.length + soon.length;

  return (
    <>
      <PageHeader
        icon={Target}
        title="Your Move"
        subtitle="Action points that need you — overdue first"
      />
      <PageMain>
        <div className="max-w-2xl space-y-6">
          {isLoading && (
            <div className="py-12 text-center text-muted-foreground">
              Loading...
            </div>
          )}

          {!isLoading && total === 0 && needsReview.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              Nothing needs your move right now. 🎉
            </div>
          )}

          <Bucket
            title="Overdue"
            icon={AlertCircle}
            accent="text-destructive"
            tasks={overdue}
            tone="overdue"
            onComplete={onComplete}
            onSnooze={onSnooze}
            busy={busy}
          />
          <Bucket
            title="Today"
            icon={Clock}
            accent="text-amber-600 dark:text-amber-400"
            tasks={today}
            tone="today"
            onComplete={onComplete}
            onSnooze={onSnooze}
            busy={busy}
          />
          <Bucket
            title="Soon"
            icon={CalendarClock}
            accent="text-muted-foreground"
            tasks={soon}
            tone="soon"
            onComplete={onComplete}
            onSnooze={onSnooze}
            busy={busy}
          />

          {needsReview.length > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                Needs review ({needsReview.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Inbound intakes the worker could not confidently match to a job.
                Resolve them from the{" "}
                <Link to="/jobs/all" className="underline">
                  jobs board
                </Link>
                .
              </p>
              <div className="space-y-2">
                {needsReview.map((item) => (
                  <div
                    key={item.intakeId}
                    className="rounded-lg border border-dashed p-3"
                  >
                    <div className="text-xs font-medium text-muted-foreground">
                      {item.source} · {item.kind}
                      {item.reason ? ` — ${item.reason}` : ""}
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm">
                      {item.preview}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </PageMain>
    </>
  );
}

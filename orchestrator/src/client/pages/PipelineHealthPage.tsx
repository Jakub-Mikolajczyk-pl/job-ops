import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import type React from "react";
import { queryKeys } from "@/client/lib/queryKeys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function StatusDot({ status }: { status: "ok" | "warn" | "error" }) {
  const color = status === "ok" ? "bg-green-500" : status === "warn" ? "bg-yellow-500" : "bg-red-500";
  return <span className={"inline-block h-2.5 w-2.5 rounded-full " + color} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.round((now - d.getTime()) / 1000 / 60);
  if (diff < 60) return diff + "m ago";
  if (diff < 60 * 24) return Math.round(diff / 60) + "h ago";
  return Math.round(diff / 60 / 24) + "d ago";
}

export const PipelineHealthPage: React.FC = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.pipeline.health(),
    queryFn: () => api.getPipelineHealth(),
    staleTime: 60_000,
  });

  const rows = data ?? [];
  const errorCount = rows.filter(r => r.status === "error").length;
  const warnCount = rows.filter(r => r.status === "warn").length;

  return (
    <>
      <PageHeader icon={Activity} title="Pipeline Health" subtitle="Extractor run history and error rates" />
      <PageMain>
        {isLoading && <div className="py-20 text-center text-muted-foreground">Loading...</div>}
        {error && <div className="py-10 text-center text-sm text-destructive">Failed to load health data.</div>}
        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold">{rows.length}</div>
                  <div className="text-xs text-muted-foreground">Sources tracked</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold text-yellow-400">{warnCount}</div>
                  <div className="text-xs text-muted-foreground">Warnings (7d)</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-2xl font-semibold text-red-400">{errorCount}</div>
                  <div className="text-xs text-muted-foreground">Errors</div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Sources (last 30 days)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {rows.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No pipeline runs recorded yet.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="pb-2 text-left">Source</th>
                        <th className="pb-2 text-left">Status</th>
                        <th className="pb-2 text-right">Runs</th>
                        <th className="pb-2 text-right">Avg Jobs</th>
                        <th className="pb-2 text-right">Err %</th>
                        <th className="pb-2 text-left pl-3">Last Success</th>
                        <th className="pb-2 text-left pl-3">Last Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => (
                        <tr key={row.source} className={row.status === "error" ? "bg-red-950/20" : row.status === "warn" ? "bg-yellow-950/20" : ""}>
                          <td className="py-2 pr-3 font-medium">{row.source}</td>
                          <td className="py-2 pr-3"><StatusDot status={row.status} /></td>
                          <td className="py-2 pr-3 tabular-nums text-right">{row.runsLast30d}</td>
                          <td className="py-2 pr-3 tabular-nums text-right">{row.avgJobsPerRun}</td>
                          <td className="py-2 pr-3 tabular-nums text-right">{row.errorRateLast30d}%</td>
                          <td className="py-2 pl-3 text-muted-foreground">{formatDate(row.lastSuccessfulRun)}</td>
                          <td className="py-2 pl-3 text-red-400 max-w-48 truncate" title={row.lastError ?? ""}>{row.lastError ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </PageMain>
    </>
  );
};

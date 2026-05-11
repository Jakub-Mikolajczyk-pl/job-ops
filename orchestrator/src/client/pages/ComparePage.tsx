import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows } from "lucide-react";
import type React from "react";
import { useSearchParams, Link } from "react-router-dom";
import * as api from "../api/jobs";
import { PageHeader, PageMain } from "@client/components/layout";
import { queryKeys } from "../lib/queryKeys";
import type { Job } from "@shared/types";

const COMPARE_FIELDS: { label: string; key: keyof Job; format?: (v: unknown) => string }[] = [
  { label: "Status", key: "status" },
  { label: "Location", key: "location" },
  { label: "Salary", key: "salary" },
  { label: "Job Type", key: "jobType" },
  { label: "Job Level", key: "jobLevel" },
  { label: "Remote", key: "isRemote", format: (v) => v === true || v === 1 ? "Yes" : v === false || v === 0 ? "No" : "?" },
  { label: "Suitability", key: "suitabilityScore", format: (v) => v !== null && v !== undefined ? `${v}/100` : "–" },
  { label: "Deadline", key: "deadline" },
  { label: "Source", key: "source" },
  { label: "Discovered", key: "discoveredAt", format: (v) => v ? new Date(v as string).toLocaleDateString() : "–" },
  { label: "Skills", key: "skills" },
  { label: "Experience", key: "experienceRange" },
  { label: "Company Size", key: "companyNumEmployees" },
  { label: "Industry", key: "companyIndustry" },
];

function fmt(v: unknown, formatter?: (v: unknown) => string): string {
  if (formatter) return formatter(v);
  if (v === null || v === undefined || v === "") return "–";
  return String(v);
}

export default function ComparePage() {
  const [params] = useSearchParams();
  const idsRaw = params.get("ids") ?? "";
  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.jobs.compare(ids),
    queryFn: () => api.getJobsCompare(ids),
    enabled: ids.length >= 2,
  });

  const jobs = data?.jobs ?? [];
  const maxCols = Math.min(jobs.length, 5);

  return (
    <>
      <PageHeader
        icon={GitCompareArrows}
        title="Compare Jobs"
        subtitle="Side-by-side comparison of job listings"
      />
      <PageMain>
        {ids.length < 2 && (
          <p className="text-muted-foreground">
            Provide at least 2 job IDs via <code>?ids=id1,id2</code> in the URL.
          </p>
        )}

        {ids.length >= 2 && isLoading && (
          <div className="text-muted-foreground">Loading...</div>
        )}
        {ids.length >= 2 && error && (
          <div className="text-destructive">Failed to load comparison.</div>
        )}

        {jobs.length > 0 && (
          <>
            <div className="overflow-auto rounded-lg border">
              <table className="text-sm w-full min-w-[600px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left w-32 sticky left-0 bg-muted/50">Field</th>
                    {jobs.slice(0, maxCols).map((j) => (
                      <th key={j.id} className="px-4 py-2 text-left min-w-48">
                        <Link to={`/job/${j.id}`} className="hover:underline font-semibold block truncate max-w-48" title={j.title}>
                          {j.title}
                        </Link>
                        <span className="text-muted-foreground font-normal text-xs">{j.employer}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_FIELDS.map((field) => {
                    const values = jobs.slice(0, maxCols).map((j) => fmt(j[field.key], field.format));
                    const allSame = values.every((v) => v === values[0]);
                    return (
                      <tr key={field.key} className="border-t hover:bg-muted/20">
                        <td className="px-4 py-2 text-muted-foreground font-medium sticky left-0 bg-background">{field.label}</td>
                        {values.map((v, i) => (
                          <td
                            key={i}
                            className={`px-4 py-2 ${!allSame && v !== "–" ? "font-medium text-primary" : ""}`}
                          >
                            {v}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  <tr className="border-t">
                    <td className="px-4 py-2 text-muted-foreground font-medium sticky left-0 bg-background">Links</td>
                    {jobs.slice(0, maxCols).map((j) => (
                      <td key={j.id} className="px-4 py-2 space-x-2">
                        <Link to={`/job/${j.id}`} className="text-xs text-primary hover:underline">Detail</Link>
                        {j.jobUrl && (
                          <a href={j.jobUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">External</a>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Highlighted cells indicate values that differ between jobs.
            </p>
          </>
        )}
      </PageMain>
    </>
  );
}

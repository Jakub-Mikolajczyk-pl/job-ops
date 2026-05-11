import type { ExtractorManifest, ExtractorProgressEvent } from "@shared/types/extractors";
import { runJustJoin } from "./src/run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  page?: number;
  totalCollected?: number;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `JustJoin.it: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }

  if (event.type === "page_fetched") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: event.page ?? 0,
      jobPagesEnqueued: event.totalCollected ?? 0,
      jobPagesProcessed: event.totalCollected ?? 0,
      currentUrl: `page ${event.page ?? 0}`,
      detail: `JustJoin.it: term ${event.termIndex}/${event.termTotal}, page ${event.page ?? 0} (${event.totalCollected ?? 0} collected)`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `JustJoin.it: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) — ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "justjoinit",
  displayName: "JustJoin.it",
  providesSources: ["justjoinit"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const parsedMax = context.settings.jobspyResultsWanted
      ? Number.parseInt(context.settings.jobspyResultsWanted, 10)
      : Number.NaN;
    const maxJobsPerTerm = Number.isFinite(parsedMax) ? Math.max(1, parsedMax) : 50;

    const result = await runJustJoin({
      searchTerms: context.searchTerms,
      workplaceTypes: context.settings.workplaceTypes
        ? JSON.parse(context.settings.workplaceTypes)
        : undefined,
      maxJobsPerTerm,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
    });

    if (!result.success) {
      return { success: false, jobs: [], error: result.error };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;

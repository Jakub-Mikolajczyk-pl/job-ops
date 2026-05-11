import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runTheprotocol } from "./src/run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  pageNo?: number;
  totalCollected?: number;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `theprotocol.it: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }

  if (event.type === "page_fetched") {
    const pageNo = event.pageNo ?? 0;
    const totalCollected = event.totalCollected ?? 0;
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: pageNo,
      jobPagesEnqueued: totalCollected,
      jobPagesProcessed: totalCollected,
      currentUrl: `page ${pageNo}`,
      detail: `theprotocol.it: term ${event.termIndex}/${event.termTotal}, page ${pageNo} (${totalCollected} collected)`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    detail: `theprotocol.it: completed term ${event.termIndex}/${event.termTotal} — ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "theprotocol",
  displayName: "theprotocol.it",
  providesSources: ["theprotocol"],
  capabilities: { locationEvidence: true },
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 100;

    const result = await runTheprotocol({
      searchTerms: context.searchTerms,
      workplaceTypes: context.settings.workplaceTypes
        ? JSON.parse(context.settings.workplaceTypes)
        : undefined,
      maxJobsPerTerm,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
    });

    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error,
        challengeRequired: result.challengeRequired,
      };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;

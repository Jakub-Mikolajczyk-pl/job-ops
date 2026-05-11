import type { CreateJobInput } from "@shared/types/jobs";

const NOFLUFFJOBS_SEARCH_URL = "https://nofluffjobs.com/api/search/posting";

export type NoFluffJobsProgressEvent =
  | { type: "term_start"; termIndex: number; termTotal: number; searchTerm: string }
  | { type: "term_complete"; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm: number };

export interface RunNoFluffJobsOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  workplaceTypes?: Array<"remote" | "hybrid" | "onsite">;
  maxJobsPerTerm?: number;
  onProgress?: (event: NoFluffJobsProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface NoFluffJobsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface NoFluffJobsPlace { city?: string }
interface NoFluffJobsSalary { from?: number; to?: number; currency?: string; type?: string }
interface NoFluffJobsPosting {
  id?: unknown; name?: unknown; title?: unknown; fullyRemote?: boolean;
  location?: { fullyRemote?: boolean; covidTimeRemotely?: boolean; hybridDesc?: string; places?: NoFluffJobsPlace[] };
  salary?: NoFluffJobsSalary;
  technology?: unknown; category?: unknown; seniority?: unknown; posted?: unknown;
}
interface NoFluffJobsSearchResponse { postings?: NoFluffJobsPosting[]; totalCount?: number }

function toPositiveIntOrFallback(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Client-side relevance filter — all tokens from the search term must appear
 * somewhere in title + technology + category.
 * Generic single-token terms (developer, engineer …) always pass through.
 */
function matchesSearchTerm(posting: NoFluffJobsPosting, searchTerm: string): boolean {
  const normalizedTerm = normalize(searchTerm);
  if (!normalizedTerm) return true;

  const tokens = normalizedTerm.split(" ").filter(Boolean);
  const GENERIC = new Set(["developer", "engineer", "programmer", "specialist", "analyst", "architect", "consultant", "manager"]);
  if (tokens.length === 1 && GENERIC.has(tokens[0])) return true;

  const haystack = [
    typeof posting.title === "string" ? posting.title : "",
    typeof posting.technology === "string" ? posting.technology : "",
    typeof posting.category === "string" ? posting.category : "",
  ].map(normalize).join(" ");

  if (!haystack.trim()) return true;
  return tokens.every((token) => haystack.includes(token));
}

function resolveLocation(posting: NoFluffJobsPosting): string {
  const loc = posting.location;
  const isRemote = posting.fullyRemote === true || loc?.fullyRemote === true || loc?.covidTimeRemotely === true;
  const cities = loc?.places?.map((p) => p.city).filter((c): c is string => Boolean(c)).slice(0, 2).join(", ") ?? "";
  if (isRemote) return cities ? `Remote (${cities})` : "Remote";
  if (loc?.hybridDesc && loc.hybridDesc.length > 0) return cities ? `Hybrid (${cities})` : "Hybrid";
  return cities || "Unknown";
}

function resolveSalaryString(salary: NoFluffJobsSalary | undefined): string | undefined {
  if (!salary || (salary.from === undefined && salary.to === undefined)) return undefined;
  const range = salary.from && salary.to
    ? `${salary.from}-${salary.to}`
    : salary.from ? `from ${salary.from}` : `up to ${salary.to}`;
  return `${range} ${salary.currency ?? "PLN"}${salary.type ? ` (${salary.type})` : ""}`;
}

function resolvePostedDate(posted: unknown): string | undefined {
  if (typeof posted === "number") return new Date(posted).toISOString().slice(0, 10);
  if (typeof posted === "string") return posted;
  return undefined;
}

function mapPosting(posting: NoFluffJobsPosting): CreateJobInput | null {
  const id = typeof posting.id === "string" ? posting.id : undefined;
  if (!id) return null;
  const jobUrl = `https://nofluffjobs.com/job/${id}`;
  const technology = typeof posting.technology === "string" ? posting.technology : undefined;
  const category = typeof posting.category === "string" ? posting.category : undefined;
  const seniority = Array.isArray(posting.seniority)
    ? (posting.seniority as unknown[]).filter((s): s is string => typeof s === "string").join(", ")
    : typeof posting.seniority === "string" ? posting.seniority : undefined;

  return {
    source: "nofluffjobs",
    sourceJobId: id,
    title: typeof posting.title === "string" ? posting.title : "Unknown Title",
    employer: typeof posting.name === "string" ? posting.name : "Unknown Employer",
    jobUrl,
    applicationLink: jobUrl,
    location: resolveLocation(posting),
    isRemote: posting.fullyRemote === true || posting.location?.fullyRemote === true || posting.location?.covidTimeRemotely === true,
    datePosted: resolvePostedDate(posting.posted),
    jobFunction: category ?? technology,
    disciplines: seniority,
    skills: [technology, category].filter(Boolean).join(", ") || undefined,
    salary: resolveSalaryString(posting.salary),
  };
}

export async function runNoFluffJobs(options: RunNoFluffJobsOptions = {}): Promise<NoFluffJobsResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const searchTerms = options.searchTerms && options.searchTerms.length > 0 ? options.searchTerms : ["software engineer"];
  const maxJobsPerTerm = toPositiveIntOrFallback(options.maxJobsPerTerm, 50);
  // Fetch more from API to account for client-side filtering
  const pageSize = Math.min(maxJobsPerTerm * 3, 200);

  if (
    options.workplaceTypes &&
    options.workplaceTypes.length > 0 &&
    !options.workplaceTypes.includes("remote") &&
    !options.workplaceTypes.includes("hybrid")
  ) {
    return { success: true, jobs: [] };
  }

  try {
    const jobs: CreateJobInput[] = [];
    const seen = new Set<string>();

    for (const [index, searchTerm] of searchTerms.entries()) {
      if (options.shouldCancel?.()) return { success: true, jobs };
      options.onProgress?.({ type: "term_start", termIndex: index + 1, termTotal: searchTerms.length, searchTerm });

      let jobsFoundTerm = 0;

      try {
        const slug = searchTerm.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const response = await fetchImpl(`${NOFLUFFJOBS_SEARCH_URL}?salaryCurrency=PLN&salaryPeriod=month`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            origin: "https://nofluffjobs.com",
            referer: "https://nofluffjobs.com/jobs",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({ criteria: { url: slug }, rawSearch: searchTerm, pageSize }),
        });

        if (!response.ok) throw new Error(`NoFluffJobs search failed with status ${response.status}`);

        const payload = (await response.json()) as NoFluffJobsSearchResponse;

        for (const posting of payload.postings ?? []) {
          if (options.shouldCancel?.()) return { success: true, jobs };
          if (jobsFoundTerm >= maxJobsPerTerm) break;
          if (!matchesSearchTerm(posting, searchTerm)) continue;
          const mapped = mapPosting(posting);
          if (!mapped) continue;
          const dedupKey = `${mapped.title}||${mapped.employer}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          jobs.push(mapped);
          jobsFoundTerm += 1;
        }
      } catch (termError) {
        const msg = termError instanceof Error ? termError.message : String(termError);
        return { success: false, jobs: [], error: msg };
      }

      options.onProgress?.({ type: "term_complete", termIndex: index + 1, termTotal: searchTerms.length, searchTerm, jobsFoundTerm });
    }

    return { success: true, jobs };
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unexpected error in NoFluffJobs extractor.";
    return { success: false, jobs: [], error: message };
  }
}

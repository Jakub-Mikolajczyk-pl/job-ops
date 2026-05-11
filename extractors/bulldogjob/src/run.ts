import type { CreateJobInput } from "@shared/types/jobs";

const BULLDOGJOB_GRAPHQL = "https://bulldogjob.pl/graphql";

// description field: confirmed as `details` (HTML) via API probe 2026-05-10.
// `requirements` and `offer` exist as separate fields but were null in probed samples;
// `details` contains the full job description including requirements.
const JOBS_QUERY = `
  query SearchJobs($first: Int!, $after: String, $q: String) {
    searchJobs(first: $first, after: $after, filters: { q: $q }) {
      nodes {
        id
        position
        city
        remote
        company { name }
        technologyTags
        publishedAt
        applyUrl
        experienceLevel
        showSalary
        details
      }
      pageInfo { hasNextPage endCursor }
      totalCount
    }
  }
`;

export type BulldogJobProgressEvent =
  | { type: "term_start"; termIndex: number; termTotal: number; searchTerm: string }
  | { type: "page_fetched"; termIndex: number; termTotal: number; searchTerm: string; page: number; totalCollected: number }
  | { type: "term_complete"; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm: number };

export interface RunBulldogJobOptions {
  searchTerms?: string[];
  workplaceTypes?: Array<"remote" | "hybrid" | "onsite">;
  maxJobsPerTerm?: number;
  onProgress?: (event: BulldogJobProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface BulldogJobResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface BulldogNode {
  id?: string;
  position?: string;
  city?: string;
  remote?: boolean;
  company?: { name?: string };
  technologyTags?: string[];
  publishedAt?: string;
  applyUrl?: string | null;
  experienceLevel?: string;
  showSalary?: boolean;
  details?: string | null;
}

interface SearchJobsPayload {
  data?: {
    searchJobs?: {
      nodes?: BulldogNode[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      totalCount?: number;
    };
  };
  errors?: Array<{ message: string }>;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#?\w+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toPositiveIntOrFallback(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesSearchTerm(node: BulldogNode, searchTerm: string): boolean {
  const normalizedTerm = normalize(searchTerm);
  if (!normalizedTerm) return true;

  const tokens = normalizedTerm.split(" ").filter(Boolean);
  const GENERIC = new Set(["developer", "engineer", "programmer", "specialist", "analyst", "architect", "consultant", "manager"]);
  if (tokens.length === 1 && GENERIC.has(tokens[0])) return true;

  const tagsText = (node.technologyTags ?? []).join(" ");
  const haystack = [
    typeof node.position === "string" ? node.position : "",
    tagsText,
  ].map(normalize).join(" ");

  if (!haystack.trim()) return true;
  return tokens.every((token) => haystack.includes(token));
}

function resolveLocation(node: BulldogNode): string {
  const city = node.city?.trim() ?? "";
  if (node.remote) return city ? `Remote (${city})` : "Remote";
  return city || "Unknown";
}

function mapNode(node: BulldogNode): CreateJobInput | null {
  const id = typeof node.id === "string" ? node.id : undefined;
  if (!id) return null;
  const jobUrl = `https://bulldogjob.pl/job/${id}`;
  const skills = (node.technologyTags ?? []).filter(Boolean).join(", ") || undefined;

  const rawDescription = typeof node.details === "string" ? node.details.trim() : null;
  const jobDescription = rawDescription ? stripHtml(rawDescription) : undefined;

  return {
    source: "bulldogjob",
    sourceJobId: id,
    title: typeof node.position === "string" ? node.position : "Unknown Title",
    employer: typeof node.company?.name === "string" ? node.company.name : "Unknown Employer",
    jobUrl,
    applicationLink: node.applyUrl ?? jobUrl,
    location: resolveLocation(node),
    isRemote: node.remote === true,
    datePosted: node.publishedAt ? node.publishedAt.slice(0, 10) : undefined,
    disciplines: typeof node.experienceLevel === "string" ? node.experienceLevel : undefined,
    skills,
    jobDescription,
  };
}

export async function runBulldogJob(options: RunBulldogJobOptions = {}): Promise<BulldogJobResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const searchTerms = options.searchTerms && options.searchTerms.length > 0 ? options.searchTerms : ["software engineer"];
  const maxJobsPerTerm = toPositiveIntOrFallback(options.maxJobsPerTerm, 50);
  const pageSize = Math.min(maxJobsPerTerm * 2, 100);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    origin: "https://bulldogjob.pl",
    referer: "https://bulldogjob.pl/companies/jobs",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  try {
    const jobs: CreateJobInput[] = [];
    const seen = new Set<string>();

    for (const [index, searchTerm] of searchTerms.entries()) {
      if (options.shouldCancel?.()) return { success: true, jobs };
      options.onProgress?.({ type: "term_start", termIndex: index + 1, termTotal: searchTerms.length, searchTerm });

      let jobsFoundTerm = 0;
      let cursor: string | null = null;
      let page = 0;

      try {
        while (jobsFoundTerm < maxJobsPerTerm) {
          if (options.shouldCancel?.()) return { success: true, jobs };

          const body = JSON.stringify({
            query: JOBS_QUERY,
            variables: { first: pageSize, after: cursor ?? undefined, q: searchTerm },
          });

          const response = await fetchImpl(BULLDOGJOB_GRAPHQL, { method: "POST", headers, body });
          if (!response.ok) throw new Error(`BulldogJob GraphQL error: ${response.status}`);

          const payload = (await response.json()) as SearchJobsPayload;
          if (payload.errors && payload.errors.length > 0) {
            throw new Error(`BulldogJob GraphQL: ${payload.errors[0].message}`);
          }

          const conn = payload.data?.searchJobs;
          const nodes = conn?.nodes ?? [];
          page += 1;

          for (const node of nodes) {
            if (options.shouldCancel?.()) return { success: true, jobs };
            if (jobsFoundTerm >= maxJobsPerTerm) break;

            // Filter by workplace type if specified
            if (options.workplaceTypes && options.workplaceTypes.length > 0) {
              const isRemote = node.remote === true;
              const wtMapped: "remote" | "onsite" = isRemote ? "remote" : "onsite";
              // bulldogjob has no hybrid — map hybrid acceptance to include onsite/remote based on user preference
              const accepted = options.workplaceTypes.includes(wtMapped) ||
                (options.workplaceTypes.includes("hybrid") && !isRemote);
              if (!accepted) continue;
            }

            if (!matchesSearchTerm(node, searchTerm)) continue;

            const mapped = mapNode(node);
            if (!mapped) continue;
            if (seen.has(mapped.sourceJobId!)) continue;
            seen.add(mapped.sourceJobId!);
            jobs.push(mapped);
            jobsFoundTerm += 1;
          }

          options.onProgress?.({ type: "page_fetched", termIndex: index + 1, termTotal: searchTerms.length, searchTerm, page, totalCollected: jobsFoundTerm });

          if (!conn?.pageInfo?.hasNextPage) break;
          cursor = conn.pageInfo.endCursor ?? null;
          if (!cursor) break;
        }
      } catch (termError) {
        const msg = termError instanceof Error ? termError.message : String(termError);
        return { success: false, jobs: [], error: msg };
      }

      options.onProgress?.({ type: "term_complete", termIndex: index + 1, termTotal: searchTerms.length, searchTerm, jobsFoundTerm });
    }

    return { success: true, jobs };
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unexpected error in BulldogJob extractor.";
    return { success: false, jobs: [], error: message };
  }
}

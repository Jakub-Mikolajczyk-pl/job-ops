import type { CreateJobInput } from "@shared/types/jobs";

const JUSTJOIN_API = "https://api.justjoin.it/v2/user-panel/offers";
// Detail endpoint (v1) confirmed 2026-05-10: GET https://justjoin.it/api/offers/{slug}
// Returns `body` (HTML). The v2/user-panel/offers/{slug} endpoint returns 404.
const JUSTJOIN_DETAIL_API = "https://justjoin.it/api/offers";
const DETAIL_CONCURRENCY = 5;

export type JustJoinProgressEvent =
  | { type: "term_start"; termIndex: number; termTotal: number; searchTerm: string }
  | { type: "page_fetched"; termIndex: number; termTotal: number; searchTerm: string; page: number; totalCollected: number }
  | { type: "term_complete"; termIndex: number; termTotal: number; searchTerm: string; jobsFoundTerm: number };

export interface RunJustJoinOptions {
  searchTerms?: string[];
  workplaceTypes?: Array<"remote" | "hybrid" | "onsite">;
  maxJobsPerTerm?: number;
  onProgress?: (event: JustJoinProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface JustJoinResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface JustJoinSkill { name: string; level?: number }
interface JustJoinEmploymentType { from?: number; to?: number; currency?: string; type?: string }
interface JustJoinOffer {
  slug?: string;
  title?: string;
  companyName?: string;
  city?: string;
  workplaceType?: string;
  experienceLevel?: string;
  requiredSkills?: JustJoinSkill[];
  employmentTypes?: JustJoinEmploymentType[];
  publishedAt?: string;
  lastPublishedAt?: string;
  remoteInterview?: boolean;
  multilocation?: Array<{ city?: string }>;
}
interface JustJoinResponse {
  data?: JustJoinOffer[];
  meta?: { total?: number; totalPages?: number; page?: number };
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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toPositiveIntOrFallback(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesSearchTerm(offer: JustJoinOffer, searchTerm: string): boolean {
  const normalizedTerm = normalize(searchTerm);
  if (!normalizedTerm) return true;

  const tokens = normalizedTerm.split(" ").filter(Boolean);
  const GENERIC = new Set(["developer", "engineer", "programmer", "specialist", "analyst", "architect", "consultant", "manager"]);
  if (tokens.length === 1 && GENERIC.has(tokens[0])) return true;

  const skillsText = (offer.requiredSkills ?? []).map((s) => s.name ?? "").join(" ");
  const haystack = [
    typeof offer.title === "string" ? offer.title : "",
    skillsText,
  ].map(normalize).join(" ");

  if (!haystack.trim()) return true;
  return tokens.every((token) => haystack.includes(token));
}

function resolveLocation(offer: JustJoinOffer): string {
  const wt = offer.workplaceType?.toLowerCase() ?? "";
  const cities: string[] = [];
  if (offer.city) cities.push(offer.city);
  for (const loc of offer.multilocation ?? []) {
    if (loc.city && !cities.includes(loc.city)) cities.push(loc.city);
  }
  const cityStr = cities.slice(0, 2).join(", ");

  if (wt === "remote") return cityStr ? `Remote (${cityStr})` : "Remote";
  if (wt === "hybrid") return cityStr ? `Hybrid (${cityStr})` : "Hybrid";
  return cityStr || "Unknown";
}

function resolveSalaryString(types: JustJoinEmploymentType[] | undefined): string | undefined {
  if (!types || types.length === 0) return undefined;
  const parts = types
    .filter((t) => t.from !== undefined || t.to !== undefined)
    .map((t) => {
      const range = t.from && t.to
        ? `${t.from}-${t.to}`
        : t.from ? `from ${t.from}` : `up to ${t.to}`;
      return `${range} ${t.currency ?? "PLN"}${t.type ? ` (${t.type})` : ""}`;
    });
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

async function fetchDescription(slug: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${JUSTJOIN_DETAIL_API}/${encodeURIComponent(slug)}`, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        origin: "https://justjoin.it",
        referer: "https://justjoin.it",
      },
    });
    if (!res.ok) return null;
    const detail = (await res.json()) as Record<string, unknown>;
    const body = typeof detail.body === "string" ? detail.body.trim() : null;
    return body ? stripHtml(body) : null;
  } catch {
    return null;
  }
}

function mapOffer(offer: JustJoinOffer): CreateJobInput | null {
  const id = typeof offer.slug === "string" ? offer.slug : undefined;
  if (!id) return null;
  const jobUrl = `https://justjoin.it/offers/${id}`;
  const skills = (offer.requiredSkills ?? []).map((s) => s.name).filter(Boolean).join(", ") || undefined;
  const isRemote = offer.workplaceType?.toLowerCase() === "remote";

  return {
    source: "justjoinit",
    sourceJobId: id,
    title: typeof offer.title === "string" ? offer.title : "Unknown Title",
    employer: typeof offer.companyName === "string" ? offer.companyName : "Unknown Employer",
    jobUrl,
    applicationLink: jobUrl,
    location: resolveLocation(offer),
    isRemote,
    datePosted: offer.publishedAt ? offer.publishedAt.slice(0, 10) : undefined,
    disciplines: typeof offer.experienceLevel === "string" ? offer.experienceLevel : undefined,
    skills,
    salary: resolveSalaryString(offer.employmentTypes),
  };
}

export async function runJustJoin(options: RunJustJoinOptions = {}): Promise<JustJoinResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const searchTerms = options.searchTerms && options.searchTerms.length > 0 ? options.searchTerms : ["software engineer"];
  const maxJobsPerTerm = toPositiveIntOrFallback(options.maxJobsPerTerm, 50);

  // Filter out onsite-only if workplaceTypes excludes remote and hybrid
  if (
    options.workplaceTypes &&
    options.workplaceTypes.length > 0 &&
    !options.workplaceTypes.includes("remote") &&
    !options.workplaceTypes.includes("hybrid")
  ) {
    // justjoin.it has many remote/hybrid; still fetch but filter is implicit
    // We'll let the fetch proceed and rely on workplaceType field
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "Version": "2",
    origin: "https://justjoin.it",
    referer: "https://justjoin.it",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  try {
    const jobs: CreateJobInput[] = [];
    const seen = new Set<string>();

    for (const [index, searchTerm] of searchTerms.entries()) {
      if (options.shouldCancel?.()) return { success: true, jobs };
      options.onProgress?.({ type: "term_start", termIndex: index + 1, termTotal: searchTerms.length, searchTerm });

      let jobsFoundTerm = 0;
      let page = 1;
      const maxPages = Math.ceil(maxJobsPerTerm / 20) + 2; // 20 items/page fixed

      try {
        while (jobsFoundTerm < maxJobsPerTerm && page <= maxPages) {
          if (options.shouldCancel?.()) return { success: true, jobs };

          const url = `${JUSTJOIN_API}?page=${page}&searchQuery=${encodeURIComponent(searchTerm)}&sortBy=newest&perPage=100`;
          const response = await fetchImpl(url, { headers });

          if (!response.ok) throw new Error(`JustJoin API error: ${response.status}`);

          const payload = (await response.json()) as JustJoinResponse;
          const offers = payload.data ?? [];

          if (offers.length === 0) break;

          for (const offer of offers) {
            if (options.shouldCancel?.()) return { success: true, jobs };
            if (jobsFoundTerm >= maxJobsPerTerm) break;

            // Filter by workplace type if specified
            if (options.workplaceTypes && options.workplaceTypes.length > 0) {
              const wt = offer.workplaceType?.toLowerCase();
              const wtMapped = wt === "remote" ? "remote" : wt === "hybrid" ? "hybrid" : "onsite";
              if (!options.workplaceTypes.includes(wtMapped)) continue;
            }

            if (!matchesSearchTerm(offer, searchTerm)) continue;

            const mapped = mapOffer(offer);
            if (!mapped) continue;
            if (seen.has(mapped.sourceJobId!)) continue;
            seen.add(mapped.sourceJobId!);
            jobs.push(mapped);
            jobsFoundTerm += 1;
          }

          const totalPages = payload.meta?.totalPages ?? 1;
          if (page >= totalPages) break;
          page += 1;
        }
      } catch (termError) {
        const msg = termError instanceof Error ? termError.message : String(termError);
        return { success: false, jobs: [], error: msg };
      }

      options.onProgress?.({ type: "term_complete", termIndex: index + 1, termTotal: searchTerms.length, searchTerm, jobsFoundTerm });
    }

    // Fetch descriptions with bounded concurrency; dedup by slug across search terms.
    const descCache = new Map<string, string | null>();
    await mapWithConcurrency(jobs, DETAIL_CONCURRENCY, async (job) => {
      const slug = job.sourceJobId;
      if (!slug) return;
      if (!descCache.has(slug)) {
        descCache.set(slug, await fetchDescription(slug, fetchImpl));
      }
      const desc = descCache.get(slug) ?? null;
      if (desc) job.jobDescription = desc;
    });

    return { success: true, jobs };
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unexpected error in JustJoin extractor.";
    return { success: false, jobs: [], error: message };
  }
}

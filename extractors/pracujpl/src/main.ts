/**
 * pracuj.pl extractor — browser-backed via camoufox/playwright
 *
 * Approach: SSR-rendered job data is embedded in __NEXT_DATA__ under
 * dehydratedState.queries → ["jobOffers", ...] → state.data.groupedOffers.
 * Each navigation to a new page URL gets fresh SSR data in a new page instance.
 *
 * PD-3 probe (2026-05-10): No usable detail API without CF clearance.
 * - api.pracuj.pl/api/offers/job/{id} → Cloudflare challenge (403 without browser)
 * - apigw.pracuj.pl/api/offers/job/{id} → Cloudflare challenge (403 without browser)
 * - www.pracuj.pl/praca/{slug} → Cloudflare challenge
 * Per-offer browser navigation is explicitly off the table (too slow, CF risk).
 * jobDescription is intentionally omitted; see IDEAS.md PD-3.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CreateJobInput } from "@shared/types/jobs";
import {
  createLaunchOptions,
  getCloudflareCookieStorageDir,
  invalidateCookies,
  loadCookies,
  navigateWithRetry,
  readCookieJar,
  saveCookies,
} from "browser-utils";
import { parseSearchTerms } from "job-ops-shared/utils/search-terms";
import {
  toNumberOrNull,
  toStringOrNull,
} from "job-ops-shared/utils/type-conversion";
import { firefox } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_ID = "pracujpl";
const BASE_URL = "https://it.pracuj.pl";
const SEARCH_URL = "https://it.pracuj.pl/praca";
const JOB_URL_BASE = "https://www.pracuj.pl/praca";
const JOBOPS_PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const DEFAULT_SEARCH_TERM = "software engineer";
const PAGE_SIZE = 50;

type RawOffer = Record<string, unknown>;
type RawGroup = Record<string, unknown>;

function emitProgress(payload: Record<string, unknown>): void {
  if (process.env.JOBOPS_EMIT_PROGRESS !== "1") return;
  console.log(`${JOBOPS_PROGRESS_PREFIX}${JSON.stringify(payload)}`);
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseWorkplaceTypes(raw: string | undefined): string[] {
  if (!raw) return ["remote", "hybrid", "onsite"];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ["remote", "hybrid", "onsite"];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return ["remote", "hybrid", "onsite"];
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesSearchTerm(group: RawGroup, searchTerm: string): boolean {
  const term = normalize(searchTerm);
  if (!term) return true;
  const tokens = term.split(" ").filter(Boolean);
  const GENERIC = new Set(["developer", "engineer", "programmer", "specialist", "analyst", "architect", "consultant", "manager"]);
  if (tokens.length === 1 && GENERIC.has(tokens[0])) return true;

  const techsText = Array.isArray(group.technologies)
    ? (group.technologies as unknown[]).filter((t): t is string => typeof t === "string").join(" ")
    : "";
  const haystack = [
    typeof group.jobTitle === "string" ? group.jobTitle : "",
    techsText,
  ].map(normalize).join(" ");

  if (!haystack.trim()) return true;
  return tokens.every((token) => haystack.includes(token));
}

function resolveLocation(group: RawGroup, offer: RawOffer): string {
  const displayWorkplace = typeof offer.displayWorkplace === "string" ? offer.displayWorkplace : "";
  const isRemote = group.isRemoteWorkAllowed === true;
  const workModes = Array.isArray(group.workModes)
    ? (group.workModes as unknown[]).filter((w): w is string => typeof w === "string")
    : [];
  const hasRemote = isRemote || workModes.some(m => m.toLowerCase().includes("remote") || m.toLowerCase().includes("home"));
  const hasHybrid = workModes.some(m => m.toLowerCase().includes("hybrid") || m.toLowerCase().includes("mieszany"));

  if (hasRemote && displayWorkplace) return `Remote (${displayWorkplace})`;
  if (hasRemote) return "Remote";
  if (hasHybrid && displayWorkplace) return `Hybrid (${displayWorkplace})`;
  if (hasHybrid) return "Hybrid";
  return displayWorkplace || "Unknown";
}

function mapGroup(group: RawGroup): CreateJobInput | null {
  const offers = Array.isArray(group.offers) ? (group.offers as RawOffer[]) : [];
  const firstOffer = offers[0];
  if (!firstOffer) return null;

  const offerUrl = typeof firstOffer.offerAbsoluteUri === "string" ? firstOffer.offerAbsoluteUri : undefined;
  if (!offerUrl) return null;

  const sourceJobId = (() => {
    const m = offerUrl.match(/,oferta,(\d+)/);
    return m ? m[1] : offerUrl.split("/").pop() ?? offerUrl;
  })();

  const techs = Array.isArray(group.technologies)
    ? (group.technologies as unknown[]).filter((t): t is string => typeof t === "string").join(", ")
    : undefined;

  const workModes = Array.isArray(group.workModes)
    ? (group.workModes as unknown[]).filter((w): w is string => typeof w === "string")
    : [];
  const isRemote = group.isRemoteWorkAllowed === true || workModes.some(m => m.toLowerCase().includes("remote") || m.toLowerCase().includes("home"));

  return {
    source: "pracujpl",
    sourceJobId,
    title: typeof group.jobTitle === "string" ? group.jobTitle : "Unknown Title",
    employer: typeof group.companyName === "string" ? group.companyName : "Unknown Employer",
    jobUrl: offerUrl,
    applicationLink: offerUrl,
    location: resolveLocation(group, firstOffer),
    isRemote,
    datePosted: typeof group.lastPublicated === "string" ? group.lastPublicated.slice(0, 10) : undefined,
    salary: typeof group.salaryDisplayText === "string" ? group.salaryDisplayText : undefined,
    skills: techs || undefined,
  };
}

async function extractJobData(pageHtml: string): Promise<{ groups: RawGroup[]; totalGroupCount: number } | null> {
  // Parse __NEXT_DATA__ from HTML
  const match = pageHtml.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const queries: unknown[] = (parsed as any)?.props?.pageProps?.dehydratedState?.queries ?? [];
  const jobQuery = (queries as any[]).find((q: any) => Array.isArray(q?.queryKey) && q.queryKey[0] === "jobOffers");
  if (!jobQuery) return null;

  const data = jobQuery.state?.data;
  const groups: RawGroup[] = Array.isArray(data?.groupedOffers) ? data.groupedOffers : [];
  const totalGroupCount = typeof data?.groupedOffersTotalCount === "number" ? data.groupedOffersTotalCount : groups.length;

  return { groups, totalGroupCount };
}

async function run(): Promise<void> {
  const searchTerms = parseSearchTerms(process.env.PRACUJPL_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.PRACUJPL_MAX_JOBS_PER_TERM, DEFAULT_MAX_JOBS_PER_TERM);
  const outputPath = process.env.PRACUJPL_OUTPUT_JSON || join(__dirname, "../storage/datasets/default/jobs.json");
  const headless = process.env.PRACUJPL_HEADLESS !== "false";
  const workplaceTypes = parseWorkplaceTypes(process.env.PRACUJPL_WORKPLACE_TYPES);

  const STORAGE_DIR = getCloudflareCookieStorageDir();
  const cookieJar = await readCookieJar(EXTRACTOR_ID, STORAGE_DIR);

  const { launchOptions, usedCamoufox } = await createLaunchOptions({ headless });
  let browser = await firefox.launch(launchOptions);
  let context = await browser.newContext(
    cookieJar.userAgent ? { userAgent: cookieJar.userAgent } : undefined,
  );

  const allJobs: CreateJobInput[] = [];
  const seen = new Set<string>();
  let challengeRequired: string | undefined;

  try {
    await loadCookies(context, EXTRACTOR_ID, STORAGE_DIR);

    // Warm up: navigate to base URL to ensure CF clearance
    const warmupPage = await context.newPage();
    try {
      const { challengeResult } = await navigateWithRetry(warmupPage, BASE_URL, {
        maxAttempts: 1,
        waitUntil: "domcontentloaded",
        navigationTimeoutMs: 60_000,
      });

      if (challengeResult.status === "timeout") {
        await invalidateCookies(EXTRACTOR_ID, STORAGE_DIR);
        emitProgress({ event: "challenge_required", url: BASE_URL });
        throw new Error("Cloudflare challenge timed out");
      }

      if (challengeResult.status === "passed" || challengeResult.status === "not-a-challenge") {
        await saveCookies(context, EXTRACTOR_ID, STORAGE_DIR);
      }
    } finally {
      await warmupPage.close();
    }

    for (let ti = 0; ti < searchTerms.length; ti++) {
      const searchTerm = searchTerms[ti];
      const slug = searchTerm.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

      emitProgress({ event: "term_start", termIndex: ti + 1, termTotal: searchTerms.length, searchTerm });

      let termCollected = 0;
      let pageNo = 1;
      let totalGroupCount: number | null = null;

      while (termCollected < maxJobsPerTerm) {
        const maxPages = totalGroupCount !== null ? Math.ceil(totalGroupCount / PAGE_SIZE) : 999;
        if (pageNo > maxPages) break;

        const url = `${SEARCH_URL}/${encodeURIComponent(slug)};kw?pn=${pageNo}&rop=${PAGE_SIZE}`;

        // Use a fresh page for each navigation to ensure SSR data
        const p = await context.newPage();
        let html = "";
        try {
          const response = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
          if (!response) {
            await p.close();
            break;
          }
          html = await p.content();
        } finally {
          await p.close();
        }

        const extracted = await extractJobData(html);
        if (!extracted || extracted.groups.length === 0) break;

        if (totalGroupCount === null) totalGroupCount = extracted.totalGroupCount;

        let pageCollected = 0;
        for (const group of extracted.groups) {
          if (termCollected >= maxJobsPerTerm) break;

          if (!matchesSearchTerm(group, searchTerm)) continue;

          // Workplace type filter
          const isRemoteGroup = group.isRemoteWorkAllowed === true;
          const workModes = Array.isArray(group.workModes)
            ? (group.workModes as unknown[]).filter((m): m is string => typeof m === "string")
            : [];
          const hasRemote = isRemoteGroup || workModes.some(m => m.toLowerCase().includes("remote") || m.toLowerCase().includes("home"));
          const hasHybrid = workModes.some(m => m.toLowerCase().includes("hybrid") || m.toLowerCase().includes("mieszany"));

          if (!workplaceTypes.includes("remote") && !workplaceTypes.includes("hybrid") && !workplaceTypes.includes("onsite")) {
            // No filter → include all
          } else {
            const wt = hasRemote ? "remote" : hasHybrid ? "hybrid" : "onsite";
            if (!workplaceTypes.includes(wt)) {
              // Also accept hybrid if remote is allowed
              if (!(wt === "hybrid" && workplaceTypes.includes("hybrid"))) continue;
            }
          }

          const mapped = mapGroup(group);
          if (!mapped) continue;
          if (seen.has(mapped.sourceJobId!)) continue;
          seen.add(mapped.sourceJobId!);
          allJobs.push(mapped);
          termCollected += 1;
          pageCollected += 1;
        }

        emitProgress({
          event: "page_fetched",
          termIndex: ti + 1,
          termTotal: searchTerms.length,
          searchTerm,
          pageNo,
          resultsOnPage: pageCollected,
          totalCollected: termCollected,
        });

        const maxPagesActual = Math.ceil(extracted.totalGroupCount / PAGE_SIZE);
        if (pageNo >= maxPagesActual) break;
        pageNo += 1;
      }

      emitProgress({
        event: "term_complete",
        termIndex: ti + 1,
        termTotal: searchTerms.length,
        searchTerm,
        jobsFoundTerm: termCollected,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pracuj.pl extractor failed: ${message}`);
    await browser.close();

    // Retry with vanilla Firefox if camoufox failed
    if (usedCamoufox && !challengeRequired) {
      browser = await firefox.launch({ headless });
      context = await browser.newContext();
      // (simplified: just rethrow for now)
    }
    throw error;
  } finally {
    await browser.close();
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(allJobs, null, 2)}\n`, "utf-8");
  console.log(`pracuj.pl extractor wrote ${allJobs.length} jobs`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`pracuj.pl extractor failed: ${message}`);
  process.exitCode = 1;
});

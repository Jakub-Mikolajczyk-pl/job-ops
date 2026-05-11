/**
 * theprotocol.it extractor — browser-backed via camoufox/playwright
 *
 * Approach: SSR-rendered job data is embedded in __NEXT_DATA__ under
 * props.pageProps.offersResponse.offers[] with pagination via page.count.
 * Navigate to ?pageNumber=N with about:blank in between to get fresh SSR data.
 *
 * PD-4 probe (2026-05-10): No usable detail API without CF clearance.
 * - theprotocol.it/api/offers/{slug} → Cloudflare challenge (403 without browser)
 * - theprotocol.it/api/offer/{id} → Cloudflare challenge
 * Per-offer browser navigation is explicitly off the table (too slow, CF risk).
 * jobDescription is intentionally omitted; see IDEAS.md PD-4.
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
const EXTRACTOR_ID = "theprotocol";
const BASE_URL = "https://theprotocol.it";
const SEARCH_URL = "https://theprotocol.it/filtry";
const JOB_URL_BASE = "https://theprotocol.it/praca";
const JOBOPS_PROGRESS_PREFIX = "JOBOPS_PROGRESS ";
const DEFAULT_MAX_JOBS_PER_TERM = 50;
const DEFAULT_SEARCH_TERM = "software engineer";
const PAGE_SIZE = 50;

type RawOffer = Record<string, unknown>;

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

function matchesSearchTerm(offer: RawOffer, searchTerm: string): boolean {
  const term = normalize(searchTerm);
  if (!term) return true;
  const tokens = term.split(" ").filter(Boolean);
  const GENERIC = new Set(["developer", "engineer", "programmer", "specialist", "analyst", "architect", "consultant", "manager"]);
  if (tokens.length === 1 && GENERIC.has(tokens[0])) return true;

  const techsText = Array.isArray(offer.technologies)
    ? (offer.technologies as unknown[]).filter((t): t is string => typeof t === "string").join(" ")
    : "";
  const haystack = [
    typeof offer.title === "string" ? offer.title : "",
    techsText,
  ].map(normalize).join(" ");

  if (!haystack.trim()) return true;
  return tokens.every((token) => haystack.includes(token));
}

function resolveWorkMode(offer: RawOffer): { isRemote: boolean; workplaceType: "remote" | "hybrid" | "onsite" } {
  const workModes = Array.isArray(offer.workModes)
    ? (offer.workModes as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  const hasRemote = workModes.some(m => {
    const lower = m.toLowerCase();
    return lower.includes("zdalna") || lower.includes("remote") || lower.includes("home");
  });
  const hasHybrid = workModes.some(m => {
    const lower = m.toLowerCase();
    return lower.includes("hybr") || lower.includes("hybrid");
  });
  if (hasRemote) return { isRemote: true, workplaceType: "remote" };
  if (hasHybrid) return { isRemote: false, workplaceType: "hybrid" };
  return { isRemote: false, workplaceType: "onsite" };
}

function resolveLocation(offer: RawOffer): string {
  const workplace = Array.isArray(offer.workplace)
    ? (offer.workplace as RawOffer[])
    : [];
  const cities = workplace
    .map(w => toStringOrNull(w.city) ?? toStringOrNull(w.location) ?? "")
    .filter(Boolean);
  const cityStr = cities.length > 0 ? cities.slice(0, 3).join(", ") : "";

  const { workplaceType } = resolveWorkMode(offer);
  if (workplaceType === "remote") return cityStr ? `Remote (${cityStr})` : "Remote";
  if (workplaceType === "hybrid") return cityStr ? `Hybrid (${cityStr})` : "Hybrid";
  return cityStr || "Unknown";
}

function resolveSalary(offer: RawOffer): string | undefined {
  const salary = offer.salary as Record<string, unknown> | null | undefined;
  if (!salary) return undefined;
  const from = toNumberOrNull(salary.from);
  const to = toNumberOrNull(salary.to);
  const currency = toStringOrNull(salary.currency) ?? toStringOrNull(salary.currencySymbol) ?? "";
  const timeUnit = (salary.timeUnit as Record<string, unknown> | undefined)?.shortForm
    ?? (salary.timeUnit as string | undefined);
  if (from && to) return `${from}–${to} ${currency}${timeUnit ? `/${timeUnit}` : ""}`.trim();
  if (to) return `up to ${to} ${currency}${timeUnit ? `/${timeUnit}` : ""}`.trim();
  if (from) return `from ${from} ${currency}${timeUnit ? `/${timeUnit}` : ""}`.trim();
  return undefined;
}

function mapOffer(offer: RawOffer): CreateJobInput | null {
  const offerUrlName = toStringOrNull(offer.offerUrlName);
  if (!offerUrlName) return null;

  const id = toStringOrNull(offer.id);
  if (!id) return null;

  const jobUrl = `${JOB_URL_BASE}/${offerUrlName}`;
  const techs = Array.isArray(offer.technologies)
    ? (offer.technologies as unknown[]).filter((t): t is string => typeof t === "string").join(", ")
    : undefined;

  const { isRemote } = resolveWorkMode(offer);

  return {
    source: "theprotocol",
    sourceJobId: id,
    title: toStringOrNull(offer.title) ?? "Unknown Title",
    employer: toStringOrNull(offer.employer) ?? "Unknown Employer",
    jobUrl,
    applicationLink: jobUrl,
    location: resolveLocation(offer),
    isRemote,
    datePosted: typeof offer.publicationDateUtc === "string"
      ? offer.publicationDateUtc.slice(0, 10)
      : undefined,
    salary: resolveSalary(offer),
    skills: techs || undefined,
  };
}

async function extractOffers(pageHtml: string): Promise<{ offers: RawOffer[]; pageCount: number } | null> {
  const match = pageHtml.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const offersResponse = (parsed as any)?.props?.pageProps?.offersResponse;
  if (!offersResponse) return null;

  const offers: RawOffer[] = Array.isArray(offersResponse.offers) ? offersResponse.offers : [];
  const pageCount = typeof offersResponse.page?.count === "number" ? offersResponse.page.count : 1;

  return { offers, pageCount };
}

async function run(): Promise<void> {
  const searchTerms = parseSearchTerms(process.env.THEPROTOCOL_SEARCH_TERMS, DEFAULT_SEARCH_TERM);
  const maxJobsPerTerm = parsePositiveInt(process.env.THEPROTOCOL_MAX_JOBS_PER_TERM, DEFAULT_MAX_JOBS_PER_TERM);
  const outputPath = process.env.THEPROTOCOL_OUTPUT_JSON || join(__dirname, "../storage/datasets/default/jobs.json");
  const headless = process.env.THEPROTOCOL_HEADLESS !== "false";
  const workplaceTypes = parseWorkplaceTypes(process.env.THEPROTOCOL_WORKPLACE_TYPES);

  const STORAGE_DIR = getCloudflareCookieStorageDir();
  const cookieJar = await readCookieJar(EXTRACTOR_ID, STORAGE_DIR);

  const { launchOptions, usedCamoufox } = await createLaunchOptions({ headless });
  const browser = await firefox.launch(launchOptions);
  const context = await browser.newContext(
    cookieJar.userAgent ? { userAgent: cookieJar.userAgent } : undefined,
  );

  const allJobs: CreateJobInput[] = [];
  const seen = new Set<string>();

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

    const page = await context.newPage();

    for (let ti = 0; ti < searchTerms.length; ti++) {
      const searchTerm = searchTerms[ti];
      const slug = searchTerm.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

      emitProgress({ event: "term_start", termIndex: ti + 1, termTotal: searchTerms.length, searchTerm });

      let termCollected = 0;
      let pageNo = 1;
      let totalPageCount: number | null = null;

      while (termCollected < maxJobsPerTerm) {
        if (totalPageCount !== null && pageNo > totalPageCount) break;

        const url = `${SEARCH_URL}/${encodeURIComponent(slug)};kw?pageNumber=${pageNo}`;

        // Navigate via about:blank to force SSR reload
        await page.goto("about:blank").catch(() => {});
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
        if (!response) break;

        const html = await page.content();
        const extracted = await extractOffers(html);
        if (!extracted || extracted.offers.length === 0) break;

        if (totalPageCount === null) totalPageCount = extracted.pageCount;

        let pageCollected = 0;
        for (const offer of extracted.offers) {
          if (termCollected >= maxJobsPerTerm) break;

          if (!matchesSearchTerm(offer, searchTerm)) continue;

          // Workplace type filter
          const { workplaceType } = resolveWorkMode(offer);
          if (workplaceTypes.length > 0) {
            if (!workplaceTypes.includes(workplaceType)) continue;
          }

          const mapped = mapOffer(offer);
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

        if (pageNo >= (totalPageCount ?? 1)) break;
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

    await page.close();
  } finally {
    await browser.close();
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(allJobs, null, 2)}\n`, "utf-8");
  console.log(`theprotocol.it extractor wrote ${allJobs.length} jobs`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`theprotocol.it extractor failed: ${message}`);
  process.exitCode = 1;
});

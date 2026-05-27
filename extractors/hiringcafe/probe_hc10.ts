import { firefox } from "playwright";
import { createLaunchOptions, getCloudflareCookieStorageDir, loadCookies } from "browser-utils";

async function probe() {
  const STORAGE_DIR = (await import("browser-utils")).getCloudflareCookieStorageDir();
  const { launchOptions } = await (await import("browser-utils")).createLaunchOptions({ headless: true });
  const browser = await (await import("playwright")).firefox.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  });
  const p = await context.newPage();
  await (await import("browser-utils")).loadCookies(context, "hiringcafe", STORAGE_DIR);

  // First navigate to homepage to get buildId and set cookies
  await p.goto("https://hiring.cafe", { waitUntil: "domcontentloaded", timeout: 40_000 }).catch(() => {});
  await p.waitForTimeout(1_000);

  const buildId = await p.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el || !el.textContent) return null;
    try { return JSON.parse(el.textContent)?.buildId; } catch { return null; }
  });
  console.log("BuildId:", buildId);

  const searchState = JSON.stringify({
    searchQuery: "web developer",
    workplaceTypes: ["Remote", "Hybrid", "Onsite"],
    dateFetchedPastNDays: 30
  });

  // Try fetching _next/data directly from browser context
  const nextDataResult = await p.evaluate(async ({ buildId, searchState }) => {
    const url = `/_next/data/${buildId}/index.json?searchState=${encodeURIComponent(searchState)}&page=0`;
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch {}
    return {
      status: res.status,
      bodyLength: text.length,
      topKeys: data ? Object.keys(data) : null,
      pagePropsKeys: data?.pageProps ? Object.keys(data.pageProps) : null,
      ssrTotalCount: data?.pageProps?.ssrTotalCount,
      ssrHitsCount: data?.pageProps?.ssrHits?.length ?? 0,
      ssrPage: data?.pageProps?.ssrPage,
      ssrIsLastPage: data?.pageProps?.ssrIsLastPage,
    };
  }, { buildId, searchState });

  console.log("\n_next/data direct fetch result:", JSON.stringify(nextDataResult, null, 2));

  // Try with page=1
  const nextDataResult1 = await p.evaluate(async ({ buildId, searchState }) => {
    const url = `/_next/data/${buildId}/index.json?searchState=${encodeURIComponent(searchState)}&page=1`;
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch {}
    return {
      status: res.status,
      ssrTotalCount: data?.pageProps?.ssrTotalCount,
      ssrHitsCount: data?.pageProps?.ssrHits?.length ?? 0,
      ssrPage: data?.pageProps?.ssrPage,
      ssrIsLastPage: data?.pageProps?.ssrIsLastPage,
    };
  }, { buildId, searchState });

  console.log("\nPage 1 _next/data result:", JSON.stringify(nextDataResult1, null, 2));

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

import { firefox } from "playwright";
import { createLaunchOptions, getCloudflareCookieStorageDir, loadCookies } from "browser-utils";

async function getPageData(page: any, searchState: object, pageNum: number): Promise<any> {
  const url = `https://hiring.cafe/?searchState=${encodeURIComponent(JSON.stringify(searchState))}&page=${pageNum}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 }).catch((e: Error) => console.log("Nav error:", e.message.slice(0,100)));
  await page.waitForTimeout(2_000);

  return page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el || !el.textContent) return { error: "not found" };
    try {
      const parsed = JSON.parse(el.textContent);
      const props = parsed?.props?.pageProps ?? {};
      return {
        ssrTotalCount: props.ssrTotalCount,
        ssrHitsCount: props.ssrHits?.length ?? 0,
        ssrPage: props.ssrPage,
        ssrPageSize: props.ssrPageSize,
        ssrIsLastPage: props.ssrIsLastPage,
        ssrError: props.ssrError,
        firstJobId: props.ssrHits?.[0]?.id,
        lastJobId: props.ssrHits?.slice(-1)?.[0]?.id,
      };
    } catch (e) { return { error: String(e) }; }
  });
}

async function probe() {
  const STORAGE_DIR = (await import("browser-utils")).getCloudflareCookieStorageDir();
  const { launchOptions } = await (await import("browser-utils")).createLaunchOptions({ headless: true });
  const browser = await (await import("playwright")).firefox.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  });
  const p = await context.newPage();
  await (await import("browser-utils")).loadCookies(context, "hiringcafe", STORAGE_DIR);

  const searchState = {
    searchQuery: "web developer",
    workplaceTypes: ["Remote", "Hybrid", "Onsite"],
    dateFetchedPastNDays: 30
  };

  for (const pageNum of [0, 1, 2, 5]) {
    console.log(`\n=== Page ${pageNum} ===`);
    const result = await getPageData(p, searchState, pageNum);
    console.log(JSON.stringify(result, null, 2));
  }

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

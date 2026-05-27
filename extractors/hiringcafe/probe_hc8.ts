import { firefox } from "playwright";
import { createLaunchOptions, getCloudflareCookieStorageDir, loadCookies } from "browser-utils";

async function probe() {
  const STORAGE_DIR = getCloudflareCookieStorageDir();
  const { launchOptions } = await createLaunchOptions({ headless: true });
  const browser = await firefox.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  });
  const page = await context.newPage();
  await loadCookies(context, "hiringcafe", STORAGE_DIR);

  // Navigate with full searchState 
  const searchState = JSON.stringify({
    searchQuery: "web developer",
    workplaceTypes: ["Remote", "Hybrid", "Onsite"],
    dateFetchedPastNDays: 30
  });
  
  await page.goto(`https://hiring.cafe/?searchState=${encodeURIComponent(searchState)}`, { waitUntil: "domcontentloaded", timeout: 40_000 }).catch(e => console.log("Nav error:", (e as Error).message.slice(0,100)));
  await page.waitForTimeout(4_000);

  const result = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el || !el.textContent) return { error: "not found" };
    try {
      const parsed = JSON.parse(el.textContent);
      const props = parsed?.props?.pageProps ?? {};
      return {
        ssrTotalCount: props.ssrTotalCount,
        ssrHitsCount: props.ssrHits?.length ?? 0,
        ssrHitsSample: props.ssrHits?.slice(0, 2) ?? [],
        ssrError: props.ssrError,
        ssrPageSize: props.ssrPageSize,
        ssrIsLastPage: props.ssrIsLastPage,
        ssrCollectionsCount: props.ssrCollections?.length ?? 0,
        ssrCollections: props.ssrCollections?.map((c: any) => ({ id: c.id, title: c.title, jobCount: c.groups?.reduce((acc: number, g: any) => acc + (g.hits?.length ?? 0), 0) })) ?? []
      };
    } catch (e) { return { error: String(e) }; }
  });
  
  console.log("Search state result:", JSON.stringify(result, null, 2));
  
  if ((result as any).ssrHitsSample?.length > 0) {
    console.log("\nFirst SSR hit keys:", Object.keys((result as any).ssrHitsSample[0]).join(","));
    console.log("First SSR hit:", JSON.stringify((result as any).ssrHitsSample[0]).slice(0, 1000));
  }

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

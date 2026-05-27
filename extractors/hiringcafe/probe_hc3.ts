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

  const nextDataResponses: { url: string; data: unknown }[] = [];

  context.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/_next/data/") && url.includes("index.json")) {
      try {
        const text = await res.text();
        nextDataResponses.push({ url, data: JSON.parse(text) });
      } catch {}
    }
  });

  await page.goto("https://hiring.cafe", { waitUntil: "networkidle", timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(3_000);

  // Find the buildId from the first response
  let buildId = "";
  for (const r of nextDataResponses) {
    const match = r.url.match(/_next\/data\/([^/]+)\/index\.json/);
    if (match) { buildId = match[1]; break; }
  }
  console.log("BuildId:", buildId);
  console.log("Next data responses:");
  for (const r of nextDataResponses) {
    console.log(`\nURL: ${r.url.replace("https://hiring.cafe", "")}`);
    const d = r.data as any;
    const props = d?.pageProps;
    if (props) {
      console.log("pageProps keys:", Object.keys(props).slice(0, 20));
      const jobs = props?.jobs || props?.results || props?.data?.jobs;
      if (Array.isArray(jobs)) {
        console.log("Jobs count:", jobs.length);
        if (jobs.length > 0) {
          console.log("First job keys:", Object.keys(jobs[0]).slice(0, 20));
          console.log("First job sample:", JSON.stringify(jobs[0]).slice(0, 500));
        }
      }
      // Look for pagination info
      const total = props?.total || props?.totalCount || props?.data?.total;
      if (total !== undefined) console.log("Total:", total);
      console.log("Full props sample:", JSON.stringify(props).slice(0, 1000));
    }
  }

  // Now trigger a search
  console.log("\n=== Triggering search ===");
  nextDataResponses.length = 0;
  const searchState = JSON.stringify({ searchQuery: "software engineer", dateFetchedPastNDays: 30 });
  const encodedState = encodeURIComponent(searchState);
  await page.goto(`https://hiring.cafe/?searchState=${encodedState}`, { waitUntil: "networkidle", timeout: 40_000 }).catch(e => console.log("Nav error:", (e as Error).message.slice(0, 100)));
  await page.waitForTimeout(5_000);
  
  console.log("Search responses:");
  for (const r of nextDataResponses) {
    console.log(`\nURL: ${r.url.replace("https://hiring.cafe", "")}`);
    const d = r.data as any;
    const props = d?.pageProps;
    if (props) {
      console.log("pageProps keys:", Object.keys(props).slice(0, 20));
      const jobs = props?.jobs || props?.results;
      if (Array.isArray(jobs)) {
        console.log("Jobs count:", jobs.length);
        if (jobs.length > 0) {
          console.log("First job sample:", JSON.stringify(jobs[0]).slice(0, 600));
        }
      }
      console.log("Full props (truncated):", JSON.stringify(props).slice(0, 2000));
    }
  }

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

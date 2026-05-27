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

  await page.goto("https://hiring.cafe", { waitUntil: "networkidle", timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(5_000);

  const result = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el || !el.textContent) return { error: "not found" };
    const text = el.textContent;
    // Just return the full text
    return { length: text.length, first500: text.slice(0, 500), last200: text.slice(-200) };
  });
  console.log("__NEXT_DATA__:", JSON.stringify(result, null, 2));

  // Also try to find job cards in the DOM
  const jobCards = await page.evaluate(() => {
    // Look for any data-* attributes with job info
    const links = Array.from(document.querySelectorAll("a[href*='/viewjob/']"));
    return links.slice(0, 5).map(a => ({
      href: a.getAttribute("href"),
      text: (a as HTMLElement).innerText.slice(0, 200)
    }));
  });
  console.log("\nJob links:", JSON.stringify(jobCards, null, 2));

  // Try calling the API from within the browser to understand auth requirements
  const apiResult = await page.evaluate(async () => {
    const res = await fetch("/api/search-jobs?size=5&page=0&s=eyJzZWFyY2hRdWVyeSI6IndlYiBkZXZlbG9wZXIifQ==", {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const text = await res.text();
    return { status: res.status, headers: Object.fromEntries(res.headers), body: text.slice(0, 500) };
  });
  console.log("\n/api/search-jobs result:", JSON.stringify(apiResult, null, 2));

  // Try the new API formats
  const aiSearchResult = await page.evaluate(async () => {
    const res = await fetch("/api/ai-search/parse-filters?query=web+developer", {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 1000) };
  });
  console.log("\n/api/ai-search/parse-filters result:", JSON.stringify(aiSearchResult, null, 2));

  // Try to get jobs via ai-search
  const aiJobsResult = await page.evaluate(async () => {
    const res = await fetch("/api/ai-search/search-jobs?query=web+developer&page=0&size=5", {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 1000) };
  });
  console.log("\n/api/ai-search/search-jobs result:", JSON.stringify(aiJobsResult, null, 2));

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

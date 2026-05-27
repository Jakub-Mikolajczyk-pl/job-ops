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

  context.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/_next/data/") || url.includes("/api/")) {
      const status = res.status();
      const ct = res.headers()["content-type"] ?? "";
      let body = "";
      if (ct.includes("json")) {
        try { body = (await res.text()).slice(0, 1500); } catch {}
      }
      console.log(`\n${res.request().method()} ${url.replace("https://hiring.cafe","")} → ${status}`);
      if (body) console.log("Body:", body);
    }
  });

  await page.goto("https://hiring.cafe", { waitUntil: "networkidle", timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(3_000);

  // Now try with a search query
  console.log("\n\n=== SEARCH WITH QUERY ===");
  const searchState = JSON.stringify({ searchQuery: "software engineer", dateFetchedPastNDays: 30 });
  await page.goto(`https://hiring.cafe/?searchState=${encodeURIComponent(searchState)}`, { waitUntil: "networkidle", timeout: 40_000 }).catch(e => console.log("Nav error:", (e as Error).message.slice(0,100)));
  await page.waitForTimeout(5_000);

  // Check page contents
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
  console.log("\nPage body text:", bodyText);

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

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
  const loaded = await loadCookies(context, "hiringcafe", STORAGE_DIR);
  console.log(`Loaded ${loaded} cached cookies`);

  const captured: { url: string; method: string; status: number; reqBody: string; respSnippet: string }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("hiring.cafe") && !url.includes(".css") && !url.includes(".js") && !url.includes(".png") && !url.includes(".svg") && !url.includes("/_next/static")) {
      captured.push({ url, method: req.method(), status: 0, reqBody: (req.postData() ?? "").slice(0, 300), respSnippet: "" });
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("hiring.cafe") && !url.includes(".css") && !url.includes(".js") && !url.includes(".png") && !url.includes(".svg") && !url.includes("/_next/static")) {
      const entry = [...captured].reverse().find(r => r.url === url && r.status === 0);
      if (entry) {
        entry.status = res.status();
        try { 
          const ct = res.headers()["content-type"] ?? "";
          if (ct.includes("json") || ct.includes("text")) {
            entry.respSnippet = (await res.text()).slice(0, 400); 
          }
        } catch {}
      }
    }
  });

  console.log("Navigating to hiring.cafe...");
  await page.goto("https://hiring.cafe", { waitUntil: "networkidle", timeout: 40_000 }).catch(e => console.log("Nav error:", (e as Error).message.slice(0, 100)));
  await page.waitForTimeout(3_000);
  console.log("Title:", await page.title().catch(() => "?"));
  console.log("URL:", page.url());

  console.log("\n=== API calls from homepage ===");
  for (const c of captured) {
    console.log(`${c.method} ${c.url.replace("https://hiring.cafe", "")} → ${c.status}`);
    if (c.respSnippet) console.log(`  Resp: ${c.respSnippet.slice(0, 200)}`);
  }

  // Now try the search URL with state param
  console.log("\n=== Navigating to search ===");
  captured.length = 0;
  const searchState = btoa(encodeURIComponent(JSON.stringify({ searchQuery: "web developer", dateFetchedPastNDays: 30 })));
  await page.goto(`https://hiring.cafe/search?s=${searchState}`, { waitUntil: "networkidle", timeout: 40_000 }).catch(e => console.log("Nav error:", (e as Error).message.slice(0, 100)));
  await page.waitForTimeout(5_000);
  console.log("Title:", await page.title().catch(() => "?"));
  console.log("URL:", page.url());

  for (const c of captured) {
    console.log(`${c.method} ${c.url.replace("https://hiring.cafe", "")} → ${c.status}`);
    if (c.respSnippet) console.log(`  Resp: ${c.respSnippet.slice(0, 300)}`);
  }

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

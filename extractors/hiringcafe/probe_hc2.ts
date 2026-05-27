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

  const captured: { url: string; method: string; status: number; reqHeaders: string; reqBody: string; respSnippet: string }[] = [];

  context.on("request", (req) => {
    const url = req.url();
    if (!url.includes(".css") && !url.includes("/_next/static") && !url.includes(".png") && !url.includes(".ico") && !url.includes("fonts.googleapis")) {
      captured.push({ url, method: req.method(), status: 0, reqHeaders: JSON.stringify(req.headers()).slice(0, 200), reqBody: (req.postData() ?? "").slice(0, 400), respSnippet: "" });
    }
  });

  context.on("response", async (res) => {
    const url = res.url();
    const entry = [...captured].reverse().find(r => r.url === url && r.status === 0);
    if (entry) {
      entry.status = res.status();
      try { 
        const ct = res.headers()["content-type"] ?? "";
        if (ct.includes("json")) {
          entry.respSnippet = (await res.text()).slice(0, 500); 
        }
      } catch {}
    }
  });

  console.log("Navigating to hiring.cafe...");
  await page.goto("https://hiring.cafe", { waitUntil: "domcontentloaded", timeout: 40_000 }).catch(e => console.log("Nav error:", (e as Error).message.slice(0, 100)));
  await page.waitForTimeout(5_000);

  console.log("Title:", await page.title().catch(() => "?"));
  console.log("URL:", page.url());

  // Try typing in the search box
  console.log("\nLooking for search input...");
  const inputs = await page.$$("input");
  console.log(`Found ${inputs.length} inputs`);
  for (const inp of inputs) {
    const ph = await inp.getAttribute("placeholder").catch(() => "");
    const name = await inp.getAttribute("name").catch(() => "");
    console.log(`  Input: placeholder="${ph}" name="${name}"`);
  }

  // Dump all links
  const links = await page.$$eval("a[href]", els => els.map(e => e.getAttribute("href")).filter(h => h && !h.startsWith("#")).slice(0, 30));
  console.log("\nFirst links:", links);

  console.log("\n=== All captured requests ===");
  for (const c of captured) {
    console.log(`${c.method} ${c.url} → ${c.status}`);
    if (c.reqBody) console.log(`  ReqBody: ${c.reqBody}`);
    if (c.respSnippet) console.log(`  Resp: ${c.respSnippet.slice(0, 300)}`);
  }

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

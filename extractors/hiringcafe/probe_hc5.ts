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

  // Intercept ALL responses to find job data
  const allResponses: { url: string; status: number; contentType: string; bodySnippet: string }[] = [];
  context.on("response", async (res) => {
    const url = res.url();
    if (url.includes("hiring.cafe") && !url.includes(".js") && !url.includes(".css") && !url.includes(".png") && !url.includes(".ico") && !url.includes("favicon")) {
      const ct = res.headers()["content-type"] ?? "";
      let body = "";
      try { body = (await res.text()).slice(0, 800); } catch {}
      allResponses.push({ url: url.replace("https://hiring.cafe", ""), status: res.status(), contentType: ct, bodySnippet: body });
    }
  });

  const searchState = JSON.stringify({ searchQuery: "software engineer", dateFetchedPastNDays: 30 });
  await page.goto(`https://hiring.cafe/?searchState=${encodeURIComponent(searchState)}`, { waitUntil: "networkidle", timeout: 40_000 }).catch(e => console.log("Nav error:", (e as Error).message.slice(0,100)));
  await page.waitForTimeout(3_000);

  // Get __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    try {
      const parsed = JSON.parse(el.textContent ?? "");
      return parsed;
    } catch { return null; }
  });

  if (nextData) {
    const props = (nextData as any).pageProps;
    console.log("pageProps keys:", Object.keys(props ?? {}).slice(0, 30));
    
    // Find job arrays
    const findArrays = (obj: any, path = "", depth = 0): void => {
      if (depth > 4) return;
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        if (obj.length > 0 && typeof obj[0] === "object") {
          console.log(`Array at ${path}: len=${obj.length}, sample keys=${Object.keys(obj[0]).slice(0,10).join(",")}`);
          if (obj.length > 0) console.log(`  First item sample: ${JSON.stringify(obj[0]).slice(0,400)}`);
        }
        return;
      }
      for (const [key, val] of Object.entries(obj)) {
        findArrays(val, `${path}.${key}`, depth + 1);
      }
    };
    findArrays(props, "props");
    
    console.log("\nFull pageProps (truncated 3000 chars):", JSON.stringify(props).slice(0, 3000));
  }

  console.log("\n=== Responses ===");
  for (const r of allResponses) {
    if (r.contentType.includes("json") || r.url.includes("_next/data")) {
      console.log(`\n${r.url} → ${r.status} [${r.contentType.slice(0,30)}]`);
      if (r.bodySnippet) console.log("Body:", r.bodySnippet);
    }
  }

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

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
    if (!url.includes("hiring.cafe")) return;
    if (!url.includes("_next/data") && !url.includes("/api/")) return;
    const ct = res.headers()["content-type"] ?? "";
    let body = "";
    try { body = await res.text(); } catch {}
    console.log(`\n=== ${url.replace("https://hiring.cafe","")} → ${res.status()} [${ct}]`);
    if (body) {
      // Try to parse as JSON and show structure
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null) {
          const topKeys = Object.keys(parsed);
          console.log("Top-level keys:", topKeys);
          // Find arrays
          for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v)) {
              console.log(`  Array[${k}]: len=${v.length}`);
              if (v.length > 0 && typeof v[0] === "object") {
                console.log(`  First item keys: ${Object.keys(v[0]).slice(0,15).join(",")}`);
                console.log(`  First item: ${JSON.stringify(v[0]).slice(0,500)}`);
              }
            } else if (typeof v === "object" && v !== null) {
              console.log(`  Object[${k}]: keys=${Object.keys(v as any).slice(0,10).join(",")}`);
            } else {
              console.log(`  ${k}: ${String(v).slice(0,100)}`);
            }
          }
        }
      } catch {
        console.log("Body (non-JSON):", body.slice(0, 300));
      }
    } else {
      console.log("(no body)");
    }
  });

  // Navigate to homepage first
  await page.goto("https://hiring.cafe", { waitUntil: "networkidle", timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(5_000);

  await browser.close();
}

probe().catch((e) => { console.error("Failed:", e); process.exit(1); });

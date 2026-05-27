import { firefox } from "playwright";
import { createLaunchOptions } from "browser-utils";

async function probe() {
  const { launchOptions } = await createLaunchOptions({ headless: true });
  const browser = await firefox.launch(launchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();

  const captured: { url: string; method: string; status: number; reqBody: string; respSnippet: string }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("hiring.cafe/api") || url.includes("hiring.cafe/_next") || url.includes("hiring.cafe/graphql")) {
      captured.push({ url, method: req.method(), status: 0, reqBody: (req.postData() ?? "").slice(0, 300), respSnippet: "" });
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("hiring.cafe/api") || url.includes("hiring.cafe/_next") || url.includes("hiring.cafe/graphql")) {
      const entry = captured.findLast(r => r.url === url && r.status === 0);
      if (entry) {
        entry.status = res.status();
        try { entry.respSnippet = (await res.text()).slice(0, 500); } catch {}
      }
    }
  });

  console.log("Navigating to hiring.cafe...");
  try {
    await page.goto("https://hiring.cafe", { waitUntil: "networkidle", timeout: 30_000 });
  } catch (e) {
    console.log("Nav error:", (e as Error).message.slice(0, 100));
  }
  await page.waitForTimeout(3_000);
  console.log("Page title:", await page.title().catch(() => "?"));
  console.log("Page URL:", page.url());

  console.log("\n=== Captured API calls ===");
  for (const c of captured) {
    console.log(`\n${c.method} ${c.url}\nStatus: ${c.status}`);
    if (c.reqBody) console.log(`Body: ${c.reqBody}`);
    if (c.respSnippet) console.log(`Resp: ${c.respSnippet}`);
    console.log("---");
  }

  // Try navigating to search page
  console.log("\n=== Navigating to search page ===");
  captured.length = 0;
  try {
    await page.goto("https://hiring.cafe/search?q=web+developer", { waitUntil: "networkidle", timeout: 30_000 });
  } catch (e) {
    console.log("Nav error:", (e as Error).message.slice(0, 100));
  }
  await page.waitForTimeout(5_000);
  console.log("Page title:", await page.title().catch(() => "?"));
  for (const c of captured) {
    console.log(`\n${c.method} ${c.url}\nStatus: ${c.status}`);
    if (c.reqBody) console.log(`Body: ${c.reqBody}`);
    if (c.respSnippet) console.log(`Resp: ${c.respSnippet}`);
    console.log("---");
  }

  await browser.close();
}

probe().catch((e) => { console.error("Probe failed:", e); process.exit(1); });

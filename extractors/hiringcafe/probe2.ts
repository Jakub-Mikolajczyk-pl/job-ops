/**
 * Probe v2 — captures full request + response for job listing APIs
 */
import { firefox } from "playwright";
import { createLaunchOptions } from "browser-utils";

async function probe() {
  const { launchOptions } = await createLaunchOptions({ headless: true });
  const browser = await firefox.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // ──────────────────── pracuj.pl ────────────────────
  console.log("\n=== pracuj.pl: capturing requests ===");
  const pracujRequests: { url: string; method: string; postData?: string; status: number; snippet: string }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes(".pracuj.pl") && url.includes("jobOffers")) {
      pracujRequests.push({ url, method: req.method(), postData: req.postData() ?? undefined, status: 0, snippet: "" });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes(".pracuj.pl") && url.includes("jobOffers")) {
      const entry = pracujRequests.find((r) => r.url === url && r.status === 0);
      if (entry) {
        entry.status = res.status();
        try { entry.snippet = (await res.text().catch(() => "")).slice(0, 600); } catch {}
      }
    }
  });

  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("pracuj nav error:", (e as Error).message); }
  await page.waitForTimeout(3_000);

  for (const r of pracujRequests) {
    console.log(`\n${r.method} ${r.url}\nStatus: ${r.status}\n${r.snippet ? `Response: ${r.snippet}` : "(empty)"}`);
    if (r.postData) console.log(`Body: ${r.postData.slice(0, 300)}`);
    console.log("---");
  }

  // ──────────────────── theprotocol.it ────────────────────
  console.log("\n=== theprotocol.it: capturing requests ===");
  const protocolRequests: { url: string; method: string; postData?: string; status: number; snippet: string }[] = [];

  page.removeAllListeners("request");
  page.removeAllListeners("response");

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("apus-api.theprotocol.it")) {
      protocolRequests.push({ url, method: req.method(), postData: req.postData() ?? undefined, status: 0, snippet: "" });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("apus-api.theprotocol.it")) {
      const entry = protocolRequests.find((r) => r.url === url && r.status === 0);
      if (entry) {
        entry.status = res.status();
        try { entry.snippet = (await res.text().catch(() => "")).slice(0, 800); } catch {}
      }
    }
  });

  // Navigate to theprotocol.it search with typescript
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("theprotocol nav error:", (e as Error).message); }
  await page.waitForTimeout(3_000);

  for (const r of protocolRequests) {
    console.log(`\n${r.method} ${r.url}\nStatus: ${r.status}\n${r.snippet ? `Response: ${r.snippet}` : "(empty)"}`);
    if (r.postData) console.log(`Body: ${r.postData.slice(0, 400)}`);
    console.log("---");
  }

  await browser.close();
}

probe().catch((e) => {
  console.error("Probe2 failed:", e);
  process.exit(1);
});

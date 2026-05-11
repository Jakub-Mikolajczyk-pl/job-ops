/**
 * Probe v3
 * - Captures ALL JSON requests to massachusetts.pracuj.pl (not just jobOffers)
 * - Tests theprotocol.it pagination by calling the API directly from within the browser
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

  // ──────────────────── pracuj.pl – ALL requests ────────────────────
  console.log("\n=== pracuj.pl: ALL JSON requests to massachusetts ===");
  const pracujAll: { url: string; method: string; status: number; snippet: string }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("massachusetts.pracuj.pl") || url.includes("api.pracuj.pl")) {
      pracujAll.push({ url, method: req.method(), status: 0, snippet: "" });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("massachusetts.pracuj.pl") || url.includes("api.pracuj.pl")) {
      const ct = res.headers()["content-type"] ?? "";
      const entry = pracujAll.find((r) => r.url === url && r.status === 0);
      if (entry) {
        entry.status = res.status();
        if (ct.includes("json")) {
          try { entry.snippet = (await res.text().catch(() => "")).slice(0, 300); } catch {}
        }
      }
    }
  });

  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("pracuj nav error:", (e as Error).message); }
  await page.waitForTimeout(3_000);

  for (const r of pracujAll) {
    if (r.snippet) console.log(`${r.method} ${r.url}\n${r.snippet}\n---`);
    else console.log(`${r.method} ${r.url} [${r.status}] (no json body)\n---`);
  }

  // ──────────────────── pracuj.pl: call listing directly ────────────────────
  console.log("\n=== pracuj.pl: direct listing API call ===");
  const listingResult = await page.evaluate(async () => {
    // Try the listing endpoint directly
    const url = "https://massachusetts.pracuj.pl/jobOffers/listing?kw=typescript&pn=1&rop=10&subservice=1";
    const res = await fetch(url, { credentials: "include", headers: { "Accept": "application/json" } });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 1500) };
  });
  console.log(`Status: ${listingResult.status}\nBody: ${listingResult.body}`);

  // ──────────────────── theprotocol.it ────────────────────
  console.log("\n=== theprotocol.it: navigate + paginate ===");

  page.removeAllListeners("request");
  page.removeAllListeners("response");

  try {
    await page.goto("https://theprotocol.it", { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (e) { console.log("theprotocol nav error:", (e as Error).message); }

  // Call the search API directly from browser context, page 1 and page 2
  const tpResult = await page.evaluate(async () => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "accept": "application/json",
    };

    // Try to get CSRF token first
    try {
      const csrfRes = await fetch("https://apus-api.theprotocol.it/csrf-token", { credentials: "include" });
      const csrfToken = csrfRes.headers.get("X-CSRF-TOKEN") ?? csrfRes.headers.get("csrf-token") ?? "";
      if (csrfToken) headers["X-CSRF-TOKEN"] = csrfToken;
    } catch {}

    const body1 = JSON.stringify({
      typesOfContractIds: [], positionLevelIds: [], cities: [], workModeCodes: [],
      onlyWithProjectDescription: false, expectedTechnologies: ["TypeScript"],
      niceToHaveTechnologies: [], excludedTechnologies: [], regionsOfWorld: [],
      keywords: [], specializationsCodes: [], isSupportingUkraine: false, fromExternalLocations: true,
    });

    const r1 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageNumber=1&pageSize=5", {
      method: "POST", credentials: "include", headers, body: body1,
    });
    const t1 = await r1.text();

    const r2 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageNumber=2&pageSize=5", {
      method: "POST", credentials: "include", headers, body: body1,
    });
    const t2 = await r2.text();

    return { page1: { status: r1.status, body: t1.slice(0, 1200) }, page2: { status: r2.status, body: t2.slice(0, 600) } };
  });

  console.log(`Page1 status: ${tpResult.page1.status}\n${tpResult.page1.body}`);
  console.log(`\nPage2 status: ${tpResult.page2.status}\n${tpResult.page2.body}`);

  await browser.close();
}

probe().catch((e) => { console.error("Probe3 failed:", e); process.exit(1); });

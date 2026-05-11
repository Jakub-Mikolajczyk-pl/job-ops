/**
 * Probe v9 — final
 * - pracuj.pl: test pn=2 with rop=50 + JS navigation from page 1
 * - theprotocol.it: try URL page number + scroll to trigger load-more
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

  // Helper to extract job query from __NEXT_DATA__
  const extractJobQuery = () => page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    let parsed: any;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return null; }
    const queries = parsed?.props?.pageProps?.dehydratedState?.queries ?? [];
    const q = queries.find((q: any) => q?.queryKey?.[0] === "jobOffers");
    if (!q) return null;
    const data = q.state?.data;
    return {
      queryKey: q.queryKey,
      totalCount: data?.offersTotalCount,
      groupCount: data?.groupedOffersTotalCount,
      offersOnPage: data?.groupedOffers?.length,
      firstTitle: data?.groupedOffers?.[0]?.jobTitle,
    };
  });

  // ──────────────────── pracuj.pl: test pn=2 with rop=50 ────────────────────
  console.log("=== pracuj.pl pn=2 rop=50 ===");
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=2&rop=50", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(1_500);
  console.log(JSON.stringify(await extractJobQuery()));

  // Test client-side JS navigation from page 1 to page 2
  console.log("\n=== pracuj.pl: JS navigation from p1 to p2 ===");
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=1&rop=50", { waitUntil: "networkidle", timeout: 35_000 });
  } catch {}
  await page.waitForTimeout(1_500);
  console.log("Page1:", JSON.stringify(await extractJobQuery()));

  // Simulate clicking a pagination link to go to page 2
  const paginationLink = page.locator('a[href*="pn=2"]').first();
  if (await paginationLink.count() > 0) {
    await paginationLink.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_000);
    console.log("After click to p2:", JSON.stringify(await extractJobQuery()));
  } else {
    console.log("No pn=2 link found on page");
    // List all pagination links
    const links = await page.locator('[class*="pagination"] a, [data-test*="pagination"] a').allInnerTexts();
    console.log("Pagination links:", links.slice(0, 10));
  }

  // ──────────────────── theprotocol.it: URL page 2 + scroll ────────────────────
  console.log("\n=== theprotocol.it: page 2 URL + scroll interceptor ===");
  const intercepted2: { url: string; method: string; body: string; status: number; respSnippet: string }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("apus-api.theprotocol.it/offers")) {
      intercepted2.push({ url, method: req.method(), body: req.postData() ?? "", status: 0, respSnippet: "" });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("apus-api.theprotocol.it/offers")) {
      const entry = intercepted2.find(r => r.url === url && r.status === 0);
      if (entry) {
        entry.status = res.status();
        try { entry.respSnippet = (await res.text().catch(() => "")).slice(0, 300); } catch {}
      }
    }
  });

  // Try URL with pageNumber
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t?pageNumber=2", { waitUntil: "networkidle", timeout: 30_000 });
  } catch {}
  await page.waitForTimeout(2_000);

  // Also try scrolling to bottom to trigger infinite scroll
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2_000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2_000);

  for (const r of intercepted2) {
    console.log(`\n${r.method} ${r.url}`);
    if (r.body) console.log("Body:", r.body.slice(0, 400));
    console.log(`Status: ${r.status} | ${r.respSnippet.slice(0, 200)}`);
  }

  await browser.close();
}

probe().catch((e) => { console.error("Probe9 failed:", e); process.exit(1); });

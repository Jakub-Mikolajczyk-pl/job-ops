/**
 * Probe v8
 * - pracuj.pl: extract full groupedOffers[0] structure (keys + nested offers)
 * - theprotocol.it: capture "load more" / infinite scroll API call via clicking or scrolling
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

  // ──────────────────── pracuj.pl: full offer + nested structure ────────────────────
  console.log("\n=== pracuj.pl: full groupedOffers[0] schema ===");
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=1&rop=5", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(1_000);

  const pracujSchema = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return { error: "no element" };
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return { error: "parse failed" }; }

    const queries = (parsed as any)?.props?.pageProps?.dehydratedState?.queries ?? [];
    const jobQuery = queries.find((q: any) => Array.isArray(q?.queryKey) && q.queryKey[0] === "jobOffers");
    if (!jobQuery) return { error: "no jobOffers query", queriesLen: queries.length };

    const data = jobQuery.state?.data;
    const groupedOffers = data?.groupedOffers ?? [];
    const firstGroup = groupedOffers[0];
    if (!firstGroup) return { error: "no firstGroup", dataKeys: Object.keys(data ?? {}) };

    const firstGroupKeys = Object.keys(firstGroup);
    const firstOffer = firstGroup.offers?.[0];
    const firstOfferKeys = firstOffer ? Object.keys(firstOffer) : [];

    // Pagination info
    const totalCount = data?.offersTotalCount;
    const groupCount = data?.groupedOffersTotalCount;

    return {
      totalCount, groupCount,
      firstGroupKeys,
      firstGroupSample: JSON.stringify(firstGroup).slice(0, 800),
      firstOfferKeys,
      firstOfferSample: JSON.stringify(firstOffer).slice(0, 600),
    };
  });
  console.log(JSON.stringify(pracujSchema, null, 2));

  // Check page 2 structure
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=2&rop=5", { waitUntil: "networkidle", timeout: 35_000 });
  } catch {}
  await page.waitForTimeout(1_000);
  const pracujPage2 = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return null; }
    const queries = (parsed as any)?.props?.pageProps?.dehydratedState?.queries ?? [];
    const jobQuery = queries.find((q: any) => q?.queryKey?.[0] === "jobOffers");
    const data = jobQuery?.state?.data;
    const firstGroup = data?.groupedOffers?.[0];
    return { jobTitle: firstGroup?.jobTitle ?? "?", paginationQueryKey: jobQuery?.queryKey };
  });
  console.log("\nPage2 first job title:", pracujPage2?.jobTitle);
  console.log("Page2 query key:", JSON.stringify(pracujPage2?.paginationQueryKey));

  // ──────────────────── theprotocol.it: intercept page load requests ────────────────────
  console.log("\n=== theprotocol.it: capture full search request ===");
  const intercepted: { url: string; method: string; requestBody: string; status: number; responseSnippet: string }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("apus-api.theprotocol.it/offers")) {
      intercepted.push({ url, method: req.method(), requestBody: req.postData() ?? "", status: 0, responseSnippet: "" });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("apus-api.theprotocol.it/offers")) {
      const entry = intercepted.find(r => r.url === url && r.status === 0);
      if (entry) {
        entry.status = res.status();
        try { entry.responseSnippet = (await res.text().catch(() => "")).slice(0, 400); } catch {}
      }
    }
  });

  // Navigate to search with 20 results per page
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t?pageSize=20&pageNumber=1", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(2_000);

  for (const r of intercepted) {
    console.log(`\n${r.method} ${r.url}`);
    if (r.requestBody) console.log("Request body:", r.requestBody.slice(0, 400));
    console.log(`Status: ${r.status}, Response: ${r.responseSnippet}`);
  }

  // Also try: intercept the actual page after clicking "next page" button
  intercepted.length = 0;
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t", { waitUntil: "networkidle", timeout: 35_000 });
  } catch {}
  await page.waitForTimeout(2_000);

  // Try clicking the "next page" button or link
  const nextBtn = await page.locator('[data-test="pagination-next"], a[rel="next"], button:has-text("Następna"), .pagination-next, [aria-label="Next page"]').first();
  const nextBtnExists = await nextBtn.count();
  if (nextBtnExists > 0) {
    console.log("\nFound next page button, clicking...");
    await nextBtn.click();
    await page.waitForTimeout(3_000);
    for (const r of intercepted) {
      console.log(`\n${r.method} ${r.url}`);
      if (r.requestBody) console.log("Request body:", r.requestBody.slice(0, 400));
      console.log(`Status: ${r.status}, Response: ${r.responseSnippet}`);
    }
  } else {
    console.log("\nNo next page button found, checking page source...");
    // Try to find pagination in the page
    const paginationHtml = await page.locator('[class*="pagination"], nav[aria-label*="pagination"]').first().innerHTML().catch(() => "not found");
    console.log("Pagination HTML:", paginationHtml.slice(0, 300));
  }

  await browser.close();
}

probe().catch((e) => { console.error("Probe8 failed:", e); process.exit(1); });

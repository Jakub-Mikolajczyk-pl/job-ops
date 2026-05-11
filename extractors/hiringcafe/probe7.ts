/**
 * Probe v7
 * - pracuj.pl: extract from dehydratedState.queries (React Query cache)
 * - theprotocol.it: pagination via body params
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

  // ──────────────────── pracuj.pl: dehydratedState ────────────────────
  console.log("\n=== pracuj.pl: dehydratedState queries ===");
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=1&rop=5", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(1_000);

  const pracujData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return { error: "no element" };
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return { error: "parse failed" }; }
    const dehydratedState = (parsed as any)?.props?.pageProps?.dehydratedState;
    if (!dehydratedState) return { error: "no dehydratedState", keys: Object.keys((parsed as any)?.props?.pageProps ?? {}) };

    const queries: unknown[] = dehydratedState?.queries ?? [];
    const queryKeys = queries.map((q: any) => JSON.stringify(q?.queryKey).slice(0, 80));

    // Find query with job data
    let jobQuery: unknown = null;
    for (const q of queries as any[]) {
      const data = q?.state?.data;
      if (!data) continue;
      const str = JSON.stringify(data);
      if (str.includes("groupedOffers") || str.includes("jobTitle") || str.includes("offerAbsoluteUri")) {
        jobQuery = { queryKey: q.queryKey, dataSample: str.slice(0, 1000), dataKeys: typeof data === "object" && data ? Object.keys(data) : [] };
        break;
      }
    }

    return { queryCount: queries.length, queryKeys: queryKeys.slice(0, 20), jobQuery };
  });
  console.log(JSON.stringify(pracujData, null, 2).slice(0, 5000));

  // ──────────────────── theprotocol.it: body pagination ────────────────────
  console.log("\n=== theprotocol.it: body pagination ===");
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(2_000);

  const tpPag = await page.evaluate(async () => {
    const xsrfToken = decodeURIComponent(document.cookie.split("; ").find(c => c.startsWith("XSRF-TOKEN="))?.split("=")[1] ?? "");
    const headers = { "content-type": "application/json", "accept": "application/json", "X-XSRF-TOKEN": xsrfToken };
    const base = { typesOfContractIds: [], positionLevelIds: [], cities: [], workModeCodes: [],
      onlyWithProjectDescription: false, expectedTechnologies: ["TypeScript"],
      niceToHaveTechnologies: [], excludedTechnologies: [], regionsOfWorld: [],
      keywords: [], specializationsCodes: [], isSupportingUkraine: false, fromExternalLocations: true };

    // Try page and pageSize in body
    const r1 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox", {
      method: "POST", credentials: "include", headers,
      body: JSON.stringify({ ...base, page: 1, pageSize: 3 }),
    });
    const d1 = await r1.json() as any;

    const r2 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox", {
      method: "POST", credentials: "include", headers,
      body: JSON.stringify({ ...base, page: 2, pageSize: 3 }),
    });
    const d2 = await r2.json() as any;

    // Check if page 2 has different IDs
    const ids1 = d1?.offers?.map((o: any) => o.id).slice(0, 3) ?? [];
    const ids2 = d2?.offers?.map((o: any) => o.id).slice(0, 3) ?? [];

    return {
      page1: { paginationInfo: d1?.page, offerCount: d1?.offersCount, ids: ids1 },
      page2: { paginationInfo: d2?.page, offerCount: d2?.offersCount, ids: ids2 },
      idsAreDifferent: JSON.stringify(ids1) !== JSON.stringify(ids2),
    };
  });
  console.log(JSON.stringify(tpPag, null, 2));

  // ──────────────────── pracuj.pl: try getting listing via RSC ────────────────────
  // pracuj.pl might use Next.js App Router with RSC (React Server Components)
  console.log("\n=== pracuj.pl: RSC / alternate fetch ===");
  const pracujRsc = await page.evaluate(async () => {
    const res = await fetch("https://it.pracuj.pl/praca/typescript;kw?pn=1&rop=5", {
      headers: { "accept": "application/json", "Next-Router-State-Tree": "%5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
        "Next-Router-Prefetch": "1", "Rsc": "1" }
    });
    return { status: res.status, ct: res.headers.get("content-type"), body: (await res.text()).slice(0, 500) };
  });
  console.log("RSC fetch:", JSON.stringify(pracujRsc));

  await browser.close();
}

probe().catch((e) => { console.error("Probe7 failed:", e); process.exit(1); });

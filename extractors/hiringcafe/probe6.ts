/**
 * Probe v6
 * - pracuj.pl: extract full offer schema from __NEXT_DATA__
 * - theprotocol.it: fix pagination + get full offer fields
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

  // ──────────────────── pracuj.pl: full offer schema ────────────────────
  console.log("\n=== pracuj.pl: first offer keys + pagination structure ===");
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=1&rop=5", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(2_000);

  const pracujFull = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return { error: "no element" };
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return { error: "parse failed" }; }

    const props = (parsed as any)?.props?.pageProps;
    if (!props) return { keys: Object.keys(parsed), error: "no pageProps" };

    const groupedOffers = props?.data?.listing?.groupedOffers ?? props?.groupedOffers ?? null;
    const pagination = props?.data?.listing?.pagination ?? props?.pagination ?? null;

    // Get first offer full structure
    let firstOffer: unknown = null;
    if (Array.isArray(groupedOffers) && groupedOffers.length > 0) {
      const firstGroup = groupedOffers[0];
      const offers = firstGroup?.offers ?? [];
      firstOffer = offers[0] ?? null;
    }

    return {
      propsTopKeys: Object.keys(props).slice(0, 30),
      dataKeys: props?.data ? Object.keys(props.data) : [],
      listingKeys: props?.data?.listing ? Object.keys(props.data.listing) : [],
      groupedOffersLen: Array.isArray(groupedOffers) ? groupedOffers.length : null,
      pagination,
      firstOffer,
    };
  });
  console.log(JSON.stringify(pracujFull, null, 2).slice(0, 4000));

  // Navigate to page 2 to test pagination
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=2&rop=5", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(1_000);
  const pracujPage2 = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return null; }
    const props = (parsed as any)?.props?.pageProps;
    const groupedOffers = props?.data?.listing?.groupedOffers ?? props?.groupedOffers ?? null;
    const pagination = props?.data?.listing?.pagination ?? props?.pagination ?? null;
    let firstOffer: unknown = null;
    if (Array.isArray(groupedOffers) && groupedOffers.length > 0) {
      firstOffer = groupedOffers[0]?.offers?.[0] ?? null;
    }
    return { paginationOnPage2: pagination, firstOfferTitle: (firstOffer as any)?.jobTitle ?? "?" };
  });
  console.log("\nPage 2 check:", JSON.stringify(pracujPage2));

  // ──────────────────── theprotocol.it: pagination in body + full fields ────────────────────
  console.log("\n=== theprotocol.it: fix pagination + full offer ===");
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(2_000);

  const tpFull = await page.evaluate(async () => {
    const xsrfToken = decodeURIComponent(document.cookie.split("; ").find(c => c.startsWith("XSRF-TOKEN="))?.split("=")[1] ?? "");
    const headers = { "content-type": "application/json", "accept": "application/json", "X-XSRF-TOKEN": xsrfToken };
    const baseBody = {
      typesOfContractIds: [], positionLevelIds: [], cities: [], workModeCodes: [],
      onlyWithProjectDescription: false, expectedTechnologies: ["TypeScript"],
      niceToHaveTechnologies: [], excludedTechnologies: [], regionsOfWorld: [],
      keywords: [], specializationsCodes: [], isSupportingUkraine: false, fromExternalLocations: true,
    };

    // Try page in body
    const r1b = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageSize=3", {
      method: "POST", credentials: "include", headers,
      body: JSON.stringify({ ...baseBody, page: 2 }),
    });

    // Try offset/from pagination
    const r2b = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageSize=3&from=3", {
      method: "POST", credentials: "include", headers,
      body: JSON.stringify(baseBody),
    });

    // Get full first offer to see all fields
    const r3 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageSize=2", {
      method: "POST", credentials: "include", headers,
      body: JSON.stringify(baseBody),
    });
    const t3 = await r3.json() as any;
    const firstOffer = t3?.offers?.[0] ?? null;
    const firstOfferKeys = firstOffer ? Object.keys(firstOffer) : [];

    return {
      page2InBody: { status: r1b.status, body: (await r1b.text()).slice(0, 300) },
      fromPagination: { status: r2b.status, body: (await r2b.text()).slice(0, 300) },
      firstOfferKeys,
      firstOffer: JSON.stringify(firstOffer).slice(0, 2000),
    };
  });
  console.log("Page 2 in body:", tpFull.page2InBody);
  console.log("From pagination:", tpFull.fromPagination);
  console.log("\nFirst offer keys:", tpFull.firstOfferKeys);
  console.log("\nFirst offer:", tpFull.firstOffer);

  await browser.close();
}

probe().catch((e) => { console.error("Probe6 failed:", e); process.exit(1); });

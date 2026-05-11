/**
 * Probe v5
 * - pracuj.pl: raw __NEXT_DATA__ extraction + find job keys
 * - theprotocol.it: use XSRF-TOKEN cookie as header + get full offer schema
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
  console.log("\n=== pracuj.pl ===");
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw?rop=10", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(2_000);

  const pracujResult = await page.evaluate(() => {
    // Try raw text from __NEXT_DATA__
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return { error: "no __NEXT_DATA__ element" };
    const raw = el.textContent ?? "";
    // Search for patterns
    const jobPattern = /"offers":\[/.test(raw) || /"jobOffers":\[/.test(raw) || /"jobOffer":{/.test(raw);
    const keys = raw.match(/"([a-zA-Z]+)":\[{"/g)?.slice(0, 20) ?? [];
    // Find the index of first job-like object
    const idx1 = raw.indexOf('"jobTitle"');
    const idx2 = raw.indexOf('"offers"');
    const idx3 = raw.indexOf('"positionName"');
    const idx4 = raw.indexOf('"offersList"');
    return {
      rawLen: raw.length,
      hasJobTitle: idx1 >= 0,
      hasOffers: idx2 >= 0,
      hasPositionName: idx3 >= 0,
      hasOffersList: idx4 >= 0,
      jobPattern,
      keys: keys.slice(0, 15),
      sampleAt: {
        jobTitle: idx1 >= 0 ? raw.slice(Math.max(0, idx1 - 20), idx1 + 200) : null,
        offers: idx2 >= 0 ? raw.slice(Math.max(0, idx2 - 20), idx2 + 200) : null,
        positionName: idx3 >= 0 ? raw.slice(Math.max(0, idx3 - 20), idx3 + 200) : null,
        offersList: idx4 >= 0 ? raw.slice(Math.max(0, idx4 - 20), idx4 + 400) : null,
      }
    };
  });
  console.log(JSON.stringify(pracujResult, null, 2));

  // Also try direct API call from within the browser
  const pracujApi = await page.evaluate(async () => {
    // The API host from intercepted requests
    const base = "https://massachusetts.pracuj.pl";
    const r = await fetch(`${base}/jobOffers/listing?kw=typescript&pn=1&rop=5&subservice=1`, {
      credentials: "include", headers: { accept: "application/json" }
    });
    return { status: r.status, body: (await r.text()).slice(0, 500) };
  });
  console.log("\nDirect listing call:", pracujApi);

  // Try alternate paths
  const pracujApi2 = await page.evaluate(async () => {
    const paths = [
      "/jobOffers?kw=typescript&pn=1&rop=5&subservice=1",
      "/jobOffers/listing/offers?kw=typescript&pn=1&rop=5&subservice=1",
      "/api/v1/jobOffers?kw=typescript&pn=1&rop=5",
      "/oferty-pracy?kw=typescript&pn=1&rop=5",
    ];
    const results: { path: string; status: number; body: string }[] = [];
    for (const path of paths) {
      const r = await fetch(`https://massachusetts.pracuj.pl${path}`, {
        credentials: "include", headers: { accept: "application/json" }
      });
      results.push({ path, status: r.status, body: (await r.text()).slice(0, 200) });
    }
    return results;
  });
  console.log("\nAlternate paths:", JSON.stringify(pracujApi2, null, 2));

  // ──────────────────── theprotocol.it ────────────────────
  console.log("\n=== theprotocol.it: XSRF-TOKEN ===");
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("nav error:", (e as Error).message); }
  await page.waitForTimeout(2_000);

  const tpResult = await page.evaluate(async () => {
    // Read XSRF-TOKEN from cookie
    const xsrfToken = document.cookie.split("; ").find(c => c.startsWith("XSRF-TOKEN="))?.split("=")[1] ?? "";
    const decodedToken = decodeURIComponent(xsrfToken);

    const body = JSON.stringify({
      typesOfContractIds: [], positionLevelIds: [], cities: [], workModeCodes: [],
      onlyWithProjectDescription: false, expectedTechnologies: ["TypeScript"],
      niceToHaveTechnologies: [], excludedTechnologies: [], regionsOfWorld: [],
      keywords: [], specializationsCodes: [], isSupportingUkraine: false, fromExternalLocations: true,
    });

    const r1 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageNumber=1&pageSize=5", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json", "X-XSRF-TOKEN": decodedToken },
      body,
    });
    const t1 = await r1.text();

    const r2 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageNumber=2&pageSize=5", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json", "X-XSRF-TOKEN": decodedToken },
      body,
    });
    const t2 = await r2.text();

    // Try keywords search instead of technologies
    const bodyKw = JSON.stringify({
      typesOfContractIds: [], positionLevelIds: [], cities: [], workModeCodes: [],
      onlyWithProjectDescription: false, expectedTechnologies: [],
      niceToHaveTechnologies: [], excludedTechnologies: [], regionsOfWorld: [],
      keywords: ["typescript"], specializationsCodes: [], isSupportingUkraine: false, fromExternalLocations: true,
    });
    const r3 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageNumber=1&pageSize=5", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json", "X-XSRF-TOKEN": decodedToken },
      body: bodyKw,
    });
    const t3 = await r3.text();

    return { xsrfLen: decodedToken.length,
             page1: { status: r1.status, body: t1.slice(0, 1500) },
             page2: { status: r2.status, body: t2.slice(0, 500) },
             kwSearch: { status: r3.status, body: t3.slice(0, 500) } };
  });
  console.log("XSRF token len:", tpResult.xsrfLen);
  console.log("Page1:", tpResult.page1.status, tpResult.page1.body);
  console.log("\nPage2:", tpResult.page2.status, tpResult.page2.body.slice(0, 400));
  console.log("\nKw search:", tpResult.kwSearch.status, tpResult.kwSearch.body.slice(0, 400));

  await browser.close();
}

probe().catch((e) => { console.error("Probe5 failed:", e); process.exit(1); });

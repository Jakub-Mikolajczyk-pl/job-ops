/**
 * Probe v4
 * - pracuj.pl: extract __NEXT_DATA__ from SSR page
 * - theprotocol.it: navigate to search page, then paginate via page.evaluate()
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

  // ──────────────────── pracuj.pl: __NEXT_DATA__ ────────────────────
  console.log("\n=== pracuj.pl: __NEXT_DATA__ extraction ===");
  try {
    await page.goto("https://it.pracuj.pl/praca/typescript;kw", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("pracuj nav error:", (e as Error).message); }
  await page.waitForTimeout(2_000);

  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    try {
      const parsed = JSON.parse(el.textContent ?? "");
      // Find the job offers inside the nested structure
      const stringify = (v: unknown) => JSON.stringify(v).slice(0, 2000);
      // Look for job-like keys
      const props = parsed?.props?.pageProps;
      if (!props) return { keys: Object.keys(parsed), rawSlice: JSON.stringify(parsed).slice(0, 500) };
      const propsKeys = Object.keys(props);
      return { propsKeys, sample: stringify(props) };
    } catch {
      return { error: "parse failed" };
    }
  });
  console.log(JSON.stringify(nextData, null, 2).slice(0, 3000));

  // Also try window.__redux_state__ or React data
  const windowData = await page.evaluate(() => {
    const keys = Object.keys(window).filter(k =>
      k.includes("REDUX") || k.includes("STATE") || k.includes("INITIAL") || k.includes("DATA") || k.includes("offer") || k.includes("job")
    );
    return keys.slice(0, 20);
  });
  console.log("Window keys:", windowData);

  // ──────────────────── theprotocol.it: navigate to search, then paginate ────────────────────
  console.log("\n=== theprotocol.it: paginating after search page load ===");
  try {
    await page.goto("https://theprotocol.it/filtry/typescript;t", { waitUntil: "networkidle", timeout: 35_000 });
  } catch (e) { console.log("theprotocol nav error:", (e as Error).message); }
  await page.waitForTimeout(3_000);

  const tpPag = await page.evaluate(async () => {
    const body = JSON.stringify({
      typesOfContractIds: [], positionLevelIds: [], cities: [], workModeCodes: [],
      onlyWithProjectDescription: false, expectedTechnologies: ["TypeScript"],
      niceToHaveTechnologies: [], excludedTechnologies: [], regionsOfWorld: [],
      keywords: [], specializationsCodes: [], isSupportingUkraine: false, fromExternalLocations: true,
    });

    // Get all cookies to see what's there
    const allCookies = document.cookie;

    // Try to get CSRF token from meta tag or window
    const metaEl = document.querySelector('meta[name="csrf-token"]');
    const csrfFromMeta = metaEl?.getAttribute("content") ?? "";

    // page 1 with small size
    const r1 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageNumber=1&pageSize=5", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body,
    });
    const t1 = await r1.text();

    // page 2
    const r2 = await fetch("https://apus-api.theprotocol.it/offers/_search/rangeBox?pageNumber=2&pageSize=5", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body,
    });
    const t2 = await r2.text();

    return { csrfFromMeta, cookieKeys: allCookies.split(";").map(c => c.split("=")[0].trim()).slice(0, 10),
             page1: { status: r1.status, body: t1.slice(0, 1500) },
             page2: { status: r2.status, body: t2.slice(0, 500) } };
  });
  console.log("CSRF meta:", tpPag.csrfFromMeta);
  console.log("Cookies:", tpPag.cookieKeys);
  console.log("Page1:", tpPag.page1.status, tpPag.page1.body.slice(0, 1500));
  console.log("Page2:", tpPag.page2.status, tpPag.page2.body.slice(0, 500));

  await browser.close();
}

probe().catch((e) => { console.error("Probe4 failed:", e); process.exit(1); });

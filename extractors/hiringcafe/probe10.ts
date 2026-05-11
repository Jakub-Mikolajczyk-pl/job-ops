/**
 * Probe v10 — final verification
 * - pracuj.pl: blank-page trick between paginations
 * - theprotocol.it: check __NEXT_DATA__ on page 2 URL
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

  const extractJobQuery = () => page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    let parsed: any;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return null; }
    const queries = parsed?.props?.pageProps?.dehydratedState?.queries ?? [];
    const q = queries.find((q: any) => q?.queryKey?.[0] === "jobOffers");
    if (!q) return { noJobQuery: true, queryKeys: queries.map((q: any) => q?.queryKey?.[0]).slice(0, 10) };
    const data = q.state?.data;
    return {
      queryKey: q.queryKey,
      totalCount: data?.offersTotalCount,
      offersOnPage: data?.groupedOffers?.length,
      firstTitle: data?.groupedOffers?.[0]?.jobTitle,
    };
  });

  // ──────────────────── pracuj.pl: blank trick ────────────────────
  console.log("=== pracuj.pl: page1 ===");
  await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=1&rop=50", { waitUntil: "networkidle", timeout: 35_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  console.log(JSON.stringify(await extractJobQuery()));

  console.log("\n=== pracuj.pl: blank then page2 ===");
  await page.goto("about:blank").catch(() => {});
  await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=2&rop=50", { waitUntil: "networkidle", timeout: 35_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  console.log(JSON.stringify(await extractJobQuery()));

  console.log("\n=== pracuj.pl: blank then page3 ===");
  await page.goto("about:blank").catch(() => {});
  await page.goto("https://it.pracuj.pl/praca/typescript;kw?pn=3&rop=50", { waitUntil: "networkidle", timeout: 35_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  console.log(JSON.stringify(await extractJobQuery()));

  // ──────────────────── theprotocol.it: __NEXT_DATA__ on page 2 ────────────────────
  console.log("\n=== theprotocol.it: page1 URL __NEXT_DATA__ ===");
  const intercepted: { url: string; body: string; respSnippet: string }[] = [];
  page.on("request", (req) => {
    if (req.url().includes("apus-api.theprotocol.it/offers/_search")) {
      intercepted.push({ url: req.url(), body: req.postData() ?? "", respSnippet: "" });
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("apus-api.theprotocol.it/offers/_search")) {
      const e = intercepted.find(r => r.url === res.url() && r.respSnippet === "");
      if (e) { try { e.respSnippet = (await res.text()).slice(0, 200); } catch {} }
    }
  });

  await page.goto("https://theprotocol.it/filtry/typescript;t", { waitUntil: "networkidle", timeout: 35_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const tp1 = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return { error: "no __NEXT_DATA__" };
    let parsed: any;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return { error: "parse failed" }; }
    const props = parsed?.props?.pageProps;
    return {
      topKeys: Object.keys(props ?? {}).slice(0, 15),
      dehydratedQueryKeys: (parsed?.props?.pageProps?.dehydratedState?.queries ?? []).map((q: any) => q?.queryKey?.[0]).slice(0, 10),
      rawSlice: JSON.stringify(props ?? {}).slice(0, 500),
    };
  });
  console.log(JSON.stringify(tp1, null, 2));

  console.log("\n=== theprotocol.it: page2 URL __NEXT_DATA__ ===");
  intercepted.length = 0;
  await page.goto("about:blank").catch(() => {});
  await page.goto("https://theprotocol.it/filtry/typescript;t?pageNumber=2", { waitUntil: "networkidle", timeout: 35_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const tp2 = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el) return { error: "no __NEXT_DATA__" };
    let parsed: any;
    try { parsed = JSON.parse(el.textContent ?? ""); } catch { return { error: "parse failed" }; }
    const props = parsed?.props?.pageProps;
    return {
      topKeys: Object.keys(props ?? {}).slice(0, 10),
      dehydratedQueryKeys: (parsed?.props?.pageProps?.dehydratedState?.queries ?? []).map((q: any) => q?.queryKey?.[0]).slice(0, 10),
      rawSlice: JSON.stringify(props ?? {}).slice(0, 500),
    };
  });
  console.log(JSON.stringify(tp2, null, 2));

  for (const r of intercepted) {
    console.log(`\nAPI: ${r.url}\nBody: ${r.body.slice(0, 300)}\nResp: ${r.respSnippet}`);
  }

  await browser.close();
}

probe().catch((e) => { console.error("Probe10 failed:", e); process.exit(1); });

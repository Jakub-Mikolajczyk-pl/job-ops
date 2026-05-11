/**
 * Quick probe — launches a headless browser, navigates to pracuj.pl and
 * theprotocol.it search pages, intercepts JSON API responses, and prints
 * discovered endpoints + first-response body (truncated).
 */
import { firefox } from "playwright";
import { createLaunchOptions } from "browser-utils";

const SITES = [
  {
    name: "pracuj.pl",
    landingUrl: "https://it.pracuj.pl/praca/typescript;kw",
    apiDomains: ["api.pracuj.pl", "pracuj.pl"],
  },
  {
    name: "theprotocol.it",
    landingUrl: "https://theprotocol.it/filtry/typescript;sp",
    apiDomains: ["theprotocol.it"],
  },
];

async function probe() {
  const { launchOptions } = await createLaunchOptions({ headless: true });
  const browser = await firefox.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  for (const site of SITES) {
    console.log(`\n=== Probing ${site.name} ===`);
    const captured: { url: string; status: number; snippet: string }[] = [];

    page.on("response", async (response) => {
      const url = response.url();
      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      if (!site.apiDomains.some((d) => url.includes(d))) return;

      try {
        const text = await response.text().catch(() => "");
        captured.push({ url, status: response.status(), snippet: text.slice(0, 400) });
      } catch {}
    });

    try {
      await page.goto(site.landingUrl, { waitUntil: "networkidle", timeout: 30_000 });
    } catch (e) {
      console.log("Navigation error:", (e as Error).message);
    }

    // Wait a bit extra
    await page.waitForTimeout(3_000);

    if (captured.length === 0) {
      console.log("No JSON API calls intercepted.");
      // Try to see page title
      const title = await page.title().catch(() => "?");
      console.log("Page title:", title);
    } else {
      for (const c of captured) {
        console.log(`\nURL: ${c.url}\nStatus: ${c.status}\nSnippet: ${c.snippet}\n---`);
      }
    }
  }

  await browser.close();
}

probe().catch((e) => {
  console.error("Probe failed:", e);
  process.exit(1);
});

import { USER_AGENT, CRAWL_DELAY_MS, REQUEST_TIMEOUT_MS, MAX_RETRIES } from "./config.js";

let lastRequest = 0;

/** Enforce robots.txt Crawl-delay between every network request (polite, serial). */
async function respectCrawlDelay(): Promise<void> {
  const now = Date.now();
  const wait = lastRequest + CRAWL_DELAY_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

export async function fetchText(url: string): Promise<string> {
  return (await fetchWithRetry(url)).text();
}

export async function fetchWithRetry(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await respectCrawlDelay();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // Exponential backoff on top of the base crawl-delay.
      await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS * attempt));
    }
  }
  throw new Error(`Failed after ${MAX_RETRIES} attempts: ${url} :: ${String(lastErr)}`);
}

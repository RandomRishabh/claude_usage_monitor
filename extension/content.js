// content.js — Content script injected on claude.ai
// Two data sources: fetch interception + DOM scraping

// ── 1. Inject the fetch wrapper into the page context ──────────────
const s = document.createElement("script");
s.src = chrome.runtime.getURL("inject.js");
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);

// ── 2. Listen for intercepted fetch data ───────────────────────────
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "__CLAUDE_USAGE_INTERCEPT__") return;

  chrome.runtime.sendMessage({
    type: "usage_from_fetch",
    url: event.data.url,
    payload: event.data.payload,
  });
});

// ── 3. DOM scraper (fallback — works when Settings > Usage is open) ─
function scrapeUsagePage() {
  const body = document.body?.innerText || "";

  // Current session
  const sessionPct = body.match(
    /Current session[\s\S]*?(\d+)%\s*used/i
  );
  const sessionReset = body.match(
    /Resets in\s+([\d]+\s*hr?\s*[\d]*\s*min?)/i
  );

  // Weekly / All models
  const weeklyPct = body.match(
    /All models[\s\S]*?(\d+)%\s*used/i
  );
  const weeklyReset = body.match(
    /Resets\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\w*\s+(\d{1,2}:\d{2}\s*[AP]M)/i
  );

  if (sessionPct || weeklyPct) {
    chrome.runtime.sendMessage({
      type: "usage_from_dom",
      data: {
        session: sessionPct ? parseInt(sessionPct[1], 10) : null,
        sessionReset: sessionReset ? sessionReset[1].trim() : null,
        weekly: weeklyPct ? parseInt(weeklyPct[1], 10) : null,
        weeklyReset: weeklyReset
          ? weeklyReset[1] + " " + weeklyReset[2]
          : null,
      },
    });
  }
}

// Scrape every 20 seconds and once on load
setInterval(scrapeUsagePage, 20000);
setTimeout(scrapeUsagePage, 2000);

// Also scrape whenever the URL hash / path changes (SPA navigation)
let lastPath = location.pathname;
new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    setTimeout(scrapeUsagePage, 1500);
  }
}).observe(document.body, { childList: true, subtree: true });

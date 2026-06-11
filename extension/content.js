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

// Keepalive ping — wakes the service worker every 20s so alarms aren't the only trigger
setInterval(() => {
  try { chrome.runtime.sendMessage({ type: "ping" }); } catch (_) {}
}, 20000);

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

// ── 4. Session "primer" — pre-fill a throwaway prompt, NEVER auto-send ─
// The popup opens claude.ai/new and sets a `primerPending` flag. We type the
// prompt into the compose box and leave the cursor there for the user.
const PRIMER_TEXT = "Just starting my session — say ok";

function findComposer() {
  return (
    document.querySelector('div.ProseMirror[contenteditable="true"]') ||
    document.querySelector('[contenteditable="true"]') ||
    document.querySelector('textarea')
  );
}

function fillComposer(el, text) {
  el.focus();

  if (el.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    ).set;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // contenteditable (ProseMirror): place the caret, then insert via execCommand
  // so the editor's own input handlers fire. We never dispatch Enter / submit.
  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.addRange(range);

  const ok = document.execCommand("insertText", false, text);
  if (!ok) {
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" })
    );
  }
}

function tryPrimer(attempt = 0) {
  const el = findComposer();
  if (el) {
    try { fillComposer(el, PRIMER_TEXT); } catch (_) {}
    return; // success or graceful no-op — done either way
  }
  if (attempt < 20) {
    setTimeout(() => tryPrimer(attempt + 1), 300); // wait up to ~6s for the editor
  }
  // else: DOM never produced a composer — leave the tab open, do nothing
}

async function maybeRunPrimer() {
  if (!location.pathname.startsWith("/new")) return;
  const { primerPending } = await chrome.storage.local.get("primerPending");
  if (!primerPending) return;
  // Consume the flag immediately so only this fresh tab primes, once.
  chrome.storage.local.remove("primerPending");
  if (Date.now() - primerPending > 15000) return; // stale request — ignore
  tryPrimer();
}

maybeRunPrimer();

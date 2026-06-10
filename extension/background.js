// background.js — Service worker
// Polls claude.ai usage API every 30s, updates badge, sends to widget

const WIDGET_URL = "http://localhost:9876/usage";
const POLL_ALARM = "pollUsage";

// ── Helpers ─────────────────────────────────────────────────────────
function badgeColor(pct) {
  if (pct > 80) return "#E74C3C";
  if (pct > 50) return "#F39C12";
  return "#27AE60";
}

async function updateBadge(usage) {
  const pct = usage.session ?? usage.weekly ?? null;
  if (pct === null) return;
  await chrome.action.setBadgeText({ text: `${Math.round(pct)}%` });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor(pct) });
}

async function sendToWidget(usage) {
  try {
    await fetch(WIDGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(usage),
    });
  } catch (_) {
    // Widget not running — OK
  }
}

// ── Flexible JSON walker ─────────────────────────────────────────────
function normalizeApiPayload(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== "object") return {};

  let result = {};

  for (const [key, val] of Object.entries(obj)) {
    const k = key.toLowerCase();

    if (typeof val === "number" && val >= 0 && val <= 100) {
      if (k.includes("session") || k.includes("current")) result.session = val;
      else if (k.includes("week")) result.weekly = val;
      else if (k.includes("percent") || k.includes("usage")) {
        if (result.session === undefined) result.session = val;
      }
    }

    if (typeof val === "string" && k.includes("reset") && /\d/.test(val)) {
      if (k.includes("session") || k.includes("current"))
        result.sessionReset = val;
      else result.weeklyReset = val;
    }

    if (typeof val === "object" && val !== null) {
      const nested = normalizeApiPayload(val, depth + 1);
      result = { ...result, ...nested };
    }
  }

  return result;
}

// ── Org ID discovery ─────────────────────────────────────────────────
async function getOrgId() {
  const cached = await chrome.storage.local.get("orgId");
  if (cached.orgId) return cached.orgId;

  const resp = await fetch("https://claude.ai/api/organizations", {
    credentials: "include",
  });
  if (!resp.ok) throw new Error(`organizations fetch: ${resp.status}`);
  const orgs = await resp.json();

  let orgId = null;
  if (Array.isArray(orgs) && orgs.length > 0) {
    orgId = orgs[0].id ?? orgs[0].uuid ?? orgs[0].organization_id ?? null;
  } else if (orgs && typeof orgs === "object") {
    orgId = orgs.id ?? orgs.uuid ?? orgs.organization_id ?? null;
    // Handle wrapped shapes: { organizations: [...] }, { data: [...] }, etc.
    const arr = orgs.organizations ?? orgs.data ?? orgs.results;
    if (orgId === null && Array.isArray(arr) && arr.length > 0) {
      orgId = arr[0].id ?? arr[0].uuid ?? arr[0].organization_id ?? null;
    }
  }

  if (!orgId) throw new Error("Could not extract org ID from response");

  await chrome.storage.local.set({ orgId });
  return orgId;
}

// ── Main poll ────────────────────────────────────────────────────────
async function pollUsage() {
  try {
    const orgId = await getOrgId();
    const resp = await fetch(
      `https://claude.ai/api/organizations/${orgId}/usage`,
      { credentials: "include" }
    );

    if (resp.status === 401 || resp.status === 403) {
      // Session expired — clear cached orgId so next poll rediscovers it
      await chrome.storage.local.remove("orgId");
      await chrome.action.setBadgeText({ text: "?" });
      await chrome.action.setBadgeBackgroundColor({ color: "#888888" });
      return;
    }

    if (!resp.ok) return;

    const json = await resp.json();
    const usage = normalizeApiPayload(json);

    if (usage.session !== undefined || usage.weekly !== undefined) {
      usage.lastUpdated = Date.now();
      await chrome.storage.local.set({ usage });
      await updateBadge(usage);
      await sendToWidget(usage);
    }
  } catch (err) {
    console.warn("[ClaudeUsage] poll error:", err.message);
  }
}

// ── Alarm setup ──────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollUsage();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "…" });
  chrome.action.setBadgeBackgroundColor({ color: "#888888" });
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 }); // 30s
  pollUsage();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  pollUsage();
});

// ── Message listener (content.js / inject.js passthrough) ───────────
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  let usage = null;

  if (msg.type === "usage_from_dom") {
    usage = msg.data;
  } else if (msg.type === "usage_from_fetch") {
    usage = normalizeApiPayload(msg.payload);
  }

  if (usage && (usage.session !== undefined || usage.weekly !== undefined)) {
    usage.lastUpdated = Date.now();
    chrome.storage.local.set({ usage });
    updateBadge(usage);
    sendToWidget(usage);
  }
});

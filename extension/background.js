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

// ── ISO timestamp → "Xh Ym" countdown from now ──────────────────────
function isoToCountdown(iso) {
  if (!iso) return null;
  const diffMs = new Date(iso) - Date.now();
  if (diffMs <= 0) return "now";
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── ISO timestamp → "Sun 11:30 AM" ──────────────────────────────────
function isoToShortDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Parse known API response structure ──────────────────────────────
function parseUsageResponse(data) {
  if (!data || typeof data !== "object") return {};
  const fh = data.five_hour ?? {};
  const sd = data.seven_day ?? {};
  const result = {};
  if (fh.utilization != null) result.session = Math.round(fh.utilization);
  if (sd.utilization != null) result.weekly = Math.round(sd.utilization);
  result.sessionReset = isoToCountdown(fh.resets_at ?? null);
  result.weeklyReset = isoToShortDate(sd.resets_at ?? null);
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
    orgId = orgs[0].uuid ?? orgs[0].organization_id ?? null;
  } else if (orgs && typeof orgs === "object") {
    orgId = orgs.uuid ?? orgs.organization_id ?? null;
    // Handle wrapped shapes: { organizations: [...] }, { data: [...] }, etc.
    const arr = orgs.organizations ?? orgs.data ?? orgs.results;
    if (orgId === null && Array.isArray(arr) && arr.length > 0) {
      orgId = arr[0].uuid ?? arr[0].organization_id ?? null;
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
    const usage = parseUsageResponse(json);

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
  chrome.storage.local.remove("orgId"); // clear any stale/numeric cached id
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  pollUsage();
});

// ── Message listener (content.js / inject.js passthrough) ───────────
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg.type === "ping") {
    pollUsage();
    return;
  }

  let usage = null;

  if (msg.type === "usage_from_dom") {
    usage = msg.data;
  } else if (msg.type === "usage_from_fetch") {
    usage = parseUsageResponse(msg.payload);
  }

  if (usage && (usage.session !== undefined || usage.weekly !== undefined)) {
    usage.lastUpdated = Date.now();
    chrome.storage.local.set({ usage });
    updateBadge(usage);
    sendToWidget(usage);
  }
});

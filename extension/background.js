// background.js — Service worker
// Polls claude.ai usage API every 30s, updates badge, sends to widget

importScripts("planner.js"); // window-planner math (computePlan, fmtTime, …)

const WIDGET_URL = "http://localhost:9876/usage";
const POLL_ALARM = "pollUsage";

// ── Burn-rate forecast config ────────────────────────────────────────
const HISTORY_KEY        = "history";
const HISTORY_MAX_MS     = 6 * 60 * 60 * 1000; // keep last 6 hours
const FORECAST_WINDOW_MS = 30 * 60 * 1000;     // slope over last 30 min
const FORECAST_MIN_POINTS = 5;                 // need ≥5 samples to forecast
const SESSION_RESET_DROP  = 30;                // %-drop that signals a reset
const NOTIFY_THRESHOLD_MIN = 45;               // warn if ETA-to-limit < this

// 1×1 transparent PNG — keeps chrome.notifications happy without an icon file
const NOTIF_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
  const payload = { ...usage };
  if (usage.forecast) {
    payload.forecastStatus = usage.forecast.status;
    payload.minutesTo100 = usage.forecast.minutesTo100 ?? null;
  }
  // Window-planner recommendation for the tray menu (null until work hours set).
  const { workHours } = await chrome.storage.local.get("workHours");
  const plan = workHours ? computePlan(workHours) : null;
  payload.recommendedPrimerTime = plan ? fmtTime(plan.primerMin) : null;
  try {
    await fetch(WIDGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
  result.sessionResetAt = fh.resets_at ?? null; // raw ISO for forecast math
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

// ── History logging ──────────────────────────────────────────────────
// Appends a {t, session, weekly} snapshot, detects session resets, and
// prunes anything older than 6 hours. Returns the updated history array.
async function recordHistory(usage) {
  const now = usage.lastUpdated ?? Date.now();
  const store = await chrome.storage.local.get([HISTORY_KEY, "forecastNotified"]);
  let history = Array.isArray(store.history) ? store.history : [];

  // Detect a session reset: a steep drop vs. the most recent session reading.
  const prev = [...history].reverse().find((e) => e.session != null);
  if (
    prev &&
    usage.session != null &&
    prev.session - usage.session >= SESSION_RESET_DROP
  ) {
    // Clear only session data across the reset boundary; keep weekly history.
    history = history.map((e) => ({ ...e, session: null }));
    // Allow the burn-rate notification to fire again in the new session.
    await chrome.storage.local.set({ forecastNotified: false });
  }

  history.push({
    t: now,
    session: usage.session ?? null,
    weekly: usage.weekly ?? null,
  });

  const cutoff = now - HISTORY_MAX_MS;
  history = history.filter((e) => e.t >= cutoff);

  await chrome.storage.local.set({ history });
  return history;
}

// ── Burn-rate forecast ───────────────────────────────────────────────
// Linear slope over the last 30 min of session samples → ETA to 100%,
// compared against the session reset time.
function computeForecast(history, currentUsage) {
  if (!Array.isArray(history) || currentUsage.session == null) return null;

  const now = Date.now();
  const pts = history.filter(
    (e) => e.session != null && e.t >= now - FORECAST_WINDOW_MS
  );
  if (pts.length < FORECAST_MIN_POINTS) return null;

  const oldest = pts[0];
  const latest = pts[pts.length - 1];
  const elapsedMin = (latest.t - oldest.t) / 60000;
  if (elapsedMin <= 0) return null;

  const slope = (latest.session - oldest.session) / elapsedMin; // % per minute
  if (slope <= 0) return { status: "idle" };

  const minutesTo100 = Math.round((100 - currentUsage.session) / slope);

  // Minutes until the session quota resets (if we know the reset time).
  let minutesToReset = null;
  if (currentUsage.sessionResetAt) {
    minutesToReset = (new Date(currentUsage.sessionResetAt) - now) / 60000;
  }

  // Reset arrives first → safe. Otherwise we'd hit the limit first.
  const status =
    minutesToReset != null && minutesTo100 >= minutesToReset
      ? "safe"
      : "will_hit_limit";

  return { status, minutesTo100 };
}

// ── Forecast notification (once per session) ─────────────────────────
async function maybeNotifyForecast(forecast) {
  if (
    !forecast ||
    forecast.status !== "will_hit_limit" ||
    forecast.minutesTo100 == null ||
    forecast.minutesTo100 >= NOTIFY_THRESHOLD_MIN
  ) {
    return;
  }

  const store = await chrome.storage.local.get("forecastNotified");
  if (store.forecastNotified === true) return;

  chrome.notifications.create("forecast_limit", {
    type: "basic",
    iconUrl: NOTIF_ICON,
    title: "Heads up — approaching your Claude limit",
    message: `At your current pace you'll hit your session limit in ~${forecast.minutesTo100} min, before the reset.`,
    priority: 2,
  });
  await chrome.storage.local.set({ forecastNotified: true });
}

// ── Shared usage pipeline (poll + message paths) ─────────────────────
async function processUsage(usage) {
  usage.lastUpdated = Date.now();
  const history = await recordHistory(usage);
  usage.forecast = computeForecast(history, usage);
  await chrome.storage.local.set({ usage });
  await updateBadge(usage);
  await maybeNotifyForecast(usage.forecast);
  await sendToWidget(usage);
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
      await processUsage(usage);
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
    processUsage(usage);
  }
});

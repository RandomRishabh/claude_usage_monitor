// popup.js
function colorClass(pct) {
  if (pct > 80) return "red";
  if (pct > 50) return "yellow";
  return "green";
}

function forecastLine(forecast) {
  if (!forecast) return "";
  switch (forecast.status) {
    case "will_hit_limit":
      return `<div class="forecast warn">⚠ At this pace you'll hit the limit in ~${forecast.minutesTo100} min (before reset)</div>`;
    case "safe":
      return `<div class="forecast muted">On pace — reset arrives before you'd hit the limit</div>`;
    case "idle":
      return `<div class="forecast muted">No active usage in the last 30 min</div>`;
    default:
      return "";
  }
}

function render(usage) {
  const content = document.getElementById("content");
  const footer  = document.getElementById("footer");
  const dot     = document.getElementById("statusDot");

  if (!usage || (usage.session === null && usage.weekly === null)) {
    dot.className = "dot gray";
    content.innerHTML = `
      <div class="empty">
        No usage data yet.<br/>
        Open <b>Settings → Usage</b> on claude.ai<br/>to capture the initial reading.
      </div>
      <div class="tip">
        💡 Tip: the extension also auto-captures data<br/>
        whenever Claude's internal usage API fires.
      </div>`;
    return;
  }

  const dominant = usage.session ?? usage.weekly ?? 0;
  dot.className = "dot " + colorClass(dominant);

  let html = "";

  if (usage.session !== null) {
    const c = colorClass(usage.session);
    html += `
      <div class="section">
        <div class="label">Current Session</div>
        <div class="bar-track">
          <div class="bar-fill fill-${c}" style="width:${usage.session}%"></div>
        </div>
        <div class="row">
          <span class="reset">${usage.sessionReset ? "Resets in " + usage.sessionReset : ""}</span>
          <span class="pct">${usage.session}% used</span>
        </div>
        ${forecastLine(usage.forecast)}
      </div>`;
  }

  if (usage.weekly !== null) {
    const c = colorClass(usage.weekly);
    html += `
      <div class="section">
        <div class="label">Weekly Limit (All Models)</div>
        <div class="bar-track">
          <div class="bar-fill fill-${c}" style="width:${usage.weekly}%"></div>
        </div>
        <div class="row">
          <span class="reset">${usage.weeklyReset ? "Resets " + usage.weeklyReset : ""}</span>
          <span class="pct">${usage.weekly}% used</span>
        </div>
      </div>`;
  }

  content.innerHTML = html;

  if (usage.lastUpdated) {
    const mins = Math.round((Date.now() - usage.lastUpdated) / 60000);
    footer.textContent =
      mins < 1 ? "Updated just now" : `Updated ${mins}m ago`;
  }
}

// ── Window planner ───────────────────────────────────────────────────
function renderPlanner(work) {
  const el = document.getElementById("planner");
  const plan = computePlan(work);
  if (!plan) {
    el.innerHTML = "";
    return;
  }

  // Timeline axis spans from the earliest of (work start, primer) to the
  // latest of (work end, last window end), so misalignment is visible.
  const spanStart = Math.min(work.start, plan.windows[0].start);
  const spanEnd = Math.max(work.end, plan.windows[2].end);
  const span = spanEnd - spanStart || 1;
  const pct = (m) => ((m - spanStart) / span) * 100;

  const workBar = `<div class="tl-work" style="left:${pct(work.start)}%;width:${pct(work.end) - pct(work.start)}%"></div>`;
  const winBars = plan.windows
    .map((w, i) => `<div class="tl-win w${i + 1}" style="left:${pct(w.start)}%;width:${pct(w.end) - pct(w.start)}%"></div>`)
    .join("");

  el.innerHTML = `
    <div class="plan-text">${recommendationText(plan, work)}</div>
    <div class="timeline">
      <div class="tl-rowlabel">Work hours</div>
      <div class="tl-row">${workBar}</div>
      <div class="tl-rowlabel">Session windows</div>
      <div class="tl-row">${winBars}</div>
      <div class="tl-ticks">
        <span>${fmtTime(spanStart)}</span>
        <span>${fmtTime(spanEnd)}</span>
      </div>
    </div>`;
}

function loadWorkHours(cb) {
  chrome.storage.local.get("workHours", (res) => {
    cb(res.workHours || { ...DEFAULT_WORK });
  });
}

function initPlanner() {
  const startInput = document.getElementById("workStart");
  const endInput = document.getElementById("workEnd");

  loadWorkHours((work) => {
    startInput.value = toHHMM(work.start);
    endInput.value = toHHMM(work.end);
    renderPlanner(work);
  });

  function onChange() {
    const start = parseHHMM(startInput.value);
    const end = parseHHMM(endInput.value);
    if (start == null || end == null || end <= start) return; // ignore invalid
    const work = { start, end };
    chrome.storage.local.set({ workHours: work });
    renderPlanner(work);
  }
  startInput.addEventListener("change", onChange);
  endInput.addEventListener("change", onChange);
}

// ── Primer button: open a fresh chat with a throwaway prompt pre-filled ─
document.getElementById("primerBtn").addEventListener("click", () => {
  chrome.storage.local.set({ primerPending: Date.now() }, () => {
    chrome.tabs.create({ url: "https://claude.ai/new" });
    window.close();
  });
});

chrome.storage.local.get("usage", (res) => render(res.usage));
initPlanner();

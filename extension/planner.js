// planner.js — shared window math for the 5-hour rolling session limit.
// Loaded by popup.html (script tag) and background.js (importScripts), so it
// must only declare plain globals — no module syntax, no chrome.* calls.

const WINDOW_MIN        = 5 * 60;   // a session window is 5 hours
const PLAN_SEARCH_START = 8 * 60;   // search primer times from 8:00 AM …
const PLAN_SEARCH_END   = 12 * 60;  // … to 12:00 PM
const PLAN_STEP         = 30;       // in 30-minute increments
const DEFAULT_WORK      = { start: 13 * 60, end: 23 * 60 }; // 1 PM – 11 PM

// Overlap length (minutes) between [a0,a1] and [b0,b1].
function overlapLen(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

// minutes-from-midnight → "9 AM" / "10:30 PM"
function fmtTime(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return mm === 0 ? `${h12} ${ampm}` : `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

// "HH:MM" (from <input type=time>) → minutes-from-midnight, or null.
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// minutes-from-midnight → "HH:MM" (for <input type=time>)
function toHHMM(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// The three contiguous 5-hour windows that follow a primer at primerMin.
function windowsFor(primerMin) {
  return [
    { start: primerMin,                  end: primerMin + WINDOW_MIN },
    { start: primerMin + WINDOW_MIN,     end: primerMin + 2 * WINDOW_MIN },
    { start: primerMin + 2 * WINDOW_MIN, end: primerMin + 3 * WINDOW_MIN },
  ];
}

// Pick the primer time (8 AM–12 PM, 30-min steps) that maximizes coverage of
// the workday and, among ties, centers the 3-window block on the workday so a
// fresh window lands mid-day. Returns { primerMin, windows, coverage } or null.
function computePlan(work) {
  if (!work || work.start == null || work.end == null || work.end <= work.start) {
    return null;
  }
  const workLen = work.end - work.start;
  const workMid = (work.start + work.end) / 2;

  let best = null;
  for (let T = PLAN_SEARCH_START; T <= PLAN_SEARCH_END; T += PLAN_STEP) {
    const blockStart = T;
    const blockEnd = T + 3 * WINDOW_MIN;
    // Fraction of the workday that has an active window.
    const coverage = overlapLen(blockStart, blockEnd, work.start, work.end) / workLen;
    // Distance of the window block's center from the workday's center —
    // operationalizes "a reset boundary near the middle" by keeping a fresh
    // window centered over the workday.
    const centerDist = Math.abs((blockStart + blockEnd) / 2 - workMid);

    if (
      best === null ||
      coverage > best.coverage + 1e-9 ||
      (Math.abs(coverage - best.coverage) < 1e-9 && centerDist < best.centerDist)
    ) {
      best = { primerMin: T, coverage, centerDist };
    }
  }

  return { primerMin: best.primerMin, coverage: best.coverage, windows: windowsFor(best.primerMin) };
}

// Human-readable recommendation sentence.
function recommendationText(plan, work) {
  const w = plan.windows;
  return (
    `Send a primer at ~${fmtTime(plan.primerMin)} → your windows reset at ` +
    `${fmtTime(w[0].start)}, ${fmtTime(w[1].start)}, ${fmtTime(w[2].start)}, ` +
    `covering your ${fmtTime(work.start)}–${fmtTime(work.end)} workday ` +
    `with a fresh window through your afternoon.`
  );
}

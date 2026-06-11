# Claude Usage Monitor

## What this is
A Chrome extension + PowerShell system tray widget that shows Claude.ai usage (session %, weekly %, reset timers) on the Windows taskbar.

## Architecture
```
Chrome Extension
    chrome.alarms → pollUsage() every 30s (background.js)
    content.js → keepalive ping every 20s (wakes service worker)
    → chrome.storage.local (persists data)
    → Badge on toolbar icon (shows %)
    → POST http://localhost:9876/usage
        → PowerShell NotifyIcon in system tray
```

## File structure
```
extension/
  manifest.json      - Manifest V3, permissions: storage, alarms, notifications
  background.js      - Service worker: polls usage API, updates badge, sends to widget
  content.js         - Content script on claude.ai: keepalive ping + DOM scraper fallback
  inject.js          - Page-context script: wraps window.fetch to catch usage API responses
  popup.html/js      - Extension popup: dashboard, primer button, window planner
  planner.js         - Shared window math (popup script tag + worker importScripts)
  icon16/48/64.png   - Extension icons
claude-usage-widget.ps1  - PowerShell system tray icon with HTTP listener on :9876
Start-Claude-Widget.bat  - Launcher (does not work on restricted machines — see Constraints)
```

## Key API endpoints
- `GET https://claude.ai/api/organizations` — returns array; org UUID is at `orgs[0].uuid` (not `orgs[0].id`, which is a numeric value)
- `GET https://claude.ai/api/organizations/{uuid}/usage` — returns:
  ```json
  {
    "five_hour": { "utilization": 54.0, "resets_at": "2026-06-10T12:30:01Z" },
    "seven_day": { "utilization": 6.0,  "resets_at": "2026-06-14T06:00:01Z" }
  }
  ```
  `five_hour` = session (5-hour window), `seven_day` = weekly
- Auth: browser session cookies (`credentials: "include"`)

## Tray icon
Donut ring drawn at 64×64, downscaled to 32×32 via high-quality bicubic for crisp anti-aliased edges. Ring fills clockwise from 12 o'clock. Color: green ≤50%, yellow 51–80%, red >80%.

## Burn-rate forecast
On every successful poll, `background.js` appends a snapshot to `history` in `chrome.storage.local`:
```json
{ "t": 1749556201000, "session": 54, "weekly": 6 }
```
- History is pruned to the last **6 hours** on each write.
- A session-utilization drop of ≥30% between polls is treated as a **session reset**: the `session` field is nulled on older entries (weekly history is kept) so the slope never spans a reset boundary.
- `computeForecast(history, usage)` fits a linear slope over the last **30 min** (needs ≥5 points; otherwise `null`). If slope ≤ 0 → `{status:"idle"}`. Otherwise it computes `minutesTo100 = (100 − session) / slope` and compares against time-to-reset (from `usage.sessionResetAt`, the raw ISO `five_hour.resets_at`): reset first → `safe`, else `will_hit_limit` with `minutesTo100`.
- The forecast is stored on `usage.forecast` and POSTed to the widget as flat `forecastStatus` / `minutesTo100` fields.
- One Chrome notification fires when the forecast first transitions to `will_hit_limit` with `minutesTo100 < 45`; the `forecastNotified` flag resets on session reset.

## Window primer & planner
The session limit is a rolling 5-hour window anchored to your **first** message, so sending a throwaway "primer" lets you choose when the window starts.

- **Primer (one-click):** the popup's "Start window now" button sets a `primerPending` timestamp in storage and opens `claude.ai/new`. On that fresh tab `content.js` waits for the compose box and pre-fills a throwaway prompt via `execCommand("insertText")` (textarea fallback: native value setter + `input` event). It **never** presses Enter or clicks send — the user submits. If no composer is found within ~6s it gives up silently and leaves the tab open. The flag is consumed immediately and ignored if older than 15s.
- **Planner (`planner.js`, shared):** work hours live in `chrome.storage.local.workHours = {start, end}` (minutes from midnight; default 1 PM–11 PM). `computePlan(work)` searches primer times 8 AM–12 PM in 30-min steps and picks the one that maximizes workday coverage by the block `[T, T+15h]`, breaking ties by centering the 3-window block (`[T,T+5h], [T+5h,T+10h], [T+10h,T+15h]`) on the workday midpoint — so a fresh window lands mid-day. The popup shows the recommendation text plus a CSS timeline (work-hours band over the three colored window bars).
- **Tray:** `background.js` POSTs `recommendedPrimerTime` (formatted string, or `null` if work hours unset); the widget's right-click menu shows `Next ideal primer: HH:MM AM` or `Set work hours in extension`.
- `chrome.tabs.create` does not require the `tabs` permission, so none was added.

## Constraints
- Work laptop: `powershell.exe` is blocked directly — must run the widget via VS Code terminal:
  ```powershell
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  . "D:\study\projects\claude-usage-monitor\claude-usage-widget.ps1"
  ```
- No admin installs allowed
- Extension is sideloaded via Chrome Developer Mode
- Keep polling interval ≥ 30s to avoid rate limits
- At least one claude.ai tab must be open for the content script keepalive to wake the service worker

## When editing
- After changing extension files, go to chrome://extensions and click Refresh
- After changing .ps1, restart the script in VS Code terminal
- Never hardcode session cookies or tokens

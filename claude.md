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
  popup.html/js      - Extension popup: mini dashboard with progress bars
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

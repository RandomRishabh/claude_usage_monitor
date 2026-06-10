# Claude Usage Monitor

## What this is
A Chrome extension + PowerShell system tray widget that shows Claude.ai usage (session %, weekly %, reset timers) on the Windows taskbar.

## Architecture
```
Chrome Extension (polls API every 30s)
    → chrome.storage.local (persists data)
    → Badge on toolbar icon (shows %)
    → POST http://localhost:9876/usage
        → PowerShell NotifyIcon in system tray
```

## File structure
```
extension/
  manifest.json      - Manifest V3, permissions: storage, notifications
  background.js      - Service worker: polls usage API, updates badge, sends to widget
  content.js         - Content script on claude.ai: DOM scraper fallback + fetch interceptor
  inject.js          - Page-context script: wraps window.fetch to catch usage API responses
  popup.html/js      - Extension popup: mini dashboard with progress bars
  icon16/48/64.png   - Extension icons
claude-usage-widget.ps1  - PowerShell system tray icon with HTTP listener on :9876
Start-Claude-Widget.bat  - Launcher for the PS1 script
```

## Key API endpoint
- `GET https://claude.ai/api/organizations/{orgId}/usage` — returns usage data
- Org ID auto-discovered via `GET https://claude.ai/api/organizations`
- Auth: browser session cookies (credentials: "include")

## Constraints
- Work laptop: PowerShell only runs via VS Code terminal (direct powershell.exe is blocked)
- No admin installs allowed
- Extension is sideloaded via Chrome Developer Mode
- Keep polling interval ≥ 30s to avoid rate limits
- The usage API response format is not documented — parsing is best-effort/flexible

## When editing
- After changing extension files, user must go to chrome://extensions and click refresh
- After changing .ps1, user must restart the script in VS Code terminal
- Never hardcode session cookies or tokens
- Keep the extension lightweight — minimal permissions, no unnecessary network calls
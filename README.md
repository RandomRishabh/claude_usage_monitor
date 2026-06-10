# Claude Usage Taskbar Widget — Setup Guide

## What You're Setting Up

Two pieces that work together:

1. **Chrome Extension** — polls the claude.ai usage API every 30 seconds automatically
2. **PowerShell Widget** — shows a color-coded donut ring icon in your Windows taskbar tray (near the clock)

No admin password required for either.

---

## STEP 1 — Place the files

1. Unzip this folder somewhere permanent on your machine, e.g.:
   `C:\Users\YourName\claude-usage-monitor\`

   The folder should contain:
   ```
   claude-usage-monitor/
   ├── extension/
   │   ├── manifest.json
   │   ├── background.js
   │   ├── content.js
   │   ├── inject.js
   │   ├── popup.html
   │   └── popup.js
   ├── claude-usage-widget.ps1
   ├── Start-Claude-Widget.bat
   └── README.md
   ```

---

## STEP 2 — Load the Chrome Extension

1. Open **Chrome** (or **Edge** — same steps)
2. Go to `chrome://extensions` (or `edge://extensions`)
3. Toggle **Developer mode** ON (top-right switch)
4. Click **"Load unpacked"**
5. Select the `extension` folder inside `claude-usage-monitor`
6. You should see "Claude Usage Monitor" appear with an icon in your toolbar

> If the icon is hidden, click the puzzle-piece icon in Chrome's
> toolbar and pin "Claude Usage Monitor."

---

## STEP 3 — Start the Taskbar Widget

On **restricted work laptops where `powershell.exe` is blocked**, you must launch via VS Code terminal:

1. Open **VS Code**, then open its integrated terminal (`` Ctrl+` ``)
2. Run these two commands:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   . "D:\study\projects\claude-usage-monitor\claude-usage-widget.ps1"
   ```
3. A donut ring icon should appear in your system tray (bottom-right, near the clock)
4. If you don't see it, click the **^** arrow to expand hidden tray icons

> **`Start-Claude-Widget.bat`** is included but will not work on machines where
> `powershell.exe` is blocked by policy. Use the VS Code terminal method above.

---

## STEP 4 — How Polling Works

1. Make sure **at least one claude.ai tab is open** in Chrome (any page — you don't need Settings > Usage)
2. The extension polls the usage API automatically every **30 seconds** via `chrome.alarms`
3. The content script sends a keepalive ping every **20 seconds** so the service worker stays awake
4. The tray icon updates within ~30 seconds of opening Chrome

That's it — no manual page navigation needed.

---

## STEP 5 — Auto-Start on Login (Optional)

Since the `.bat` launcher may not work on restricted machines, create a VS Code workspace task or a shortcut that opens your `.ps1` in a terminal on login. The simplest approach is to pin VS Code to startup and keep a terminal profile that runs the widget command.

---

## How It Works Day-to-Day

| What you see                 | What it means                          |
|------------------------------|----------------------------------------|
| Green donut with "9"         | Session is at 9% — you're fine         |
| Yellow donut with "62"       | Session at 62% — moderate use          |
| Red donut with "91"          | Session at 91% — nearing limit!        |
| Hover over icon              | Tooltip shows session + weekly + reset |
| Left-click icon              | Popup with full details                |
| Right-click → Open Usage     | Opens claude.ai/settings/usage         |
| Right-click → Exit           | Shuts down the widget                  |
| Balloon notification at 75%  | Heads up warning                       |
| Balloon notification at 90%  | Critical warning                       |

The tray icon is a **donut ring** that fills clockwise from 12 o'clock. The arc color is green (≤50%), yellow (51–80%), or red (>80%). Drawn at 64×64 and downscaled to 32×32 for crisp anti-aliased rendering.

---

## Troubleshooting

**Widget icon doesn't appear:**
- Confirm the PS1 script is running in your VS Code terminal (no red errors)
- `powershell.exe` launched directly (e.g. double-clicking the .bat) is blocked on restricted machines — use the VS Code terminal method

**Data not updating / badge shows "…":**
- Make sure at least one claude.ai tab is open — the content script keepalive requires an active tab
- Click the extension icon to open the popup and check the last-updated timestamp
- Reload the claude.ai tab, then wait up to 30 seconds

**"?" badge on the extension icon:**
- Your claude.ai session has expired — log back in and the extension will rediscover your org automatically

**"Execution Policy" error in VS Code terminal:**
- Run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first (Process scope, not CurrentUser — avoids policy conflicts)

**Extension disappeared after Chrome update:**
- Sideloaded extensions sometimes get disabled. Go to chrome://extensions and toggle it back on.

---

## No Admin Required?

Correct:
- Chrome Developer Mode is a user-level toggle (no admin)
- PowerShell and System.Windows.Forms are built into Windows
- localhost HTTP listener doesn't need elevated privileges
- VS Code terminal inherits your user session — no elevation needed

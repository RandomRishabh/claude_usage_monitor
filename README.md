# Claude Usage Taskbar Widget — Setup Guide

## What You're Setting Up

Two pieces that work together:

1. **Chrome Extension** — silently captures your usage data from claude.ai
2. **PowerShell Widget** — shows a color-coded icon in your Windows taskbar tray (near the clock)

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

1. Double-click **`Start-Claude-Widget.bat`**
2. A green circle icon with "0" should appear in your system tray
   (bottom-right, near the clock/volume icons)
3. If you don't see it, click the **^** arrow to expand hidden tray icons

> The script opens a tiny HTTP server on localhost:9876 — no firewall
> issues, no admin needed. It stays running in the background.

---

## STEP 4 — Feed It Data

1. Go to **claude.ai** in your browser
2. Open **Settings → Usage** (the page from your screenshot)
3. The extension will scrape the usage percentages and send them
   to the taskbar widget
4. You should see the tray icon update to show your session percentage
   with a green/yellow/red color

The extension also tries to intercept Claude's internal API calls, so
after the initial reading, it may update automatically even without
the Usage page open.

---

## STEP 5 — Auto-Start on Login (Optional)

1. Press `Win + R`, type `shell:startup`, press Enter
2. Copy the **`Start-Claude-Widget.bat`** file into that folder
3. The widget will now launch automatically every time you log in

---

## How It Works Day-to-Day

| What you see                 | What it means                          |
|------------------------------|----------------------------------------|
| Green icon with "9"          | Session is at 9% — you're fine         |
| Yellow icon with "62"        | Session at 62% — moderate use          |
| Red icon with "91"           | Session at 91% — nearing limit!        |
| Hover over icon              | Tooltip shows session + weekly + reset |
| Left-click icon              | Popup with full details                |
| Right-click → Open Usage     | Opens claude.ai/settings/usage         |
| Right-click → Exit           | Shuts down the widget                  |
| Balloon notification at 75%  | Heads up warning                       |
| Balloon notification at 90%  | Critical warning                       |

---

## Troubleshooting

**Widget icon doesn't appear:**
- Make sure PowerShell is actually running (check Task Manager for `powershell`)
- Try running the .ps1 directly: right-click → "Run with PowerShell"

**Data not updating:**
- Go to claude.ai → Settings → Usage to trigger a fresh scrape
- Check the extension popup (click the extension icon) — if it says
  "No data yet," the DOM scraper hasn't found the usage text yet
- Reload the claude.ai tab

**"Execution Policy" error:**
- The .bat file already uses `-ExecutionPolicy Bypass`
- If it still fails, open PowerShell and run:
  `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

**Extension disappeared after Chrome update:**
- Sideloaded extensions sometimes get disabled. Just go to
  chrome://extensions, find it, and toggle it back on.

---

## No Admin Required?

Correct:
- Chrome Developer Mode is a user-level toggle (no admin)
- PowerShell and System.Windows.Forms are built into Windows
- localhost HTTP listener doesn't need elevated privileges
- `shell:startup` is a per-user folder (no admin)

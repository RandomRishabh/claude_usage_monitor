---
name: usage-monitor-conventions
description: Conventions for the Claude Usage Monitor (Chrome extension + PowerShell tray widget). Use when editing any file in this project — covers the dark theme palette, level thresholds, WinForms GDI disposal, the no-auto-send safety rule, the usage API schema, and the commit workflow.
---

# Claude Usage Monitor — conventions

Reference for keeping changes consistent. Apply when editing extension JS, the PowerShell widget, or popup UI.

## Dark theme palette
| Color | Hex / ARGB | Used for |
|-------|-----------|----------|
| Background | `#15151E` (21,21,30) | popup body, widget form bg |
| Track | `#1F1F2E` (31,31,46) | progress-bar track behind fill |
| Muted text | `#8A8A99` (138,138,153) | labels, secondary/footer text |
| White | `#F5F5F5` / `#FFF` | values, header title |
| Accent blue | `#5B9BD5` (91,155,213) | reset times, "Ideal primer" line |
| Border/line | `#2A2A3A` (42,42,58) | window border, header accent line |
| Warn | `#F39C12` | forecast `will_hit_limit` text |

## Level thresholds (status color)
`>80` red `#E74C3C` · `51–80` yellow `#F39C12` · `≤50` green `#27AE60`.
JS: `colorClass()`/`badgeColor()`. PowerShell: `Get-Level` → `Get-LevelColor`. Keep these in sync.

## WinForms GDI disposal (claude-usage-widget.ps1)
The detail window opens/closes many times a day — leaks accumulate.
- Build the form **once** (`Initialize-DetailWindow`), reuse via Show/Hide. Never recreate per open.
- Any `Pen`/`Brush`/`GraphicsPath`/`Font`/`Graphics` created **inside a Paint handler** must be `.Dispose()`d in that same handler.
- Fonts/controls created once with the form may live for the process lifetime (no per-open disposal).
- Paint handlers: `SmoothingMode = HighQuality`; text-bearing surfaces: `TextRenderingHint = ClearTypeGridFit`.
- DPI: process is set PER_MONITOR_AWARE_V2 at startup; the form uses `AutoScaleMode = Dpi` with a 96-DPI baseline. Coordinates drawn manually in Paint must scale by `$s.DeviceDpi / 96.0`.

## Safety: never auto-send
The primer feature **pre-fills only** — type the throwaway prompt into the composer and leave the caret for the user. Never dispatch Enter, click send, or submit programmatically. If the composer isn't found, fail gracefully (leave the tab open).

## Usage API schema
`GET https://claude.ai/api/organizations/{uuid}/usage` (org uuid from `orgs[0].uuid`, **not** `.id`):
```json
{ "five_hour": { "utilization": 54.0, "resets_at": "2026-06-10T12:30:01Z" },
  "seven_day": { "utilization": 6.0,  "resets_at": "2026-06-14T06:00:01Z" } }
```
`five_hour` = session, `seven_day` = weekly. Parse via `parseUsageResponse`; keep raw `resets_at` as `sessionResetAt` for forecast math. Auth: `credentials: "include"`.

## Commit workflow
Commit to the **dev** branch after each completed, verified change with a clear, descriptive message. One logical change per commit. Co-author trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Reload after edits
Extension files → `chrome://extensions` → Refresh. `.ps1` → restart in VS Code terminal (powershell.exe is blocked on the work laptop).

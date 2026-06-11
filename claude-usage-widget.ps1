<#
  Claude Usage Taskbar Widget
  ============================
  Sits in the Windows system tray (notification area).
  Receives usage data from the Chrome extension via HTTP on localhost:9876.

  Run:  powershell -ExecutionPolicy Bypass -File claude-usage-widget.ps1
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── High-DPI awareness (MUST run before any Form/control is created) ──
# Tells Windows we render at native resolution, so it won't bitmap-scale
# (blur) the window on high-DPI displays.
try {
    Add-Type -Namespace Native -Name DpiApi -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
'@
    # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
    if (-not [Native.DpiApi]::SetProcessDpiAwarenessContext([System.IntPtr](-4))) {
        [Native.DpiApi]::SetProcessDPIAware() | Out-Null   # fallback (older Windows)
    }
} catch {
    try { [Native.DpiApi]::SetProcessDPIAware() | Out-Null } catch {}
}

# Modern theming + GDI (TextRenderer) text so labels render crisply.
try {
    [System.Windows.Forms.Application]::EnableVisualStyles()
    [System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)
} catch {}

# ── DPI scale factor (read AFTER DPI awareness is set above) ─────────
# The detail window is laid out at a 96-DPI baseline and scaled manually
# by this factor, so it never clips/overlaps at 125%/150% display scaling.
$script:dwScale = 1.0
try {
    $screenG = [System.Drawing.Graphics]::FromHwnd([System.IntPtr]::Zero)
    $script:dwScale = $screenG.DpiX / 96.0
    $screenG.Dispose()
} catch {}
if ($script:dwScale -le 0) { $script:dwScale = 1.0 }

# ── Global state ─────────────────────────────────────────────────────
$script:usage = @{
    session              = $null
    weekly               = $null
    sessionReset         = $null
    weeklyReset          = $null
    lastUpdated          = $null
    forecastStatus       = $null
    minutesTo100         = $null
    recommendedPrimerTime = $null
}

# ── Theme palette (custom detail window) ─────────────────────────────
$cBg     = [System.Drawing.Color]::FromArgb(21, 21, 30)    # #15151E
$cMuted  = [System.Drawing.Color]::FromArgb(138, 138, 153) # #8A8A99
$cWhite  = [System.Drawing.Color]::FromArgb(245, 245, 245)
$cAccent = [System.Drawing.Color]::FromArgb(91, 155, 213)  # reset blue
$cLine   = [System.Drawing.Color]::FromArgb(42, 42, 58)
$cWarn   = [System.Drawing.Color]::FromArgb(243, 156, 18)

# Detail-window toggle + drag state
$script:detailForm     = $null
$script:detailHiddenAt = [DateTime]::MinValue
$script:dwDragging     = $false
$script:dwDragCursor   = $null
$script:dwDragForm     = $null

# ── Icon generator (donut ring progress indicator) ───────────────────
function New-TrayIcon([int]$pct, [string]$level) {
    # Draw on a 128px canvas, downscale to the system tray icon size → crisp.
    $canvas = 128
    $bmp = New-Object System.Drawing.Bitmap($canvas, $canvas)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $ringColor = switch ($level) {
        'red'    { [System.Drawing.Color]::FromArgb(231, 76, 60)  }
        'yellow' { [System.Drawing.Color]::FromArgb(243, 156, 18) }
        default  { [System.Drawing.Color]::FromArgb(39, 174, 96)  }
    }

    # Ring: center (64,64), path radius 52, pen width 8 → rect (12,12,104,104)
    # Thin ring leaves more interior space for the number.
    $penW  = 8
    $ringR = 52
    $rx = 12; $ry = 12; $rw = 104; $rh = 104

    # Background ring (full 360°, dark gray, 30% opacity)
    $bgPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(77, 42, 42, 42), $penW)
    $bgPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawArc($bgPen, $rx, $ry, $rw, $rh, 0, 360)

    # Progress ring (clockwise from top, -90°)
    $sweep = [Math]::Round($pct / 100.0 * 360, 1)
    if ($sweep -gt 0) {
        $fgPen = New-Object System.Drawing.Pen($ringColor, $penW)
        $fgPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $fgPen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
        $g.DrawArc($fgPen, $rx, $ry, $rw, $rh, -90, $sweep)
        $fgPen.Dispose()
    }

    # Center number — must sit INSIDE the donut hole, not over the ring.
    # Auto-fit: shrink (pixel) font until the text box is contained within a
    # circle of radius (ringR - penW), i.e. half its diagonal <= safe radius.
    $text     = if ($pct -ge 100) { "!" } else { "$pct" }
    $fontSize = if ($text.Length -ge 3) { 34.0 } elseif ($text.Length -eq 2) { 44.0 } else { 52.0 }
    $safeR    = $ringR - $penW
    $font     = $null
    $sz       = $null
    while ($true) {
        if ($null -ne $font) { $font.Dispose() }
        $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $sz   = $g.MeasureString($text, $font)
        $halfDiag = [Math]::Sqrt(($sz.Width * $sz.Width) + ($sz.Height * $sz.Height)) / 2.0
        if ($halfDiag -le $safeR -or $fontSize -le 12) { break }
        $fontSize -= 2
    }
    $x = ($canvas - $sz.Width)  / 2
    $y = ($canvas - $sz.Height) / 2
    $g.DrawString($text, $font, [System.Drawing.Brushes]::White, $x, $y)

    $font.Dispose(); $bgPen.Dispose(); $g.Dispose()

    # Downscale to the actual tray icon size (DPI-correct) via bicubic
    $iconSize = [System.Windows.Forms.SystemInformation]::SmallIconSize
    $resized  = New-Object System.Drawing.Bitmap($bmp, $iconSize)
    $bmp.Dispose()
    return [System.Drawing.Icon]::FromHandle($resized.GetHicon())
}

function Get-Level([int]$pct) {
    if ($pct -gt 80) { return 'red' }
    if ($pct -gt 50) { return 'yellow' }
    return 'green'
}

function Get-LevelColor([string]$lvl) {
    switch ($lvl) {
        'red'    { [System.Drawing.Color]::FromArgb(231, 76, 60)  }
        'yellow' { [System.Drawing.Color]::FromArgb(243, 156, 18) }
        default  { [System.Drawing.Color]::FromArgb(39, 174, 96)  }
    }
}

# ── Custom detail window (replaces the dated MessageBox popup) ────────
# A rounded-rectangle path for flat, modern progress bars.
function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    if ($r -gt ($w / 2)) { $r = $w / 2 }
    if ($r -gt ($h / 2)) { $r = $h / 2 }
    $d = 2 * $r
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
    $path.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $path.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

# Paint handler shared by both progress bars. Reads the % from the panel's .Tag.
$script:BarPaint = {
    param($s, $e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $w = $s.ClientSize.Width
    $h = $s.ClientSize.Height
    $r = $h / 2.0
    $pct = [int]$s.Tag

    # Dark track
    $trackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(31, 31, 46))
    $trackPath  = New-RoundedPath 0 0 $w $h $r
    $g.FillPath($trackBrush, $trackPath)
    $trackBrush.Dispose(); $trackPath.Dispose()

    # Filled portion, colored by level (≥ track height so the rounded cap shows)
    if ($pct -gt 0) {
        $clamped = [Math]::Min($pct, 100)
        $fw  = [Math]::Max([int]$h, [int]($w * ($clamped / 100.0)))
        $col = Get-LevelColor (Get-Level $pct)
        $fillBrush = New-Object System.Drawing.SolidBrush($col)
        $fillPath  = New-RoundedPath 0 0 $fw $h $r
        $g.FillPath($fillBrush, $fillPath)
        $fillBrush.Dispose(); $fillPath.Dispose()
    }
}

# Paint handler for the small status dot. Reads the level from the panel's .Tag.
$script:DotPaint = {
    param($s, $e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $col = Get-LevelColor ([string]$s.Tag)
    $b = New-Object System.Drawing.SolidBrush($col)
    $g.FillEllipse($b, 0, 0, ($s.ClientSize.Width - 1), ($s.ClientSize.Height - 1))
    $b.Dispose()
}

# Scale a 96-DPI coordinate/size to the active DPI.
function S([double]$v) { return [int][Math]::Round($v * $script:dwScale) }

# Build a Bold/Regular pixel-unit font at the 96-DPI point size, DPI-scaled.
function New-PxFont([string]$name, [double]$pt, [System.Drawing.FontStyle]$style) {
    $px = $pt * (96.0 / 72.0) * $script:dwScale
    return New-Object System.Drawing.Font($name, [single]$px, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function New-Lbl($text, $x, $y, $w, $h, $font, $color, $align) {
    $l = New-Object System.Windows.Forms.Label
    $l.AutoSize  = $false
    $l.Text      = $text
    $l.Location  = New-Object System.Drawing.Point((S $x), (S $y))
    $l.Size      = New-Object System.Drawing.Size((S $w), (S $h))
    $l.Font      = $font
    $l.ForeColor = $color
    $l.BackColor = [System.Drawing.Color]::Transparent
    if ($align) { $l.TextAlign = $align }
    return $l
}

# Borderless window → make the header draggable.
function Add-DragHandlers($ctrl) {
    $ctrl.Add_MouseDown({
        param($s, $e)
        if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            $script:dwDragging   = $true
            $script:dwDragCursor = [System.Windows.Forms.Cursor]::Position
            $script:dwDragForm   = $script:detailForm.Location
        }
    })
    $ctrl.Add_MouseMove({
        param($s, $e)
        if ($script:dwDragging) {
            $cur = [System.Windows.Forms.Cursor]::Position
            $nx  = $script:dwDragForm.X + ($cur.X - $script:dwDragCursor.X)
            $ny  = $script:dwDragForm.Y + ($cur.Y - $script:dwDragCursor.Y)
            $script:detailForm.Location = New-Object System.Drawing.Point($nx, $ny)
        }
    })
    $ctrl.Add_MouseUp({ $script:dwDragging = $false })
}

# Builds the window once; reused (show/hide) for the app's lifetime.
function Initialize-DetailWindow {
    $f = New-Object System.Windows.Forms.Form
    # We scale every coord/size/font manually by $script:dwScale, so disable
    # WinForms auto-scaling to avoid double-scaling.
    $f.AutoScaleMode   = [System.Windows.Forms.AutoScaleMode]::None
    $f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $f.Width           = S 320
    $f.Height          = S 286   # +30 base for breathing room (forecast/primer)
    $f.BackColor       = $cBg
    $f.ShowInTaskbar   = $false
    $f.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
    $f.TopMost         = $true

    # 1px border + subtle accent line under the header (DPI-scaled coords)
    $f.Add_Paint({
        param($s, $e)
        $e.Graphics.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $e.Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
        $pad   = S 18
        $lineY = S 47
        $pen = New-Object System.Drawing.Pen($cLine, 1)
        $e.Graphics.DrawRectangle($pen, 0, 0, ($s.Width - 1), ($s.Height - 1))
        $e.Graphics.DrawLine($pen, $pad, $lineY, ($s.Width - $pad), $lineY)
        $pen.Dispose()
    })
    # Click-away hides the window
    $f.Add_Deactivate({
        $script:detailForm.Hide()
        $script:detailHiddenAt = [DateTime]::Now
    })

    # Fonts (created once, reused) — pixel-unit, DPI-scaled
    $reg     = [System.Drawing.FontStyle]::Regular
    $bold    = [System.Drawing.FontStyle]::Bold
    $fHeader = New-PxFont "Segoe UI Semibold" 12 $reg
    $fLabel  = New-PxFont "Segoe UI" 8  $reg
    $fReset  = New-PxFont "Segoe UI" 9  $reg
    $fPct    = New-PxFont "Segoe UI" 10 $bold
    $fFore   = New-PxFont "Segoe UI" 9  $reg
    $fSmall  = New-PxFont "Segoe UI" 8  $reg

    $alignL = [System.Drawing.ContentAlignment]::MiddleLeft
    $alignR = [System.Drawing.ContentAlignment]::MiddleRight

    # Header: status dot + title
    $dot = New-Object System.Windows.Forms.Panel
    $dot.Location  = New-Object System.Drawing.Point((S 18), (S 20))
    $dot.Size      = New-Object System.Drawing.Size((S 11), (S 11))
    $dot.BackColor = $cBg
    $dot.Tag       = 'green'
    $dot.Add_Paint($script:DotPaint)
    $f.Controls.Add($dot)
    $script:dwDot = $dot

    $title = New-Lbl "Claude Usage" 36 15 220 24 $fHeader $cWhite $alignL
    $f.Controls.Add($title)

    # CURRENT SESSION
    $f.Controls.Add((New-Lbl "CURRENT SESSION" 18 58 284 14 $fLabel $cMuted $alignL))

    $sBar = New-Object System.Windows.Forms.Panel
    $sBar.Location  = New-Object System.Drawing.Point((S 18), (S 76))
    $sBar.Size      = New-Object System.Drawing.Size((S 284), (S 8))
    $sBar.BackColor = $cBg
    $sBar.Tag       = 0
    $sBar.Add_Paint($script:BarPaint)
    $f.Controls.Add($sBar)
    $script:dwSessionBar = $sBar

    $script:dwSessionReset = New-Lbl "" 18 90 180 16 $fReset $cAccent $alignL
    $script:dwSessionPct   = New-Lbl "" 18 90 284 16 $fPct   $cWhite  $alignR
    $f.Controls.Add($script:dwSessionReset)
    $f.Controls.Add($script:dwSessionPct)

    # WEEKLY LIMIT
    $f.Controls.Add((New-Lbl "WEEKLY LIMIT" 18 116 284 14 $fLabel $cMuted $alignL))

    $wBar = New-Object System.Windows.Forms.Panel
    $wBar.Location  = New-Object System.Drawing.Point((S 18), (S 134))
    $wBar.Size      = New-Object System.Drawing.Size((S 284), (S 8))
    $wBar.BackColor = $cBg
    $wBar.Tag       = 0
    $wBar.Add_Paint($script:BarPaint)
    $f.Controls.Add($wBar)
    $script:dwWeeklyBar = $wBar

    $script:dwWeeklyReset = New-Lbl "" 18 148 180 16 $fReset $cAccent $alignL
    $script:dwWeeklyPct   = New-Lbl "" 18 148 284 16 $fPct   $cWhite  $alignR
    $f.Controls.Add($script:dwWeeklyReset)
    $f.Controls.Add($script:dwWeeklyPct)

    # Forecast + recommended primer
    $script:dwForecast = New-Lbl "" 18 176 284 16 $fFore  $cMuted  $alignL
    $script:dwPrimer   = New-Lbl "" 18 197 284 16 $fReset $cAccent $alignL
    $f.Controls.Add($script:dwForecast)
    $f.Controls.Add($script:dwPrimer)

    # Footer
    $script:dwFooter = New-Lbl "" 18 224 284 14 $fSmall $cMuted $alignL
    $f.Controls.Add($script:dwFooter)

    Add-DragHandlers $f
    Add-DragHandlers $title

    $script:detailForm = $f
}

# Refreshes the window's controls from the live $script:usage state.
function Update-DetailWindow {
    $u = $script:usage
    $pct = if ($null -ne $u.session) { $u.session } elseif ($null -ne $u.weekly) { $u.weekly } else { 0 }

    $script:dwDot.Tag = Get-Level $pct
    $script:dwDot.Invalidate()

    if ($null -ne $u.session) {
        $script:dwSessionBar.Tag    = [int]$u.session
        $script:dwSessionPct.Text   = "$($u.session)% used"
        $script:dwSessionReset.Text = if ($u.sessionReset) { "Resets in $($u.sessionReset)" } else { "" }
    } else {
        $script:dwSessionBar.Tag    = 0
        $script:dwSessionPct.Text   = "—"
        $script:dwSessionReset.Text = ""
    }
    $script:dwSessionBar.Invalidate()

    if ($null -ne $u.weekly) {
        $script:dwWeeklyBar.Tag    = [int]$u.weekly
        $script:dwWeeklyPct.Text   = "$($u.weekly)% used"
        $script:dwWeeklyReset.Text = if ($u.weeklyReset) { "Resets $($u.weeklyReset)" } else { "" }
    } else {
        $script:dwWeeklyBar.Tag    = 0
        $script:dwWeeklyPct.Text   = "—"
        $script:dwWeeklyReset.Text = ""
    }
    $script:dwWeeklyBar.Invalidate()

    switch ($u.forecastStatus) {
        'will_hit_limit' {
            $script:dwForecast.Text = if ($null -ne $u.minutesTo100) {
                "⚠ At this pace, limit in ~$($u.minutesTo100) min (before reset)"
            } else { "⚠ Approaching the session limit" }
            $script:dwForecast.ForeColor = $cWarn
        }
        'safe' {
            $script:dwForecast.Text = "On pace — reset arrives first"
            $script:dwForecast.ForeColor = $cMuted
        }
        'idle' {
            $script:dwForecast.Text = "No active usage recently"
            $script:dwForecast.ForeColor = $cMuted
        }
        default { $script:dwForecast.Text = "" }
    }

    $script:dwPrimer.Text = if ($u.recommendedPrimerTime) { "Ideal primer: $($u.recommendedPrimerTime)" } else { "" }

    $script:dwFooter.Text = if ($u.lastUpdated) {
        $ago = [Math]::Round(((Get-Date) - $u.lastUpdated).TotalMinutes)
        if ($ago -lt 1) { "Updated just now" } else { "Updated ${ago}m ago" }
    } else { "Waiting for data…" }
}

# ── NotifyIcon setup ─────────────────────────────────────────────────
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Visible = $true
$tray.Icon    = New-TrayIcon 0 'green'
$tray.Text    = "Claude Usage — waiting for data…"

# Context menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:menuPrimer = $menu.Items.Add("Set work hours in extension")
$script:menuPrimer.Enabled = $false   # informational display only
$null = $menu.Items.Add("-")
$menuRefresh = $menu.Items.Add("Open Usage Page")
$menuRefresh.Add_Click({
    Start-Process "https://claude.ai/settings/usage"
})
$menuSep  = $menu.Items.Add("-")
$menuExit = $menu.Items.Add("Exit")
$menuExit.Add_Click({
    $script:running = $false
    $tray.Visible = $false
    $tray.Dispose()
    $listener.Stop()
    [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu

# ── Detail window on left-click ──────────────────────────────────────
Initialize-DetailWindow

# Left-click toggles the custom detail window; right-click uses the menu.
$tray.Add_MouseClick({
    param($s, $e)
    if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }

    if ($script:detailForm.Visible) {
        $script:detailForm.Hide()
        return
    }
    # If this same click just closed the window via Deactivate, don't reopen.
    if (((Get-Date) - $script:detailHiddenAt).TotalMilliseconds -lt 300) { return }

    Update-DetailWindow
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $x  = $wa.Right  - $script:detailForm.Width  - 12
    $y  = $wa.Bottom - $script:detailForm.Height - 12
    $script:detailForm.Location = New-Object System.Drawing.Point($x, $y)
    $script:detailForm.Show()
    $script:detailForm.Activate()
})

# ── Balloon notification at thresholds ───────────────────────────────
$script:notified75  = $false
$script:notified90  = $false

function Show-Alert([int]$pct) {
    if ($pct -ge 90 -and -not $script:notified90) {
        $tray.BalloonTipIcon  = 'Warning'
        $tray.BalloonTipTitle = 'Claude Usage Critical'
        $tray.BalloonTipText  = "Session is at ${pct}% — you're close to the limit!"
        $tray.ShowBalloonTip(5000)
        $script:notified90 = $true
    }
    elseif ($pct -ge 75 -and -not $script:notified75) {
        $tray.BalloonTipIcon  = 'Info'
        $tray.BalloonTipTitle = 'Claude Usage Warning'
        $tray.BalloonTipText  = "Session usage is at ${pct}%."
        $tray.ShowBalloonTip(4000)
        $script:notified75 = $true
    }
    # Reset flags when usage drops (session reset)
    if ($pct -lt 50) {
        $script:notified75 = $false
        $script:notified90 = $false
    }
}

# ── Update tray from new data ────────────────────────────────────────
function Update-Tray {
    $u   = $script:usage
    $pct = if ($null -ne $u.session) { $u.session } elseif ($null -ne $u.weekly) { $u.weekly } else { 0 }
    $lvl = Get-Level $pct

    $tray.Icon = New-TrayIcon $pct $lvl

    $tip = "Claude Usage`n"
    if ($null -ne $u.session) { $tip += "Session: $($u.session)%  " }
    if ($u.sessionReset)      { $tip += "(resets $($u.sessionReset))`n" }
    if ($null -ne $u.weekly)  { $tip += "Weekly: $($u.weekly)%" }
    if ($u.forecastStatus -eq 'will_hit_limit' -and $null -ne $u.minutesTo100) {
        $tip += "`nLimit in ~$($u.minutesTo100) min"
    }
    $tray.Text = $tip.Substring(0, [Math]::Min($tip.Length, 127))

    # Window-planner recommendation in the right-click menu
    if ($u.recommendedPrimerTime) {
        $script:menuPrimer.Text = "Next ideal primer: $($u.recommendedPrimerTime)"
    } else {
        $script:menuPrimer.Text = "Set work hours in extension"
    }

    # Live-refresh the detail window if it's open
    if ($script:detailForm -and $script:detailForm.Visible) { Update-DetailWindow }

    Show-Alert $pct
}

# ── HTTP listener on localhost:9876 ──────────────────────────────────
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:9876/")
$listener.Start()
Write-Host "Claude Usage Widget listening on http://localhost:9876 …"

$script:running = $true

# ── Async accept loop (non-blocking so the tray stays responsive) ────
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300   # check every 300 ms

$asyncResult = $listener.BeginGetContext($null, $null)

$timer.Add_Tick({
    if (-not $script:running) { return }

    # Check for incoming HTTP request
    if ($asyncResult.IsCompleted) {
        try {
            $ctx  = $listener.EndGetContext($asyncResult)
            $req  = $ctx.Request
            $resp = $ctx.Response

            # CORS headers so the browser extension can POST
            $resp.Headers.Add("Access-Control-Allow-Origin", "*")
            $resp.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")
            $resp.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

            if ($req.HttpMethod -eq "OPTIONS") {
                $resp.StatusCode = 204
                $resp.Close()
            }
            elseif ($req.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($req.InputStream)
                $body   = $reader.ReadToEnd()
                $reader.Close()

                try {
                    $json = $body | ConvertFrom-Json
                    if ($null -ne $json.session)      { $script:usage.session      = [int]$json.session }
                    if ($null -ne $json.weekly)        { $script:usage.weekly       = [int]$json.weekly }
                    if ($json.sessionReset)            { $script:usage.sessionReset = $json.sessionReset }
                    if ($json.weeklyReset)             { $script:usage.weeklyReset  = $json.weeklyReset }
                    $script:usage.forecastStatus = $json.forecastStatus
                    $script:usage.minutesTo100   = if ($null -ne $json.minutesTo100) { [int]$json.minutesTo100 } else { $null }
                    $script:usage.recommendedPrimerTime = $json.recommendedPrimerTime
                    $script:usage.lastUpdated = Get-Date
                    Update-Tray
                } catch {}

                $resp.StatusCode  = 200
                $resp.ContentType = "application/json"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true}')
                $resp.OutputStream.Write($bytes, 0, $bytes.Length)
                $resp.Close()
            }
            else {
                $resp.StatusCode = 405
                $resp.Close()
            }
        } catch {}

        # Begin listening for next request
        $asyncResult = $listener.BeginGetContext($null, $null)
        Set-Variable -Name asyncResult -Value $asyncResult -Scope 1
    }
})

$timer.Start()

# ── Run the message loop (keeps the tray icon alive) ─────────────────
[System.Windows.Forms.Application]::Run()

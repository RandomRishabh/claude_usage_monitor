<#
  Claude Usage Taskbar Widget
  ============================
  Sits in the Windows system tray (notification area).
  Receives usage data from the Chrome extension via HTTP on localhost:9876.

  Run:  powershell -ExecutionPolicy Bypass -File claude-usage-widget.ps1
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Global state ─────────────────────────────────────────────────────
$script:usage = @{
    session      = $null
    weekly       = $null
    sessionReset = $null
    weeklyReset  = $null
    lastUpdated  = $null
}

# ── Icon generator (draws a number inside a colored circle) ──────────
function New-TrayIcon([int]$pct, [string]$level) {
    $bmp = New-Object System.Drawing.Bitmap(16, 16)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = 'AntiAlias'
    $g.TextRenderingHint = 'ClearTypeGridFit'

    $color = switch ($level) {
        'red'    { [System.Drawing.Color]::FromArgb(231, 76, 60)  }
        'yellow' { [System.Drawing.Color]::FromArgb(243, 156, 18) }
        default  { [System.Drawing.Color]::FromArgb(39, 174, 96)  }
    }

    $g.FillEllipse((New-Object System.Drawing.SolidBrush($color)), 0, 0, 15, 15)

    $text = if ($pct -ge 100) { "!" } else { "$pct" }
    $fontSize = if ($text.Length -ge 2) { 6.5 } else { 7.5 }
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold)
    $sz   = $g.MeasureString($text, $font)
    $x    = [Math]::Max(0, (16 - $sz.Width)  / 2)
    $y    = [Math]::Max(0, (16 - $sz.Height) / 2)
    $g.DrawString($text, $font, [System.Drawing.Brushes]::White, $x, $y)

    $font.Dispose(); $g.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

function Get-Level([int]$pct) {
    if ($pct -gt 80) { return 'red' }
    if ($pct -gt 50) { return 'yellow' }
    return 'green'
}

# ── NotifyIcon setup ─────────────────────────────────────────────────
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Visible = $true
$tray.Icon    = New-TrayIcon 0 'green'
$tray.Text    = "Claude Usage — waiting for data…"

# Context menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip
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

# ── Detail popup on left-click ───────────────────────────────────────
$tray.Add_MouseClick({
    param($s, $e)
    if ($e.Button -ne 'Left') { return }

    $u = $script:usage
    $msg = ""

    if ($null -ne $u.session) {
        $msg += "SESSION:  $($u.session)% used`n"
        if ($u.sessionReset) { $msg += "  Resets in $($u.sessionReset)`n" }
        $msg += "`n"
    }
    if ($null -ne $u.weekly) {
        $msg += "WEEKLY:   $($u.weekly)% used`n"
        if ($u.weeklyReset) { $msg += "  Resets $($u.weeklyReset)`n" }
        $msg += "`n"
    }
    if ($u.lastUpdated) {
        $ago = [Math]::Round(((Get-Date) - $u.lastUpdated).TotalMinutes)
        $msg += "Updated: $(if ($ago -lt 1) { 'just now' } else { "${ago}m ago" })"
    }
    if (-not $msg) { $msg = "No usage data yet.`nOpen Settings > Usage on claude.ai." }

    [System.Windows.Forms.MessageBox]::Show(
        $msg,
        "Claude Usage Details",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    )
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
    $tray.Text = $tip.Substring(0, [Math]::Min($tip.Length, 127))

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

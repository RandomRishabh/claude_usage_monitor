// popup.js
function colorClass(pct) {
  if (pct > 80) return "red";
  if (pct > 50) return "yellow";
  return "green";
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

chrome.storage.local.get("usage", (res) => render(res.usage));

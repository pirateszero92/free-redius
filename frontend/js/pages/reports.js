/* =============================================================
   reports.js — Reports and Analytics page
   ============================================================= */
registerPage('reports', {
  title: 'Reports & Analytics',
  subtitle: 'Network authentication and bandwidth usage analysis',
  render: async () => `
    <div id="reports-root">
      <div class="stat-grid" style="grid-template-columns: 1fr 1fr; margin-bottom: 20px;">
        <div class="stat-card">
          <div class="stat-icon green">✅</div>
          <div class="stat-value" id="rep-accepts">0</div>
          <div class="stat-label">Total Successful Auths</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red">❌</div>
          <div class="stat-value" id="rep-rejects">0</div>
          <div class="stat-label">Total Failed Auths</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <!-- Top Active Users -->
        <div class="card">
          <div class="card-header"><span class="card-title">👥 Top 5 Active Users (Auths)</span></div>
          <div id="rep-active-users">${renderLoading()}</div>
        </div>
        <!-- Top Failed Users -->
        <div class="card">
          <div class="card-header"><span class="card-title">⚠️ Top 5 Users with Auth Failures</span></div>
          <div id="rep-failed-users">${renderLoading()}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <!-- Top Calling Stations (MACs) -->
        <div class="card">
          <div class="card-header"><span class="card-title">💻 Top 5 Client Device MACs</span></div>
          <div id="rep-calling-stations">${renderLoading()}</div>
        </div>
        <!-- Top Called Stations (APs/SSIDs) -->
        <div class="card">
          <div class="card-header"><span class="card-title">📡 Top 5 Connected APs / SSIDs</span></div>
          <div id="rep-called-stations">${renderLoading()}</div>
        </div>
      </div>

      <!-- Bandwidth Usage Report -->
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header"><span class="card-title">📊 Top 5 Users by Bandwidth Usage</span></div>
        <div id="rep-bandwidth-users" style="padding:0;">${renderLoading()}</div>
      </div>
    </div>`,
  onload: () => loadReportsSummary()
});

async function loadReportsSummary() {
  try {
    const data = await API.get('/reports/summary');
    
    // Set counts
    document.getElementById('rep-accepts').textContent = data.auth_ratio.accepts;
    document.getElementById('rep-rejects').textContent = data.auth_ratio.rejects;

    // Render active users
    const activeUsersEl = document.getElementById('rep-active-users');
    if (!data.top_active_users.length) {
      activeUsersEl.innerHTML = renderEmptyBox('No active users');
    } else {
      activeUsersEl.innerHTML = `
        <table>
          <thead><tr><th>Username</th><th>Auth Success Count</th></tr></thead>
          <tbody>${data.top_active_users.map(u => `
            <tr><td><code>${u.username}</code></td><td><strong>${u.count} times</strong></td></tr>
          `).join('')}</tbody>
        </table>`;
    }

    // Render failed users
    const failedUsersEl = document.getElementById('rep-failed-users');
    if (!data.top_failed_users.length) {
      failedUsersEl.innerHTML = renderEmptyBox('No auth failures');
    } else {
      failedUsersEl.innerHTML = `
        <table>
          <thead><tr><th>Username</th><th>Failure Count</th></tr></thead>
          <tbody>${data.top_failed_users.map(u => `
            <tr><td><code>${u.username}</code></td><td class="text-danger"><strong>${u.count} times</strong></td></tr>
          `).join('')}</tbody>
        </table>`;
    }

    // Render calling stations (client MACs)
    const callingEl = document.getElementById('rep-calling-stations');
    if (!data.top_calling_stations.length) {
      callingEl.innerHTML = renderEmptyBox('No client MAC data');
    } else {
      callingEl.innerHTML = `
        <table>
          <thead><tr><th>Client MAC Address</th><th>Auth Attempts</th></tr></thead>
          <tbody>${data.top_calling_stations.map(c => `
            <tr><td><code>${c.mac}</code></td><td>${c.count} times</td></tr>
          `).join('')}</tbody>
        </table>`;
    }

    // Render called stations (AP BSSIDs / SSIDs)
    const calledEl = document.getElementById('rep-called-stations');
    if (!data.top_called_stations.length) {
      calledEl.innerHTML = renderEmptyBox('No AP connection data');
    } else {
      calledEl.innerHTML = `
        <table>
          <thead><tr><th>AP BSSID / SSID Name</th><th>Connections</th></tr></thead>
          <tbody>${data.top_called_stations.map(c => `
            <tr><td><code>${c.id}</code></td><td>${c.count} times</td></tr>
          `).join('')}</tbody>
        </table>`;
    }

    // Render bandwidth users
    const bandwidthEl = document.getElementById('rep-bandwidth-users');
    if (!data.top_bandwidth_users.length) {
      bandwidthEl.innerHTML = `<div style="padding:16px;">${renderEmptyBox('No accounting data available yet')}</div>`;
    } else {
      bandwidthEl.innerHTML = `
        <table>
          <thead><tr>
            <th>Username</th><th>Upload (TX)</th><th>Download (RX)</th><th>Total Traffic</th>
          </tr></thead>
          <tbody>${data.top_bandwidth_users.map(b => `
            <tr>
              <td><code>${b.username}</code></td>
              <td>${fmtBytes(b.upload)}</td>
              <td>${fmtBytes(b.download)}</td>
              <td><strong>${fmtBytes(b.total)}</strong></td>
            </tr>
          `).join('')}</tbody>
        </table>`;
    }

  } catch (err) {
    toast(`Failed to load reports: ${err.message}`, 'error');
  }
}

function renderEmptyBox(msg) {
  return `<div class="text-muted text-center" style="padding:20px;font-size:13px;">${msg}</div>`;
}

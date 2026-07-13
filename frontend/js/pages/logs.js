/* =============================================================
   logs.js — System Logs page
   ============================================================= */
let logsService = 'freeradius';
let logsLines = 150;
let logsAutoRefreshInterval = null;

registerPage('logs', {
  title: 'System Logs',
  subtitle: 'Real-time container console outputs',
  render: async () => `
    <div id="logs-root">
      <div class="toolbar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="text-sm text-secondary">Service:</span>
          <select id="logs-select-service" class="form-select" style="width:160px;" onchange="changeLogsService(this.value)">
            <option value="freeradius">FreeRADIUS Server</option>
            <option value="api">Node.js REST API</option>
            <option value="postgres">PostgreSQL Database</option>
            <option value="nginx">Nginx Web Proxy</option>
          </select>
        </div>

        <div style="display:flex;align-items:center;gap:6px;">
          <span class="text-sm text-secondary">Lines:</span>
          <select id="logs-select-lines" class="form-select" style="width:80px;" onchange="changeLogsLines(this.value)">
            <option value="50">50</option>
            <option value="150" selected>150</option>
            <option value="300">300</option>
            <option value="500">500</option>
          </select>
        </div>

        <button class="btn btn-ghost" onclick="fetchLogs()" style="display:flex;align-items:center;gap:6px;">
          <span>🔄</span> Refresh
        </button>

        <div style="display:flex;align-items:center;gap:6px;">
          <span class="text-sm text-secondary">Search:</span>
          <div class="search-box" style="margin:0;width:220px;">
            <span class="search-icon">🔍</span>
            <input type="text" id="logs-search" placeholder="Search in logs..." style="width:100%;height:32px;padding-left:32px;font-size:13px;" oninput="onLogsSearchInput()">
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
          <label class="toggle">
            <input type="checkbox" id="logs-autorefresh" onchange="toggleLogsAutoRefresh(this.checked)" checked>
            <span class="toggle-slider"></span>
          </label>
          <span class="text-sm text-secondary">Auto-refresh (2s)</span>
        </div>
      </div>

      <div class="card" style="padding:0;background:#0d1117;border:1px solid #30363d;border-radius:var(--radius);overflow:hidden;">
        <div style="display:flex;justify-content:between;align-items:center;background:#161b22;padding:8px 16px;border-bottom:1px solid #30363d;">
          <span style="font-family:monospace;font-size:12px;color:#8b949e;" id="logs-terminal-title">console@freeradius-server:~</span>
          <button class="btn btn-ghost btn-sm" onclick="clearLogsTerminal()" style="color:#8b949e;padding:2px 8px;font-size:11px;">Clear Screen</button>
        </div>
        <pre id="logs-terminal" style="margin:0;padding:16px;height:550px;overflow-y:auto;font-family:'Courier New', Courier, monospace;font-size:12px;color:#c9d1d9;line-height:1.6;white-space:pre-wrap;background:#0d1117;text-align:left;"></pre>
      </div>
    </div>`,
  onload: () => {
    fetchLogs();
    // Enable auto-refresh by default
    toggleLogsAutoRefresh(true);
  },
  ondestroy: () => {
    // Clear auto-refresh timer when navigating away from this page
    if (logsAutoRefreshInterval) {
      clearInterval(logsAutoRefreshInterval);
      logsAutoRefreshInterval = null;
    }
  }
});

function changeLogsService(val) {
  logsService = val;
  document.getElementById('logs-terminal-title').textContent = `console@freeradius-${val}:~`;
  fetchLogs();
}

function changeLogsLines(val) {
  logsLines = parseInt(val) || 150;
  fetchLogs();
}

function toggleLogsAutoRefresh(checked) {
  if (logsAutoRefreshInterval) {
    clearInterval(logsAutoRefreshInterval);
    logsAutoRefreshInterval = null;
  }
  if (checked) {
    logsAutoRefreshInterval = setInterval(fetchLogs, 2000);
  }
}

function clearLogsTerminal() {
  const term = document.getElementById('logs-terminal');
  if (term) term.textContent = '';
}

function onLogsSearchInput() {
  fetchLogs();
}

async function fetchLogs() {
  const term = document.getElementById('logs-terminal');
  if (!term) return;
  
  const searchEl = document.getElementById('logs-search');
  const search = searchEl ? searchEl.value : '';
  
  try {
    const data = await API.get(`/logs?service=${logsService}&lines=${logsLines}&search=${encodeURIComponent(search)}`);
    
    // Check if terminal is currently scrolled to the bottom before replacing content
    const isAtBottom = term.scrollHeight - term.clientHeight <= term.scrollTop + 50;

    term.textContent = data.logs || '--- No matching logs found ---';

    // Auto-scroll to bottom if they were already at the bottom
    if (isAtBottom) {
      term.scrollTop = term.scrollHeight;
    }
  } catch (err) {
    term.textContent = `❌ Error fetching logs: ${err.message}\n\nMake sure the Docker Socket (/var/run/docker.sock) is correctly mounted to the API container and Docker is running.`;
  }
}

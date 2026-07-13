/* =============================================================
   accounting.js — Accounting & Auth Logs page
   ============================================================= */
let acctTab = 'sessions';
let acctPage = 1;
let authPage = 1;

registerPage('accounting', {
  title: 'Accounting',
  subtitle: 'Session & auth logs',
  render: async () => `
    <div id="acct-root">
      <div class="tabs">
        <div class="tab active" id="tab-sessions" onclick="switchAcctTab('sessions')">📡 Active/Sessions</div>
        <div class="tab" id="tab-authlogs" onclick="switchAcctTab('authlogs')">🔐 Auth Logs</div>
      </div>
      <div id="acct-tab-content"></div>
    </div>`,
  onload: () => renderSessionsTab()
});

function switchAcctTab(tab) {
  acctTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (tab === 'sessions') renderSessionsTab();
  else renderAuthLogsTab();
}

function renderSessionsTab() {
  const el = document.getElementById('acct-tab-content');
  if (!el) return;
  el.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="sess-user" placeholder="Filter by username...">
      </div>
      <select id="sess-status" class="form-select" style="width:130px;">
        <option value="">All Sessions</option>
        <option value="active">Active Only</option>
        <option value="stopped">Stopped</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="loadSessions(1)">Apply</button>
    </div>
    <div class="card" style="padding:0;">
      <div id="sess-table">${renderLoading()}</div>
      <div id="sess-pager" style="padding:12px 20px;border-top:1px solid var(--border);"></div>
    </div>`;
  loadSessions(1);
}

async function loadSessions(page) {
  acctPage = page;
  const wrap = document.getElementById('sess-table');
  if (!wrap) return;
  wrap.innerHTML = renderLoading();
  const username = (document.getElementById('sess-user') || {}).value || '';
  const status = (document.getElementById('sess-status') || {}).value || '';
  try {
    const data = await API.get(`/accounting/sessions?page=${page}&limit=15&username=${encodeURIComponent(username)}&status=${status}`);
    if (!data.data.length) {
      wrap.innerHTML = renderEmpty('📡', 'No sessions found', 'Sessions will appear when users connect via RADIUS');
      document.getElementById('sess-pager').innerHTML = '';
      return;
    }
    wrap.innerHTML = `
      <div style="overflow-x:auto;">
      <table>
        <thead><tr>
          <th>Username</th><th>Device / MAC</th><th>Client IP</th><th>Device Name</th><th>Device IP</th><th>Called Station</th>
          <th>Session Time</th><th>In ↓</th><th>Out ↑</th>
          <th>Start</th><th>Stop</th><th>Status</th>
        </tr></thead>
        <tbody>${data.data.map(s => `
          <tr>
            <td><code>${s.username}</code></td>
            <td>
              ${s.device_name ? `<code>${s.device_name}</code>` : ''}
              <div class="text-xs text-muted" style="font-family:monospace;">${s.callingstationid || '—'}</div>
            </td>
            <td><code>${s.framedipaddress || '—'}</code></td>
            <td><code>${s.nas_name || '—'}</code></td>
            <td><code>${s.nasipaddress}</code></td>
            <td class="text-sm text-muted">${s.calledstationid || '—'}</td>
            <td>${fmtDuration(s.acctsessiontime)}</td>
            <td class="text-sm">${fmtBytes(s.acctinputoctets)}</td>
            <td class="text-sm">${fmtBytes(s.acctoutputoctets)}</td>
            <td class="text-sm text-muted">${fmtDate(s.acctstarttime)}</td>
            <td class="text-sm text-muted">${fmtDate(s.acctstoptime)}</td>
            <td>${s.acctstoptime
              ? '<span class="badge badge-gray">Stopped</span>'
              : '<span class="badge badge-green">● Active</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
    document.getElementById('sess-pager').innerHTML =
      renderPagination(page, data.total, data.pages, 'loadSessions');
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger" style="margin:16px;"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

function renderAuthLogsTab() {
  const el = document.getElementById('acct-tab-content');
  if (!el) return;
  el.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="auth-user-filter" placeholder="Filter by username...">
      </div>
      <select id="auth-reply-filter" class="form-select" style="width:160px;">
        <option value="">All Results</option>
        <option value="Access-Accept">Access-Accept</option>
        <option value="Access-Reject">Access-Reject</option>
        <option value="Access-Challenge">Access-Challenge</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="loadAuthLogs(1)">Apply</button>
    </div>
    <div class="card" style="padding:0;">
      <div id="auth-log-table">${renderLoading()}</div>
      <div id="auth-log-pager" style="padding:12px 20px;border-top:1px solid var(--border);"></div>
    </div>`;
  loadAuthLogs(1);
}

async function loadAuthLogs(page) {
  authPage = page;
  const wrap = document.getElementById('auth-log-table');
  if (!wrap) return;
  wrap.innerHTML = renderLoading();
  const username = (document.getElementById('auth-user-filter') || {}).value || '';
  const reply = (document.getElementById('auth-reply-filter') || {}).value || '';
  try {
    const data = await API.get(`/accounting/auth-logs?page=${page}&limit=20&username=${encodeURIComponent(username)}&reply=${encodeURIComponent(reply)}`);
    if (!data.data.length) {
      wrap.innerHTML = renderEmpty('🔐', 'No auth logs', 'Auth events will appear when users attempt to authenticate');
      document.getElementById('auth-log-pager').innerHTML = '';
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>Username</th><th>Reply</th><th>Called Station</th><th>Date/Time</th>
        </tr></thead>
        <tbody>${data.data.map(l => {
          const isAccept = l.reply && l.reply.includes('Accept');
          const isReject = l.reply && l.reply.includes('Reject');
          const badgeClass = isAccept ? 'badge-green' : isReject ? 'badge-red' : 'badge-yellow';
          return `
          <tr>
            <td><code>${l.username}</code></td>
            <td><span class="badge ${badgeClass}">${l.reply || '—'}</span></td>
            <td class="text-sm text-muted">${l.calledstationid || '—'}</td>
            <td class="text-sm text-muted">${fmtDate(l.authdate)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
    document.getElementById('auth-log-pager').innerHTML =
      renderPagination(page, data.total, data.pages, 'loadAuthLogs');
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger" style="margin:16px;"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

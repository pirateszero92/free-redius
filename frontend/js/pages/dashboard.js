/* =============================================================
   dashboard.js
   ============================================================= */
registerPage('dashboard', {
  title: 'Dashboard',
  subtitle: 'System Overview',
  render: async () => {
    return `
      <div id="dashboard-root">
        <div class="stat-grid" id="stat-grid">${renderLoading()}</div>
        <div style="display:grid;grid-template-columns:1.25fr 0.75fr;gap:16px;" id="dash-bottom">
          <div class="card">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;">
              <span class="card-title" id="dash-sessions-title">🟢 Live Sessions (Last 5 mins)</span>
              <div style="display:flex;align-items:center;gap:8px;">
                <select id="dash-session-interval" class="form-select" style="width:110px;padding:4px 8px;font-size:12px;" onchange="changeDashSessionInterval(this.value)">
                  <option value="5" selected>Last 5 mins</option>
                  <option value="15">Last 15 mins</option>
                  <option value="30">Last 30 mins</option>
                  <option value="60">Last 1 Hour</option>
                </select>
                <input type="text" id="dash-session-search" placeholder="Search user or IP..." class="form-input" style="width:150px;padding:4px 8px;font-size:12px;" oninput="onDashSessionSearch(this.value)">
              </div>
            </div>
            <div id="live-sessions">${renderLoading()}</div>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">📈 Auth Activity (24h)</span>
            </div>
            <canvas id="auth-chart" height="180"></canvas>
            <div id="chart-fallback" class="hidden"></div>
          </div>
        </div>
      </div>`;
  },
  onload: async () => {
    loadDashStats();
    loadLiveSessions();
    loadAuthChart();
    // Poll stats and live sessions every 3 seconds
    this.dashPollInterval = setInterval(() => {
      loadDashStats();
      // Only poll automatically if the user is not actively searching
      const searchInput = document.getElementById('dash-session-search');
      if (searchInput && !searchInput.value) {
        loadLiveSessions();
      }
    }, 3000);
  },
  ondestroy: () => {
    if (this.dashPollInterval) {
      clearInterval(this.dashPollInterval);
      this.dashPollInterval = null;
    }
  }
});

let dashSessionInterval = 5;
let dashSessionSearch = '';
let dashSessionSearchTimer;

function changeDashSessionInterval(val) {
  dashSessionInterval = parseInt(val) || 5;
  
  const titleEl = document.getElementById('dash-sessions-title');
  if (titleEl) {
    const text = val === '60' ? 'Last 1 Hour' : `Last ${val} mins`;
    titleEl.textContent = `🟢 Live Sessions (${text})`;
  }
  
  loadLiveSessions();
}

function onDashSessionSearch(val) {
  dashSessionSearch = val;
  clearTimeout(dashSessionSearchTimer);
  dashSessionSearchTimer = setTimeout(loadLiveSessions, 300);
}

async function loadDashStats() {
  try {
    const s = await API.get('/dashboard/stats');
    document.getElementById('stat-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon blue">👤</div>
        <div class="stat-value">${s.total_users}</div>
        <div class="stat-label">Total Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple">👥</div>
        <div class="stat-value">${s.total_groups}</div>
        <div class="stat-label">Groups</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon yellow">🌐</div>
        <div class="stat-value">${s.total_nas}</div>
        <div class="stat-label">NAS Clients</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">🟢</div>
        <div class="stat-value">${s.active_sessions}</div>
        <div class="stat-label">Active Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">✅</div>
        <div class="stat-value">${s.total_accepts}</div>
        <div class="stat-label">Access Accepts</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red">❌</div>
        <div class="stat-value">${s.total_rejects}</div>
        <div class="stat-label">Access Rejects</div>
      </div>`;

    // AD status in topbar
    if (s.ad_enabled) {
      document.getElementById('topbar-actions').innerHTML = `
        <span class="badge badge-green">● AD Sync Active</span>
        <span class="text-sm text-muted">Last sync: ${fmtDate(s.ad_last_sync)}</span>`;
    }
  } catch (err) {
    document.getElementById('stat-grid').innerHTML = `<div class="alert alert-danger"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function loadLiveSessions() {
  const wrap = document.getElementById('live-sessions');
  if (!wrap) return;
  try {
    const sessions = await API.get(`/dashboard/live-sessions?minutes=${dashSessionInterval}&search=${encodeURIComponent(dashSessionSearch)}`);
    if (!sessions.length) {
      const text = dashSessionInterval === 60 ? '1 hour' : `${dashSessionInterval} minutes`;
      wrap.innerHTML = `<div class="text-muted text-center" style="padding:40px;font-size:13px;">No live sessions in the last ${text}</div>`;
      return;
    }
    wrap.innerHTML = `
      <table style="font-size:12px;">
        <thead><tr>
          <th>User</th><th>Client IP</th><th>Device IP</th><th>Status</th><th>Started</th>
        </tr></thead>
        <tbody>${sessions.map(s => {
          const isActive = !s.acctstoptime;
          return `
          <tr>
            <td><code>${s.username}</code></td>
            <td><code>${s.framedipaddress || '—'}</code></td>
            <td><code>${s.nasipaddress}</code></td>
            <td><span class="badge ${isActive ? 'badge-green' : 'badge-gray'}">${isActive ? 'Active' : 'Closed'}</span></td>
            <td class="text-muted text-sm">${fmtDate(s.acctstarttime)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<div class="text-muted text-sm" style="padding:16px;">Failed to load live sessions</div>`;
  }
}

async function loadAuthChart() {
  try {
    const data = await API.get('/dashboard/auth-chart');
    const canvas = document.getElementById('auth-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 400;
    const H = 180;
    canvas.width = W;
    canvas.height = H;

    if (!data.length) {
      ctx.fillStyle = '#4a5878';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data in last 24 hours', W / 2, H / 2);
      return;
    }

    const maxVal = Math.max(...data.map(d => Math.max(parseInt(d.accepts) || 0, parseInt(d.rejects) || 0)), 1);
    const pad = { top: 16, right: 16, bottom: 36, left: 44 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const barW = Math.max(4, (chartW / data.length) * 0.35);
    const gap = chartW / data.length;

    // Grid lines
    ctx.strokeStyle = 'rgba(99,149,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + chartH - (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = '#4a5878'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal / 4 * i), pad.left - 6, y + 4);
    }

    // Bars
    data.forEach((d, i) => {
      const x = pad.left + i * gap + gap / 2;
      const accepts = parseInt(d.accepts) || 0;
      const rejects = parseInt(d.rejects) || 0;

      // Accept bar (green)
      const ah = (accepts / maxVal) * chartH;
      const grad1 = ctx.createLinearGradient(0, pad.top + chartH - ah, 0, pad.top + chartH);
      grad1.addColorStop(0, 'rgba(52,211,153,0.9)'); grad1.addColorStop(1, 'rgba(52,211,153,0.4)');
      ctx.fillStyle = grad1;
      ctx.beginPath();
      ctx.roundRect(x - barW - 2, pad.top + chartH - ah, barW, ah, [3, 3, 0, 0]);
      ctx.fill();

      // Reject bar (red)
      const rh = (rejects / maxVal) * chartH;
      const grad2 = ctx.createLinearGradient(0, pad.top + chartH - rh, 0, pad.top + chartH);
      grad2.addColorStop(0, 'rgba(247,92,92,0.9)'); grad2.addColorStop(1, 'rgba(247,92,92,0.4)');
      ctx.fillStyle = grad2;
      ctx.beginPath();
      ctx.roundRect(x + 2, pad.top + chartH - rh, barW, rh, [3, 3, 0, 0]);
      ctx.fill();

      // Label
      if (i % Math.ceil(data.length / 6) === 0) {
        const hr = new Date(d.hour).getHours();
        ctx.fillStyle = '#4a5878'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
        ctx.fillText(`${String(hr).padStart(2,'0')}:00`, x, H - 8);
      }
    });

    // Legend
    ctx.fillStyle = 'rgba(52,211,153,0.8)';
    ctx.fillRect(pad.left, H - 14, 10, 8);
    ctx.fillStyle = '#8a9bb8'; ctx.font = '10px Inter'; ctx.textAlign = 'left';
    ctx.fillText('Accept', pad.left + 14, H - 7);
    ctx.fillStyle = 'rgba(247,92,92,0.8)';
    ctx.fillRect(pad.left + 70, H - 14, 10, 8);
    ctx.fillStyle = '#8a9bb8';
    ctx.fillText('Reject', pad.left + 84, H - 7);
  } catch (err) {
    console.error('Chart error', err);
  }
}

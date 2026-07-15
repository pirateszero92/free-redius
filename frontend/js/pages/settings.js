/* =============================================================
   settings.js — Settings page (AD/LDAP + General + Admin)
   ============================================================= */
let settingsTab = 'ad';

registerPage('settings', {
  title: 'Settings',
  subtitle: 'System configuration',
  render: async () => `
    <div id="settings-root">
      <div class="tabs">
        <div class="tab active" id="stab-ad" onclick="switchSettingsTab('ad')">🏢 Active Directory</div>
        <div class="tab" id="stab-general" onclick="switchSettingsTab('general')">⚙️ General</div>
        <div class="tab" id="stab-guest" onclick="switchSettingsTab('guest')">🌐 Guest Portal</div>
        <div class="tab" id="stab-admins" onclick="switchSettingsTab('admins')">👤 Admin Users</div>
        <div class="tab" id="stab-password" onclick="switchSettingsTab('password')">🔑 Change Password</div>
      </div>
      <div id="settings-tab-content"></div>
    </div>`,
  onload: async () => {
    await renderAdTab();
    const hostEl = document.getElementById('ad-host');
    if (hostEl && hostEl.value) {
      loadAdGroups();
    }
  }
});

function switchSettingsTab(tab) {
  settingsTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`stab-${tab}`).classList.add('active');
  const fns = { 
    ad: renderAdTab, 
    general: renderGeneralTab, 
    guest: renderGuestTab,
    admins: renderAdminsTab, 
    password: renderPasswordTab 
  };
  if (fns[tab]) fns[tab]();
}

/* ---- Active Directory Tab ---- */
async function renderAdTab() {
  const el = document.getElementById('settings-tab-content');
  el.innerHTML = renderLoading();
  try {
    const s = await API.get('/settings/ad');
    window.adSettings = s;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">
        <!-- Left: AD Config -->
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">🏢 Active Directory / LDAP Connection</span>
            </div>

            <div class="alert alert-info">
              <span class="alert-icon">ℹ️</span>
              <span>เปลี่ยนค่าได้ตลอดเวลาโดยไม่ต้อง restart container — การเปลี่ยนแปลงมีผลทันที</span>
            </div>

            <div class="form-group">
              <label class="form-label">Enable AD Integration</label>
              <div class="toggle-wrap">
                <label class="toggle">
                  <input type="checkbox" id="ad-enabled" ${s.is_enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span class="toggle-label">Enable Active Directory sync</span>
              </div>
            </div>

            <div class="section-title">Server Connection</div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">LDAP Server Host *</label>
                <input id="ad-host" class="form-input" value="${s.host || ''}" placeholder="192.168.1.10 or dc.example.com">
              </div>
              <div class="form-group">
                <label class="form-label">Port</label>
                <input id="ad-port" class="form-input" type="number" value="${s.port || 389}" placeholder="389 / 636">
                <div class="form-hint">389 = LDAP, 636 = LDAPS</div>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Use SSL (LDAPS)</label>
                <div class="toggle-wrap">
                  <label class="toggle">
                    <input type="checkbox" id="ad-ssl" ${s.use_ssl ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                  <span class="toggle-label">Secure connection</span>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Use TLS (StartTLS)</label>
                <div class="toggle-wrap">
                  <label class="toggle">
                    <input type="checkbox" id="ad-tls" ${s.use_tls ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                  <span class="toggle-label">Upgrade to TLS</span>
                </div>
              </div>
            </div>

            <div class="section-title">Bind Credentials</div>

            <div class="form-group">
              <label class="form-label">Bind DN *</label>
              <input id="ad-binddn" class="form-input" value="${s.bind_dn || ''}" placeholder="CN=ldap-reader,OU=Service Accounts,DC=example,DC=com">
            </div>
            <div class="form-group">
              <label class="form-label">Bind Password</label>
              <input id="ad-bindpw" type="password" class="form-input" placeholder="${s.bind_password_set ? '••••••••• (leave blank to keep)' : 'Enter bind password'}">
            </div>

            <div class="section-title">Search Configuration</div>

            <div class="form-group">
              <label class="form-label">Base DN *</label>
              <input id="ad-basedn" class="form-input" value="${s.base_dn || ''}" placeholder="DC=example,DC=com">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">User Filter</label>
                <input id="ad-userfilter" class="form-input" value="${s.user_filter || '(objectClass=person)'}" placeholder="(objectClass=person)">
              </div>
              <div class="form-group">
                <label class="form-label">Group Filter</label>
                <input id="ad-groupfilter" class="form-input" value="${s.group_filter || '(objectClass=group)'}" placeholder="(objectClass=group)">
              </div>
            </div>

            <div class="section-title">Attribute Mapping</div>

            <div class="form-row-3">
              <div class="form-group">
                <label class="form-label">Username Attr</label>
                <input id="ad-userattr" class="form-input" value="${s.user_attr || 'sAMAccountName'}" placeholder="sAMAccountName">
              </div>
              <div class="form-group">
                <label class="form-label">Email Attr</label>
                <input id="ad-emailattr" class="form-input" value="${s.email_attr || 'mail'}" placeholder="mail">
              </div>
              <div class="form-group">
                <label class="form-label">Display Name Attr</label>
                <input id="ad-nameattr" class="form-input" value="${s.display_name_attr || 'displayName'}" placeholder="displayName">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Sync Interval (minutes)</label>
              <input id="ad-syncinterval" class="form-input" type="number" value="${s.sync_interval || 60}" min="5" max="1440">
              <div class="form-hint">Manual sync is always available</div>
            </div>

            <div style="display:flex;gap:10px;margin-top:8px;">
              <button class="btn btn-ghost" onclick="testAdConnection()">🔌 Test Connection</button>
              <button class="btn btn-primary" onclick="saveAdSettings()">💾 Save Settings</button>
            </div>

            ${s.last_sync ? `<div class="text-sm text-muted" style="margin-top:10px;">Last sync: ${fmtDate(s.last_sync)}</div>` : ''}
          </div>
        </div>

        <!-- Right: Sync Control -->
        <div>
          <div class="card">
            <div class="card-header"><span class="card-title">🔄 Manual Sync</span></div>
            <p class="text-secondary text-sm" style="margin-bottom:16px;">
              เลือก AD Groups ที่ต้องการ sync — users ในกลุ่มที่เลือกจะถูก import เข้า RADIUS database
            </p>

            <div class="form-group">
              <label class="form-label">Filter by Groups (optional)</label>
              <div id="ad-group-list" style="min-height:60px;border:1px solid var(--border);border-radius:var(--radius);padding:8px;background:var(--bg-elevated);">
                <span class="text-muted text-sm">Click "Load AD Groups" to see available groups</span>
              </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">
              <button class="btn btn-ghost" onclick="loadAdGroups()">📂 Load AD Groups</button>
              <button class="btn btn-success" onclick="runSync()">🔄 Sync Now</button>
            </div>

            <div id="sync-result" style="margin-top:16px;"></div>
          </div>

          <div class="card" style="margin-top:16px;">
            <div class="card-header"><span class="card-title">ℹ️ AD Integration Info</span></div>
            <div class="text-sm text-secondary" style="line-height:1.8;">
              <p><strong style="color:var(--text-primary);">Sync Mode:</strong> Users/Groups จาก AD จะถูก import เข้า PostgreSQL</p>
              <p style="margin-top:8px;"><strong style="color:var(--text-primary);">Auth Flow:</strong></p>
              <ul style="list-style:none;padding:0;margin-top:4px;">
                <li>• AD users → Auth-Type = LDAP (ผ่าน FreeRADIUS LDAP module)</li>
                <li>• Local users → Cleartext-Password ใน radcheck</li>
              </ul>
              <p style="margin-top:8px;"><strong style="color:var(--text-primary);">Group Mapping:</strong> AD Groups → radusergroup table</p>
            </div>
          </div>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function testAdConnection() {
  const resultEl = document.getElementById('sync-result');
  if (resultEl) resultEl.innerHTML = `<div class="alert alert-info"><span class="alert-icon">🔌</span>Testing connection...</div>`;
  try {
    // Save first, then test
    await saveAdSettings(true);
    const result = await API.post('/ldap/test', {});
    toast('Connection successful! ✅', 'success');
    if (resultEl) resultEl.innerHTML = `<div class="alert alert-success"><span class="alert-icon">✅</span>${result.message}</div>`;
  } catch (err) {
    toast('Connection failed: ' + err.message, 'error');
    if (resultEl) resultEl.innerHTML = `<div class="alert alert-danger"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function saveAdSettings(silent = false) {
  const body = {
    host: document.getElementById('ad-host').value.trim(),
    port: document.getElementById('ad-port').value,
    use_ssl: document.getElementById('ad-ssl').checked,
    use_tls: document.getElementById('ad-tls').checked,
    bind_dn: document.getElementById('ad-binddn').value.trim(),
    base_dn: document.getElementById('ad-basedn').value.trim(),
    user_filter: document.getElementById('ad-userfilter').value.trim(),
    group_filter: document.getElementById('ad-groupfilter').value.trim(),
    user_attr: document.getElementById('ad-userattr').value.trim(),
    email_attr: document.getElementById('ad-emailattr').value.trim(),
    display_name_attr: document.getElementById('ad-nameattr').value.trim(),
    is_enabled: document.getElementById('ad-enabled').checked,
    sync_interval: document.getElementById('ad-syncinterval').value,
  };
  const pw = document.getElementById('ad-bindpw').value;
  if (pw) body.bind_password = pw;

  // Persist selected groups if the checklist is currently rendered
  const checksExist = document.querySelectorAll('input[name="ad-group-check"]').length > 0;
  if (checksExist) {
    body.selected_groups = Array.from(document.querySelectorAll('input[name="ad-group-check"]:checked'))
      .map(cb => cb.value);
  } else if (window.adSettings && window.adSettings.selected_groups) {
    body.selected_groups = window.adSettings.selected_groups;
  }

  await API.put('/settings/ad', body);
  if (!silent) toast('AD settings saved', 'success');
}

async function loadAdGroups() {
  const el = document.getElementById('ad-group-list');
  el.innerHTML = `<div class="loading-spinner" style="padding:10px;">${renderLoading()}</div>`;
  try {
    await saveAdSettings(true);
    const groups = await API.get('/ldap/groups');
    if (!groups.length) {
      el.innerHTML = `<span class="text-muted text-sm">No groups found in AD</span>`;
      return;
    }
    
    // Fetch latest saved settings (including selected groups) to check the checkboxes
    const s = await API.get('/settings/ad');
    window.adSettings = s;
    const saved = s.selected_groups || [];

    el.innerHTML = groups.map(g => {
      const isChecked = saved.includes(g.dn) || saved.includes(g.name);
      return `
      <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;border-radius:var(--radius-sm);hover:background:var(--bg-hover);">
        <input type="checkbox" value="${g.dn}" name="ad-group-check" ${isChecked ? 'checked' : ''} style="accent-color:var(--accent-primary);">
        <span class="text-sm"><strong>${g.name}</strong> <span class="text-muted">(${g.member_count} members)</span></span>
      </label>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<span class="text-danger text-sm">❌ ${err.message}</span>`;
  }
}

async function runSync() {
  const syncBtn = event.target;
  syncBtn.disabled = true;
  syncBtn.textContent = '⏳ Syncing...';
  const resultEl = document.getElementById('sync-result');
  resultEl.innerHTML = `<div class="alert alert-info"><span class="alert-icon">🔄</span>Syncing from AD...</div>`;

  const selected = Array.from(document.querySelectorAll('input[name="ad-group-check"]:checked'))
    .map(cb => cb.value);

  try {
    await saveAdSettings(true);
    const result = await API.post('/ldap/sync', {
      sync_users: true,
      sync_groups: true,
      selected_groups: selected
    });
    
    // Update local settings object with newly saved selected groups
    if (window.adSettings) {
      window.adSettings.selected_groups = selected;
    }

    resultEl.innerHTML = `
      <div class="alert alert-success">
        <span class="alert-icon">✅</span>
        <div>
          <strong>Sync Complete</strong><br>
          <span class="text-sm">Groups: ${result.groups_synced} | Users: ${result.users_synced}</span>
          ${result.errors.length ? `<br><span class="text-warning text-sm">Errors: ${result.errors.length} (check console)</span>` : ''}
        </div>
      </div>`;
    toast(`Sync complete — ${result.users_synced} users, ${result.groups_synced} groups`, 'success');
  } catch (err) {
    resultEl.innerHTML = `<div class="alert alert-danger"><span class="alert-icon">❌</span>${err.message}</div>`;
    toast('Sync failed: ' + err.message, 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = '🔄 Sync Now';
  }
}

/* ---- General Settings Tab ---- */
async function renderGeneralTab() {
  const el = document.getElementById('settings-tab-content');
  el.innerHTML = renderLoading();
  try {
    const s = await API.get('/settings/app');
    el.innerHTML = `
      <div class="card" style="max-width:600px;">
        <div class="card-header"><span class="card-title">⚙️ General Settings</span></div>
        <div class="form-group">
          <label class="form-label">Site Name</label>
          <input id="gs-sitename" class="form-input" value="${s.site_name || 'FreeRADIUS Manager'}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Session Timeout (seconds)</label>
            <input id="gs-timeout" class="form-input" type="number" value="${s.session_timeout || 28800}">
            <div class="form-hint">Default RADIUS session timeout (e.g. 28800 = 8h)</div>
          </div>
          <div class="form-group">
            <label class="form-label">Device per User (Max Sessions)</label>
            <input id="gs-maxsess" class="form-input" type="number" value="${s.max_sessions_per_user || 1}" min="1">
            <div class="form-hint">Set to 1 to restrict users to a single concurrent device.</div>
          </div>
        </div>
        <button class="btn btn-primary" onclick="saveGeneralSettings()">💾 Save Settings</button>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function renderGuestTab() {
  const el = document.getElementById('settings-tab-content');
  el.innerHTML = renderLoading();
  try {
    const s = await API.get('/settings/guest');
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">
        <!-- Left Column: UniFi Controller -->
        <div class="card">
          <div class="card-header"><span class="card-title">📡 UniFi Controller API Settings</span></div>
          <div class="form-group">
            <label class="form-label">UniFi Controller URL *</label>
            <input id="gp-unifi-url" class="form-input" value="${s.unifi_url || ''}" placeholder="https://192.168.22.10:8443">
            <div class="form-hint">The base IP/URL of your UniFi controller including port.</div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Admin Username *</label>
              <input id="gp-unifi-user" class="form-input" value="${s.unifi_username || ''}" placeholder="Admin user">
            </div>
            <div class="form-group">
              <label class="form-label">Admin Password *</label>
              <input id="gp-unifi-pass" type="password" class="form-input" value="${s.unifi_password || ''}" placeholder="••••••••">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">UniFi Site Name</label>
              <input id="gp-unifi-site" class="form-input" value="${s.unifi_site || 'default'}" placeholder="default">
              <div class="form-hint">Default is usually 'default'</div>
            </div>
            <div class="form-group">
              <label class="form-label">Session Duration (minutes)</label>
              <input id="gp-duration" type="number" class="form-input" value="${s.session_duration_mins || 120}" placeholder="120">
              <div class="form-hint">Time allowed before re-authentication is required.</div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">SSL Verification</label>
            <div class="toggle-wrap">
              <label class="toggle">
                <input type="checkbox" id="gp-unifi-ssl" ${s.unifi_verify_ssl ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <span class="toggle-label">Verify UniFi Controller SSL (uncheck for self-signed certificates)</span>
            </div>
          </div>
        </div>

        <!-- Right Column: Social OAuth2 Configurations -->
        <div style="display:flex;flex-direction:column;gap:20px;">
          <!-- Google OAuth2 -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Google Authentication</span>
              <div class="toggle-wrap" style="margin-left:auto;margin-top:0;">
                <label class="toggle">
                  <input type="checkbox" id="gp-google-enabled" ${s.google_enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Google Client ID</label>
              <input id="gp-google-id" class="form-input" value="${s.google_client_id || ''}" placeholder="Google Client ID">
            </div>
            <div class="form-group">
              <label class="form-label">Google Client Secret</label>
              <input id="gp-google-secret" type="password" class="form-input" value="${s.google_client_secret || ''}" placeholder="${s.google_client_secret ? '••••••••' : 'Secret Key'}">
            </div>
          </div>

          <!-- LINE Login OAuth2 -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">LINE Login Authentication</span>
              <div class="toggle-wrap" style="margin-left:auto;margin-top:0;">
                <label class="toggle">
                  <input type="checkbox" id="gp-line-enabled" ${s.line_enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">LINE Channel ID</label>
              <input id="gp-line-id" class="form-input" value="${s.line_client_id || ''}" placeholder="LINE Channel ID">
            </div>
            <div class="form-group">
              <label class="form-label">LINE Channel Secret</label>
              <input id="gp-line-secret" type="password" class="form-input" value="${s.line_client_secret || ''}" placeholder="${s.line_client_secret ? '••••••••' : 'Secret Key'}">
            </div>
          </div>

          <!-- GitHub OAuth2 -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">GitHub Authentication</span>
              <div class="toggle-wrap" style="margin-left:auto;margin-top:0;">
                <label class="toggle">
                  <input type="checkbox" id="gp-github-enabled" ${s.github_enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">GitHub Client ID</label>
              <input id="gp-github-id" class="form-input" value="${s.github_client_id || ''}" placeholder="GitHub Client ID">
            </div>
            <div class="form-group">
              <label class="form-label">GitHub Client Secret</label>
              <input id="gp-github-secret" type="password" class="form-input" value="${s.github_client_secret || ''}" placeholder="${s.github_client_secret ? '••••••••' : 'Secret Key'}">
            </div>
          </div>
        </div>
      </div>
      
      <div style="margin-top:20px;text-align:right;">
        <button class="btn btn-primary" onclick="saveGuestSettings()" style="padding:10px 24px;">💾 Save Guest Portal Settings</button>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function saveGuestSettings() {
  try {
    await API.post('/settings/guest', {
      unifi_url: document.getElementById('gp-unifi-url').value.trim(),
      unifi_username: document.getElementById('gp-unifi-user').value.trim(),
      unifi_password: document.getElementById('gp-unifi-pass').value,
      unifi_site: document.getElementById('gp-unifi-site').value.trim(),
      unifi_verify_ssl: document.getElementById('gp-unifi-ssl').checked,
      session_duration_mins: document.getElementById('gp-duration').value,
      google_client_id: document.getElementById('gp-google-id').value.trim(),
      google_client_secret: document.getElementById('gp-google-secret').value,
      google_enabled: document.getElementById('gp-google-enabled').checked,
      github_client_id: document.getElementById('gp-github-id').value.trim(),
      github_client_secret: document.getElementById('gp-github-secret').value,
      github_enabled: document.getElementById('gp-github-enabled').checked,
      line_client_id: document.getElementById('gp-line-id').value.trim(),
      line_client_secret: document.getElementById('gp-line-secret').value,
      line_enabled: document.getElementById('gp-line-enabled').checked
    });
    toast('Guest Portal settings saved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---- Admin Users Tab ---- */
async function renderAdminsTab() {
  const el = document.getElementById('settings-tab-content');
  el.innerHTML = renderLoading();
  try {
    const users = await API.get('/settings/admin-users');
    el.innerHTML = `
      <div class="card" style="max-width:850px;">
        <div class="card-header">
          <span class="card-title">👤 Admin Users</span>
          <button class="btn btn-primary btn-sm" onclick="openCreateAdminModal()">＋ Add Admin</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Username</th><th>Full Name</th><th>Email</th><th>Auth Source</th><th>Role</th>
              <th>Last Login</th><th style="text-align:right;">Actions</th>
            </tr></thead>
            <tbody>${users.map(u => `
              <tr>
                <td><code>${u.username}</code></td>
                <td>${u.full_name || '<span class="text-muted">—</span>'}</td>
                <td>${u.email || '<span class="text-muted">—</span>'}</td>
                <td><span class="badge ${u.source === 'ad' ? 'badge-blue' : 'badge-gray'}">${u.source === 'ad' ? 'Active Directory' : 'Local'}</span></td>
                <td><span class="badge ${u.role === 'superadmin' ? 'badge-purple' : 'badge-blue'}">${u.role}</span></td>
                <td class="text-muted text-sm">${fmtDate(u.last_login)}</td>
                <td style="text-align:right;">
                  ${u.id !== State.user.id
                    ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="deleteAdminUser(${u.id},'${u.username}')">🗑️</button>`
                    : '<span class="badge badge-gray">You</span>'}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert alert-danger"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

window.toggleAdminSource = function(val) {
  const passGroup = document.getElementById('ac-pass-group');
  const passInput = document.getElementById('ac-pass');
  if (val === 'ad') {
    passGroup.style.display = 'none';
    passInput.value = '';
  } else {
    passGroup.style.display = 'block';
  }
};

window.onAdminPromoteSelect = function(username) {
  const select = document.getElementById('ac-promote-user');
  if (!select) return;
  const opt = select.options[select.selectedIndex];
  if (!username) {
    document.getElementById('ac-user').value = '';
    document.getElementById('ac-name').value = '';
    document.getElementById('ac-email').value = '';
    document.getElementById('ac-source').value = 'local';
    window.toggleAdminSource('local');
    return;
  }
  
  const name = opt.getAttribute('data-name') || '';
  const email = opt.getAttribute('data-email') || '';
  const source = opt.getAttribute('data-source') || 'local';
  
  document.getElementById('ac-user').value = username;
  document.getElementById('ac-name').value = name;
  document.getElementById('ac-email').value = email;
  document.getElementById('ac-source').value = source;
  window.toggleAdminSource(source);
};

async function openCreateAdminModal() {
  let eligibleUsers = [];
  try {
    eligibleUsers = await API.get('/settings/eligible-admins');
  } catch (err) {
    console.error('Failed to load eligible users', err);
  }

  createModal('admin-create-modal', '＋ Add Admin User',
    `<div class="form-group" style="margin-bottom:15px;border-bottom:1px solid var(--border);padding-bottom:15px;">
      <label class="form-label">Promote Existing User (Auto-fill)</label>
      <select id="ac-promote-user" class="form-select" onchange="onAdminPromoteSelect(this.value)">
        <option value="">-- Select a synced AD or Local user --</option>
        ${eligibleUsers.map(u => `<option value="${u.username}" data-name="${u.full_name || ''}" data-email="${u.email || ''}" data-source="${u.source}">${u.username} (${u.source.toUpperCase()})</option>`).join('')}
      </select>
    </div>
    <div class="form-group" style="margin-bottom:15px;">
      <label class="form-label">Authentication Source</label>
      <select id="ac-source" class="form-select" onchange="toggleAdminSource(this.value)">
        <option value="local">Local Account</option>
        <option value="ad">Active Directory (AD)</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Username *</label>
        <input id="ac-user" class="form-input" placeholder="admin username">
      </div>
      <div class="form-group" id="ac-pass-group">
        <label class="form-label">Password *</label>
        <input id="ac-pass" type="password" class="form-input" placeholder="Strong password">
        <div class="form-hint" style="margin-top:4px;">Leave blank to use user's existing RADIUS password.</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input id="ac-name" class="form-input" placeholder="Full name">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input id="ac-email" class="form-input" placeholder="email@example.com">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Role</label>
      <select id="ac-role" class="form-select">
        <option value="admin">admin</option>
        <option value="superadmin">superadmin</option>
      </select>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal('admin-create-modal')">Cancel</button>
     <button class="btn btn-primary" onclick="submitCreateAdmin()">Create</button>`
  );
  openModal('admin-create-modal');
}

async function submitCreateAdmin() {
  const username = document.getElementById('ac-user').value.trim();
  const source = document.getElementById('ac-source').value;
  const password = document.getElementById('ac-pass').value;
  if (!username) return toast('Username is required', 'error');
  if (source === 'local' && !password && !document.getElementById('ac-promote-user').value) {
    return toast('Password is required for local accounts', 'error');
  }
  try {
    await API.post('/settings/admin-users', {
      username, source,
      password: source === 'local' ? password : '',
      full_name: document.getElementById('ac-name').value.trim(),
      email: document.getElementById('ac-email').value.trim(),
      role: document.getElementById('ac-role').value,
    });
    toast('Admin user created', 'success');
    closeModal('admin-create-modal');
    renderAdminsTab();
  } catch (err) { toast(err.message, 'error'); }
}

function deleteAdminUser(id, username) {
  confirmDialog(`Delete admin user "<strong>${username}</strong>"?`, async () => {
    try {
      await API.delete(`/settings/admin-users/${id}`);
      toast('Admin user deleted', 'success');
      renderAdminsTab();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---- Change Password Tab ---- */
function renderPasswordTab() {
  const el = document.getElementById('settings-tab-content');
  el.innerHTML = `
    <div class="card" style="max-width:460px;">
      <div class="card-header"><span class="card-title">🔑 Change Password</span></div>
      <div class="form-group">
        <label class="form-label">Current Password</label>
        <input id="cp-current" type="password" class="form-input" placeholder="Current password">
      </div>
      <div class="form-group">
        <label class="form-label">New Password</label>
        <input id="cp-new" type="password" class="form-input" placeholder="New password">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm New Password</label>
        <input id="cp-confirm" type="password" class="form-input" placeholder="Confirm new password">
      </div>
      <button class="btn btn-primary" onclick="submitChangePassword()">🔑 Change Password</button>
    </div>`;
}

async function submitChangePassword() {
  const current_password = document.getElementById('cp-current').value;
  const new_password = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  if (!current_password || !new_password) return toast('All fields required', 'error');
  if (new_password !== confirm) return toast('New passwords do not match', 'error');
  try {
    await API.post('/auth/change-password', { current_password, new_password });
    toast('Password changed successfully', 'success');
    document.getElementById('cp-current').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
  } catch (err) { toast(err.message, 'error'); }
}

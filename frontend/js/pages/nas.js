/* =============================================================
   nas.js — NAS Clients management page
   ============================================================= */
registerPage('nas', {
  title: 'NAS Clients',
  subtitle: 'Network Access Server clients',
  render: async () => `
    <div id="nas-root">
      <div class="toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="nas-search" placeholder="Search IP, name, description..." oninput="nasOnSearch(this.value)">
        </div>
        <button class="btn btn-primary" onclick="openCreateNasModal()">＋ Add NAS Client</button>
      </div>
      <div class="card" style="padding:0;">
        <div id="nas-table-wrap">${renderLoading()}</div>
      </div>
    </div>`,
  onload: () => loadNas()
});

let nasSearch = '', nasSearchTimer;
function nasOnSearch(val) {
  nasSearch = val;
  clearTimeout(nasSearchTimer);
  nasSearchTimer = setTimeout(loadNas, 350);
}

async function loadNas() {
  const wrap = document.getElementById('nas-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderLoading();
  try {
    const clients = await API.get(`/nas?search=${encodeURIComponent(nasSearch)}`);
    if (!clients.length) {
      wrap.innerHTML = renderEmpty('🌐', 'No NAS clients', 'Add RADIUS client devices like routers, switches, APs',
        `<button class="btn btn-primary" onclick="openCreateNasModal()">＋ Add NAS Client</button>`);
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>IP / Hostname</th><th>Short Name</th><th>Type / Vendor</th>
          <th>Description</th><th>Secret</th><th>Added</th>
          <th style="text-align:right;">Actions</th>
        </tr></thead>
        <tbody>${clients.map(c => {
          let badgeClass = 'badge-gray';
          if (c.type === 'cisco') badgeClass = 'badge-blue';
          else if (c.type === 'aruba') badgeClass = 'badge-purple';
          else if (c.type === 'ubiquiti') badgeClass = 'badge-yellow';
          else if (c.type === 'mikrotik') badgeClass = 'badge-green';

          return `
          <tr>
            <td><code>${c.nasname}</code></td>
            <td>${c.shortname || '<span class="text-muted">—</span>'}</td>
            <td><span class="badge ${badgeClass}">${c.type.toUpperCase()}</span></td>
            <td>${c.description || '<span class="text-muted">—</span>'}</td>
            <td><code class="text-muted">${c.secret}</code></td>
            <td class="text-muted text-sm">${fmtDate(c.created_at)}</td>
            <td style="text-align:right;">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditNasModal(${c.id})" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="deleteNas(${c.id},'${c.nasname}')" title="Delete">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger" style="margin:16px;"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

function openCreateNasModal() {
  createModal('nas-modal', '＋ Add NAS Client',
    `<div class="form-row">
      <div class="form-group">
        <label class="form-label">IP / Hostname *</label>
        <input id="nm-ip" class="form-input" placeholder="192.168.1.1 or nas.example.com" oninput="updateNasHelper()">
      </div>
      <div class="form-group">
        <label class="form-label">Short Name</label>
        <input id="nm-name" class="form-input" placeholder="e.g. office-ap">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Shared Secret *</label>
        <input id="nm-secret" class="form-input" placeholder="Shared secret key" oninput="updateNasHelper()">
      </div>
      <div class="form-group">
        <label class="form-label">Type / Vendor</label>
        <select id="nm-type" class="form-select" onchange="updateNasHelper()">
          <option value="other">Generic / Other</option>
          <option value="cisco">Cisco Systems</option>
          <option value="aruba">Aruba Networks</option>
          <option value="ubiquiti">Ubiquiti UniFi</option>
          <option value="mikrotik">MikroTik RouterOS</option>
          <option value="juniper">Juniper Networks</option>
          <option value="ruckus">Ruckus Wireless</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input id="nm-desc" class="form-input" placeholder="Location or device description">
    </div>
    <div id="nas-helper-panel" class="hidden" style="margin-top:16px;padding:12px;background:var(--bg-elevated);border:1px dashed var(--border);border-radius:var(--radius);">
      <div class="section-title" style="margin-bottom:6px;">🛠️ Device Configuration Snippet</div>
      <pre id="nas-helper-code" class="mono" style="font-size:11px;overflow-x:auto;padding:8px;background:var(--bg-base);white-space:pre-wrap;"></pre>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal('nas-modal')">Cancel</button>
     <button class="btn btn-primary" onclick="submitCreateNas()">Add Client</button>`,
    true
  );
  openModal('nas-modal');
  updateNasHelper();
}

function updateNasHelper() {
  const ip = document.getElementById('nm-ip').value.trim() || 'RADIUS_IP';
  const secret = document.getElementById('nm-secret').value.trim() || 'SHARED_SECRET';
  const type = document.getElementById('nm-type').value;
  const panel = document.getElementById('nas-helper-panel');
  const code = document.getElementById('nas-helper-code');

  if (type === 'other') {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  let configStr = '';

  if (type === 'cisco') {
    configStr = `! Cisco IOS Switch/Router RADIUS Configuration
aaa new-model
aaa authentication login default group radius local
aaa authorization exec default group radius local
aaa authorization network default group radius

radius server RADIUS_SERVER
 address ipv4 ${ip} auth-port 1812 acct-port 1813
 key ${secret}
!
ip radius source-interface GigabitEthernet0/1`;
  } else if (type === 'aruba') {
    configStr = `# Aruba OS Controller / AP RADIUS Configuration
wlan auth-server radius-srv
  ip-addr ${ip}
  key ${secret}
!
wlan server-group radius-grp
  auth-server radius-srv
!
wlan ssid-profile staff-ssid
  essid "Enterprise Wi-Fi"
  opmode wpa2-aes
  a-server-group radius-grp`;
  } else if (type === 'ubiquiti') {
    configStr = `# Ubiquiti UniFi RADIUS Profile Setup (GUI)
1. Go to settings > Profiles > RADIUS Profiles
2. Create new RADIUS Profile:
   - Name: FreeRADIUS Server
   - Shared Secret: ${secret}
   - Auth Server: [RADIUS Server IP] (Port: 1812)
   - Acct Server: [RADIUS Server IP] (Port: 1813)
3. Under Wireless Networks, select WPA EAP Security and choose this RADIUS Profile.`;
  } else if (type === 'mikrotik') {
    configStr = `# MikroTik RouterOS CLI Configuration
/radius
add address=${ip} secret="${secret}" service=login,wireless,ppp,dhcp
/radius incoming
set accept=yes port=3799`;
  } else {
    configStr = `# Generic Device RADIUS Config
Primary Server: [FreeRADIUS Server IP]
Shared Secret: ${secret}
Authentication Port: 1812
Accounting Port: 1813`;
  }

  code.textContent = configStr;
}

async function submitCreateNas() {
  const nasname = document.getElementById('nm-ip').value.trim();
  const secret = document.getElementById('nm-secret').value.trim();
  if (!nasname || !secret) return toast('IP and secret are required', 'error');
  try {
    await API.post('/nas', {
      nasname, secret,
      shortname: document.getElementById('nm-name').value.trim(),
      type: document.getElementById('nm-type').value,
      description: document.getElementById('nm-desc').value.trim(),
    });
    toast('NAS client added', 'success');
    closeModal('nas-modal');
    loadNas();
  } catch (err) { toast(err.message, 'error'); }
}

async function openEditNasModal(id) {
  try {
    const c = await API.get(`/nas/${id}`);
    createModal('nas-edit-modal', `✏️ Edit NAS: ${c.nasname}`,
      `<div class="form-row">
        <div class="form-group">
          <label class="form-label">IP / Hostname *</label>
          <input id="ne-ip" class="form-input" value="${c.nasname}">
        </div>
        <div class="form-group">
          <label class="form-label">Short Name</label>
          <input id="ne-name" class="form-input" value="${c.shortname || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">New Secret <span class="text-muted">(leave blank to keep)</span></label>
          <input id="ne-secret" class="form-input" placeholder="New shared secret">
        </div>
        <div class="form-group">
          <label class="form-label">Type</label>
          <select id="ne-type" class="form-select">
            ${['other','cisco','aruba','ubiquiti','mikrotik','juniper','ruckus'].map(t =>
              `<option value="${t}" ${c.type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input id="ne-desc" class="form-input" value="${c.description || ''}">
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal('nas-edit-modal')">Cancel</button>
       <button class="btn btn-primary" onclick="submitEditNas(${id})">Save</button>`
    );
    openModal('nas-edit-modal');
  } catch (err) { toast(err.message, 'error'); }
}

async function submitEditNas(id) {
  const body = {
    nasname: document.getElementById('ne-ip').value.trim(),
    shortname: document.getElementById('ne-name').value.trim(),
    type: document.getElementById('ne-type').value,
    description: document.getElementById('ne-desc').value.trim(),
  };
  const secret = document.getElementById('ne-secret').value.trim();
  if (secret) body.secret = secret;
  try {
    await API.put(`/nas/${id}`, body);
    toast('NAS client updated', 'success');
    closeModal('nas-edit-modal');
    loadNas();
  } catch (err) { toast(err.message, 'error'); }
}

function deleteNas(id, name) {
  confirmDialog(`Delete NAS client "<strong>${name}</strong>"?`, async () => {
    try {
      await API.delete(`/nas/${id}`);
      toast('NAS client deleted', 'success');
      loadNas();
    } catch (err) { toast(err.message, 'error'); }
  });
}

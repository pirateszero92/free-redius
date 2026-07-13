/* =============================================================
   devices.js — IoT / Printer Device Registry (MAB)
   ============================================================= */
let devicesPage = 1;
let devicesSearch = '';

registerPage('devices', {
  title: 'Device Registry',
  subtitle: 'Register and manage IoT/Printers for MAC Authentication Bypass (MAB)',
  render: async () => `
    <div id="devices-root">
      <div class="toolbar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="dev-search-input" placeholder="Search name, MAC, desc..." oninput="devicesOnSearch(this.value)">
        </div>
        <button class="btn btn-primary btn-sm" onclick="openCreateDeviceModal()" style="margin-left:auto;">＋ Register Device</button>
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div id="devices-table-wrap">${renderLoading()}</div>
        <div id="devices-pager" style="padding:12px 20px;border-top:1px solid var(--border);"></div>
      </div>
    </div>`,
  onload: () => {
    loadDevices(1);
    document.getElementById('topbar-actions').innerHTML =
      `<button class="btn btn-ghost btn-sm" onclick="loadDevices(devicesPage)">↻ Refresh</button>`;
  }
});

let devicesSearchTimer;
function devicesOnSearch(val) {
  devicesSearch = val;
  clearTimeout(devicesSearchTimer);
  devicesSearchTimer = setTimeout(() => loadDevices(1), 350);
}

async function loadDevices(page) {
  devicesPage = page;
  const wrap = document.getElementById('devices-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderLoading();

  try {
    const data = await API.get(`/devices?page=${page}&limit=15&search=${encodeURIComponent(devicesSearch)}`);
    if (!data.data.length) {
      wrap.innerHTML = renderEmpty('🏷️', 'No devices registered', devicesSearch ? 'Try a different search term' : 'Register your first IoT/Printer device for MAB bypass',
        `<button class="btn btn-primary" onclick="openCreateDeviceModal()">＋ Register Device</button>`);
      document.getElementById('devices-pager').innerHTML = '';
      return;
    }

    wrap.innerHTML = `
      <div style="overflow-x:auto;">
      <table>
        <thead><tr>
          <th>Device Name</th><th>MAC Address</th><th>Description</th><th>VLAN / ACL Profile</th><th>Registered</th><th style="text-align:right;">Actions</th>
        </tr></thead>
        <tbody>${data.data.map(d => `
          <tr>
            <td><strong>${d.name}</strong></td>
            <td><code>${d.mac_address}</code></td>
            <td class="text-sm text-muted">${d.description || '<span class="text-muted">—</span>'}</td>
            <td>${d.acl_profile_name ? `<span class="badge badge-blue">🛡️ ${d.acl_profile_name}</span>` : '<span class="text-muted">—</span>'}</td>
            <td class="text-sm text-muted">${fmtDate(d.created_at)}</td>
            <td style="text-align:right;">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditDeviceModal(${d.id})" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="deleteDevice(${d.id},'${d.mac_address}')" title="Delete">🗑️</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

    document.getElementById('devices-pager').innerHTML =
      renderPagination(page, data.total, data.pages, 'loadDevices');
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger" style="margin:16px;"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function openCreateDeviceModal() {
  try {
    const acls = await API.get('/acl');
    createModal('device-create-modal', '＋ Register New Device (MAB)',
      `<div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">MAC Address *</label>
        <input id="dc-mac" class="form-input" placeholder="e.g. aa:bb:cc:dd:ee:ff or aabbccddeeff" required>
        <div class="form-hint" style="margin-top:4px;">Supported formats: raw hex, colons, or hyphens. Will be normalized automatically.</div>
      </div>
      <div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">Device Name *</label>
        <input id="dc-name" class="form-input" placeholder="e.g. Finance Printer, Guard Camera 1" required>
      </div>
      <div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">Description</label>
        <input id="dc-desc" class="form-input" placeholder="Location, owner, or asset tags">
      </div>
      <div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">VLAN / ACL Profile</label>
        <select id="dc-acl" class="form-select">
          <option value="">No Policy / Default VLAN</option>
          ${acls.map(a => `<option value="${a.id}">🛡️ ${a.name} (${a.vendor.toUpperCase()})</option>`).join('')}
        </select>
        <div class="form-hint" style="margin-top:4px;">Assigns the dynamic VLAN when this device connects.</div>
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal('device-create-modal')">Cancel</button>
       <button class="btn btn-primary" onclick="submitCreateDevice()">Register</button>`
    );
    openModal('device-create-modal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitCreateDevice() {
  const mac_address = document.getElementById('dc-mac').value.trim();
  const name = document.getElementById('dc-name').value.trim();
  const description = document.getElementById('dc-desc').value.trim();
  const acl_profile_id = document.getElementById('dc-acl').value || null;

  if (!mac_address || !name) {
    return toast('MAC address and name are required', 'error');
  }

  try {
    await API.post('/devices', { mac_address, name, description, acl_profile_id });
    toast('Device registered successfully', 'success');
    closeModal('device-create-modal');
    loadDevices(devicesPage);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openEditDeviceModal(id) {
  try {
    const devices = await API.get('/devices'); // get current page to find device
    const device = devices.data.find(d => d.id === id);
    if (!device) return toast('Device not found', 'error');

    const acls = await API.get('/acl');

    createModal('device-edit-modal', `✏️ Edit Device`,
      `<div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">MAC Address *</label>
        <input id="de-mac" class="form-input" value="${device.mac_address}" placeholder="e.g. aa:bb:cc:dd:ee:ff">
        <div class="form-hint" style="margin-top:4px;">WARNING: Changing MAC address will reconfigure RADIUS authentication.</div>
      </div>
      <div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">Device Name *</label>
        <input id="de-name" class="form-input" value="${device.name}" placeholder="e.g. Finance Printer">
      </div>
      <div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">Description</label>
        <input id="de-desc" class="form-input" value="${device.description || ''}" placeholder="Description">
      </div>
      <div class="form-group" style="margin-bottom:15px;">
        <label class="form-label">VLAN / ACL Profile</label>
        <select id="de-acl" class="form-select">
          <option value="">No Policy / Default VLAN</option>
          ${acls.map(a => `<option value="${a.id}" ${device.acl_profile_id == a.id ? 'selected' : ''}>🛡️ ${a.name} (${a.vendor.toUpperCase()})</option>`).join('')}
        </select>
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal('device-edit-modal')">Cancel</button>
       <button class="btn btn-primary" onclick="submitEditDevice(${id})">Save Changes</button>`
    );
    openModal('device-edit-modal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitEditDevice(id) {
  const mac_address = document.getElementById('de-mac').value.trim();
  const name = document.getElementById('de-name').value.trim();
  const description = document.getElementById('de-desc').value.trim();
  const acl_profile_id = document.getElementById('de-acl').value || null;

  if (!mac_address || !name) {
    return toast('MAC address and name are required', 'error');
  }

  try {
    await API.put(`/devices/${id}`, { mac_address, name, description, acl_profile_id });
    toast('Device updated successfully', 'success');
    closeModal('device-edit-modal');
    loadDevices(devicesPage);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deleteDevice(id, mac) {
  confirmDialog(`Are you sure you want to delete device <strong>${mac}</strong>? This will remove its MAC authentication bypass from RADIUS.`, async () => {
    try {
      await API.delete(`/devices/${id}`);
      toast(`Device ${mac} deleted`, 'success');
      loadDevices(devicesPage);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

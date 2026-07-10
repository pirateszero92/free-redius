/* =============================================================
   acl.js — ACL Profiles management page
   ============================================================= */
registerPage('acl', {
  title: 'ACL Profiles',
  subtitle: 'Access Control policies mapping to RADIUS',
  render: async () => `
    <div id="acl-root">
      <div class="toolbar">
        <button class="btn btn-primary" onclick="openCreateAclModal()">＋ Add ACL Profile</button>
      </div>
      <div class="card" style="padding:0;">
        <div id="acl-table-wrap">${renderLoading()}</div>
      </div>
    </div>`,
  onload: () => loadAclProfiles()
});

async function loadAclProfiles() {
  const wrap = document.getElementById('acl-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderLoading();
  try {
    const list = await API.get('/acl');
    if (!list.length) {
      wrap.innerHTML = renderEmpty('🛡️', 'No ACL Profiles', 'Create reusable access control policies for users and groups',
        `<button class="btn btn-primary" onclick="openCreateAclModal()">＋ Add ACL Profile</button>`);
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>Profile Name</th><th>Description</th><th>Device Vendor</th>
          <th>Policy Type</th><th>Mapped Value</th><th>Created</th>
          <th style="text-align:right;">Actions</th>
        </tr></thead>
        <tbody>${list.map(p => {
          let vendorBadge = 'badge-gray';
          if (p.vendor === 'cisco') vendorBadge = 'badge-blue';
          else if (p.vendor === 'aruba') vendorBadge = 'badge-purple';
          else if (p.vendor === 'ubiquiti') vendorBadge = 'badge-yellow';

          let typeLabel = p.acl_type.toUpperCase();
          if (p.acl_type === 'filter_id') typeLabel = 'Filter-Id (ACL Name)';

          return `
          <tr>
            <td><strong>${p.name}</strong></td>
            <td>${p.description || '<span class="text-muted">—</span>'}</td>
            <td><span class="badge ${vendorBadge}">${p.vendor.toUpperCase()}</span></td>
            <td><span class="badge badge-blue">${typeLabel}</span></td>
            <td><code>${p.value}</code></td>
            <td class="text-muted text-sm">${fmtDate(p.created_at)}</td>
            <td style="text-align:right;">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditAclModal(${p.id})" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="deleteAclProfile(${p.id},'${p.name}')" title="Delete">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger" style="margin:16px;"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

function openCreateAclModal() {
  createModal('acl-modal', '＋ Add ACL Profile',
    `<div class="form-group">
      <label class="form-label">Profile Name *</label>
      <input id="acm-name" class="form-input" placeholder="e.g. Staff-VLAN10, Cisco-Admin-Level15">
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input id="acm-desc" class="form-input" placeholder="e.g. Assigns staff to VLAN 10">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Network Vendor *</label>
        <select id="acm-vendor" class="form-select" onchange="onAclVendorChange()">
          <option value="standard">Standard / Generic</option>
          <option value="cisco">Cisco Systems</option>
          <option value="aruba">Aruba Networks</option>
          <option value="ubiquiti">Ubiquiti UniFi</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Policy Type *</label>
        <select id="acm-type" class="form-select" onchange="onAclTypeChange()">
          <option value="vlan">VLAN Assignment</option>
          <option value="filter_id">Standard Filter-ID (Firewall ACL)</option>
          <option value="privilege" id="opt-priv" disabled>Cisco Privilege Level</option>
          <option value="role" id="opt-role" disabled>Aruba User Role</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" id="acm-value-label">VLAN ID *</label>
      <input id="acm-value" class="form-input" placeholder="e.g. 10">
      <div class="form-hint" id="acm-value-hint">The VLAN tag number to assign to the network port.</div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal('acl-modal')">Cancel</button>
     <button class="btn btn-primary" onclick="submitCreateAcl()">Create Profile</button>`
  );
  openModal('acl-modal');
  onAclVendorChange(); // Trigger initial view state
}

function onAclVendorChange() {
  const vendor = document.getElementById('acm-vendor').value;
  const optPriv = document.getElementById('opt-priv');
  const optRole = document.getElementById('opt-role');
  const typeSelect = document.getElementById('acm-type');

  // Reset disabled options
  optPriv.disabled = true;
  optRole.disabled = true;

  if (vendor === 'cisco') {
    optPriv.disabled = false;
  } else if (vendor === 'aruba') {
    optRole.disabled = false;
  }

  // If currently selected type becomes disabled, revert to standard 'vlan'
  if (typeSelect.value === 'privilege' && vendor !== 'cisco') typeSelect.value = 'vlan';
  if (typeSelect.value === 'role' && vendor !== 'aruba') typeSelect.value = 'vlan';

  onAclTypeChange();
}

function onAclTypeChange() {
  const type = document.getElementById('acm-type').value;
  const label = document.getElementById('acm-value-label');
  const input = document.getElementById('acm-value');
  const hint = document.getElementById('acm-value-hint');

  if (type === 'vlan') {
    label.textContent = 'VLAN ID (Number) *';
    input.placeholder = 'e.g. 10';
    input.type = 'number';
    hint.textContent = 'Standard VLAN tag number (e.g. 10, 20, 100) returned to NAS device.';
  } else if (type === 'filter_id') {
    label.textContent = 'Filter-Id (ACL Name) *';
    input.placeholder = 'e.g. LAN_ACCESS_ONLY';
    input.type = 'text';
    hint.textContent = 'Policy or ACL rule name configured on your firewall/switch.';
  } else if (type === 'privilege') {
    label.textContent = 'Cisco Privilege Level (1-15) *';
    input.placeholder = '15';
    input.type = 'number';
    hint.textContent = 'Command execution privilege level for telnet/ssh logins (e.g. 15 = admin).';
  } else if (type === 'role') {
    label.textContent = 'Aruba User Role Name *';
    input.placeholder = 'e.g. guest-wifi-role';
    input.type = 'text';
    hint.textContent = 'Aruba controller local user role identifier name.';
  }
}

async function submitCreateAcl() {
  const name = document.getElementById('acm-name').value.trim();
  const description = document.getElementById('acm-desc').value.trim();
  const vendor = document.getElementById('acm-vendor').value;
  const acl_type = document.getElementById('acm-type').value;
  const value = document.getElementById('acm-value').value.trim();

  if (!name || !value) return toast('Name and Value are required', 'error');

  try {
    await API.post('/acl', { name, description, vendor, acl_type, value });
    toast(`ACL Profile "${name}" created`, 'success');
    closeModal('acl-modal');
    loadAclProfiles();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openEditAclModal(id) {
  try {
    const p = await API.get(`/acl/${id}`);
    createModal('acl-edit-modal', `✏️ Edit ACL Profile: ${p.name}`,
      `<div class="form-group">
        <label class="form-label">Profile Name *</label>
        <input id="ace-name" class="form-input" value="${p.name}">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input id="ace-desc" class="form-input" value="${p.description || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Network Vendor *</label>
          <select id="ace-vendor" class="form-select" onchange="onEditAclVendorChange()">
            <option value="standard" ${p.vendor === 'standard' ? 'selected' : ''}>Standard / Generic</option>
            <option value="cisco" ${p.vendor === 'cisco' ? 'selected' : ''}>Cisco Systems</option>
            <option value="aruba" ${p.vendor === 'aruba' ? 'selected' : ''}>Aruba Networks</option>
            <option value="ubiquiti" ${p.vendor === 'ubiquiti' ? 'selected' : ''}>Ubiquiti UniFi</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Policy Type *</label>
          <select id="ace-type" class="form-select" onchange="onEditAclTypeChange()">
            <option value="vlan" ${p.acl_type === 'vlan' ? 'selected' : ''}>VLAN Assignment</option>
            <option value="filter_id" ${p.acl_type === 'filter_id' ? 'selected' : ''}>Standard Filter-ID (Firewall ACL)</option>
            <option value="privilege" id="opt-edit-priv" ${p.acl_type === 'privilege' ? 'selected' : ''} ${p.vendor !== 'cisco' ? 'disabled' : ''}>Cisco Privilege Level</option>
            <option value="role" id="opt-edit-role" ${p.acl_type === 'role' ? 'selected' : ''} ${p.vendor !== 'aruba' ? 'disabled' : ''}>Aruba User Role</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" id="ace-value-label">Value *</label>
        <input id="ace-value" class="form-input" value="${p.value}">
        <div class="form-hint" id="ace-value-hint">Value details.</div>
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal('acl-edit-modal')">Cancel</button>
       <button class="btn btn-primary" onclick="submitEditAcl(${id})">Save Changes</button>`
    );
    openModal('acl-edit-modal');
    onEditAclVendorChange(); // Sync initial values
  } catch (err) {
    toast(err.message, 'error');
  }
}

function onEditAclVendorChange() {
  const vendor = document.getElementById('ace-vendor').value;
  const optPriv = document.getElementById('opt-edit-priv');
  const optRole = document.getElementById('opt-edit-role');
  const typeSelect = document.getElementById('ace-type');

  optPriv.disabled = (vendor !== 'cisco');
  optRole.disabled = (vendor !== 'aruba');

  if (typeSelect.value === 'privilege' && vendor !== 'cisco') typeSelect.value = 'vlan';
  if (typeSelect.value === 'role' && vendor !== 'aruba') typeSelect.value = 'vlan';

  onEditAclTypeChange();
}

function onEditAclTypeChange() {
  const type = document.getElementById('ace-type').value;
  const label = document.getElementById('ace-value-label');
  const input = document.getElementById('ace-value');
  const hint = document.getElementById('ace-value-hint');

  if (type === 'vlan') {
    label.textContent = 'VLAN ID (Number) *';
    input.type = 'number';
    hint.textContent = 'Standard VLAN tag number (e.g. 10, 20, 100) returned to NAS device.';
  } else if (type === 'filter_id') {
    label.textContent = 'Filter-Id (ACL Name) *';
    input.type = 'text';
    hint.textContent = 'Policy or ACL rule name configured on your firewall/switch.';
  } else if (type === 'privilege') {
    label.textContent = 'Cisco Privilege Level (1-15) *';
    input.type = 'number';
    hint.textContent = 'Command execution privilege level for telnet/ssh logins (e.g. 15 = admin).';
  } else if (type === 'role') {
    label.textContent = 'Aruba User Role Name *';
    input.type = 'text';
    hint.textContent = 'Aruba controller local user role identifier name.';
  }
}

async function submitEditAcl(id) {
  const name = document.getElementById('ace-name').value.trim();
  const description = document.getElementById('ace-desc').value.trim();
  const vendor = document.getElementById('ace-vendor').value;
  const acl_type = document.getElementById('ace-type').value;
  const value = document.getElementById('ace-value').value.trim();

  if (!name || !value) return toast('Name and Value are required', 'error');

  try {
    await API.put(`/acl/${id}`, { name, description, vendor, acl_type, value });
    toast(`ACL Profile "${name}" updated`, 'success');
    closeModal('acl-edit-modal');
    loadAclProfiles();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deleteAclProfile(id, name) {
  confirmDialog(`Delete ACL Profile "<strong>${name}</strong>"? All associated RADIUS reply attributes on users and groups will be cleared.`, async () => {
    try {
      await API.delete(`/acl/${id}`);
      toast(`ACL Profile "${name}" deleted`, 'success');
      loadAclProfiles();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

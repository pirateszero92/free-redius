/* =============================================================
   groups.js — Groups management page
   ============================================================= */
let groupsSearch = '';

registerPage('groups', {
  title: 'Groups',
  subtitle: 'RADIUS user groups',
  render: async () => `
    <div id="groups-root">
      <div class="toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="groups-search" placeholder="Search group name..." oninput="groupsOnSearch(this.value)">
        </div>
        <button class="btn btn-primary" onclick="openCreateGroupModal()">＋ Add Group</button>
      </div>
      <div class="card" style="padding:0;">
        <div id="groups-table-wrap">${renderLoading()}</div>
      </div>
    </div>`,
  onload: () => loadGroups()
});

let groupsSearchTimer;
function groupsOnSearch(val) {
  groupsSearch = val;
  clearTimeout(groupsSearchTimer);
  groupsSearchTimer = setTimeout(loadGroups, 350);
}

async function loadAclOptions() {
  try {
    return await API.get('/acl');
  } catch (e) {
    return [];
  }
}

async function loadGroups() {
  const wrap = document.getElementById('groups-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderLoading();
  try {
    const groups = await API.get(`/groups?search=${encodeURIComponent(groupsSearch)}`);
    if (!groups.length) {
      wrap.innerHTML = renderEmpty('👥', 'No groups found', groupsSearch ? 'Try a different search' : 'Create your first RADIUS group',
        `<button class="btn btn-primary" onclick="openCreateGroupModal()">＋ Add Group</button>`);
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>Group Name</th><th>Description</th><th>Members</th><th>ACL Profile</th><th>Source</th><th>Created</th>
          <th style="text-align:right;">Actions</th>
        </tr></thead>
        <tbody>${groups.map(g => `
          <tr>
            <td><code>${g.groupname}</code></td>
            <td>${g.description || '<span class="text-muted">—</span>'}</td>
            <td><span class="badge badge-blue">👤 ${g.member_count}</span></td>
            <td>${g.acl_profile_name ? `<span class="badge badge-green">🛡️ ${g.acl_profile_name}</span>` : '<span class="text-muted">—</span>'}</td>
            <td><span class="badge ${g.source === 'ad' ? 'badge-purple' : 'badge-gray'}">${g.source === 'ad' ? '🏢 AD' : '🔧 Local'}</span></td>
            <td class="text-muted text-sm">${fmtDate(g.created_at)}</td>
            <td style="text-align:right;">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="openGroupMembersModal('${g.groupname}')" title="Members">👥</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditGroupModal('${g.groupname}')" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="deleteGroup('${g.groupname}')" title="Delete">🗑️</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger" style="margin:16px;"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function openCreateGroupModal() {
  const acls = await loadAclOptions();
  createModal('group-create-modal', '＋ Create Group',
    `<div class="form-row">
      <div class="form-group">
        <label class="form-label">Group Name *</label>
        <input id="gc-name" class="form-input" placeholder="e.g. staff, vip, admin">
      </div>
      <div class="form-group">
        <label class="form-label">ACL Profile</label>
        <select id="gc-acl" class="form-select">
          <option value="">No Policy / None</option>
          ${acls.map(a => `<option value="${a.id}">🛡️ ${a.name} (${a.vendor.toUpperCase()})</option>`).join('')}
        </select>
        <div class="form-hint">Applies predefined VLAN/ACL attributes to this group.</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <input id="gc-desc" class="form-input" placeholder="Group description">
    </div>
    <div class="section-title">RADIUS Check Attributes</div>
    <div id="gc-checks">
      <div class="check-attr-row" style="display:flex;gap:8px;margin-bottom:8px;">
        <input class="form-input" style="flex:2;" placeholder="Attribute (e.g. Auth-Type)" data-field="attr">
        <select class="form-select" style="width:70px;" data-field="op">
          <option>:=</option><option>==</option><option>!=</option>
        </select>
        <input class="form-input" style="flex:2;" placeholder="Value" data-field="val">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="this.closest('.check-attr-row').remove()">✕</button>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="addAttrRow('gc-checks')">＋ Add Check Attribute</button>
    <div class="section-title" style="margin-top:16px;">RADIUS Reply Attributes</div>
    <div id="gc-replies">
      <div class="check-attr-row" style="display:flex;gap:8px;margin-bottom:8px;">
        <input class="form-input" style="flex:2;" placeholder="e.g. Session-Timeout" data-field="attr">
        <select class="form-select" style="width:70px;" data-field="op">
          <option>=</option><option>:=</option><option>+=</option>
        </select>
        <input class="form-input" style="flex:2;" placeholder="Value" data-field="val">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="this.closest('.check-attr-row').remove()">✕</button>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="addAttrRow('gc-replies')">＋ Add Reply Attribute</button>`,
    `<button class="btn btn-ghost" onclick="closeModal('group-create-modal')">Cancel</button>
     <button class="btn btn-primary" onclick="submitCreateGroup()">Create Group</button>`,
    true
  );
  openModal('group-create-modal');
}

function addAttrRow(containerId) {
  const el = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'check-attr-row';
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
  row.innerHTML = `
    <input class="form-input" style="flex:2;" placeholder="Attribute" data-field="attr">
    <select class="form-select" style="width:70px;" data-field="op">
      <option>:=</option><option>==</option><option>=</option><option>+=</option>
    </select>
    <input class="form-input" style="flex:2;" placeholder="Value" data-field="val">
    <button class="btn btn-ghost btn-sm btn-icon" onclick="this.closest('.check-attr-row').remove()">✕</button>`;
  el.appendChild(row);
}

function collectAttrRows(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .check-attr-row`))
    .map(row => ({
      attribute: row.querySelector('[data-field=attr]').value.trim(),
      op: row.querySelector('[data-field=op]').value,
      value: row.querySelector('[data-field=val]').value.trim()
    }))
    .filter(r => r.attribute && r.value);
}

async function submitCreateGroup() {
  const groupname = document.getElementById('gc-name').value.trim();
  const acl_profile_id = document.getElementById('gc-acl').value || null;
  if (!groupname) return toast('Group name is required', 'error');
  try {
    await API.post('/groups', {
      groupname,
      description: document.getElementById('gc-desc').value.trim(),
      check_attributes: collectAttrRows('gc-checks'),
      reply_attributes: collectAttrRows('gc-replies'),
      acl_profile_id,
    });
    toast(`Group "${groupname}" created`, 'success');
    closeModal('group-create-modal');
    loadGroups();
  } catch (err) { toast(err.message, 'error'); }
}

async function openEditGroupModal(groupname) {
  try {
    const [g, acls] = await Promise.all([
      API.get(`/groups/${groupname}`),
      loadAclOptions()
    ]);
    createModal('group-edit-modal', `✏️ Edit Group: ${groupname}`,
      `<div class="form-row">
        <div class="form-group">
          <label class="form-label">Description</label>
          <input id="ge-desc" class="form-input" value="${g.description || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">ACL Profile</label>
          <select id="ge-acl" class="form-select">
            <option value="">No Policy / None</option>
            ${acls.map(a => `<option value="${a.id}" ${g.acl_profile_id == a.id ? 'selected' : ''}>🛡️ ${a.name} (${a.vendor.toUpperCase()})</option>`).join('')}
          </select>
          <div class="form-hint">Applies predefined VLAN/ACL attributes to this group.</div>
        </div>
      </div>
      <div class="section-title">Check Attributes</div>
      <div id="ge-checks">
        ${(g.check_attributes || []).map(a => `
        <div class="check-attr-row" style="display:flex;gap:8px;margin-bottom:8px;">
          <input class="form-input" style="flex:2;" data-field="attr" value="${a.attribute}">
          <select class="form-select" style="width:70px;" data-field="op"><option ${a.op===':='?'selected':''}>:=</option><option ${a.op==='=='?'selected':''}>==</option><option ${a.op==='!='?'selected':''}>!=</option></select>
          <input class="form-input" style="flex:2;" data-field="val" value="${a.value}">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="this.closest('.check-attr-row').remove()">✕</button>
        </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="addAttrRow('ge-checks')">＋ Add</button>
      <div class="section-title" style="margin-top:16px;">Reply Attributes</div>
      <div id="ge-replies">
        ${(g.reply_attributes || []).map(a => `
        <div class="check-attr-row" style="display:flex;gap:8px;margin-bottom:8px;">
          <input class="form-input" style="flex:2;" data-field="attr" value="${a.attribute}">
          <select class="form-select" style="width:70px;" data-field="op"><option ${a.op==='='?'selected':''}>= </option><option ${a.op===':='?'selected':''}>:=</option><option ${a.op==='+='?'selected':''}>+=</option></select>
          <input class="form-input" style="flex:2;" data-field="val" value="${a.value}">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="this.closest('.check-attr-row').remove()">✕</button>
        </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="addAttrRow('ge-replies')">＋ Add</button>`,
      `<button class="btn btn-ghost" onclick="closeModal('group-edit-modal')">Cancel</button>
       <button class="btn btn-primary" onclick="submitEditGroup('${groupname}')">Save</button>`,
      true
    );
    openModal('group-edit-modal');
  } catch (err) { toast(err.message, 'error'); }
}

async function submitEditGroup(groupname) {
  const acl_profile_id = document.getElementById('ge-acl').value || null;
  try {
    await API.put(`/groups/${groupname}`, {
      description: document.getElementById('ge-desc').value.trim(),
      check_attributes: collectAttrRows('ge-checks'),
      reply_attributes: collectAttrRows('ge-replies'),
      acl_profile_id,
    });
    toast(`Group "${groupname}" updated`, 'success');
    closeModal('group-edit-modal');
    loadGroups();
  } catch (err) { toast(err.message, 'error'); }
}

async function openGroupMembersModal(groupname) {
  try {
    const [g, usersData] = await Promise.all([
      API.get(`/groups/${groupname}`),
      API.get('/users?limit=5000')
    ]);
    const members = g.members || [];
    const memberUsernames = members.map(m => m.username);
    // Filter out users who are already members of this group
    const availableUsers = (usersData.data || []).filter(u => !memberUsernames.includes(u.username));
    
    // Save to window for global access by filter function
    window.gmAvailableUsers = availableUsers;

    createModal('group-members-modal', `👥 Members: ${groupname}`,
      `<style>
        .autocomplete-container {
          position: relative;
          flex: 1;
        }
        .autocomplete-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: 200px;
          overflow-y: auto;
          background: #1f293d; /* match theme elevated background */
          border: 1px solid #3b4b66;
          border-radius: var(--radius-sm);
          z-index: 1050;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .autocomplete-dropdown.hidden {
          display: none;
        }
        .autocomplete-item {
          padding: 8px 12px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text-primary);
          border-bottom: 1px solid #2a364f;
          text-align: left;
        }
        .autocomplete-item:last-child {
          border-bottom: none;
        }
        .autocomplete-item:hover {
          background: #2a364f;
        }
      </style>
      <div style="margin-bottom:12px;">
        <div class="flex gap-8" style="overflow: visible;">
          <div class="autocomplete-container">
            <input id="gm-username" class="form-input" placeholder="Add username..." style="width:100%;" oninput="filterGmUserlist(this.value)" autocomplete="off">
            <div id="gm-autocomplete-list" class="autocomplete-dropdown hidden"></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="addGroupMember('${groupname}')">Add</button>
        </div>
      </div>
      <div id="gm-list">
        ${members.length ? `
        <table>
          <thead><tr><th>Username</th><th>Priority</th><th style="text-align:right;">Action</th></tr></thead>
          <tbody>${members.map(m => `
            <tr id="gmr-${m.username}">
              <td><code>${escapeHtml(m.username)}</code></td>
              <td>${m.priority}</td>
              <td style="text-align:right;">
                <button class="btn btn-ghost btn-sm btn-icon" onclick="removeGroupMember('${groupname}','${escapeHtml(m.username)}')">✕</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>` : renderEmpty('👤', 'No members', 'Add users using the field above')}
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal('group-members-modal')">Close</button>`
    );
    openModal('group-members-modal');
  } catch (err) { toast(err.message, 'error'); }
}

async function addGroupMember(groupname) {
  const username = document.getElementById('gm-username').value.trim();
  if (!username) return;
  try {
    await API.post(`/groups/${groupname}/members`, { username });
    toast(`${username} added to ${groupname}`, 'success');
    document.getElementById('gm-username').value = '';
    openGroupMembersModal(groupname);
  } catch (err) { toast(err.message, 'error'); }
}

async function removeGroupMember(groupname, username) {
  try {
    await API.delete(`/groups/${groupname}/members/${username}`);
    const row = document.getElementById(`gmr-${username}`);
    if (row) row.remove();
    toast(`${username} removed from ${groupname}`, 'success');
    loadGroups();
  } catch (err) { toast(err.message, 'error'); }
}

function deleteGroup(groupname) {
  confirmDialog(`Delete group "<strong>${groupname}</strong>"? All member assignments will be removed.`, async () => {
    try {
      await API.delete(`/groups/${groupname}`);
      toast(`Group "${groupname}" deleted`, 'success');
      loadGroups();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---- Autocomplete helpers ---- */
function filterGmUserlist(val) {
  const listEl = document.getElementById('gm-autocomplete-list');
  if (!listEl) return;
  const search = val.trim().toLowerCase();
  if (!search) {
    listEl.innerHTML = '';
    listEl.classList.add('hidden');
    return;
  }
  const matches = (window.gmAvailableUsers || []).filter(u => 
    u.username.toLowerCase().includes(search) || 
    (u.full_name && u.full_name.toLowerCase().includes(search))
  );
  if (!matches.length) {
    listEl.innerHTML = '<div style="padding:8px 12px;color:var(--text-secondary);font-size:12px;">No users found</div>';
    listEl.classList.remove('hidden');
    return;
  }
  listEl.innerHTML = matches.map(u => `
    <div class="autocomplete-item" onclick="selectGmUser('${escapeHtml(u.username)}')">
      <strong>${escapeHtml(u.username)}</strong>
      ${u.full_name ? `<span style="color:var(--text-secondary);margin-left:6px;">(${escapeHtml(u.full_name)})</span>` : ''}
    </div>
  `).join('');
  listEl.classList.remove('hidden');
}
window.filterGmUserlist = filterGmUserlist;

function selectGmUser(username) {
  const input = document.getElementById('gm-username');
  if (input) input.value = username;
  const listEl = document.getElementById('gm-autocomplete-list');
  if (listEl) {
    listEl.innerHTML = '';
    listEl.classList.add('hidden');
  }
}
window.selectGmUser = selectGmUser;

// Hide dropdown on click outside
document.addEventListener('click', (e) => {
  const listEl = document.getElementById('gm-autocomplete-list');
  if (listEl && !e.target.closest('#gm-username') && !e.target.closest('#gm-autocomplete-list')) {
    listEl.classList.add('hidden');
  }
});

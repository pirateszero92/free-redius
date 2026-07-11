/* =============================================================
   users.js — Users management page
   ============================================================= */
let usersPage = 1;
let usersSearch = '';

registerPage('users', {
  title: 'Users',
  subtitle: 'RADIUS user accounts',
  render: async () => `
    <div id="users-root">
      <div class="toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="users-search" placeholder="Search username, name, email..." oninput="usersOnSearch(this.value)">
        </div>
        <select id="users-group-filter" class="form-select" style="width:180px;" onchange="loadUsers(1)">
          <option value="">All Groups</option>
        </select>
        <button class="btn btn-primary" onclick="openCreateUserModal()">＋ Add User</button>
      </div>
      <div class="card" style="padding:0;">
        <div id="users-table-wrap">${renderLoading()}</div>
        <div id="users-pagination" style="padding:16px 20px;border-top:1px solid var(--border);"></div>
      </div>
    </div>`,
  onload: async () => {
    await loadGroupFilterOptions();
    loadUsers(1);
    // Topbar action
    document.getElementById('topbar-actions').innerHTML =
      `<button class="btn btn-ghost btn-sm" onclick="loadUsers(usersPage)">↻ Refresh</button>`;
  }
});

async function loadGroupFilterOptions() {
  const select = document.getElementById('users-group-filter');
  if (!select) return;
  try {
    const groups = await API.get('/groups');
    select.innerHTML = '<option value="">All Groups</option>';
    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.groupname;
      opt.textContent = g.groupname;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('[users/loadGroupFilter]', err);
  }
}

let usersSearchTimer;
function usersOnSearch(val) {
  usersSearch = val;
  clearTimeout(usersSearchTimer);
  usersSearchTimer = setTimeout(() => loadUsers(1), 350);
}

async function loadUsers(page) {
  usersPage = page;
  const wrap = document.getElementById('users-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = renderLoading();
  const groupVal = document.getElementById('users-group-filter')?.value || '';
  try {
    const data = await API.get(`/users?page=${page}&limit=15&search=${encodeURIComponent(usersSearch)}&group=${encodeURIComponent(groupVal)}`);
    if (!data.data.length) {
      wrap.innerHTML = renderEmpty('👤', 'No users found', usersSearch || groupVal ? 'Try a different search term or group' : 'Add your first RADIUS user',
        `<button class="btn btn-primary" onclick="openCreateUserModal()">＋ Add User</button>`);
      document.getElementById('users-pagination').innerHTML = '';
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>Username</th><th>Full Name</th><th>Email</th>
          <th>Department</th><th>Groups</th><th>ACL Profile</th><th>Source</th><th>Status</th><th style="text-align:right;">Actions</th>
        </tr></thead>
        <tbody>${data.data.map(u => `
          <tr>
            <td><code>${u.username}</code></td>
            <td>${u.full_name || '<span class="text-muted">—</span>'}</td>
            <td>${u.email || '<span class="text-muted">—</span>'}</td>
            <td>${u.department || '<span class="text-muted">—</span>'}</td>
            <td>${(u.groups || []).map(g => `<span class="badge badge-blue" style="margin-right:3px;">${g}</span>`).join('') || '<span class="text-muted">—</span>'}</td>
            <td>${u.acl_profile_name ? `<span class="badge badge-green">🛡️ ${u.acl_profile_name}</span>` : '<span class="text-muted">—</span>'}</td>
            <td><span class="badge ${u.source === 'ad' ? 'badge-purple' : 'badge-gray'}">${u.source === 'ad' ? '🏢 AD' : '🔧 Local'}</span></td>
            <td><span class="status-dot ${u.is_active ? 'green' : 'red'}"></span> ${u.is_active ? 'Active' : 'Inactive'}</td>
            <td style="text-align:right;">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditUserModal('${u.username}')" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="deleteUser('${u.username}')" title="Delete">🗑️</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.getElementById('users-pagination').innerHTML =
      renderPagination(page, data.total, data.pages, 'loadUsers');
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger" style="margin:16px;"><span class="alert-icon">❌</span>${err.message}</div>`;
  }
}

async function openCreateUserModal() {
  const [groups, acls] = await Promise.all([
    loadGroupOptions(),
    loadAclOptions()
  ]);
  createModal('user-modal', '＋ Add User',
    `<div class="form-row">
      <div class="form-group">
        <label class="form-label">Username *</label>
        <input id="um-username" class="form-input" placeholder="e.g. john.doe">
      </div>
      <div class="form-group">
        <label class="form-label">Password *</label>
        <input id="um-password" type="password" class="form-input" placeholder="User password">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input id="um-fullname" class="form-input" placeholder="Full name">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input id="um-email" class="form-input" placeholder="email@example.com">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input id="um-phone" class="form-input" placeholder="Phone number">
      </div>
      <div class="form-group">
        <label class="form-label">Department</label>
        <input id="um-dept" class="form-input" placeholder="Department">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Groups</label>
        <select id="um-groups" class="form-select" multiple style="height:100px;">
          ${groups.map(g => `<option value="${g.groupname}">${g.groupname}</option>`).join('')}
        </select>
        <div class="form-hint">Hold Ctrl/Cmd to select multiple groups</div>
      </div>
      <div class="form-group">
        <label class="form-label">ACL Profile</label>
        <select id="um-acl" class="form-select">
          <option value="">No Policy / None</option>
          ${acls.map(a => `<option value="${a.id}">🛡️ ${a.name} (${a.vendor.toUpperCase()})</option>`).join('')}
        </select>
        <div class="form-hint">Applies predefined VLAN/ACL attributes to this user.</div>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal('user-modal')">Cancel</button>
     <button class="btn btn-primary" onclick="submitCreateUser()">Create User</button>`,
    true
  );
  openModal('user-modal');
}

async function submitCreateUser() {
  const username = document.getElementById('um-username').value.trim();
  const password = document.getElementById('um-password').value;
  const full_name = document.getElementById('um-fullname').value.trim();
  const email = document.getElementById('um-email').value.trim();
  const phone = document.getElementById('um-phone').value.trim();
  const department = document.getElementById('um-dept').value.trim();
  const groups = Array.from(document.getElementById('um-groups').selectedOptions).map(o => o.value);
  const acl_profile_id = document.getElementById('um-acl').value || null;

  if (!username || !password) return toast('Username and password are required', 'error');
  try {
    await API.post('/users', { username, password, full_name, email, phone, department, groups, acl_profile_id });
    toast(`User "${username}" created`, 'success');
    closeModal('user-modal');
    loadUsers(usersPage);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openEditUserModal(username) {
  try {
    const [user, groups, acls] = await Promise.all([
      API.get(`/users/${username}`),
      loadGroupOptions(),
      loadAclOptions()
    ]);
    const userGroups = (user.groups || []).map(g => g.groupname);

    createModal('user-edit-modal', `✏️ Edit User: ${username}`,
      `<div class="form-row">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input id="ue-fullname" class="form-input" value="${user.full_name || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input id="ue-email" class="form-input" value="${user.email || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input id="ue-phone" class="form-input" value="${user.phone || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Department</label>
          <input id="ue-dept" class="form-input" value="${user.department || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">New Password <span class="text-muted">(leave blank to keep)</span></label>
          <input id="ue-password" type="password" class="form-input" placeholder="New password">
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select id="ue-active" class="form-select">
            <option value="true" ${user.is_active ? 'selected' : ''}>Active</option>
            <option value="false" ${!user.is_active ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Groups</label>
          <select id="ue-groups" class="form-select" multiple style="height:100px;">
            ${groups.map(g => `<option value="${g.groupname}" ${userGroups.includes(g.groupname) ? 'selected' : ''}>${g.groupname}</option>`).join('')}
          </select>
          <div class="form-hint">Hold Ctrl/Cmd to select multiple groups</div>
        </div>
        <div class="form-group">
          <label class="form-label">ACL Profile</label>
          <select id="ue-acl" class="form-select">
            <option value="">No Policy / None</option>
            ${acls.map(a => `<option value="${a.id}" ${user.acl_profile_id == a.id ? 'selected' : ''}>🛡️ ${a.name} (${a.vendor.toUpperCase()})</option>`).join('')}
          </select>
          <div class="form-hint">Applies predefined VLAN/ACL attributes to this user.</div>
        </div>
      </div>`,
      `<button class="btn btn-ghost" onclick="closeModal('user-edit-modal')">Cancel</button>
       <button class="btn btn-primary" onclick="submitEditUser('${username}')">Save Changes</button>`,
      true
    );
    openModal('user-edit-modal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitEditUser(username) {
  const password = document.getElementById('ue-password').value;
  const groups = Array.from(document.getElementById('ue-groups').selectedOptions).map(o => o.value);
  const acl_profile_id = document.getElementById('ue-acl').value || null;
  const body = {
    full_name: document.getElementById('ue-fullname').value.trim(),
    email: document.getElementById('ue-email').value.trim(),
    phone: document.getElementById('ue-phone').value.trim(),
    department: document.getElementById('ue-dept').value.trim(),
    is_active: document.getElementById('ue-active').value === 'true',
    groups,
    acl_profile_id,
  };
  if (password) body.password = password;
  try {
    await API.put(`/users/${username}`, body);
    toast(`User "${username}" updated`, 'success');
    closeModal('user-edit-modal');
    loadUsers(usersPage);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function deleteUser(username) {
  confirmDialog(`Delete user "<strong>${username}</strong>"? This will remove all their RADIUS data.`, async () => {
    try {
      await API.delete(`/users/${username}`);
      toast(`User "${username}" deleted`, 'success');
      loadUsers(usersPage);
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function loadGroupOptions() {
  try { return await API.get('/groups'); } catch { return []; }
}

async function loadAclOptions() {
  try { return await API.get('/acl'); } catch { return []; }
}

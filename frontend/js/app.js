/* =============================================================
   app.js — SPA Router, API client, Toast, Modal helpers
   ============================================================= */

const API_BASE = '/api';

/* ---- State ---- */
const State = {
  token: localStorage.getItem('radius_token'),
  user: JSON.parse(localStorage.getItem('radius_user') || 'null'),
  currentPage: 'dashboard',
};

/* ---- API Client ---- */
const API = {
  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (State.token) headers['Authorization'] = `Bearer ${State.token}`;
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    // 401 on authenticated request = session expired → logout
    // 401 on login attempt (no token) = wrong credentials → throw error
    if (res.status === 401) {
      if (State.token) { logout(); return; }
      throw new Error(data.error || 'Invalid credentials');
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get(path)       { return this.request('GET', path); },
  post(path, body){ return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  delete(path)    { return this.request('DELETE', path); },
};

/* ---- HTML Escaping ---- */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

/* ---- Toast ---- */
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  // Escape message just in case it contains user input
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-msg">${escapeHtml(msg)}</span>`;
  const container = document.getElementById('toast-container');
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; el.style.transition = '0.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

/* ---- Modal ---- */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('show'); }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('show'); }
}
function createModal(id, title, bodyHtml, footerHtml = '', large = false) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'modal-overlay'; document.body.appendChild(el); }
  el.innerHTML = `
    <div class="modal${large ? ' modal-lg' : ''}">
      <div class="modal-header">
        <span class="modal-title">${escapeHtml(title)}</span>
        <span class="modal-close" onclick="closeModal('${id}')">✕</span>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    </div>`;
  el.addEventListener('click', e => { if (e.target === el) closeModal(id); });
  return el;
}

/* ---- Confirm Dialog ---- */
function confirmDialog(message, onConfirm) {
  createModal('confirm-modal', 'Confirm Action',
    `<p style="color:var(--text-secondary);font-size:14px;">${message}</p>`,
    `<button class="btn btn-ghost" onclick="closeModal('confirm-modal')">Cancel</button>
     <button class="btn btn-danger" id="confirm-yes-btn">Confirm</button>`
  );
  openModal('confirm-modal');
  document.getElementById('confirm-yes-btn').onclick = () => { closeModal('confirm-modal'); onConfirm(); };
}

/* ---- Loading / Empty helpers ---- */
function renderLoading() {
  return `<div class="loading-spinner"><div class="spinner"></div><span>Loading...</span></div>`;
}
function renderEmpty(icon, title, desc, actionHtml = '') {
  return `<div class="empty-state">
    <div class="empty-icon">${escapeHtml(icon)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-desc">${escapeHtml(desc)}</div>
    ${actionHtml}
  </div>`;
}

/* ---- Pagination ---- */
function renderPagination(current, total, pages, onPage) {
  if (pages <= 1) return '';
  const start = (current - 1) * (total / pages | 0) + 1;
  const end = Math.min(current * (total / pages | 0), total);
  let html = `<div class="pagination">
    <span class="pagination-info">Showing ${start}–${end} of ${total}</span>`;
  html += `<button class="page-btn" onclick="${onPage}(${current - 1})" ${current === 1 ? 'disabled' : ''}>‹</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && Math.abs(i - current) > 2 && i !== 1 && i !== pages) {
      if (Math.abs(i - current) === 3) html += `<span class="page-btn" style="cursor:default">…</span>`;
      continue;
    }
    html += `<button class="page-btn${i === current ? ' active' : ''}" onclick="${onPage}(${i})">${i}</button>`;
  }
  html += `<button class="page-btn" onclick="${onPage}(${current + 1})" ${current === pages ? 'disabled' : ''}>›</button>`;
  html += `</div>`;
  return html;
}

/* ---- Format helpers ---- */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}
function fmtBytes(b) {
  if (!b) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  // Use Number instead of parseInt to prevent truncation of large (> 2GB) byte values
  let n = Number(b) || 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}
function fmtDuration(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/* ---- Router ---- */
const Pages = {};
function registerPage(name, pageObj) {
  Pages[name] = pageObj;
}

async function navigateTo(page) {
  if (!Pages[page]) return;

  // Call ondestroy of the previous page if exists (e.g. to clear timers)
  if (State.currentPage && Pages[State.currentPage] && Pages[State.currentPage].ondestroy) {
    try { Pages[State.currentPage].ondestroy(); } catch (e) { console.error(e); }
  }

  State.currentPage = page;

  // Update sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  const p = Pages[page];
  document.getElementById('page-title').textContent = p.title || page;
  document.getElementById('page-subtitle').textContent = p.subtitle || '';
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('page-content').innerHTML = renderLoading();

  try {
    const html = await p.render();
    document.getElementById('page-content').innerHTML = html;
    if (p.onload) await p.onload();
  } catch (err) {
    document.getElementById('page-content').innerHTML = `
      <div class="alert alert-danger"><span class="alert-icon">❌</span><span>Failed to load page: ${err.message}</span></div>`;
  }
}

/* ---- Auth ---- */
function login(token, user) {
  State.token = token;
  State.user = user;
  localStorage.setItem('radius_token', token);
  localStorage.setItem('radius_user', JSON.stringify(user));
  showApp();
}

function logout() {
  State.token = null;
  State.user = null;
  localStorage.removeItem('radius_token');
  localStorage.removeItem('radius_user');
  document.getElementById('app-layout').classList.add('hidden');
  document.getElementById('login-page').style.display = 'flex';
}

function showApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-layout').classList.remove('hidden');
  // Update sidebar user info
  if (State.user) {
    const initials = (State.user.full_name || State.user.username || 'A').slice(0, 2).toUpperCase();
    document.getElementById('sidebar-avatar').textContent = initials;
    document.getElementById('sidebar-username').textContent = State.user.full_name || State.user.username;
    document.getElementById('sidebar-role').textContent = State.user.role || 'admin';
  }
  navigateTo('dashboard');
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    errEl.classList.remove('show');
    try {
      const data = await API.post('/auth/login', {
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value,
      });
      login(data.token, data.user);
    } catch (err) {
      errEl.textContent = err.message || 'Login failed';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });

  // Sidebar navigation
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.page));
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    confirmDialog('Are you sure you want to logout?', logout);
  });

  // Check existing session
  if (State.token && State.user) {
    showApp();
  }
});

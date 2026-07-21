const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/knex');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

// Allowlist of keys that can be written to app_settings
const ALLOWED_APP_SETTING_KEYS = ['site_name', 'session_timeout', 'max_sessions_per_user'];

router.use(auth);

// GET /api/settings/ad — Get AD/LDAP settings
router.get('/ad', async (req, res) => {
  try {
    const settings = await db('ad_settings').where({ id: 1 }).first();
    if (!settings) return res.status(404).json({ error: 'AD settings not found' });
    // Never expose bind_password in response
    const { bind_password, ...safeSettings } = settings;
    safeSettings.bind_password_set = !!bind_password;
    safeSettings.selected_groups = safeSettings.selected_groups ? JSON.parse(safeSettings.selected_groups) : [];
    res.json(safeSettings);
  } catch (err) {
    console.error('[settings/ad/get]', err);
    res.status(500).json({ error: 'Failed to get AD settings' });
  }
});

// PUT /api/settings/ad — Update AD/LDAP settings
router.put('/ad', async (req, res) => {
  try {
    const {
      host, port, use_ssl, use_tls,
      bind_dn, bind_password,
      base_dn, user_filter, group_filter,
      user_attr, email_attr, display_name_attr,
      group_member_attr, is_enabled, sync_interval,
      selected_groups
    } = req.body;

    const updates = {
      updated_at: new Date()
    };

    if (host !== undefined) updates.host = host;
    if (port !== undefined) updates.port = parseInt(port);
    if (use_ssl !== undefined) updates.use_ssl = use_ssl;
    if (use_tls !== undefined) updates.use_tls = use_tls;
    if (bind_dn !== undefined) updates.bind_dn = bind_dn;
    if (bind_password !== undefined && bind_password !== '') updates.bind_password = bind_password;
    if (base_dn !== undefined) updates.base_dn = base_dn;
    if (user_filter !== undefined) updates.user_filter = user_filter;
    if (group_filter !== undefined) updates.group_filter = group_filter;
    if (user_attr !== undefined) updates.user_attr = user_attr;
    if (email_attr !== undefined) updates.email_attr = email_attr;
    if (display_name_attr !== undefined) updates.display_name_attr = display_name_attr;
    if (group_member_attr !== undefined) updates.group_member_attr = group_member_attr;
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;
    if (sync_interval !== undefined) updates.sync_interval = parseInt(sync_interval);
    if (selected_groups !== undefined) {
      updates.selected_groups = JSON.stringify(selected_groups);
    }

    // Upsert
    const existing = await db('ad_settings').where({ id: 1 }).first();
    if (existing) {
      await db('ad_settings').where({ id: 1 }).update(updates);
    } else {
      await db('ad_settings').insert({ id: 1, ...updates });
    }

    res.json({ message: 'AD settings updated' });
  } catch (err) {
    console.error('[settings/ad/update]', err);
    res.status(500).json({ error: 'Failed to update AD settings' });
  }
});

// GET /api/settings/app — General app settings
router.get('/app', async (req, res) => {
  try {
    const settings = await db('app_settings').orderBy('key');
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get app settings' });
  }
});

// PUT /api/settings/app — Update general settings
router.put('/app', async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      // Only allow known keys to prevent arbitrary key injection
      if (!ALLOWED_APP_SETTING_KEYS.includes(key)) continue;
      const exists = await db('app_settings').where({ key }).first();
      if (exists) {
        await db('app_settings').where({ key }).update({ value: String(value), updated_at: new Date() });
      } else {
        await db('app_settings').insert({ key, value: String(value) });
      }
    }
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update app settings' });
  }
});

// GET /api/settings/admin-users — List admin users
router.get('/admin-users', async (req, res) => {
  try {
    const users = await db('admin_users')
      .select('id', 'username', 'full_name', 'email', 'role', 'is_active', 'source', 'last_login', 'created_at')
      .orderBy('username');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list admin users' });
  }
});

// GET /api/settings/eligible-admins — Get users that can be promoted to admin (superadmin only)
router.get('/eligible-admins', requireRole('superadmin'), async (req, res) => {
  try {
    const existingAdmins = db('admin_users').select('username');
    const users = await db('user_profiles')
      .select('username', 'full_name', 'email', 'source')
      .whereNotIn('username', existingAdmins)
      .orderBy('username');
    res.json(users);
  } catch (err) {
    console.error('[settings/eligible-admins]', err);
    res.status(500).json({ error: 'Failed to fetch eligible users' });
  }
});

// POST /api/settings/admin-users — Create admin user (superadmin only)
router.post('/admin-users', requireRole('superadmin'), async (req, res) => {
  try {
    const { username, password, full_name, email, role, source } = req.body;
    const isAD = source === 'ad';
    
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    const existing = await db('admin_users').where({ username }).first();
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    let hash = '';
    if (isAD) {
      const randomSecret = Math.random().toString(36).substring(2) + Date.now().toString(36);
      hash = await bcrypt.hash(randomSecret, 10);
    } else {
      let cleartextPass = password;
      if (!cleartextPass) {
        // Try to fetch from radcheck if they promoted an existing local user without specifying a new password
        const radpass = await db('radcheck')
          .where({ username, attribute: 'Cleartext-Password' })
          .first();
        if (radpass) {
          cleartextPass = radpass.value;
        } else {
          return res.status(400).json({ error: 'Password is required for local account' });
        }
      }
      hash = await bcrypt.hash(cleartextPass, 10);
    }

    await db('admin_users').insert({
      username,
      password: hash,
      full_name: full_name || '',
      email: email || '',
      role: role || 'admin',
      source: source || 'local',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    });
    res.status(201).json({ message: 'Admin user created' });
  } catch (err) {
    console.error('[settings/admin-users/create]', err);
    res.status(500).json({ error: 'Failed to create admin user' });
  }
});

// DELETE /api/settings/admin-users/:id (superadmin only)
router.delete('/admin-users/:id', requireRole('superadmin'), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await db('admin_users').where({ id: req.params.id }).delete();
    res.json({ message: 'Admin user deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete admin user' });
  }
});

// GET /api/settings/guest — Get Guest Portal Settings (superadmin only)
router.get('/guest', requireRole('superadmin'), async (req, res) => {
  try {
    const settings = await db('guest_settings').where({ id: 1 }).first();
    if (!settings) {
      return res.status(404).json({ error: 'Guest Portal settings not found' });
    }
    // Mask password & secrets
    if (settings.unifi_password) settings.unifi_password = '••••••••';
    if (settings.google_client_secret) settings.google_client_secret = '••••••••';
    if (settings.github_client_secret) settings.github_client_secret = '••••••••';
    if (settings.line_client_secret) settings.line_client_secret = '••••••••';
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch guest settings' });
  }
});

// POST /api/settings/guest — Update Guest Portal Settings
router.post('/guest', requireRole('superadmin'), async (req, res) => {
  try {
    const data = req.body;

    if (data.unifi_password === '••••••••') delete data.unifi_password;
    if (data.google_client_secret === '••••••••') delete data.google_client_secret;
    if (data.github_client_secret === '••••••••') delete data.github_client_secret;
    if (data.line_client_secret === '••••••••') delete data.line_client_secret;

    // M-7 FIX: Validate unifi_url to prevent SSRF — only allow http/https
    if (data.unifi_url) {
      try {
        const parsed = new URL(data.unifi_url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ error: 'unifi_url must use http or https protocol.' });
        }
      } catch {
        return res.status(400).json({ error: 'unifi_url is not a valid URL.' });
      }
    }

    const updates = {
      unifi_url: data.unifi_url || '',
      unifi_username: data.unifi_username || '',
      unifi_site: data.unifi_site || 'default',
      unifi_verify_ssl: !!data.unifi_verify_ssl,
      session_duration_mins: parseInt(data.session_duration_mins) || 120,
      google_client_id: data.google_client_id || '',
      google_enabled: !!data.google_enabled,
      github_client_id: data.github_client_id || '',
      github_enabled: !!data.github_enabled,
      line_client_id: data.line_client_id || '',
      line_enabled: !!data.line_enabled,
      updated_at: new Date()
    };

    if (data.unifi_password !== undefined) updates.unifi_password = data.unifi_password;
    if (data.google_client_secret !== undefined) updates.google_client_secret = data.google_client_secret;
    if (data.github_client_secret !== undefined) updates.github_client_secret = data.github_client_secret;
    if (data.line_client_secret !== undefined) updates.line_client_secret = data.line_client_secret;

    await db('guest_settings').where({ id: 1 }).update(updates);
    res.json({ message: 'Guest Portal settings updated' });
  } catch (err) {
    console.error('[settings/guest/update]', err);
    res.status(500).json({ error: 'Failed to update guest settings' });
  }
});

module.exports = router;

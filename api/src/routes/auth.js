const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/knex');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const ldap = require('ldapjs');

async function authenticateLdapUser(username, password) {
  const settings = await db('ad_settings').where({ id: 1 }).first();
  if (!settings || !settings.host || !settings.is_enabled) {
    throw new Error('Active Directory is not enabled or configured');
  }

  const protocol = settings.use_ssl ? 'ldaps' : 'ldap';
  const url = `${protocol}://${settings.host}:${settings.port}`;

  const client = ldap.createClient({
    url,
    tlsOptions: settings.use_ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 5000,
    timeout: 5000,
  });

  // Try to resolve domain from base_dn (e.g. "DC=VSKAUTOPARTS,DC=LOCAL" -> "vskautoparts.local")
  const domainParts = settings.base_dn
    ? settings.base_dn
        .split(',')
        .filter(p => p.trim().toLowerCase().startsWith('dc='))
        .map(p => p.trim().split('=')[1])
    : [];
  const domainName = domainParts.join('.');
  const bindUser = domainName ? `${username}@${domainName}` : username;

  return new Promise((resolve, reject) => {
    client.bind(bindUser, password, (err) => {
      try { client.unbind(); } catch (_) {}
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await db('admin_users')
      .where({ username, is_active: true })
      .first();

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let valid = false;
    if (user.source === 'ad') {
      try {
        await authenticateLdapUser(username, password);
        valid = true;
      } catch (err) {
        console.error(`[auth/login] AD authentication failed for "${username}":`, err.message);
        return res.status(401).json({ error: 'Invalid Active Directory credentials' });
      }
    } else {
      valid = await bcrypt.compare(password, user.password);
    }

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last_login
    await db('admin_users').where({ id: user.id }).update({ last_login: new Date() });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      }
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/change-password
const auth = require('../middleware/auth');
router.post('/change-password', auth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }

    const user = await db('admin_users').where({ id: req.user.id }).first();
    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db('admin_users').where({ id: req.user.id }).update({
      password: hash,
      updated_at: new Date()
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('[auth/change-password]', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await db('admin_users')
      .select('id', 'username', 'full_name', 'email', 'role', 'last_login', 'created_at')
      .where({ id: req.user.id })
      .first();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

module.exports = router;

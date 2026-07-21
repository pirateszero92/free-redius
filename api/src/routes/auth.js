const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db/knex');

// C-3 FIX: Fail fast — never use a fallback secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const ldap = require('ldapjs');

// H-4 FIX: Rate limit login attempts (max 20 per 15 minutes per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

async function authenticateLdapUser(username, password) {
  const settings = await db('ad_settings').where({ id: 1 }).first();
  if (!settings || !settings.host || !settings.is_enabled) {
    throw new Error('Active Directory is not enabled or configured');
  }

  const protocol = settings.use_ssl ? 'ldaps' : 'ldap';
  const url = `${protocol}://${settings.host}:${settings.port}`;

  const client = ldap.createClient({
    url,
    // H-8 NOTE: rejectUnauthorized is intentionally left as true (default).
    // If using a self-signed cert, configure a custom CA via NODE_EXTRA_CA_CERTS
    // instead of disabling verification entirely.
    tlsOptions: settings.use_ssl ? { rejectUnauthorized: true } : undefined,
    connectTimeout: 5000,
    timeout: 5000,
  });

  // Resolve domain from base_dn (e.g. "DC=CORP,DC=LOCAL" -> "corp.local")
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
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// M-9 FIX: Basic password complexity check
function validatePasswordComplexity(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  return null; // null = valid
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
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

    // M-9 FIX: Validate new password complexity
    const complexityError = validatePasswordComplexity(new_password);
    if (complexityError) {
      return res.status(400).json({ error: complexityError });
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

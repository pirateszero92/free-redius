const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db/knex');
const axios = require('axios');
const UnifiController = require('../utils/unifi');
const { normalizeMac } = require('../utils/mac');

// ─── Security helpers ────────────────────────────────────────────────────────

// C-2 FIX: HMAC-sign the OAuth state so it cannot be tampered with
const HMAC_SECRET = process.env.JWT_SECRET; // reuse the already-required JWT secret

function encodeState(stateObj) {
  const payload = Buffer.from(JSON.stringify(stateObj)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function decodeState(stateStr) {
  try {
    const [payload, sig] = stateStr.split('.');
    if (!payload || !sig) return {};
    const expected = crypto
      .createHmac('sha256', HMAC_SECRET)
      .update(payload)
      .digest('base64url');
    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return {};
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return {};
  }
}

// C-1 FIX: Escape HTML special characters before injecting into HTML templates
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// H-6 FIX: Validate redirect_url — only allow http/https schemes
function safeRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'https://www.google.com';
    return url;
  } catch {
    return 'https://www.google.com';
  }
}

// H-4 FIX: Rate limit guest registration (max 10 per 10 minutes per IP)
const guestRegisterLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please wait before trying again.' }
});

// H-4 FIX: Rate limit OAuth login initiation (max 20 per 10 minutes per IP)
const guestLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please wait before trying again.'
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/guest/config — Get which providers are enabled
router.get('/config', async (req, res) => {
  try {
    const settings = await db('guest_settings').where({ id: 1 }).first();
    if (!settings) {
      return res.json({ google: false, github: false, line: false });
    }
    res.json({
      google: !!settings.google_enabled,
      github: !!settings.github_enabled,
      line: !!settings.line_enabled
    });
  } catch (err) {
    console.error('[Guest/config]', err);
    res.status(500).json({ error: 'Failed to load portal configuration' });
  }
});

// POST /api/guest/register-local — Register via simple form (no social)
router.post('/register-local', guestRegisterLimiter, async (req, res) => {
  try {
    const { mac_address, name, phone, email, line_id, ap_mac, ssid, redirect_url } = req.body;
    if (!mac_address || !name || !phone) {
      return res.status(400).json({ error: 'Name and Phone Number are required.' });
    }

    // H-2 FIX: normalizeMac now returns '' on invalid input instead of crashing
    const normMac = normalizeMac(mac_address);
    if (!normMac) {
      return res.status(400).json({ error: 'Invalid MAC address format.' });
    }
    const normApMac = normalizeMac(ap_mac);
    const safeRedirect = safeRedirectUrl(redirect_url); // H-6 FIX

    // Save to guest_users (upsert based on MAC + local provider)
    const existing = await db('guest_users').where({ mac_address: normMac, provider: 'local' }).first();
    if (existing) {
      await db('guest_users').where({ id: existing.id }).update({
        name,
        email: email || '',
        social_id: phone, // phone acts as social_id for local guests
        updated_at: new Date()
      });
    } else {
      await db('guest_users').insert({
        mac_address: normMac,
        provider: 'local',
        social_id: phone,
        email: email || '',
        name,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    // Load guest settings to talk to UniFi Controller
    const settings = await db('guest_settings').where({ id: 1 }).first();
    if (!settings || !settings.unifi_url) {
      console.log('[Guest] UniFi Controller is not configured. Simulating success...');
    } else {
      const unifi = new UnifiController(settings);
      await unifi.authorizeGuest(normMac, settings.session_duration_mins || 120);
    }

    // Save Guest Session
    const durationMins = settings ? (settings.session_duration_mins || 120) : 120;
    const expiresAt = new Date(Date.now() + durationMins * 60 * 1000);
    await db('guest_sessions').insert({
      mac_address: normMac,
      ap_mac: normApMac || null,
      ssid: ssid || null,
      authorized_at: new Date(),
      expires_at: expiresAt
    });

    res.json({ success: true, redirect: safeRedirect });
  } catch (err) {
    console.error('[Guest/LocalRegister]', err);
    res.status(500).json({ error: 'Failed to authorize guest access.' });
  }
});

// GET /api/guest/login — Redirect to Social Provider Login Screen
router.get('/login', guestLoginLimiter, async (req, res) => {
  try {
    const { provider, mac, ap, ssid, redirect_url } = req.query;
    if (!provider || !mac) {
      return res.status(400).send('Provider and client MAC address are required.');
    }

    // H-2 FIX: validate MAC before embedding in state
    const normMac = normalizeMac(mac);
    if (!normMac) {
      return res.status(400).send('Invalid MAC address format.');
    }

    const settings = await db('guest_settings').where({ id: 1 }).first();
    if (!settings) {
      return res.status(500).send('Guest Portal settings not configured.');
    }

    // C-2 FIX: Sign the state so it cannot be forged
    const state = encodeState({
      mac: normMac,
      ap: normalizeMac(ap),
      ssid,
      redirect_url: safeRedirectUrl(redirect_url) // H-6 FIX: validate at encode time
    });

    const host = req.get('host');
    let protocol = req.headers['x-forwarded-proto'] || req.protocol;
    if (host && host.includes('superpart.co.th')) {
      protocol = 'https';
    }
    const redirectUri = `${protocol}://${host}/api/guest/oauth/callback?provider=${provider}`;

    let authUrl = '';
    if (provider === 'google') {
      if (!settings.google_enabled || !settings.google_client_id) {
        return res.status(400).send('Google Login is not enabled or configured.');
      }
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(settings.google_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20profile%20email&state=${encodeURIComponent(state)}`;
    } else if (provider === 'github') {
      if (!settings.github_enabled || !settings.github_client_id) {
        return res.status(400).send('GitHub Login is not enabled or configured.');
      }
      authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(settings.github_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email&state=${encodeURIComponent(state)}`;
    } else if (provider === 'line') {
      if (!settings.line_enabled || !settings.line_client_id) {
        return res.status(400).send('LINE Login is not enabled or configured.');
      }
      authUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${encodeURIComponent(settings.line_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=profile%20openid%20email`;
    } else {
      return res.status(400).send('Unsupported social provider.');
    }

    res.redirect(authUrl);
  } catch (err) {
    console.error('[Guest/LoginRedirect]', err);
    res.status(500).send('Login redirect failed. Please try again.');
  }
});

// GET /api/guest/oauth/callback — Handle OAuth2 callback, authorize in UniFi, and redirect client
router.get('/oauth/callback', async (req, res) => {
  const { provider, code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameters from OAuth2 provider.');
  }

  // C-2 FIX: decodeState verifies HMAC signature — rejects tampered states
  const { mac, ap, ssid, redirect_url } = decodeState(state);
  if (!mac) {
    return res.status(400).send('Invalid or tampered state. Please restart the login process.');
  }

  try {
    const settings = await db('guest_settings').where({ id: 1 }).first();
    if (!settings) return res.status(500).send('Guest Portal settings not configured.');

    const host = req.get('host');
    let protocol = req.headers['x-forwarded-proto'] || req.protocol;
    if (host && host.includes('superpart.co.th')) {
      protocol = 'https';
    }
    const redirectUri = `${protocol}://${host}/api/guest/oauth/callback?provider=${provider}`;

    let socialId = '';
    let name = '';
    let email = '';

    if (provider === 'google') {
      const params = new URLSearchParams();
      params.append('code', code);
      params.append('client_id', settings.google_client_id);
      params.append('client_secret', settings.google_client_secret);
      params.append('redirect_uri', redirectUri);
      params.append('grant_type', 'authorization_code');

      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000
      });

      const { access_token } = tokenRes.data;
      const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 5000
      });

      socialId = userRes.data.sub;
      name = userRes.data.name || '';
      email = userRes.data.email || '';

    } else if (provider === 'github') {
      const params = new URLSearchParams();
      params.append('code', code);
      params.append('client_id', settings.github_client_id);
      params.append('client_secret', settings.github_client_secret);
      params.append('redirect_uri', redirectUri);

      const tokenRes = await axios.post('https://github.com/login/oauth/access_token', params, {
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded' 
        },
        timeout: 5000
      });

      const { access_token } = tokenRes.data;
      const userRes = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 5000
      });

      socialId = String(userRes.data.id);
      name = userRes.data.name || userRes.data.login || '';
      email = userRes.data.email || '';

    } else if (provider === 'line') {
      const params = new URLSearchParams();
      params.append('code', code);
      params.append('client_id', settings.line_client_id);
      params.append('client_secret', settings.line_client_secret);
      params.append('redirect_uri', redirectUri);
      params.append('grant_type', 'authorization_code');

      const tokenRes = await axios.post('https://api.line.me/oauth2/v2.1/token', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000
      });

      const { access_token } = tokenRes.data;
      const userRes = await axios.get('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 5000
      });

      socialId = userRes.data.userId;
      name = userRes.data.displayName || '';
      email = '';

    } else {
      return res.status(400).send('Unsupported social provider callback.');
    }

    // Save/Upsert Guest User
    const existing = await db('guest_users').where({ mac_address: mac, provider }).first();
    if (existing) {
      await db('guest_users').where({ id: existing.id }).update({
        social_id: socialId,
        name,
        email,
        updated_at: new Date()
      });
    } else {
      await db('guest_users').insert({
        mac_address: mac,
        provider,
        social_id: socialId,
        name,
        email,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    // Authorize in UniFi
    if (settings && settings.unifi_url) {
      const unifi = new UnifiController(settings);
      await unifi.authorizeGuest(mac, settings.session_duration_mins || 120);
    } else {
      console.log('[Guest] UniFi Controller is not configured. Simulating success...');
    }

    // Log Session
    const durationMins = settings ? (settings.session_duration_mins || 120) : 120;
    const expiresAt = new Date(Date.now() + durationMins * 60 * 1000);
    await db('guest_sessions').insert({
      mac_address: mac,
      ap_mac: ap || null,
      ssid: ssid || null,
      authorized_at: new Date(),
      expires_at: expiresAt
    });

    // C-1 FIX: All dynamic values are HTML-escaped before injection into the template.
    // redirect_url was already validated in encodeState; escapeHtml prevents attribute injection.
    const safeUrl = escapeHtml(safeRedirectUrl(redirect_url));
    const safeName = escapeHtml(name);

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connection Successful</title>
  <style>
    body {
      margin: 0; padding: 0;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #0f172a, #1e293b);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #ffffff; text-align: center;
    }
    .card {
      background: rgba(255,255,255,0.05); backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.1); padding: 40px 30px;
      border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      max-width: 400px; width: 85%;
    }
    .icon { font-size: 60px; margin-bottom: 20px; animation: bounce 2s infinite; }
    h1 { font-size: 24px; margin: 0 0 10px 0; font-weight: 700; }
    p { font-size: 15px; color: #94a3b8; line-height: 1.6; margin: 0 0 25px 0; }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: white; text-decoration: none; padding: 12px 30px;
      border-radius: 50px; font-weight: 600; font-size: 15px;
      box-shadow: 0 4px 15px rgba(37,99,235,0.4);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(37,99,235,0.5); }
    @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚡</div>
    <h1>Connection Successful</h1>
    <p>Welcome, ${safeName}! Your device has been authorized. You are now connected to the internet.</p>
    <a href="${safeUrl}" class="btn">Start Browsing</a>
  </div>
</body>
</html>`);

  } catch (err) {
    console.error('[Guest/OAuthCallbackError]', err);
    // L-3: Do not expose internal error details to the client
    res.status(500).send('Authorization failed. Please try again or use the manual registration form.');
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const axios = require('axios');
const UnifiController = require('../utils/unifi');

// Helper to base64 encode/decode state
function encodeState(stateObj) {
  return Buffer.from(JSON.stringify(stateObj)).toString('base64');
}

function decodeState(stateStr) {
  try {
    return JSON.parse(Buffer.from(stateStr, 'base64').toString('utf-8'));
  } catch (e) {
    return {};
  }
}

// Helper to normalize MAC
function normalizeMac(mac) {
  if (!mac) return '';
  return mac.toLowerCase().replace(/[^0-9a-f]/g, '').match(/.{1,2}/g).join(':');
}

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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/guest/register-local — Register via simple form (no social)
router.post('/register-local', async (req, res) => {
  try {
    const { mac_address, name, phone, email, line_id, ap_mac, ssid, redirect_url } = req.body;
    if (!mac_address || !name || !phone) {
      return res.status(400).json({ error: 'Name and Phone Number are required.' });
    }

    const normMac = normalizeMac(mac_address);
    const normApMac = normalizeMac(ap_mac);

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

    res.json({ success: true, redirect: redirect_url || 'https://www.google.com' });
  } catch (err) {
    console.error('[Guest/LocalRegister]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/guest/login — Redirect to Social Provider Login Screen
router.get('/login', async (req, res) => {
  try {
    const { provider, mac, ap, ssid, redirect_url } = req.query;
    if (!provider || !mac) {
      return res.status(400).send('Provider and client MAC address are required.');
    }

    const settings = await db('guest_settings').where({ id: 1 }).first();
    if (!settings) {
      return res.status(500).send('Guest Portal settings not configured.');
    }

    const state = encodeState({
      mac: normalizeMac(mac),
      ap: normalizeMac(ap),
      ssid,
      redirect_url: redirect_url || 'https://www.google.com'
    });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const redirectUri = `${protocol}://${host}/api/guest/oauth/callback?provider=${provider}`;

    let authUrl = '';
    if (provider === 'google') {
      if (!settings.google_enabled || !settings.google_client_id) {
        return res.status(400).send('Google Login is not enabled or configured.');
      }
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(settings.google_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20profile%20email&state=${state}`;
    } else if (provider === 'github') {
      if (!settings.github_enabled || !settings.github_client_id) {
        return res.status(400).send('GitHub Login is not enabled or configured.');
      }
      authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(settings.github_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email&state=${state}`;
    } else if (provider === 'line') {
      if (!settings.line_enabled || !settings.line_client_id) {
        return res.status(400).send('LINE Login is not enabled or configured.');
      }
      authUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${encodeURIComponent(settings.line_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=profile%20openid%20email`;
    } else {
      return res.status(400).send('Unsupported social provider.');
    }

    res.redirect(authUrl);
  } catch (err) {
    console.error('[Guest/LoginRedirect]', err);
    res.status(500).send(`Login failed: ${err.message}`);
  }
});

// GET /api/guest/oauth/callback — Handle OAuth2 callback, authorize in UniFi, and redirect client
router.get('/oauth/callback', async (req, res) => {
  const { provider } = req.query;
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameters from OAuth2 provider.');
  }

  const { mac, ap, ssid, redirect_url } = decodeState(state);
  if (!mac) {
    return res.status(400).send('Invalid state payload: MAC address is missing.');
  }

  try {
    const settings = await db('guest_settings').where({ id: 1 }).first();
    if (!settings) return res.status(500).send('Guest Portal settings not configured.');

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const redirectUri = `${protocol}://${host}/api/guest/oauth/callback?provider=${provider}`;

    let socialId = '';
    let name = '';
    let email = '';

    if (provider === 'google') {
      // Exchange Code for Token
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: settings.google_client_id,
        client_secret: settings.google_client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });

      const { access_token } = tokenRes.data;

      // Fetch User Info
      const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      socialId = userRes.data.sub;
      name = userRes.data.name || '';
      email = userRes.data.email || '';

    } else if (provider === 'github') {
      const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
        code,
        client_id: settings.github_client_id,
        client_secret: settings.github_client_secret,
        redirect_uri: redirectUri
      }, {
        headers: { Accept: 'application/json' }
      });

      const { access_token } = tokenRes.data;

      // Fetch User Info
      const userRes = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${access_token}` }
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
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const { access_token } = tokenRes.data;

      // Fetch User Info
      const userRes = await axios.get('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      socialId = userRes.data.userId;
      name = userRes.data.displayName || '';
      email = ''; // LINE profile endpoint doesn't return email by default unless requested in OpenID

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

    // Render a friendly dynamic redirection page to indicate success
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Connection Successful</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a, #1e293b);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #ffffff;
            text-align: center;
          }
          .card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 40px 30px;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            max-width: 400px;
            width: 85%;
          }
          .icon {
            font-size: 60px;
            margin-bottom: 20px;
            animation: bounce 2s infinite;
          }
          h1 {
            font-size: 24px;
            margin: 0 0 10px 0;
            font-weight: 700;
          }
          p {
            font-size: 15px;
            color: #94a3b8;
            line-height: 1.6;
            margin: 0 0 25px 0;
          }
          .btn {
            display: inline-block;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            color: white;
            text-decoration: none;
            padding: 12px 30px;
            border-radius: 50px;
            font-weight: 600;
            font-size: 15px;
            box-shadow: 0 4px 15px rgba(37, 99, 235, 0.4);
            transition: transform 0.2s, box-shadow 0.2s;
          }
          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">⚡</div>
          <h1>Connection Successful</h1>
          <p>Your device has been authorized successfully. You are now connected to the internet.</p>
          <a href="${redirect_url}" class="btn">Start Browsing</a>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('[Guest/OAuthCallbackError]', err);
    res.status(500).send(`OAuth2 authorization failed: ${err.message}`);
  }
});

module.exports = router;

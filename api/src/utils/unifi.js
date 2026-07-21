const axios = require('axios');
const https = require('https');

class UnifiController {
  constructor(config) {
    this.url = config.unifi_url;
    this.username = config.unifi_username;
    this.password = config.unifi_password;
    this.site = config.unifi_site || 'default';
    this.verifySsl = !!config.unifi_verify_ssl;

    this.axiosInstance = axios.create({
      baseURL: this.url,
      timeout: 10000,
      // H-8 NOTE: verifySsl is configured per-setting in the admin panel.
      // Default is false for UniFi since most installations use self-signed certs.
      // For production deployments we recommend enabling this and supplying a CA cert.
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.verifySsl
      })
    });

    // Cookie jar simulation
    this.cookies = '';

    // H-5 FIX: Login mutex — prevents concurrent login storms when cookies expire
    // Holds the in-progress login Promise so all concurrent callers await the same attempt.
    this._loginPromise = null;
  }

  /**
   * Login to UniFi Controller and cache the session cookies.
   * H-5 FIX: Only one login request is made at a time regardless of concurrent callers.
   */
  async login() {
    if (this._loginPromise) {
      // Another call is already logging in — await that same promise
      return this._loginPromise;
    }

    this._loginPromise = this._doLogin().finally(() => {
      // Release the mutex after login completes (success or failure)
      this._loginPromise = null;
    });

    return this._loginPromise;
  }

  async _doLogin() {
    if (!this.url || !this.username || !this.password) {
      throw new Error('UniFi Controller config is missing URL, username, or password.');
    }

    console.log(`[UniFi] Attempting login to Controller at ${this.url}`);
    const res = await this.axiosInstance.post('/api/login', {
      username: this.username,
      password: this.password
    });

    // Extract cookies from response headers
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      this.cookies = setCookie.map(c => c.split(';')[0]).join('; ');
    }
    console.log('[UniFi] Logged in successfully to Controller');
    return true;
  }

  async authorizeGuest(macAddress, minutes) {
    // H-2: Normalise MAC address safely
    const cleanMac = macAddress.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (cleanMac.length !== 12) throw new Error('Invalid MAC address format for UniFi authorization.');
    const normalizedMac = cleanMac.match(/.{1,2}/g).join(':');

    // Ensure we have a session cookie before calling the API
    if (!this.cookies) {
      await this.login();
    }

    try {
      console.log(`[UniFi] Authorizing guest MAC ${normalizedMac} for ${minutes} minutes...`);
      const res = await this.axiosInstance.post(
        `/api/s/${this.site}/cmd/stamgr`,
        {
          cmd: 'authorize-guest',
          mac: normalizedMac,
          minutes: parseInt(minutes) || 120
        },
        {
          headers: { Cookie: this.cookies }
        }
      );

      console.log('[UniFi] Authorization response:', res.data);
      return res.data;
    } catch (err) {
      // Retry login once if cookie expired (401/403 from UniFi)
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        console.log('[UniFi] Cookie might be expired, retrying login...');
        this.cookies = ''; // clear stale cookie before re-login
        await this.login();
        const res = await this.axiosInstance.post(
          `/api/s/${this.site}/cmd/stamgr`,
          {
            cmd: 'authorize-guest',
            mac: normalizedMac,
            minutes: parseInt(minutes) || 120
          },
          {
            headers: { Cookie: this.cookies }
          }
        );
        console.log('[UniFi] Authorization response (retry):', res.data);
        return res.data;
      }
      console.error('[UniFi] Failed to authorize guest:', err.message);
      throw new Error(`UniFi Controller guest authorization failed: ${err.message}`);
    }
  }
}

module.exports = UnifiController;

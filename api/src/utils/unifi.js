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
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.verifySsl
      })
    });
    
    // Cookie jar simulation
    this.cookies = '';
  }

  async login() {
    if (!this.url || !this.username || !this.password) {
      throw new Error('UniFi Controller config is missing URL, username, or password.');
    }

    try {
      console.log(`[UniFi] Attempting login to Controller at ${this.url}`);
      const res = await this.axiosInstance.post('/api/login', {
        username: this.username,
        password: this.password
      });

      // Extract cookies
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        this.cookies = setCookie.map(c => c.split(';')[0]).join('; ');
      }
      console.log('[UniFi] Logged in successfully to Controller');
      return true;
    } catch (err) {
      console.error('[UniFi] Login failed:', err.message);
      throw new Error(`UniFi Controller login failed: ${err.message}`);
    }
  }

  async authorizeGuest(macAddress, minutes) {
    const normalizedMac = macAddress.toLowerCase().replace(/[^0-9a-f]/g, '').match(/.{1,2}/g).join(':');
    
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
          headers: {
            Cookie: this.cookies
          }
        }
      );

      console.log('[UniFi] Authorization response:', res.data);
      return res.data;
    } catch (err) {
      // Retry login once if cookie expired
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        console.log('[UniFi] Cookie might be expired, retrying login...');
        await this.login();
        const res = await this.axiosInstance.post(
          `/api/s/${this.site}/cmd/stamgr`,
          {
            cmd: 'authorize-guest',
            mac: normalizedMac,
            minutes: parseInt(minutes) || 120
          },
          {
            headers: {
              Cookie: this.cookies
            }
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

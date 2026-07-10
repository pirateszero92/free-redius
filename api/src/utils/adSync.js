const ldap = require('ldapjs');
const db = require('../db/knex');

/**
 * Escape special characters in LDAP filter values to prevent LDAP injection.
 */
function escapeLdapFilter(s) {
  return String(s).replace(/[\\*() ]/g, c => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

/**
 * Convert LdapSearchEntry to plain JavaScript object
 */
function entryToPlainObject(entry) {
  const dnStr = entry.objectName ? entry.objectName.toString() : '';
  const obj = {
    dn: dnStr,
    distinguishedName: dnStr
  };
  if (entry.pojo && entry.pojo.attributes) {
    for (const attr of entry.pojo.attributes) {
      const type = attr.type;
      const values = attr.values;
      if (values && values.length > 0) {
        obj[type] = values.length === 1 ? values[0] : values;
      }
    }
  }
  return obj;
}

/**
 * Bind and search helper
 */
function ldapSearch(client, base, filter, attrs) {
  return new Promise((resolve, reject) => {
    client.search(base, { scope: 'sub', filter, attributes: attrs }, (err, res) => {
      if (err) return reject(err);
      const entries = [];
      res.on('searchEntry', entry => {
        try {
          entries.push(entryToPlainObject(entry));
        } catch (e) {
          console.error('[adSync/ldapSearch] failed to parse entry:', e);
        }
      });
      res.on('error', reject);
      res.on('end', () => resolve(entries));
    });
  });
}

/**
 * Core AD/LDAP Sync function
 * @param {Array<string>} [selectedGroupsOverride] Optional override for selected groups to sync
 * @returns {Promise<object>} Results of the sync
 */
async function runAdSync(selectedGroupsOverride = null) {
  const settings = await db('ad_settings').where({ id: 1 }).first();
  if (!settings || !settings.host) {
    throw new Error('AD settings not configured');
  }

  const protocol = settings.use_ssl ? 'ldaps' : 'ldap';
  const url = `${protocol}://${settings.host}:${settings.port}`;
  const client = ldap.createClient({
    url,
    tlsOptions: settings.use_ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 10000,
    timeout: 15000,
  });

  try {
    // Bind
    await new Promise((resolve, reject) => {
      client.bind(settings.bind_dn, settings.bind_password, (err) => {
        if (err) reject(err); else resolve();
      });
    });

    // Determine selected groups
    let selected_groups = selectedGroupsOverride;
    if (!selected_groups) {
      selected_groups = settings.selected_groups ? JSON.parse(settings.selected_groups) : [];
    }

    const results = { groups_synced: 0, users_synced: 0, errors: [] };
    const userAttr = settings.user_attr || 'sAMAccountName';
    const emailAttr = settings.email_attr || 'mail';
    const nameAttr = settings.display_name_attr || 'displayName';

    // 1. Sync Groups
    let groupFilter = settings.group_filter || '(objectClass=group)';
    if (selected_groups.length > 0) {
      const cnFilters = selected_groups.map(g => {
        let cn = g;
        if (g.toLowerCase().startsWith('cn=')) {
          const match = g.match(/^CN=([^,]+)/i);
          cn = match ? match[1] : g;
        }
        return `(cn=${escapeLdapFilter(cn)})`;
      }).join('');
      groupFilter = `(&${groupFilter}(|${cnFilters}))`;
    }

    const groupEntries = await ldapSearch(client, settings.base_dn, groupFilter,
      ['cn', 'distinguishedName', 'description', 'member']);

    for (const entry of groupEntries) {
      try {
        const groupname = entry.cn;
        if (!groupname) continue;

        const existing = await db('group_profiles').where({ groupname }).first();
        if (existing) {
          await db('group_profiles').where({ groupname }).update({
            description: entry.description || existing.description,
            source: 'ad',
            ad_dn: entry.distinguishedName || '',
            updated_at: new Date()
          });
        } else {
          await db('group_profiles').insert({
            groupname,
            description: entry.description || '',
            source: 'ad',
            ad_dn: entry.distinguishedName || '',
            created_at: new Date(),
            updated_at: new Date()
          });
        }
        results.groups_synced++;
      } catch (err) {
        results.errors.push(`Group ${entry.cn}: ${err.message}`);
      }
    }

    // 2. Sync Users
    let userFilter = settings.user_filter || '(&(objectClass=person)(sAMAccountName=*))';
    if (selected_groups.length > 0) {
      const groupFilters = selected_groups
        .map(g => {
          if (g.toLowerCase().startsWith('cn=')) {
            return `(memberOf=${escapeLdapFilter(g)})`;
          }
          return `(memberOf=CN=${escapeLdapFilter(g)},${settings.base_dn})`;
        }).join('');
      userFilter = `(&${userFilter}(|${groupFilters}))`;
    }

    const userEntries = await ldapSearch(client, settings.base_dn, userFilter,
      [userAttr, emailAttr, nameAttr, 'department', 'telephoneNumber', 'distinguishedName', 'memberOf']);

    for (const entry of userEntries) {
      try {
        const username = entry[userAttr];
        if (!username) continue;

        const full_name = entry[nameAttr] || '';
        const email = entry[emailAttr] || '';
        const department = entry.department || '';
        const phone = entry.telephoneNumber || '';
        const ad_dn = entry.distinguishedName || '';

        // Upsert user_profile
        const existingProfile = await db('user_profiles').where({ username }).first();
        if (existingProfile) {
          await db('user_profiles').where({ username }).update({
            full_name, email, department, phone, source: 'ad', ad_dn, updated_at: new Date()
          });
        } else {
          await db('user_profiles').insert({
            username, full_name, email, department, phone,
            source: 'ad', ad_dn, is_active: true,
            created_at: new Date(), updated_at: new Date()
          });
        }

        // Ensure radcheck entry exists
        const hasCheck = await db('radcheck').where({ username, attribute: 'Auth-Type' }).first();
        if (!hasCheck) {
          await db('radcheck').insert({
            username,
            attribute: 'Auth-Type',
            op: ':=',
            value: 'LDAP'
          });
        }

        // Sync group memberships
        const memberOf = Array.isArray(entry.memberOf)
          ? entry.memberOf
          : entry.memberOf ? [entry.memberOf] : [];

        const cnGroups = memberOf.map(dn => {
          const match = dn.match(/^CN=([^,]+)/i);
          return match ? match[1] : null;
        }).filter(Boolean);

        // Add to user groups mapping table
        if (selected_groups.length > 0) {
          for (const groupname of cnGroups) {
            const matchedSelected = selected_groups.some(g => {
              let cn = g;
              if (g.toLowerCase().startsWith('cn=')) {
                const match = g.match(/^CN=([^,]+)/i);
                cn = match ? match[1] : g;
              }
              return cn.toLowerCase() === groupname.toLowerCase();
            });
            if (matchedSelected) {
              const exists = await db('radusergroup').where({ username, groupname }).first();
              if (!exists) {
                await db('radusergroup').insert({ username, groupname, priority: 1 });
              }
            }
          }
        } else {
          for (const groupname of cnGroups) {
            const groupExists = await db('group_profiles').where({ groupname }).first();
            if (groupExists) {
              const exists = await db('radusergroup').where({ username, groupname }).first();
              if (!exists) {
                await db('radusergroup').insert({ username, groupname, priority: 1 });
              }
            }
          }
        }

        results.users_synced++;
      } catch (err) {
        results.errors.push(`User ${entry[userAttr]}: ${err.message}`);
      }
    }

    // Save back selected groups and last sync timestamp
    const adUpdate = { last_sync: new Date() };
    if (selectedGroupsOverride) {
      adUpdate.selected_groups = JSON.stringify(selectedGroupsOverride);
    }
    await db('ad_settings').where({ id: 1 }).update(adUpdate);

    return results;
  } finally {
    try { client.unbind(); } catch (_) {}
  }
}

/**
 * Initializes background auto sync scheduling
 */
let autoSyncIntervalId = null;

function startAutoSyncScheduler() {
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
  }

  async function checkAndRun() {
    try {
      const settings = await db('ad_settings').where({ id: 1 }).first();
      if (!settings || !settings.is_enabled || !settings.host) {
        return;
      }

      // Check if it is time to sync (based on last_sync and sync_interval)
      const lastSync = settings.last_sync ? new Date(settings.last_sync) : null;
      const intervalMs = (settings.sync_interval || 60) * 60 * 1000;
      const now = new Date();

      if (!lastSync || (now.getTime() - lastSync.getTime() >= intervalMs)) {
        console.log('[AutoSync] Starting scheduled Active Directory sync...');
        const res = await runAdSync();
        console.log(`[AutoSync] Completed! Synced ${res.groups_synced} groups, ${res.users_synced} users. Errors: ${res.errors.length}`);
      }
    } catch (e) {
      console.error('[AutoSync] Error during background sync scheduler check:', e.message);
    }
  }

  // Check every 30 seconds
  autoSyncIntervalId = setInterval(checkAndRun, 30 * 1000);
  // Run initial check immediately (delayed by 5s to let server startup settle)
  setTimeout(checkAndRun, 5000);
  console.log('[AutoSync] Active Directory Background Scheduler started');
}

module.exports = {
  runAdSync,
  startAutoSyncScheduler
};

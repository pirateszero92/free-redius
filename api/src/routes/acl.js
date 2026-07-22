const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');
const { getMacFormats } = require('../utils/mac'); // L-1 FIX: use shared utility

router.use(auth);

// Helper to translate ACL Profile to RADIUS Attributes
function getRadiusAttributesForAcl(profile) {
  const replyAttributes = [];

  switch (profile.acl_type) {
    case 'vlan':
      // Standard VLAN assignment attributes (RFC 3580)
      replyAttributes.push(
        { attribute: 'Tunnel-Type', op: ':=', value: 'VLAN' },
        { attribute: 'Tunnel-Medium-Type', op: ':=', value: 'IEEE-802' },
        { attribute: 'Tunnel-Private-Group-Id', op: ':=', value: String(profile.value) }
      );
      break;
    case 'privilege':
      if (profile.vendor === 'cisco') {
        replyAttributes.push({ attribute: 'Cisco-AVPair', op: ':=', value: `shell:priv-lvl=${profile.value}` });
      }
      break;
    case 'role':
      if (profile.vendor === 'aruba') {
        replyAttributes.push({ attribute: 'Aruba-User-Role', op: ':=', value: String(profile.value) });
      }
      break;
    case 'filter_id':
      replyAttributes.push({ attribute: 'Filter-Id', op: ':=', value: String(profile.value) });
      break;
  }
  return replyAttributes;
}

// GET /api/acl
router.get('/', async (req, res) => {
  try {
    const list = await db('acl_profiles').orderBy('name');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list ACL profiles' });
  }
});

// GET /api/acl/:id
router.get('/:id', async (req, res) => {
  try {
    const profile = await db('acl_profiles').where({ id: req.params.id }).first();
    if (!profile) return res.status(404).json({ error: 'ACL profile not found' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get ACL profile' });
  }
});

// POST /api/acl
router.post('/', async (req, res) => {
  try {
    const { name, description, vendor, acl_type, value } = req.body;
    if (!name || !vendor || !acl_type || !value) {
      return res.status(400).json({ error: 'name, vendor, acl_type, and value are required' });
    }

    const existing = await db('acl_profiles').where({ name }).first();
    if (existing) return res.status(409).json({ error: 'ACL profile name already exists' });

    const [id] = await db('acl_profiles').insert({
      name, description: description || '',
      vendor, acl_type, value,
      created_at: new Date(), updated_at: new Date()
    }).returning('id');

    res.status(201).json({ message: 'ACL profile created', id });
  } catch (err) {
    console.error('[acl/create]', err);
    res.status(500).json({ error: 'Failed to create ACL profile' });
  }
});

// PUT /api/acl/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, description, vendor, acl_type, value } = req.body;
    const profile = await db('acl_profiles').where({ id: req.params.id }).first();
    if (!profile) return res.status(404).json({ error: 'ACL profile not found' });

    // Check duplicate name
    if (name && name !== profile.name) {
      const existing = await db('acl_profiles').where({ name }).first();
      if (existing) return res.status(409).json({ error: 'ACL profile name already exists' });
    }

    const updates = {
      name: name || profile.name,
      description: description !== undefined ? description : profile.description,
      vendor: vendor || profile.vendor,
      acl_type: acl_type || profile.acl_type,
      value: value || profile.value,
      updated_at: new Date()
    };

    await db('acl_profiles').where({ id: req.params.id }).update(updates);

    // Dynamic update: update radreply and radgroupreply for all users/groups/devices using this profile
    const updatedProfile = { id: req.params.id, ...updates };
    const newAttrs = getRadiusAttributesForAcl(updatedProfile);

    const users = await db('user_profiles').where({ acl_profile_id: req.params.id });
    const groups = await db('group_profiles').where({ acl_profile_id: req.params.id });
    const devices = await db('device_registry').where({ acl_profile_id: req.params.id });

    const ACL_ATTRS = ['Tunnel-Type', 'Tunnel-Medium-Type', 'Tunnel-Private-Group-Id', 'Cisco-AVPair', 'Aruba-User-Role', 'Filter-Id'];

    // Single transaction with bulk operations to eliminate N+1 performance bottleneck
    await db.transaction(async trx => {
      // 1. Bulk update user radreply
      if (users.length > 0) {
        const usernames = users.map(u => u.username);
        await trx('radreply')
          .whereIn('username', usernames)
          .whereIn('attribute', ACL_ATTRS)
          .delete();

        if (newAttrs.length > 0) {
          const userRows = [];
          for (const username of usernames) {
            for (const attr of newAttrs) {
              userRows.push({
                username,
                attribute: attr.attribute,
                op: attr.op,
                value: attr.value
              });
            }
          }
          await trx('radreply').insert(userRows);
        }
      }

      // 2. Bulk update device radreply
      if (devices.length > 0) {
        const deviceFormats = devices.flatMap(d => getMacFormats(d.mac_address));
        await trx('radreply')
          .whereIn('username', deviceFormats)
          .whereIn('attribute', ACL_ATTRS)
          .delete();

        if (newAttrs.length > 0) {
          const deviceRows = [];
          for (const format of deviceFormats) {
            for (const attr of newAttrs) {
              deviceRows.push({
                username: format,
                attribute: attr.attribute,
                op: attr.op,
                value: attr.value
              });
            }
          }
          await trx('radreply').insert(deviceRows);
        }
      }

      // 3. Bulk update group radgroupreply
      if (groups.length > 0) {
        const groupnames = groups.map(g => g.groupname);
        await trx('radgroupreply')
          .whereIn('groupname', groupnames)
          .whereIn('attribute', ACL_ATTRS)
          .delete();

        if (newAttrs.length > 0) {
          const groupRows = [];
          for (const groupname of groupnames) {
            for (const attr of newAttrs) {
              groupRows.push({
                groupname,
                attribute: attr.attribute,
                op: attr.op,
                value: attr.value
              });
            }
          }
          await trx('radgroupreply').insert(groupRows);
        }

        // Ensure Fall-Through := Yes for each group
        for (const g of groups) {
          const hasFallthrough = await trx('radgroupreply')
            .where({ groupname: g.groupname, attribute: 'Fall-Through' })
            .first();
          if (!hasFallthrough) {
            await trx('radgroupreply').insert({
              groupname: g.groupname,
              attribute: 'Fall-Through',
              op: ':=',
              value: 'Yes'
            });
          }
        }
      }
    });

    res.json({ message: 'ACL profile updated' });
  } catch (err) {
    console.error('[acl/update]', err);
    res.status(500).json({ error: 'Failed to update ACL profile' });
  }
});

// DELETE /api/acl/:id
router.delete('/:id', async (req, res) => {
  try {
    const profile = await db('acl_profiles').where({ id: req.params.id }).first();
    if (!profile) return res.status(404).json({ error: 'ACL profile not found' });

    const ACL_ATTRS = ['Tunnel-Type', 'Tunnel-Medium-Type', 'Tunnel-Private-Group-Id', 'Cisco-AVPair', 'Aruba-User-Role', 'Filter-Id'];

    // M-6 FIX: Wrap all cleanup and deletion in a single transaction for atomicity
    await db.transaction(async trx => {
      // Clean up radreply for users
      const users = await trx('user_profiles').where({ acl_profile_id: req.params.id });
      for (const u of users) {
        await trx('radreply')
          .where({ username: u.username })
          .whereIn('attribute', ACL_ATTRS)
          .delete();
      }

      // Clean up radreply for devices
      const devices = await trx('device_registry').where({ acl_profile_id: req.params.id });
      for (const d of devices) {
        const formats = getMacFormats(d.mac_address);
        await trx('radreply')
          .whereIn('username', formats)
          .whereIn('attribute', ACL_ATTRS)
          .delete();
      }

      // Clean up radgroupreply for groups
      const groups = await trx('group_profiles').where({ acl_profile_id: req.params.id });
      for (const g of groups) {
        await trx('radgroupreply')
          .where({ groupname: g.groupname })
          .whereIn('attribute', ACL_ATTRS)
          .delete();
      }

      await trx('acl_profiles').where({ id: req.params.id }).delete();
    });

    res.json({ message: 'ACL profile deleted and associated RADIUS attributes cleared' });
  } catch (err) {
    console.error('[acl/delete]', err);
    res.status(500).json({ error: 'Failed to delete ACL profile' });
  }
});

module.exports = router;
module.exports.getRadiusAttributesForAcl = getRadiusAttributesForAcl;

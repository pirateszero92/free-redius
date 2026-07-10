const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');

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

    // Dynamic update: update radreply and radgroupreply for all users/groups using this profile
    const updatedProfile = { id: req.params.id, ...updates };
    const newAttrs = getRadiusAttributesForAcl(updatedProfile);

    const users = await db('user_profiles').where({ acl_profile_id: req.params.id });
    const groups = await db('group_profiles').where({ acl_profile_id: req.params.id });

    // Single transaction covers all users AND groups — no partial updates
    await db.transaction(async trx => {
      for (const u of users) {
        await trx('radreply')
          .where({ username: u.username })
          .whereIn('attribute', ['Tunnel-Type', 'Tunnel-Medium-Type', 'Tunnel-Private-Group-Id', 'Cisco-AVPair', 'Aruba-User-Role', 'Filter-Id'])
          .delete();
        for (const attr of newAttrs) {
          await trx('radreply').insert({
            username: u.username,
            attribute: attr.attribute,
            op: attr.op,
            value: attr.value
          });
        }
      }

      for (const g of groups) {
        await trx('radgroupreply')
          .where({ groupname: g.groupname })
          .whereIn('attribute', ['Tunnel-Type', 'Tunnel-Medium-Type', 'Tunnel-Private-Group-Id', 'Cisco-AVPair', 'Aruba-User-Role', 'Filter-Id'])
          .delete();
        for (const attr of newAttrs) {
          await trx('radgroupreply').insert({
            groupname: g.groupname,
            attribute: attr.attribute,
            op: attr.op,
            value: attr.value
          });
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

    // Clean up radreply for users
    const users = await db('user_profiles').where({ acl_profile_id: req.params.id });
    for (const u of users) {
      await db('radreply')
        .where({ username: u.username })
        .whereIn('attribute', ['Tunnel-Type', 'Tunnel-Medium-Type', 'Tunnel-Private-Group-Id', 'Cisco-AVPair', 'Aruba-User-Role', 'Filter-Id'])
        .delete();
    }

    // Clean up radgroupreply for groups
    const groups = await db('group_profiles').where({ acl_profile_id: req.params.id });
    for (const g of groups) {
      await db('radgroupreply')
        .where({ groupname: g.groupname })
        .whereIn('attribute', ['Tunnel-Type', 'Tunnel-Medium-Type', 'Tunnel-Private-Group-Id', 'Cisco-AVPair', 'Aruba-User-Role', 'Filter-Id'])
        .delete();
    }

    await db('acl_profiles').where({ id: req.params.id }).delete();
    res.json({ message: 'ACL profile deleted and associated RADIUS attributes cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete ACL profile' });
  }
});

module.exports = router;
module.exports.getRadiusAttributesForAcl = getRadiusAttributesForAcl;

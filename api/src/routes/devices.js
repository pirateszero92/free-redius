const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');
const { getRadiusAttributesForAcl } = require('./acl');

router.use(auth);

// Helper to validate and format MAC
function normalizeMac(mac) {
  const clean = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (clean.length !== 12) throw new Error('Invalid MAC address. Must be 12 hex characters.');
  return clean.match(/.{1,2}/g).join(':'); // Standard format: aa:bb:cc:dd:ee:ff
}

// Generates 6 formats for maximum compatibility with all APs/Switches
function getMacFormats(mac) {
  const clean = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  const f1 = clean;
  const f2 = clean.match(/.{1,2}/g).join(':');
  const f3 = clean.match(/.{1,2}/g).join('-');
  return [
    f1, f2, f3,
    f1.toUpperCase(), f2.toUpperCase(), f3.toUpperCase()
  ];
}

// GET /api/devices
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let query = db('device_registry as d');
    if (search) {
      query = query.where(function() {
        this.where('d.mac_address', 'ilike', `%${search}%`)
            .orWhere('d.name', 'ilike', `%${search}%`)
            .orWhere('d.description', 'ilike', `%${search}%`);
      });
    }

    const total = await query.clone().count('d.id as count').first();
    const devices = await query
      .leftJoin('acl_profiles as a', 'd.acl_profile_id', 'a.id')
      .select('d.*', 'a.name as acl_profile_name')
      .orderBy('d.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    res.json({
      data: devices,
      total: parseInt(total.count),
      page, limit,
      pages: Math.ceil(parseInt(total.count) / limit)
    });
  } catch (err) {
    console.error('[devices/list]', err);
    res.status(500).json({ error: 'Failed to list devices' });
  }
});

// POST /api/devices
router.post('/', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { mac_address, name, description, acl_profile_id } = req.body;
    if (!mac_address || !name) return res.status(400).json({ error: 'MAC address and name are required' });

    let standardMac;
    try {
      standardMac = normalizeMac(mac_address);
    } catch (err) {
      await trx.rollback();
      return res.status(400).json({ error: err.message });
    }

    const existing = await trx('device_registry').where({ mac_address: standardMac }).first();
    if (existing) {
      await trx.rollback();
      return res.status(409).json({ error: 'Device already registered' });
    }

    // Insert registry
    const [newDevice] = await trx('device_registry').insert({
      mac_address: standardMac,
      name,
      description: description || '',
      acl_profile_id: acl_profile_id || null,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('*');

    // Fetch ACL Attributes if set
    let aclAttrs = [];
    if (acl_profile_id) {
      const aclProfile = await trx('acl_profiles').where({ id: acl_profile_id }).first();
      if (aclProfile) {
        aclAttrs = getRadiusAttributesForAcl(aclProfile);
      }
    }

    // Write formats to radcheck and radreply
    const formats = getMacFormats(standardMac);
    for (const format of formats) {
      // radcheck: username = format, Cleartext-Password := format
      await trx('radcheck').insert({
        username: format,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: format
      });

      // radreply: username = format, assign ACL reply attributes
      for (const attr of aclAttrs) {
        await trx('radreply').insert({
          username: format,
          attribute: attr.attribute,
          op: attr.op,
          value: attr.value
        });
      }
    }

    await trx.commit();
    res.status(201).json({ message: 'Device registered successfully', data: newDevice });
  } catch (err) {
    await trx.rollback();
    console.error('[devices/create]', err);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// PUT /api/devices/:id
router.put('/:id', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { id } = req.params;
    const { mac_address, name, description, acl_profile_id } = req.body;

    const device = await trx('device_registry').where({ id }).first();
    if (!device) {
      await trx.rollback();
      return res.status(404).json({ error: 'Device not found' });
    }

    let standardMac = device.mac_address;
    if (mac_address && mac_address !== device.mac_address) {
      try {
        standardMac = normalizeMac(mac_address);
      } catch (err) {
        await trx.rollback();
        return res.status(400).json({ error: err.message });
      }
      const duplicate = await trx('device_registry').where({ mac_address: standardMac }).whereNot({ id }).first();
      if (duplicate) {
        await trx.rollback();
        return res.status(409).json({ error: 'Device MAC address already registered' });
      }
    }

    // Clean up old formats from radcheck and radreply
    const oldFormats = getMacFormats(device.mac_address);
    await trx('radcheck').whereIn('username', oldFormats).delete();
    await trx('radreply').whereIn('username', oldFormats).delete();

    // Update registry
    const updates = {
      mac_address: standardMac,
      name: name !== undefined ? name : device.name,
      description: description !== undefined ? description : device.description,
      acl_profile_id: acl_profile_id !== undefined ? acl_profile_id : device.acl_profile_id,
      updated_at: new Date()
    };
    await trx('device_registry').where({ id }).update(updates);

    // Fetch ACL Attributes if set
    let aclAttrs = [];
    const targetAclId = acl_profile_id !== undefined ? acl_profile_id : device.acl_profile_id;
    if (targetAclId) {
      const aclProfile = await trx('acl_profiles').where({ id: targetAclId }).first();
      if (aclProfile) {
        aclAttrs = getRadiusAttributesForAcl(aclProfile);
      }
    }

    // Write new formats to radcheck and radreply
    const newFormats = getMacFormats(standardMac);
    for (const format of newFormats) {
      await trx('radcheck').insert({
        username: format,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: format
      });

      for (const attr of aclAttrs) {
        await trx('radreply').insert({
          username: format,
          attribute: attr.attribute,
          op: attr.op,
          value: attr.value
        });
      }
    }

    await trx.commit();
    res.json({ message: 'Device updated successfully' });
  } catch (err) {
    await trx.rollback();
    console.error('[devices/update]', err);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// DELETE /api/devices/:id
router.delete('/:id', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { id } = req.params;
    const device = await trx('device_registry').where({ id }).first();
    if (!device) {
      await trx.rollback();
      return res.status(404).json({ error: 'Device not found' });
    }

    // Clean up formats
    const formats = getMacFormats(device.mac_address);
    await trx('radcheck').whereIn('username', formats).delete();
    await trx('radreply').whereIn('username', formats).delete();

    // Delete from registry
    await trx('device_registry').where({ id }).delete();

    await trx.commit();
    res.json({ message: 'Device deleted successfully' });
  } catch (err) {
    await trx.rollback();
    console.error('[devices/delete]', err);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

module.exports = router;
module.exports.getMacFormats = getMacFormats;

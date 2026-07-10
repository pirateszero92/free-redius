const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');
const { getRadiusAttributesForAcl } = require('./acl');

// All routes require auth
router.use(auth);

// GET /api/users?page=1&limit=20&search=
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let query = db('user_profiles');
    if (search) {
      query = query.where(function () {
        this.where('user_profiles.username', 'ilike', `%${search}%`)
          .orWhere('user_profiles.full_name', 'ilike', `%${search}%`)
          .orWhere('user_profiles.email', 'ilike', `%${search}%`)
          .orWhere('user_profiles.department', 'ilike', `%${search}%`);
      });
    }

    const total = await query.clone().count('user_profiles.id as count').first();
    const users = await query
      .leftJoin('acl_profiles', 'user_profiles.acl_profile_id', 'acl_profiles.id')
      .select('user_profiles.*', 'acl_profiles.name as acl_profile_name')
      .orderBy('user_profiles.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Get group memberships
    const usernames = users.map(u => u.username);
    const groups = usernames.length
      ? await db('radusergroup').whereIn('username', usernames)
      : [];

    const groupMap = {};
    groups.forEach(g => {
      if (!groupMap[g.username]) groupMap[g.username] = [];
      groupMap[g.username].push(g.groupname);
    });

    const result = users.map(u => ({
      ...u,
      groups: groupMap[u.username] || []
    }));

    res.json({
      data: result,
      total: parseInt(total.count),
      page,
      limit,
      pages: Math.ceil(parseInt(total.count) / limit)
    });
  } catch (err) {
    console.error('[users/list]', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /api/users/:username
router.get('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const profile = await db('user_profiles')
      .leftJoin('acl_profiles', 'user_profiles.acl_profile_id', 'acl_profiles.id')
      .select('user_profiles.*', 'acl_profiles.name as acl_profile_name')
      .where({ 'user_profiles.username': username })
      .first();
    if (!profile) return res.status(404).json({ error: 'User not found' });

    const radcheck = await db('radcheck').where({ username });
    const radreply = await db('radreply').where({ username });
    const groups = await db('radusergroup').where({ username });

    res.json({ ...profile, radcheck, radreply, groups });
  } catch (err) {
    console.error('[users/get]', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { username, password, full_name, email, phone, department, groups = [], attributes = [], acl_profile_id = null } = req.body;

    if (!username) return res.status(400).json({ error: 'username is required' });

    // Check duplicate
    const existing = await trx('user_profiles').where({ username }).first();
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    // Create profile
    await trx('user_profiles').insert({
      username,
      full_name: full_name || '',
      email: email || '',
      phone: phone || '',
      department: department || '',
      is_active: true,
      source: 'local',
      acl_profile_id: acl_profile_id || null,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Create radcheck for password (Cleartext-Password)
    if (password) {
      await trx('radcheck').insert({
        username,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: password
      });
    }

    // Additional check attributes
    for (const attr of attributes) {
      await trx('radcheck').insert({
        username,
        attribute: attr.attribute,
        op: attr.op || ':=',
        value: attr.value
      });
    }

    // Add ACL attributes to radreply if profile is selected
    if (acl_profile_id) {
      const aclProfile = await trx('acl_profiles').where({ id: acl_profile_id }).first();
      if (aclProfile) {
        const aclAttrs = getRadiusAttributesForAcl(aclProfile);
        for (const attr of aclAttrs) {
          await trx('radreply').insert({
            username,
            attribute: attr.attribute,
            op: attr.op,
            value: attr.value
          });
        }
      }
    }

    // Assign groups
    for (const groupname of groups) {
      await trx('radusergroup').insert({ username, groupname, priority: 1 });
    }

    await trx.commit();
    res.status(201).json({ message: 'User created', username });
  } catch (err) {
    await trx.rollback();
    console.error('[users/create]', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:username
router.put('/:username', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { username } = req.params;
    const { password, full_name, email, phone, department, is_active, groups, attributes, acl_profile_id } = req.body;

    const profile = await trx('user_profiles').where({ username }).first();
    if (!profile) return res.status(404).json({ error: 'User not found' });

    // Update profile
    const profileUpdates = {
      full_name: full_name !== undefined ? full_name : profile.full_name,
      email: email !== undefined ? email : profile.email,
      phone: phone !== undefined ? phone : profile.phone,
      department: department !== undefined ? department : profile.department,
      is_active: is_active !== undefined ? is_active : profile.is_active,
      updated_at: new Date()
    };
    if (acl_profile_id !== undefined) {
      profileUpdates.acl_profile_id = acl_profile_id || null;
    }
    await trx('user_profiles').where({ username }).update(profileUpdates);

    // Update password
    if (password) {
      await trx('radcheck')
        .where({ username, attribute: 'Cleartext-Password' })
        .delete();
      await trx('radcheck').insert({
        username,
        attribute: 'Cleartext-Password',
        op: ':=',
        value: password
      });
    }

    // Update ACL attributes in radreply
    if (acl_profile_id !== undefined) {
      await trx('radreply')
        .where({ username })
        .whereIn('attribute', ['Tunnel-Type', 'Tunnel-Medium-Type', 'Tunnel-Private-Group-Id', 'Cisco-AVPair', 'Aruba-User-Role', 'Filter-Id'])
        .delete();

      if (acl_profile_id) {
        const aclProfile = await trx('acl_profiles').where({ id: acl_profile_id }).first();
        if (aclProfile) {
          const aclAttrs = getRadiusAttributesForAcl(aclProfile);
          for (const attr of aclAttrs) {
            await trx('radreply').insert({
              username,
              attribute: attr.attribute,
              op: attr.op,
              value: attr.value
            });
          }
        }
      }
    }

    // Update groups
    if (groups !== undefined) {
      await trx('radusergroup').where({ username }).delete();
      for (const groupname of groups) {
        await trx('radusergroup').insert({ username, groupname, priority: 1 });
      }
    }

    await trx.commit();
    res.json({ message: 'User updated', username });
  } catch (err) {
    await trx.rollback();
    console.error('[users/update]', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:username
router.delete('/:username', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { username } = req.params;
    // Verify user exists before deleting
    const profile = await trx('user_profiles').where({ username }).first();
    if (!profile) {
      await trx.rollback();
      return res.status(404).json({ error: 'User not found' });
    }
    await trx('radusergroup').where({ username }).delete();
    await trx('radcheck').where({ username }).delete();
    await trx('radreply').where({ username }).delete();
    await trx('user_profiles').where({ username }).delete();
    await trx.commit();
    res.json({ message: 'User deleted' });
  } catch (err) {
    await trx.rollback();
    console.error('[users/delete]', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');
const { getRadiusAttributesForAcl } = require('./acl');

router.use(auth);

// GET /api/groups
router.get('/', async (req, res) => {
  try {
    const search = req.query.search || '';
    let query = db('group_profiles');
    if (search) {
      query = query.where('group_profiles.groupname', 'ilike', `%${search}%`);
    }
    const groups = await query
      .leftJoin('acl_profiles', 'group_profiles.acl_profile_id', 'acl_profiles.id')
      .select('group_profiles.*', 'acl_profiles.name as acl_profile_name')
      .orderBy('group_profiles.groupname');

    // Get member counts
    const groupnames = groups.map(g => g.groupname);
    const counts = groupnames.length
      ? await db('radusergroup')
          .whereIn('groupname', groupnames)
          .groupBy('groupname')
          .select('groupname', db.raw('count(*) as member_count'))
      : [];

    const countMap = {};
    counts.forEach(c => { countMap[c.groupname] = parseInt(c.member_count); });

    res.json(groups.map(g => ({
      ...g,
      member_count: countMap[g.groupname] || 0
    })));
  } catch (err) {
    console.error('[groups/list]', err);
    res.status(500).json({ error: 'Failed to list groups' });
  }
});

// GET /api/groups/:groupname
router.get('/:groupname', async (req, res) => {
  try {
    const { groupname } = req.params;
    const profile = await db('group_profiles')
      .leftJoin('acl_profiles', 'group_profiles.acl_profile_id', 'acl_profiles.id')
      .select('group_profiles.*', 'acl_profiles.name as acl_profile_name')
      .where({ 'group_profiles.groupname': groupname })
      .first();
    if (!profile) return res.status(404).json({ error: 'Group not found' });

    const check = await db('radgroupcheck').where({ groupname });
    const reply = await db('radgroupreply').where({ groupname });
    const members = await db('radusergroup').where({ groupname });

    res.json({ ...profile, check_attributes: check, reply_attributes: reply, members });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get group' });
  }
});

// POST /api/groups
router.post('/', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { groupname, description, check_attributes = [], reply_attributes = [], acl_profile_id = null } = req.body;
    if (!groupname) return res.status(400).json({ error: 'groupname is required' });

    const existing = await trx('group_profiles').where({ groupname }).first();
    if (existing) return res.status(409).json({ error: 'Group already exists' });

    await trx('group_profiles').insert({
      groupname,
      description: description || '',
      source: 'local',
      acl_profile_id: acl_profile_id || null,
      created_at: new Date(),
      updated_at: new Date()
    });

    for (const attr of check_attributes) {
      await trx('radgroupcheck').insert({ groupname, attribute: attr.attribute, op: attr.op || ':=', value: attr.value });
    }
    for (const attr of reply_attributes) {
      await trx('radgroupreply').insert({ groupname, attribute: attr.attribute, op: attr.op || '=', value: attr.value });
    }

    // Add ACL attributes to radgroupreply if profile selected
    if (acl_profile_id) {
      const aclProfile = await trx('acl_profiles').where({ id: acl_profile_id }).first();
      if (aclProfile) {
        const aclAttrs = getRadiusAttributesForAcl(aclProfile);
        for (const attr of aclAttrs) {
          await trx('radgroupreply').insert({
            groupname,
            attribute: attr.attribute,
            op: attr.op,
            value: attr.value
          });
        }
      }
    }

    await trx.commit();
    res.status(201).json({ message: 'Group created', groupname });
  } catch (err) {
    await trx.rollback();
    console.error('[groups/create]', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PUT /api/groups/:groupname
router.put('/:groupname', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { groupname } = req.params;
    const { description, check_attributes, reply_attributes, acl_profile_id } = req.body;

    const groupUpdates = {
      updated_at: new Date()
    };
    if (description !== undefined) groupUpdates.description = description;
    if (acl_profile_id !== undefined) groupUpdates.acl_profile_id = acl_profile_id || null;

    await trx('group_profiles').where({ groupname }).update(groupUpdates);

    if (check_attributes !== undefined) {
      await trx('radgroupcheck').where({ groupname }).delete();
      for (const attr of check_attributes) {
        await trx('radgroupcheck').insert({ groupname, attribute: attr.attribute, op: attr.op || ':=', value: attr.value });
      }
    }

    // Handle replies and ACL replies
    if (reply_attributes !== undefined || acl_profile_id !== undefined) {
      // Fetch normal custom reply attributes (that are not part of ACL profiles)
      // Since ACL attributes are: Tunnel-Type, Tunnel-Medium-Type, Tunnel-Private-Group-Id, Cisco-AVPair, Aruba-User-Role, Filter-Id
      // We delete all and rewrite them
      await trx('radgroupreply').where({ groupname }).delete();

      // Write normal reply attributes back
      const normalReplies = reply_attributes || [];
      for (const attr of normalReplies) {
        await trx('radgroupreply').insert({ groupname, attribute: attr.attribute, op: attr.op || '=', value: attr.value });
      }

      // Write ACL attributes if a profile is set
      const targetAclId = acl_profile_id !== undefined ? acl_profile_id : (await trx('group_profiles').where({ groupname }).first()).acl_profile_id;
      if (targetAclId) {
        const aclProfile = await trx('acl_profiles').where({ id: targetAclId }).first();
        if (aclProfile) {
          const aclAttrs = getRadiusAttributesForAcl(aclProfile);
          for (const attr of aclAttrs) {
            await trx('radgroupreply').insert({
              groupname,
              attribute: attr.attribute,
              op: attr.op,
              value: attr.value
            });
          }
        }
      }
    }

    await trx.commit();
    res.json({ message: 'Group updated', groupname });
  } catch (err) {
    await trx.rollback();
    console.error('[groups/update]', err);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE /api/groups/:groupname
router.delete('/:groupname', async (req, res) => {
  const trx = await db.transaction();
  try {
    const { groupname } = req.params;
    await trx('radgroupcheck').where({ groupname }).delete();
    await trx('radgroupreply').where({ groupname }).delete();
    await trx('radusergroup').where({ groupname }).delete();
    await trx('group_profiles').where({ groupname }).delete();
    await trx.commit();
    res.json({ message: 'Group deleted' });
  } catch (err) {
    await trx.rollback();
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// POST /api/groups/:groupname/members — add user to group
router.post('/:groupname/members', async (req, res) => {
  try {
    const { groupname } = req.params;
    const { username } = req.body;
    const exists = await db('radusergroup').where({ username, groupname }).first();
    if (exists) return res.status(409).json({ error: 'User already in group' });
    await db('radusergroup').insert({ username, groupname, priority: 1 });
    res.json({ message: 'User added to group' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add user to group' });
  }
});

// DELETE /api/groups/:groupname/members/:username
router.delete('/:groupname/members/:username', async (req, res) => {
  try {
    const { groupname, username } = req.params;
    await db('radusergroup').where({ username, groupname }).delete();
    res.json({ message: 'User removed from group' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove user from group' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');
const http = require('http');

router.use(auth);

// Helper to restart FreeRADIUS container when NAS list changes
function restartRadiusContainer() {
  return new Promise((resolve) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path: '/containers/freeradius-server/restart',
      method: 'POST'
    };
    const req = http.request(options, res => {
      resolve(res.statusCode === 204);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

// GET /api/nas
router.get('/', async (req, res) => {
  try {
    const search = req.query.search || '';
    let query = db('nas');
    if (search) {
      query = query.where(function () {
        this.where('nasname', 'ilike', `%${search}%`)
          .orWhere('shortname', 'ilike', `%${search}%`)
          .orWhere('description', 'ilike', `%${search}%`);
      });
    }
    const clients = await query.orderBy('nasname');
    // Mask secret in list view
    res.json(clients.map(c => ({ ...c, secret: '••••••••' })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to list NAS clients' });
  }
});

// GET /api/nas/:id
router.get('/:id', async (req, res) => {
  try {
    const client = await db('nas').where({ id: req.params.id }).first();
    if (!client) return res.status(404).json({ error: 'NAS client not found' });
    // Mask secret — same policy as list endpoint
    res.json({ ...client, secret: '••••••••' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get NAS client' });
  }
});

// POST /api/nas
router.post('/', async (req, res) => {
  try {
    const { nasname, shortname, type, ports, secret, server, community, description } = req.body;
    if (!nasname || !secret) return res.status(400).json({ error: 'nasname and secret are required' });

    const existing = await db('nas').where({ nasname }).first();
    if (existing) return res.status(409).json({ error: 'NAS client already exists' });

    const [id] = await db('nas').insert({
      nasname, shortname, type: type || 'other',
      ports: ports || null, secret,
      server: server || null, community: community || null,
      description: description || 'RADIUS Client',
      created_at: new Date(), updated_at: new Date()
    }).returning('id');

    // Trigger FreeRADIUS reload in the background
    restartRadiusContainer();

    res.status(201).json({ message: 'NAS client created (RADIUS service restarted)' });
  } catch (err) {
    console.error('[nas/create]', err);
    res.status(500).json({ error: 'Failed to create NAS client' });
  }
});

// PUT /api/nas/:id
router.put('/:id', async (req, res) => {
  try {
    const { nasname, shortname, type, ports, secret, server, community, description } = req.body;
    const client = await db('nas').where({ id: req.params.id }).first();
    if (!client) return res.status(404).json({ error: 'NAS client not found' });

    const updates = {
      nasname: nasname || client.nasname,
      shortname: shortname !== undefined ? shortname : client.shortname,
      type: type || client.type,
      ports: ports !== undefined ? ports : client.ports,
      server: server !== undefined ? server : client.server,
      community: community !== undefined ? community : client.community,
      description: description !== undefined ? description : client.description,
      updated_at: new Date()
    };
    if (secret) updates.secret = secret;

    await db('nas').where({ id: req.params.id }).update(updates);

    // Trigger FreeRADIUS reload in the background
    restartRadiusContainer();

    res.json({ message: 'NAS client updated (RADIUS service restarted)' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update NAS client' });
  }
});

// DELETE /api/nas/:id
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await db('nas').where({ id: req.params.id }).delete();
    if (!deleted) return res.status(404).json({ error: 'NAS client not found' });

    // Trigger FreeRADIUS reload in the background
    restartRadiusContainer();

    res.json({ message: 'NAS client deleted (RADIUS service restarted)' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete NAS client' });
  }
});

module.exports = router;

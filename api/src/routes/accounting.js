const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/accounting/sessions?page=&limit=&username=&nas=&status=active|stopped
router.get('/sessions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { username, nas, status } = req.query;

    let query = db('radacct as s')
      .leftJoin('nas', db.raw('HOST(s.nasipaddress)'), '=', 'nas.nasname');

    if (username) query = query.where('s.username', 'ilike', `%${username}%`);
    if (nas) query = query.where(function() {
      this.whereRaw(`s.nasipaddress::text ILIKE ?`, [`%${nas}%`])
        .orWhere('nas.shortname', 'ilike', `%${nas}%`);
    });
    if (status === 'active') query = query.whereNull('s.acctstoptime');
    if (status === 'stopped') query = query.whereNotNull('s.acctstoptime');

    const total = await query.clone().count('s.radacctid as count').first();
    const sessions = await query
      .select(
        's.*',
        'nas.shortname as nas_name',
        db.raw("(SELECT split_part(replace(username, 'host/', ''), '.', 1) FROM radacct WHERE callingstationid = s.callingstationid AND username ILIKE 'host/%' ORDER BY acctstarttime DESC LIMIT 1) as device_name")
      )
      .orderBy('s.acctstarttime', 'desc')
      .limit(limit)
      .offset(offset);

    res.json({
      data: sessions,
      total: parseInt(total.count),
      page, limit,
      pages: Math.ceil(parseInt(total.count) / limit)
    });
  } catch (err) {
    console.error('[accounting/sessions]', err);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// GET /api/accounting/auth-logs?page=&limit=&username=&reply=
router.get('/auth-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { username, reply } = req.query;

    let query = db('radpostauth');
    if (username) query = query.where('username', 'ilike', `%${username}%`);
    if (reply) query = query.where('reply', 'ilike', `%${reply}%`);

    const total = await query.clone().count('id as count').first();
    const logs = await query.orderBy('authdate', 'desc').limit(limit).offset(offset);

    res.json({
      data: logs,
      total: parseInt(total.count),
      page, limit,
      pages: Math.ceil(parseInt(total.count) / limit)
    });
  } catch (err) {
    console.error('[accounting/auth-logs]', err);
    res.status(500).json({ error: 'Failed to get auth logs' });
  }
});

// GET /api/accounting/stats — summary for dashboard
router.get('/stats', async (req, res) => {
  try {
    const [
      totalAccepts,
      totalRejects,
      activeSessions,
      totalSessions
    ] = await Promise.all([
      db('radpostauth').where('reply', 'ilike', '%Access-Accept%').count('id as count').first(),
      db('radpostauth').where('reply', 'ilike', '%Access-Reject%').count('id as count').first(),
      db('radacct').whereNull('acctstoptime').count('radacctid as count').first(),
      db('radacct').count('radacctid as count').first(),
    ]);

    res.json({
      total_accepts: parseInt(totalAccepts.count),
      total_rejects: parseInt(totalRejects.count),
      active_sessions: parseInt(activeSessions.count),
      total_sessions: parseInt(totalSessions.count),
    });
  } catch (err) {
    console.error('[accounting/stats]', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;

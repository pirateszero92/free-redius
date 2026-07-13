const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const [
      totalUsers,
      totalGroups,
      totalNas,
      activeSessions,
      totalAccepts,
      totalRejects,
      adSettings
    ] = await Promise.all([
      db('user_profiles').count('id as count').first(),
      db('group_profiles').count('id as count').first(),
      db('nas').count('id as count').first(),
      db('radacct').whereNull('acctstoptime').count('radacctid as count').first(),
      db('radpostauth').where('reply', 'ilike', '%Access-Accept%').count('id as count').first(),
      db('radpostauth').where('reply', 'ilike', '%Access-Reject%').count('id as count').first(),
      db('ad_settings').where({ id: 1 }).first(),
    ]);

    res.json({
      total_users: parseInt(totalUsers.count),
      total_groups: parseInt(totalGroups.count),
      total_nas: parseInt(totalNas.count),
      active_sessions: parseInt(activeSessions.count),
      total_accepts: parseInt(totalAccepts.count),
      total_rejects: parseInt(totalRejects.count),
      ad_enabled: adSettings ? adSettings.is_enabled : false,
      ad_last_sync: adSettings ? adSettings.last_sync : null,
    });
  } catch (err) {
    console.error('[dashboard/stats]', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// GET /api/dashboard/live-sessions
router.get('/live-sessions', async (req, res) => {
  try {
    const search = req.query.search || '';
    const minutes = Math.min(Math.max(1, parseInt(req.query.minutes) || 5), 1440);

    let query = db('radacct')
      .leftJoin('nas', db.raw('HOST(radacct.nasipaddress)'), '=', 'nas.nasname')
      .select(
        'radacct.*',
        'nas.shortname as nas_name'
      )
      .where(function () {
        this.whereNull('radacct.acctstoptime')
          .orWhere('radacct.acctstoptime', '>=', db.raw(`NOW() - INTERVAL '${minutes} minutes'`));
      });

    if (search) {
      query = query.where(function () {
        this.where('radacct.username', 'ilike', `%${search}%`)
          .orWhere(db.raw('radacct.framedipaddress::text'), 'ilike', `%${search}%`)
          .orWhere(db.raw('radacct.nasipaddress::text'), 'ilike', `%${search}%`)
          .orWhere('nas.shortname', 'ilike', `%${search}%`);
      });
    }

    const sessions = await query
      .orderBy('radacct.acctstarttime', 'desc')
      .limit(50);

    res.json(sessions);
  } catch (err) {
    console.error('[dashboard/live-sessions]', err);
    res.status(500).json({ error: 'Failed to get live sessions' });
  }
});

// GET /api/dashboard/auth-chart — Auth counts per hour (last 24h)
router.get('/auth-chart', async (req, res) => {
  try {
    const rows = await db.raw(`
      SELECT
        date_trunc('hour', authdate) AS hour,
        SUM(CASE WHEN reply ILIKE '%Accept%' THEN 1 ELSE 0 END) AS accepts,
        SUM(CASE WHEN reply ILIKE '%Reject%' THEN 1 ELSE 0 END) AS rejects
      FROM radpostauth
      WHERE authdate >= NOW() - INTERVAL '24 hours'
      GROUP BY hour
      ORDER BY hour
    `);
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get chart data' });
  }
});

// POST /api/dashboard/live-sessions/:radacctid/close — Force-close a live session (stale session management)
router.post('/live-sessions/:radacctid/close', async (req, res) => {
  try {
    const { radacctid } = req.params;
    await db('radacct')
      .where({ radacctid })
      .update({
        acctstoptime: new Date(),
        acctterminatecause: 'Admin-Reset'
      });
    res.json({ success: true, message: 'Session marked as closed' });
  } catch (err) {
    console.error('[dashboard/close-session]', err);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

module.exports = router;

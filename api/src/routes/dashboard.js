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
      .where(function () {
        this.whereNull('acctstoptime')
          .orWhere('acctstoptime', '>=', db.raw(`NOW() - INTERVAL '${minutes} minutes'`));
      });

    if (search) {
      query = query.where(function () {
        this.where('username', 'ilike', `%${search}%`)
          .orWhere(db.raw('framedipaddress::text'), 'ilike', `%${search}%`)
          .orWhere(db.raw('nasipaddress::text'), 'ilike', `%${search}%`);
      });
    }

    const sessions = await query
      .orderBy('acctstarttime', 'desc')
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

module.exports = router;

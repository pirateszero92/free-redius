const express = require('express');
const router = express.Router();
const db = require('../db/knex');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/reports/summary
router.get('/summary', async (req, res) => {
  try {
    const [
      accepts,
      rejects,
      topFailed,
      topCalling,
      topCalled,
      topBandwidth,
      topActiveUsers
    ] = await Promise.all([
      db('radpostauth').where('reply', 'ilike', '%Accept%').count('id as count').first(),
      db('radpostauth').where('reply', 'ilike', '%Reject%').count('id as count').first(),
      
      // Top 5 users with authentication failures
      db('radpostauth')
        .where('reply', 'ilike', '%Reject%')
        .groupBy('username')
        .select('username', db.raw('count(*) as count'))
        .orderBy('count', 'desc')
        .limit(5),

      // Top 5 Calling Station IDs (Device MACs)
      db('radpostauth')
        .groupBy('callingstationid')
        .select('callingstationid', db.raw('count(*) as count'))
        .whereNotNull('callingstationid')
        .whereNot('callingstationid', '')
        .orderBy('count', 'desc')
        .limit(5),

      // Top 5 Called Station IDs (AP BSSIDs / SSIDs)
      db('radpostauth')
        .groupBy('calledstationid')
        .select('calledstationid', db.raw('count(*) as count'))
        .whereNotNull('calledstationid')
        .whereNot('calledstationid', '')
        .orderBy('count', 'desc')
        .limit(5),

      // Top 5 Users by Bandwidth usage (download + upload)
      db('radacct')
        .groupBy('username')
        .select('username')
        .select(db.raw('sum(acctinputoctets) as upload'))
        .select(db.raw('sum(acctoutputoctets) as download'))
        .select(db.raw('sum(acctinputoctets + acctoutputoctets) as total_octets'))
        .orderBy('total_octets', 'desc')
        .limit(5),

      // Top 5 Users by successful auths
      db('radpostauth')
        .where('reply', 'ilike', '%Accept%')
        .groupBy('username')
        .select('username', db.raw('count(*) as count'))
        .orderBy('count', 'desc')
        .limit(5),
    ]);

    res.json({
      auth_ratio: {
        accepts: parseInt(accepts.count) || 0,
        rejects: parseInt(rejects.count) || 0
      },
      top_failed_users: topFailed.map(r => ({ username: r.username, count: parseInt(r.count) })),
      top_calling_stations: topCalling.map(r => ({ mac: r.callingstationid, count: parseInt(r.count) })),
      top_called_stations: topCalled.map(r => ({ id: r.calledstationid, count: parseInt(r.count) })),
      top_bandwidth_users: topBandwidth.map(r => ({
        username: r.username,
        upload: parseInt(r.upload) || 0,
        download: parseInt(r.download) || 0,
        total: parseInt(r.total_octets) || 0
      })),
      top_active_users: topActiveUsers.map(r => ({ username: r.username, count: parseInt(r.count) }))
    });
  } catch (err) {
    console.error('[reports/summary]', err);
    res.status(500).json({ error: 'Failed to generate reports summary' });
  }
});

module.exports = router;

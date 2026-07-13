require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { testConnection } = require('./db/knex');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const groupsRoutes = require('./routes/groups');
const nasRoutes = require('./routes/nas');
const accountingRoutes = require('./routes/accounting');
const settingsRoutes = require('./routes/settings');
const ldapRoutes = require('./routes/ldap');
const dashboardRoutes = require('./routes/dashboard');
const aclRoutes = require('./routes/acl');
const logsRoutes = require('./routes/logs');
const reportsRoutes = require('./routes/reports');
const devicesRoutes = require('./routes/devices');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check (no auth required)
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/nas', nasRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ldap', ldapRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/acl', aclRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/devices', devicesRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Start
app.listen(PORT, async () => {
  console.log(`[API] FreeRADIUS API running on port ${PORT}`);
  // Retry DB connection on startup
  let retries = 10;
  while (retries > 0) {
    try {
      await testConnection();
      console.log('[API] Database connected successfully');
      try {
        const { startAutoSyncScheduler } = require('./utils/adSync');
        startAutoSyncScheduler();
      } catch (adErr) {
        console.error('[API] Failed to start AD auto sync scheduler:', adErr.message);
      }
      break;
    } catch (err) {
      retries--;
      console.log(`[API] DB connection failed, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  // Alter table schema if needed to support AD source admins
  try {
    const db = require('./db/knex');
    const hasSourceCol = await db.schema.hasColumn('admin_users', 'source');
    if (!hasSourceCol) {
      await db.schema.alterTable('admin_users', table => {
        table.string('source', 20).notNullable().defaultTo('local');
      });
      console.log('[API] Added source column to admin_users table');
    }
  } catch (err) {
    console.error('[API] Failed to run schema migrations for admin_users:', err.message);
  }

  // Create device_registry table if not exists
  try {
    const db = require('./db/knex');
    const hasDevicesTable = await db.schema.hasTable('device_registry');
    if (!hasDevicesTable) {
      await db.schema.createTable('device_registry', table => {
        table.increments('id').primary();
        table.string('mac_address', 50).notNullable().unique();
        table.string('name', 128).notNullable();
        table.string('description', 255);
        table.integer('acl_profile_id').unsigned().references('id').inTable('acl_profiles').onDelete('SET NULL');
        table.timestamps(true, true);
      });
      console.log('[API] Created device_registry table');
    }
  } catch (err) {
    console.error('[API] Failed to create device_registry table:', err.message);
  }

  // Seed default admin user if not exists (atomic upsert — safe for concurrent startup)
  try {
    const db = require('./db/knex');
    const bcrypt = require('bcrypt');
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
    const hash = await bcrypt.hash(adminPassword, 10);
    const inserted = await db('admin_users')
      .insert({
        username: adminUsername,
        password: hash,
        full_name: 'Administrator',
        role: 'superadmin',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict('username')
      .ignore();
    // onConflict().ignore() returns rowCount 0 if skipped
    const wasInserted = inserted && inserted.rowCount > 0;
    if (wasInserted) {
      console.log(`[API] Admin user "${adminUsername}" created`);
    } else {
      console.log(`[API] Admin user "${adminUsername}" already exists`);
    }
  } catch (err) {
    console.error('[API] Failed to seed admin user:', err.message);
  }
});

module.exports = app;

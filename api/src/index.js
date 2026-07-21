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
const guestRoutes = require('./routes/guest');

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
app.use('/api/guest', guestRoutes);

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

// Bootstrapping function to run migrations and start the server
async function bootstrap() {
  // Retry DB connection on startup
  let retries = 10;
  let dbConnected = false;
  while (retries > 0) {
    try {
      await testConnection();
      console.log('[API] Database connected successfully');
      dbConnected = true;
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

  if (!dbConnected) {
    console.error('[FATAL] Failed to connect to database after 10 attempts. Exiting...');
    process.exit(1);
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

  // Create guest portal tables if not exists
  try {
    const db = require('./db/knex');
    
    const hasGuestUsersTable = await db.schema.hasTable('guest_users');
    if (!hasGuestUsersTable) {
      await db.schema.createTable('guest_users', table => {
        table.increments('id').primary();
        table.string('mac_address', 20).notNullable();
        table.string('provider', 50).notNullable();
        table.string('social_id', 255).notNullable();
        table.string('email', 255);
        table.string('name', 255);
        table.timestamps(true, true);
      });
      console.log('[API] Created guest_users table');
    }

    const hasGuestSessionsTable = await db.schema.hasTable('guest_sessions');
    if (!hasGuestSessionsTable) {
      await db.schema.createTable('guest_sessions', table => {
        table.increments('id').primary();
        table.string('mac_address', 20).notNullable();
        table.string('ap_mac', 20);
        table.string('ssid', 128);
        table.timestamp('authorized_at').defaultTo(db.fn.now());
        table.timestamp('expires_at').notNullable();
      });
      console.log('[API] Created guest_sessions table');
    }

    const hasGuestSettingsTable = await db.schema.hasTable('guest_settings');
    if (!hasGuestSettingsTable) {
      await db.schema.createTable('guest_settings', table => {
        table.increments('id').primary();
        table.string('unifi_url', 255);
        table.string('unifi_username', 128);
        table.string('unifi_password', 255);
        table.string('unifi_site', 128).defaultTo('default');
        table.boolean('unifi_verify_ssl').defaultTo(false);
        table.integer('session_duration_mins').defaultTo(120);
        table.string('google_client_id', 255);
        table.string('google_client_secret', 255);
        table.boolean('google_enabled').defaultTo(false);
        table.string('github_client_id', 255);
        table.string('github_client_secret', 255);
        table.boolean('github_enabled').defaultTo(false);
        table.string('line_client_id', 255);
        table.string('line_client_secret', 255);
        table.boolean('line_enabled').defaultTo(false);
        table.timestamps(true, true);
      });
      console.log('[API] Created guest_settings table');

      // Seed default settings row
      await db('guest_settings').insert({
        id: 1,
        unifi_site: 'default',
        unifi_verify_ssl: false,
        session_duration_mins: 120,
        google_enabled: false,
        github_enabled: false,
        line_enabled: false
      });
      console.log('[API] Seeded default guest_settings row');
    }
  } catch (err) {
    console.error('[API] Failed to run guest portal schema migrations:', err.message);
  }

  // Seed default admin user if not exists (atomic upsert — safe for concurrent startup)
  try {
    const db = require('./db/knex');
    const bcrypt = require('bcrypt');
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';

    // H-7 startup warning check
    if (adminPassword === 'Admin@1234') {
      console.warn('[WARNING] API is using the default ADMIN_PASSWORD! Please change it immediately.');
    }
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.includes('change_this')) {
      console.warn('[WARNING] API is using the default JWT_SECRET! Please configure a secure JWT_SECRET in production.');
    }

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

  // Start Express app listening
  app.listen(PORT, () => {
    console.log(`[API] FreeRADIUS API running on port ${PORT}`);
  });
}

bootstrap();

module.exports = app;

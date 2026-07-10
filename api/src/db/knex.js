const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'radius',
    user: process.env.POSTGRES_USER || 'radius',
    password: process.env.POSTGRES_PASSWORD || 'radius_secret',
  },
  pool: {
    min: 0,
    max: 10,
    acquireTimeoutMillis: 30000,
    createTimeoutMillis: 30000,
    idleTimeoutMillis: 600000,
  },
  acquireConnectionTimeout: 60000,
});

async function testConnection() {
  await knex.raw('SELECT 1');
}

module.exports = knex;
module.exports.testConnection = testConnection;

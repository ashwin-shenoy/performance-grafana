/**
 * PostgreSQL Database Configuration
 * Uses Knex.js query builder for migrations and queries
 */
'use strict';

const knex = require('knex');
const logger = require('../utils/logger');

let db;

const config = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'postgresql',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'perfplatform',
    password: process.env.DB_PASSWORD || 'changeme',
    database: process.env.DB_NAME || 'perfplatform',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
};

async function initDatabase() {
  db = knex(config);

  // Verify connectivity
  await db.raw('SELECT 1');
  logger.info('PostgreSQL connection verified');

  // Run pending migrations
  const [batch, migrations] = await db.migrate.latest();
  if (migrations.length > 0) {
    logger.info(`Ran ${migrations.length} migrations (batch ${batch})`);
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

module.exports = { initDatabase, getDb };

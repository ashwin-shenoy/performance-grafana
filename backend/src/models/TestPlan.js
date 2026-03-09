/**
 * TestPlan Model — Represents a JMeter test plan (.jmx)
 * Stores metadata, configuration, and file reference
 */
'use strict';

const { getDb } = require('../config/database');

const TABLE = 'test_plans';

const TestPlan = {
  async create({ name, description, jmxFileName, jmxContent, createdBy, environmentId, config, team, service, scenario }) {
    const db = getDb();
    const [row] = await db(TABLE)
      .insert({
        name,
        description,
        jmx_file_name:  jmxFileName,
        jmx_content:    jmxContent,
        created_by:     createdBy,
        environment_id: environmentId || null,
        config:         JSON.stringify(config || {}),
        team:           team     || 'default',
        service:        service  || 'unknown',
        scenario:       scenario || 'stress',
      })
      .returning('*');
    return row;
  },

  async findById(id) {
    const db = getDb();
    return db(TABLE).where({ id }).first();
  },

  async findAll({ page = 1, limit = 20, search, environmentId, team, service, scenario }) {
    const db = getDb();
    let query = db(TABLE).orderBy('created_at', 'desc');
    if (search)        query = query.where('name', 'ilike', `%${search}%`);
    if (environmentId) query = query.where('environment_id', environmentId);
    if (team)          query = query.where('team', team);
    if (service)       query = query.where('service', service);
    if (scenario)      query = query.where('scenario', scenario);
    const offset = (page - 1) * limit;
    const [{ count }] = await query.clone().clearOrder().count('* as count');
    const rows = await query.offset(offset).limit(limit);
    return { data: rows, total: parseInt(count, 10), page, limit };
  },

  async update(id, fields) {
    const db = getDb();
    // Added team, service, scenario to the allowed update fields
    const allowedFields = ['name', 'description', 'config', 'environment_id', 'team', 'service', 'scenario'];
    const updateData = {};
    for (const f of allowedFields) {
      if (fields[f] !== undefined) {
        updateData[f] = f === 'config' ? JSON.stringify(fields[f]) : fields[f];
      }
    }
    updateData.updated_at = db.fn.now();
    const [row] = await db(TABLE).where({ id }).update(updateData).returning('*');
    return row;
  },

  /** Get all executions for a specific test plan */
  async findExecutions(id, { page = 1, limit = 20 } = {}) {
    const db = getDb();
    const offset = (page - 1) * limit;
    const [{ count }] = await db('test_executions').where('test_plan_id', id).count('id as count');
    const rows = await db('test_executions')
      .where('test_plan_id', id)
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
    return { data: rows, total: parseInt(count, 10), page, limit };
  },

  async delete(id) {
    const db = getDb();
    return db(TABLE).where({ id }).del();
  },
};

module.exports = TestPlan;

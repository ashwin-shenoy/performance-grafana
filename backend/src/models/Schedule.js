/**
 * Schedule Model — Cron-based test scheduling
 * Supports recurring tests with configurable parameters
 */
'use strict';

const { getDb } = require('../config/database');

const TABLE = 'test_schedules';

const Schedule = {
  async create({ testPlanId, cronExpression, workerCount, parameters, createdBy, environmentId, enabled }) {
    const db = getDb();
    const [row] = await db(TABLE)
      .insert({
        test_plan_id: testPlanId,
        cron_expression: cronExpression,
        worker_count: workerCount || 1,
        parameters: JSON.stringify(parameters || {}),
        created_by: createdBy,
        environment_id: environmentId,
        enabled: enabled !== false,
      })
      .returning('*');
    return row;
  },

  async findById(id) {
    const db = getDb();
    return db(TABLE)
      .select('test_schedules.*', 'test_plans.name as test_plan_name')
      .leftJoin('test_plans', 'test_schedules.test_plan_id', 'test_plans.id')
      .where('test_schedules.id', id)
      .first();
  },

  async findAll() {
    const db = getDb();
    return db(TABLE)
      .select('test_schedules.*', 'test_plans.name as test_plan_name')
      .leftJoin('test_plans', 'test_schedules.test_plan_id', 'test_plans.id')
      .orderBy('test_schedules.created_at', 'desc');
  },

  async findEnabled() {
    const db = getDb();
    return db(TABLE)
      .select('test_schedules.*', 'test_plans.name as test_plan_name')
      .leftJoin('test_plans', 'test_schedules.test_plan_id', 'test_plans.id')
      .where('test_schedules.enabled', true);
  },

  async update(id, fields) {
    const db = getDb();
    const updateData = { updated_at: db.fn.now() };
    const allowed = ['cron_expression', 'worker_count', 'parameters', 'enabled', 'environment_id'];
    for (const f of allowed) {
      if (fields[f] !== undefined) {
        updateData[f] = f === 'parameters' ? JSON.stringify(fields[f]) : fields[f];
      }
    }
    const [row] = await db(TABLE).where({ id }).update(updateData).returning('*');
    return row;
  },

  async updateLastRun(id) {
    const db = getDb();
    await db(TABLE).where({ id }).update({ last_run_at: db.fn.now() });
  },

  async delete(id) {
    const db = getDb();
    return db(TABLE).where({ id }).del();
  },
};

module.exports = Schedule;

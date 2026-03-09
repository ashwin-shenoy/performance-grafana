/**
 * Initial database migration — Creates all tables
 */
'use strict';

exports.up = async function(knex) {
  // Environments
  await knex.schema.createTableIfNotExists('environments', (t) => {
    t.increments('id').primary();
    t.string('name', 100).notNullable().unique();
    t.text('description').defaultTo('');
    t.string('base_url', 500).defaultTo('');
    t.string('namespace', 100).defaultTo('perf-testing');
    t.timestamps(true, true);
  });

  // Seed environments (only if empty)
  const existing = await knex('environments').count('id as cnt').first();
  if (parseInt(existing.cnt, 10) === 0) {
    await knex('environments').insert([
      { name: 'development', description: 'Development environment', base_url: 'https://dev.example.com', namespace: 'perf-dev' },
      { name: 'staging', description: 'Staging / Pre-production', base_url: 'https://staging.example.com', namespace: 'perf-staging' },
      { name: 'production', description: 'Production environment', base_url: 'https://example.com', namespace: 'perf-prod' },
    ]);
  }

  // Test Plans
  await knex.schema.createTableIfNotExists('test_plans', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.text('description').defaultTo('');
    t.string('jmx_file_name', 255).notNullable();
    t.text('jmx_content').notNullable();
    t.string('created_by', 100).defaultTo('anonymous');
    t.integer('environment_id').references('id').inTable('environments').onDelete('SET NULL');
    t.jsonb('config').defaultTo('{}');
    t.timestamps(true, true);
    t.index('name');
    t.index('environment_id');
  });

  // Test Executions
  await knex.schema.createTableIfNotExists('test_executions', (t) => {
    t.increments('id').primary();
    t.integer('test_plan_id').notNullable().references('id').inTable('test_plans').onDelete('CASCADE');
    t.string('status', 20).notNullable().defaultTo('PENDING');
    t.string('triggered_by', 100).defaultTo('api');
    t.integer('worker_count').defaultTo(1);
    t.jsonb('parameters').defaultTo('{}');
    t.integer('environment_id').references('id').inTable('environments').onDelete('SET NULL');
    t.string('controller_job_name', 100);
    t.string('worker_job_name', 100);
    t.string('kube_namespace', 100);
    t.string('jtl_path', 500);
    t.string('report_path', 500);
    t.jsonb('summary').defaultTo('{}');
    t.text('error_message');
    t.timestamp('started_at');
    t.timestamp('finished_at');
    t.timestamps(true, true);
    t.index('status');
    t.index('test_plan_id');
    t.index('environment_id');
  });

  // Test Schedules
  await knex.schema.createTableIfNotExists('test_schedules', (t) => {
    t.increments('id').primary();
    t.integer('test_plan_id').notNullable().references('id').inTable('test_plans').onDelete('CASCADE');
    t.string('cron_expression', 100).notNullable();
    t.integer('worker_count').defaultTo(1);
    t.jsonb('parameters').defaultTo('{}');
    t.integer('environment_id').references('id').inTable('environments').onDelete('SET NULL');
    t.boolean('enabled').defaultTo(true);
    t.string('created_by', 100).defaultTo('api');
    t.timestamp('last_run_at');
    t.timestamps(true, true);
    t.index('test_plan_id');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('test_schedules');
  await knex.schema.dropTableIfExists('test_executions');
  await knex.schema.dropTableIfExists('test_plans');
  await knex.schema.dropTableIfExists('environments');
};

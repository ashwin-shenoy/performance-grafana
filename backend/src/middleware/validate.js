/**
 * Lightweight request validation middleware
 *
 * Usage:
 *   router.post('/', validate({ body: { testPlanId: 'integer', cronExpression: 'string' } }), handler)
 *
 * Supported types: string | integer | number | boolean | object | array
 * Prefix '?' marks the field as optional.
 */
'use strict';

const cron = require('node-cron');

/**
 * Build a validation middleware from a schema descriptor.
 * @param {{ body?: object, query?: object, params?: object }} schema
 */
function validate(schema = {}) {
  return (req, res, next) => {
    const errors = [];

    for (const [location, fields] of Object.entries(schema)) {
      const source = req[location] || {};
      for (const [rawKey, rawType] of Object.entries(fields)) {
        const optional = rawKey.startsWith('?');
        const key      = optional ? rawKey.slice(1) : rawKey;
        const type     = typeof rawType === 'string' ? rawType : rawType.type;
        const value    = source[key];

        if (value === undefined || value === null || value === '') {
          if (!optional) errors.push(`${location}.${key} is required`);
          continue;
        }

        switch (type) {
          case 'integer': {
            const n = parseInt(value, 10);
            if (isNaN(n) || String(n) !== String(value).trim()) {
              errors.push(`${location}.${key} must be an integer`);
            } else if (rawType.min !== undefined && n < rawType.min) {
              errors.push(`${location}.${key} must be >= ${rawType.min}`);
            } else if (rawType.max !== undefined && n > rawType.max) {
              errors.push(`${location}.${key} must be <= ${rawType.max}`);
            }
            break;
          }
          case 'number': {
            const n = parseFloat(value);
            if (isNaN(n)) errors.push(`${location}.${key} must be a number`);
            break;
          }
          case 'string': {
            if (typeof value !== 'string') errors.push(`${location}.${key} must be a string`);
            else if (rawType.minLength && value.trim().length < rawType.minLength) {
              errors.push(`${location}.${key} must have at least ${rawType.minLength} characters`);
            } else if (rawType.maxLength && value.trim().length > rawType.maxLength) {
              errors.push(`${location}.${key} must not exceed ${rawType.maxLength} characters`);
            } else if (rawType.enum && !rawType.enum.includes(value)) {
              errors.push(`${location}.${key} must be one of: ${rawType.enum.join(', ')}`);
            }
            break;
          }
          case 'boolean': {
            if (!['true', 'false', true, false, '0', '1', 0, 1].includes(value)) {
              errors.push(`${location}.${key} must be a boolean`);
            }
            break;
          }
          case 'cron': {
            if (!cron.validate(String(value))) {
              errors.push(`${location}.${key} is not a valid cron expression`);
            }
            break;
          }
          case 'object': {
            if (typeof value !== 'object' || Array.isArray(value)) {
              errors.push(`${location}.${key} must be an object`);
            }
            break;
          }
          case 'array': {
            if (!Array.isArray(value)) errors.push(`${location}.${key} must be an array`);
            break;
          }
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details: errors },
      });
    }

    next();
  };
}

module.exports = validate;

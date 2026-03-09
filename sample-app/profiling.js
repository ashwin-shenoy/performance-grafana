'use strict';

/**
 * Pyroscope continuous-profiling bootstrap
 * Pushes CPU / heap / goroutine profiles to the Pyroscope server every 10 s.
 * Wrapped in try/catch so a missing native binary won't crash the app.
 */

const serverAddress = process.env.PYROSCOPE_SERVER_ADDRESS || 'http://pyroscope:4040';
const appName       = process.env.PYROSCOPE_APP_NAME       || 'sample-app';
const env           = process.env.NODE_ENV                 || 'local';

try {
  const Pyroscope = require('@pyroscope/nodejs');

  Pyroscope.init({
    serverAddress,
    appName,
    tags: {
      service: appName,
      env,
      version: '1.0.0',
    },
  });

  Pyroscope.start();
  console.log(JSON.stringify({
    level: 'info',
    message: `[profiling] Pyroscope started → ${serverAddress}  app=${appName}`,
  }));
} catch (err) {
  // Native addon unavailable on this platform — continue without profiling
  console.warn(JSON.stringify({
    level: 'warn',
    message: `[profiling] Pyroscope unavailable, skipping: ${err.message}`,
  }));
}

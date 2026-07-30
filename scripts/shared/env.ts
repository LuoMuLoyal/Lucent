const path = require('node:path');

const dotenv = require('dotenv');
const { getDotenvLoadOrder } = require('../../src/config/env/env-file-paths');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Loads .env files in the standard order for the current NODE_ENV.
 * Returns the resolved NODE_ENV value.
 */
function loadEnvironment() {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  for (const envPath of getDotenvLoadOrder()) {
    dotenv.config({
      path: path.join(REPO_ROOT, envPath),
      override: true,
    });
  }
  return nodeEnv;
}

module.exports = { loadEnvironment, REPO_ROOT };

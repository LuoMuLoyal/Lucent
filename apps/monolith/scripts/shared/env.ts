import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getDotenvLoadOrder } from '../../src/config/env/env-file-paths.ts';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(thisDir, '..', '..');

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

export { loadEnvironment, REPO_ROOT };

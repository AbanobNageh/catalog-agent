import { existsSync } from 'node:fs';

/**
 * Loads a `.env` file into `process.env` if it exists, with Node's own
 * parser. Variables that are already set win, so a host's or a test's
 * environment always overrides the file. Given an absolute location (the
 * repo root, from `import.meta.url`), not a path relative to the working
 * directory: a host may start the server from anywhere.
 */
export function loadDotEnv(file: URL): boolean {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

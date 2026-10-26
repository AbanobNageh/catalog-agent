import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from './env.js';

const dirs: string[] = [];
const names = ['M2_ENV_TEST_A', 'M2_ENV_TEST_B'];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  for (const name of names) delete process.env[name];
});

function envFile(content: string): URL {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-agent-env-'));
  dirs.push(dir);
  const path = join(dir, '.env');
  writeFileSync(path, content);
  return pathToFileURL(path);
}

describe('loadDotEnv', () => {
  it('loads a .env file into process.env', () => {
    const file = envFile('M2_ENV_TEST_A=from-file\n');
    expect(loadDotEnv(file)).toBe(true);
    expect(process.env.M2_ENV_TEST_A).toBe('from-file');
  });

  it('never overrides a variable that is already set', () => {
    process.env.M2_ENV_TEST_A = 'from-env';
    const file = envFile('M2_ENV_TEST_A=from-file\nM2_ENV_TEST_B=from-file\n');
    loadDotEnv(file);
    expect(process.env.M2_ENV_TEST_A).toBe('from-env');
    expect(process.env.M2_ENV_TEST_B).toBe('from-file');
  });

  it('a missing file is fine: nothing is loaded', () => {
    const missing = new URL('file:///nonexistent-dir-catalog-agent/.env');
    expect(loadDotEnv(missing)).toBe(false);
  });
});

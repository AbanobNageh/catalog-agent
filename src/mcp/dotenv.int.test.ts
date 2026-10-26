import { spawn } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { KEYS } from '../testing/fixtures.js';

// main.ts loads the .env next to its package root (dist/../.env), wherever the
// host starts it (Review Focus 9, review I2). This lays out a copy like the
// repo, `dist/` plus a linked `node_modules/`, so the test can put its own .env
// there without touching a developer's, and starts the server from elsewhere.

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** `dotenv` is the file's content, or `{ directory: true }` for an unreadable .env. */
function layout(dotenv: string | { directory: true }): string {
  const root = mkdtempSync(join(tmpdir(), 'catalog-agent-dotenv-'));
  roots.push(root);
  cpSync(join(REPO, 'dist'), join(root, 'dist'), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(root, 'package.json'));
  // A junction needs no admin rights on Windows; on Linux it's a symlink.
  symlinkSync(
    join(REPO, 'node_modules'),
    join(root, 'node_modules'),
    'junction',
  );
  if (typeof dotenv === 'string') writeFileSync(join(root, '.env'), dotenv);
  else mkdirSync(join(root, '.env'));
  return root;
}

/** Starts the copy's server from another directory; resolves when it exits. */
function run(root: string, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [join(root, 'dist', 'main.js')], {
    cwd: tmpdir(),
    // No CATALOG_* variables unless a test sets them.
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      ...env,
    },
    stdio: 'pipe',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
    // Started: close stdin, the way a host disconnects.
    if (stderr.includes('"server started"')) child.stdin.end();
  });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => child.on('exit', (code) => resolve({ code, stdout, stderr })),
  );
}

const started = (stderr: string) =>
  stderr
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .find((l) => l.msg === 'server started');

describe('the .env next to dist/', () => {
  it('is loaded when the server is started from another directory', async () => {
    const root = layout(
      `CATALOG_API_KEY=${KEYS.read}\nCATALOG_TIMEOUT_MS=4321\n`,
    );
    const { code, stdout, stderr } = await run(root);
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(started(stderr)).toMatchObject({ timeoutMs: 4321 });
  });

  it('never overrides a variable the host already set', async () => {
    const root = layout(
      `CATALOG_API_KEY=${KEYS.read}\nCATALOG_TIMEOUT_MS=4321\n`,
    );
    const { stderr } = await run(root, { CATALOG_TIMEOUT_MS: '5555' });
    expect(started(stderr)).toMatchObject({ timeoutMs: 5555 });
  });

  it('a .env that cannot be read is a JSON error line and exit 1, not a stack trace (review M5)', async () => {
    const root = layout({ directory: true });
    const { code, stdout, stderr } = await run(root, {
      CATALOG_API_KEY: KEYS.read,
    });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    const lines = stderr.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'error',
      msg: 'cannot read .env',
    });
    expect(stderr).not.toMatch(/\n\s+at /);
  });
});

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const KEY = 'dev-read-key-not-secret-0000000000000000';

describe('loadConfig', () => {
  it('defaults to the Compose stack on :3100, a 5s timeout and write access', () => {
    expect(loadConfig({ CATALOG_API_KEY: KEY })).toEqual({
      catalogApiUrl: 'http://localhost:3100',
      catalogApiKey: KEY,
      timeoutMs: 5000,
      access: 'write',
    });
  });

  it.each(['read', 'write'] as const)('reads CATALOG_ACCESS %s', (access) => {
    expect(
      loadConfig({ CATALOG_API_KEY: KEY, CATALOG_ACCESS: access }).access,
    ).toBe(access);
  });

  it.each(['', 'READ', 'Write', 'admin', ' write', 'read '])(
    'rejects CATALOG_ACCESS %j',
    (value) => {
      expect(() =>
        loadConfig({ CATALOG_API_KEY: KEY, CATALOG_ACCESS: value }),
      ).toThrow(/CATALOG_ACCESS must be read or write/);
    },
  );

  it('reads CATALOG_TIMEOUT_MS', () => {
    const config = loadConfig({
      CATALOG_API_KEY: KEY,
      CATALOG_TIMEOUT_MS: '1500',
    });
    expect(config.timeoutMs).toBe(1500);
  });

  it.each(['', 'abc', '99', '60001', '1.5', '1e3', ' 500'])(
    'rejects CATALOG_TIMEOUT_MS %j',
    (value) => {
      expect(() =>
        loadConfig({ CATALOG_API_KEY: KEY, CATALOG_TIMEOUT_MS: value }),
      ).toThrow(/CATALOG_TIMEOUT_MS must be a whole number from 100 to 60000/);
    },
  );

  it('removes trailing slashes from CATALOG_API_URL', () => {
    const config = loadConfig({
      CATALOG_API_URL: 'https://catalog.example.com/api//',
      CATALOG_API_KEY: KEY,
    });
    expect(config.catalogApiUrl).toBe('https://catalog.example.com/api');
  });

  it.each(['localhost:3100', 'ftp://example.com', 'http://', 'not a url'])(
    'rejects CATALOG_API_URL %j',
    (url) => {
      expect(() =>
        loadConfig({ CATALOG_API_URL: url, CATALOG_API_KEY: KEY }),
      ).toThrow(/CATALOG_API_URL must be an http\(s\) URL with a host/);
    },
  );

  it.each([undefined, ''])('requires CATALOG_API_KEY (%j)', (key) => {
    expect(() => loadConfig({ CATALOG_API_KEY: key })).toThrow(
      /CATALOG_API_KEY is required/,
    );
  });

  // Node's fetch repeats an invalid header value, or a URL with credentials, in
  // its error message, which would put the key in a log line or tool result.
  it.each([
    ['only spaces', '   '],
    ['a space', 'dev-read-key not-secret-000000000000000'],
    ['a trailing CR', `${KEY}\r`],
    ['a trailing LF', `${KEY}\n`],
    ['a non-ASCII character', 'dev-read-key-not-secret-00000000000000é'],
  ])('rejects a CATALOG_API_KEY with %s', (_, key) => {
    expect(() => loadConfig({ CATALOG_API_KEY: key })).toThrow(
      /CATALOG_API_KEY must be printable ASCII without spaces/,
    );
  });

  it('rejects a CATALOG_API_KEY shorter than 32 characters', () => {
    expect(() => loadConfig({ CATALOG_API_KEY: 'short-key' })).toThrow(
      /CATALOG_API_KEY must be at least 32 characters/,
    );
  });

  it.each([
    'http://user:pw@localhost:3100',
    'http://user@localhost:3100',
    'http://localhost:3100?x=1',
    'http://localhost:3100/#f',
  ])(
    'rejects CATALOG_API_URL with credentials, a query or a fragment',
    (url) => {
      expect(() =>
        loadConfig({ CATALOG_API_URL: url, CATALOG_API_KEY: KEY }),
      ).toThrow(
        /CATALOG_API_URL must not include credentials, a query or a fragment/,
      );
    },
  );

  it('reports every problem in one error', () => {
    expect(() => loadConfig({ CATALOG_API_URL: 'localhost' })).toThrow(
      'Invalid configuration:\n' +
        '- CATALOG_API_URL must be an http(s) URL with a host\n' +
        '- CATALOG_API_KEY is required',
    );
  });

  it('never puts the key in an error message', () => {
    // Messages name the variable, never the value: a key pasted into the wrong
    // variable, or a URL with credentials in it, must not reach a log.
    const run = () =>
      loadConfig({ CATALOG_API_URL: KEY, CATALOG_API_KEY: KEY });
    expect(run).toThrow(/CATALOG_API_URL/);
    try {
      run();
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY);
    }
  });
});

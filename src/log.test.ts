import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './log.js';

function recorder() {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => lines.push(line),
    json: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes one JSON line per event with time, level, msg and fields', () => {
    const out = recorder();
    createLogger({ write: out.write }).info('catalog call', {
      method: 'GET',
      status: 200,
    });
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]?.endsWith('\n')).toBe(true);
    const [entry] = out.json();
    expect(entry).toMatchObject({
      level: 'info',
      msg: 'catalog call',
      method: 'GET',
      status: 200,
    });
    expect(new Date(entry?.time as string).toISOString()).toBe(entry?.time);
  });

  it('drops events below the configured level', () => {
    const out = recorder();
    const log = createLogger({ write: out.write, level: 'warn' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(out.json().map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('redacts credential-like fields, also when nested', () => {
    const out = recorder();
    createLogger({ write: out.write }).info('x', {
      authorization: 'Bearer abc',
      apiKey: 'k1',
      api_key: 'k2',
      nested: { token: 't', clientSecret: 's', password: 'p', safe: 'ok' },
      list: [{ Authorization: 'Bearer def' }],
    });
    const [entry] = out.json();
    expect(entry).toMatchObject({
      authorization: '[redacted]',
      apiKey: '[redacted]',
      api_key: '[redacted]',
      nested: {
        token: '[redacted]',
        clientSecret: '[redacted]',
        password: '[redacted]',
        safe: 'ok',
      },
      list: [{ Authorization: '[redacted]' }],
    });
    expect(out.lines[0]).not.toMatch(/abc|k1|k2|def/);
  });

  it("doesn't redact names that merely contain a secret word (Phase 2 token counts)", () => {
    const out = recorder();
    createLogger({ write: out.write }).info('x', {
      prompt_tokens: 10,
      completion_tokens: 5,
      maxTokensPerTask: 9,
      keyCount: 3,
    });
    expect(out.json()[0]).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 5,
      maxTokensPerTask: 9,
      keyCount: 3,
    });
  });

  it('a field cannot overwrite time, level or msg', () => {
    const out = recorder();
    createLogger({ write: out.write }).warn('real', {
      msg: 'fake',
      level: 'debug',
    });
    expect(out.json()[0]).toMatchObject({ msg: 'real', level: 'warn' });
  });

  it('writes to stderr by default, never stdout (stdout is the MCP protocol)', () => {
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    createLogger().error('boom');
    expect(stderr).toHaveBeenCalledOnce();
    expect(stdout).not.toHaveBeenCalled();
  });
});

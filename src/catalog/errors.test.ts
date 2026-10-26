import { describe, expect, it } from 'vitest';
import { CatalogError, fromNetworkError, fromResponse } from './errors.js';

// Bodies as catalog-api v1.1.0 sends them (captured from the Compose stack).
const body = (status: number, message: unknown, extra = {}) =>
  JSON.stringify({ statusCode: status, message, error: 'x', ...extra });

describe('fromResponse (REQUIREMENTS.md §4.3)', () => {
  it('400: VALIDATION, with a message list joined', () => {
    const err = fromResponse(
      400,
      body(400, [
        'sort must be one of the following values: relevance, price_asc',
        'size must be a whole number from 1 to 100',
      ]),
      { op: 'search' },
    );
    expect(err).toMatchObject({
      code: 'VALIDATION',
      status: 400,
      retryable: false,
      message:
        'sort must be one of the following values: relevance, price_asc; size must be a whole number from 1 to 100',
    });
  });

  it('replaces the given secrets in the message, wherever they appear (review I1)', () => {
    const key = 'dev-read-key-not-secret-0000000000000000';
    const err = fromResponse(
      400,
      body(400, [`bad header: Bearer ${key}`, `${key} again`]),
      { op: 'get', secrets: [key] },
    );
    expect(err.message).toBe('bad header: Bearer [redacted]; [redacted] again');
  });

  it('replaces a secret before cutting the message, so no part of it survives the cut', () => {
    const key = 'dev-read-key-not-secret-0000000000000000';
    const err = fromResponse(400, body(400, `${'x'.repeat(480)}${key}`), {
      op: 'get',
      secrets: [key],
    });
    expect(err.message).not.toContain(key.slice(0, 10));
    expect(err.message.length).toBeLessThanOrEqual(500);
  });

  it('401: UNAUTHORIZED', () => {
    const err = fromResponse(
      401,
      body(401, 'a valid API key is required: Authorization: Bearer <key>'),
      { op: 'get' },
    );
    expect(err).toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
  });

  it("403: FORBIDDEN, keeping the API's message about the scope", () => {
    const err = fromResponse(
      403,
      body(403, 'this endpoint needs the write scope; your key has read'),
      { op: 'update' },
    );
    expect(err).toMatchObject({
      code: 'FORBIDDEN',
      retryable: false,
      message: 'this endpoint needs the write scope; your key has read',
    });
  });

  it('404: NOT_FOUND', () => {
    expect(
      fromResponse(404, body(404, 'product not found'), { op: 'get' }),
    ).toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('409 on create or update (a sku another product has): SKU_EXISTS', () => {
    const conflict = body(409, 'sku already exists');
    for (const op of ['create', 'update'] as const) {
      expect(fromResponse(409, conflict, { op })).toMatchObject({
        code: 'SKU_EXISTS',
        retryable: false,
      });
    }
    expect(fromResponse(409, conflict, { op: 'search' }).code).toBe('INTERNAL');
  });

  it('412: STALE_VERSION, retryable after a re-read, with the current version', () => {
    const err = fromResponse(
      412,
      body(412, 'product changed: you sent version 1, current is 2', {
        currentVersion: 2,
      }),
      { op: 'update' },
    );
    expect(err).toMatchObject({
      code: 'STALE_VERSION',
      status: 412,
      retryable: true,
      details: { currentVersion: 2 },
    });
  });

  it('503: UNAVAILABLE, retryable', () => {
    expect(
      fromResponse(503, body(503, 'search is temporarily unavailable'), {
        op: 'search',
      }),
    ).toMatchObject({ code: 'UNAVAILABLE', retryable: true });
  });

  it.each([500, 502, 504, 418])('%i: INTERNAL, not retryable', (status) => {
    expect(fromResponse(status, 'oops', { op: 'get' })).toMatchObject({
      code: 'INTERNAL',
      retryable: false,
    });
  });

  it('never returns a raw or huge body: a non-JSON body becomes the status text', () => {
    const err = fromResponse(500, '<html>' + 'x'.repeat(10_000), {
      op: 'get',
    });
    expect(err.message).toBe('catalog-api returned 500');
  });

  it('cuts a long API message to 500 characters', () => {
    const err = fromResponse(400, body(400, 'y'.repeat(2000)), {
      op: 'create',
    });
    expect(err.message.length).toBeLessThanOrEqual(500);
  });

  it('is an Error and a CatalogError', () => {
    const err = fromResponse(404, body(404, 'nope'), { op: 'get' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CatalogError);
  });
});

describe('fromNetworkError', () => {
  it('a timeout (TimeoutError or AbortError) is UNAVAILABLE with cause timeout', () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const err = new Error('The operation was aborted');
      err.name = name;
      expect(fromNetworkError(err)).toMatchObject({
        code: 'UNAVAILABLE',
        retryable: true,
        details: { cause: 'timeout' },
      });
    }
  });

  it("a connection error (fetch's TypeError) is UNAVAILABLE with the system code", () => {
    const err = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
    });
    expect(fromNetworkError(err)).toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
      details: { cause: 'ECONNREFUSED' },
    });
  });

  it("doesn't copy fetch's message, which can repeat a header value", () => {
    const err = new TypeError('Headers.append: "Bearer secret" is invalid');
    expect(fromNetworkError(err).message).not.toContain('secret');
  });

  it('anything else is rethrown as is: a bug, not an outage', () => {
    const bug = new RangeError('bad');
    expect(() => fromNetworkError(bug)).toThrow(bug);
  });
});

import { describe, expect, it } from 'vitest';
import { CatalogError } from '../catalog/errors.js';
import { errorOf } from '../testing/mcp.js';
import { errorData, toolError, toolSuccess } from './results.js';

const textOf = (result: { content: unknown[] }) =>
  (result.content[0] as { type: string; text: string }).text;

describe('toolSuccess (ADR-0005)', () => {
  it('puts the data in structuredContent and the summary plus the JSON in the text', () => {
    const data = { total: 2, hits: [{ id: 'a' }] };
    const result = toolSuccess('2 products match.', data);
    expect(result.structuredContent).toEqual(data);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(textOf(result)).toBe(`2 products match.\n\n${JSON.stringify(data)}`);
  });
});

describe('toolError (ADR-0005): text only, never structuredContent', () => {
  it('is isError with one text block: the summary, then the error JSON', () => {
    const data = errorData(
      new CatalogError('NOT_FOUND', 'product not found', false),
    );
    const result = toolError(data);
    expect(result.isError).toBe(true);
    // An error object in structuredContent wouldn't match the tool's success
    // outputSchema, which strict clients (MCP Inspector) reject.
    expect('structuredContent' in result).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(textOf(result)).toBe(
      `Error NOT_FOUND: product not found. Hint: check the id; use search_products to find it.\n\n${JSON.stringify(data)}`,
    );
    expect(errorOf(result)).toEqual(data);
  });
});

describe('errorData: one row per §4.3 code', () => {
  const err = (
    code: ConstructorParameters<typeof CatalogError>[0],
    message: string,
    retryable = false,
    details?: ConstructorParameters<typeof CatalogError>[4],
  ) => new CatalogError(code, message, retryable, undefined, details);

  it.each([
    [
      'VALIDATION',
      err('VALIDATION', 'q must be shorter than or equal to 200 characters'),
      false,
      'q must be shorter than or equal to 200 characters',
    ],
    [
      'UNAUTHORIZED',
      err('UNAUTHORIZED', 'missing or unknown API key'),
      false,
      "the MCP server's catalog key is missing or wrong (configuration problem)",
    ],
    [
      'FORBIDDEN',
      err(
        'FORBIDDEN',
        'this endpoint needs the write scope; your key has read',
      ),
      false,
      'this endpoint needs the write scope; your key has read',
    ],
    [
      'NOT_FOUND',
      err('NOT_FOUND', 'product not found'),
      false,
      'check the id; use search_products to find it',
    ],
    [
      'SKU_EXISTS',
      err('SKU_EXISTS', 'sku already exists'),
      false,
      'a product with this sku already exists',
    ],
    [
      'STALE_VERSION',
      err('STALE_VERSION', 'product changed', true, { currentVersion: 7 }),
      true,
      'the product changed (current version 7); call get_product, check the change still makes sense, then retry with expectedVersion 7',
    ],
    [
      'UNAVAILABLE',
      err('UNAVAILABLE', 'catalog-api did not answer in time', true, {
        cause: 'timeout',
      }),
      true,
      'temporary; retry later',
    ],
    [
      'INTERNAL',
      err('INTERNAL', 'catalog-api returned 500'),
      false,
      'an unexpected error; retrying the same call will not help',
    ],
  ] as const)('%s', (code, error, retryable, hint) => {
    expect(errorData(error)).toEqual({
      code,
      message: error.message,
      retryable,
      hint,
      ...(error.details ? { details: error.details } : {}),
    });
  });

  it('STALE_VERSION without a current version still says what to do', () => {
    expect(errorData(err('STALE_VERSION', 'product changed', true)).hint).toBe(
      'the product changed; call get_product for its current version, check the change still makes sense, then retry with that version',
    );
  });

  it('an unknown outcome says the change may have been applied', () => {
    const data = errorData(
      err('UNAVAILABLE', 'the change may have been applied', true, {
        outcome: 'unknown',
      }),
    );
    expect(data).toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
      hint: 'the change may have been applied; read the product before retrying',
      details: { outcome: 'unknown' },
    });
  });

  it('copies only the known fields: never the stack, the status or the retry count', () => {
    const data = errorData(err('NOT_FOUND', 'product not found'));
    expect(Object.keys(data).sort()).toEqual([
      'code',
      'hint',
      'message',
      'retryable',
    ]);
    const text = JSON.stringify(toolError(data));
    expect(text).not.toContain('CatalogError');
    expect(text).not.toMatch(/\n\s+at /);
  });

  it('anything that is not a CatalogError is INTERNAL with a fixed message', () => {
    for (const thrown of [
      new Error('secret dev-read-key-not-secret-0000000000000000 at line 3'),
      new TypeError('cannot read properties of undefined'),
      'a string',
      undefined,
    ]) {
      const data = errorData(thrown);
      expect(data).toEqual({
        code: 'INTERNAL',
        message: 'internal error in the MCP server',
        retryable: false,
        hint: 'an unexpected error; retrying the same call will not help',
      });
      const text = JSON.stringify(toolError(data));
      expect(text).not.toContain('dev-read-key');
      expect(text).not.toContain('undefined');
    }
  });
});

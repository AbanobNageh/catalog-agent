import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Product, SearchHit, SearchResult } from '../catalog/types.js';
import { SERVER_INFO } from './server.js';
import {
  call,
  closeAll,
  harness as connectHarness,
  json,
  KEY,
  textOf,
  type Handler,
} from '../testing/harness.js';
import { ERAS, errorOf, type Era } from '../testing/mcp.js';

// MCP-level tests (§4.5) of the read tools, in both protocol eras, on a server
// in read-only mode. The write tools are in write-tools.test.ts.

const ID = '01150e76-a154-4f63-a9b7-497146a129f0';

const harness = (era: Era, ...steps: Handler[]) =>
  connectHarness(era, 'read', ...steps);

afterEach(closeAll);

const hit = (n: number, overrides: Partial<SearchHit> = {}): SearchHit => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  sku: `SKU-${n}`,
  name: `Product ${n}`,
  description: `A long description of product ${n}`,
  category: 'books',
  brand: 'Acme',
  priceCents: 79900,
  currency: 'EGP',
  stock: n,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const product: Product = { ...hit(1, { id: ID }), version: 3 };

// The version a client sees in serverInfo is the released one.
it('SERVER_INFO matches package.json', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { name: string; version: string };
  expect(SERVER_INFO).toEqual({ name: pkg.name, version: pkg.version });
});

const searchResult = (
  hits: SearchHit[],
  total: number,
  facets?: SearchResult['facets'],
): SearchResult => ({
  hits,
  total,
  facets: facets ?? { category: [], brand: [], price: [] },
});

describe.each(ERAS)('MCP server (%s era)', (era) => {
  it('connects in the era under test', async () => {
    const h = await harness(era);
    expect(h.client.getProtocolEra()).toBe(era);
  });

  it('in read mode, lists exactly the three read tools, read-only and closed-world', async () => {
    const h = await harness(era);
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'search_products',
      'get_product',
      'list_facets',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: false,
      });
      expect(tool.title).toBeTruthy();
      expect(tool.description).toMatch(/cents/);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    const search = tools[0]?.inputSchema.properties ?? {};
    expect(search.size).toMatchObject({
      minimum: 1,
      maximum: 100,
      default: 10,
    });
    expect(search.sort).toMatchObject({
      enum: ['relevance', 'price_asc', 'price_desc', 'newest', 'stock_asc'],
    });
  });

  describe('search_products', () => {
    it('returns compact hits with a formatted price, and the paging', async () => {
      const h = await harness(era, () =>
        json(200, searchResult([hit(1), hit(2)], 25)),
      );
      const result = await call(h, 'search_products', {
        category: 'books',
        maxStock: 5,
        sort: 'stock_asc',
      });
      expect(result.isError).toBeFalsy();
      const data = result.structuredContent as Record<string, unknown>;
      expect(data).toEqual({
        hits: [1, 2].map((n) => ({
          id: hit(n).id,
          sku: `SKU-${n}`,
          name: `Product ${n}`,
          category: 'books',
          brand: 'Acme',
          priceCents: 79900,
          price: '799.00 EGP',
          currency: 'EGP',
          stock: n,
        })),
        total: 25,
        page: 1,
        size: 10,
        hasMore: true,
        nextPage: 2,
      });
      expect(textOf(result)).toBe(
        `25 products match; showing 1–2 (page 1). More: call search_products with page: 2.\n\n${JSON.stringify(data)}`,
      );
      const query = Object.fromEntries(h.requests[0]?.searchParams ?? []);
      expect(query).toEqual({
        category: 'books',
        maxStock: '5',
        sort: 'stock_asc',
        page: '1',
        size: '10',
      });
    });

    it('includes the facets only when asked', async () => {
      const facets = {
        category: [{ key: 'books', count: 25 }],
        brand: [{ key: 'Acme', count: 25 }],
        price: [{ key: '*-10000', count: 25, to: 10000 }],
      };
      const h = await harness(era, () =>
        json(200, searchResult([hit(1)], 25, facets)),
      );
      const result = await call(h, 'search_products', { includeFacets: true });
      expect(result.structuredContent).toMatchObject({
        facets: {
          categories: [{ key: 'books', count: 25 }],
          brands: [{ key: 'Acme', count: 25 }],
          priceBuckets: [{ key: '*-10000', count: 25, to: 10000 }],
        },
      });
      expect(h.requests[0]?.searchParams.has('includeFacets')).toBe(false);
    });

    it('copies only the known bucket fields, so the outputSchema (no extra properties) holds (review M3)', async () => {
      const facets = {
        category: [{ key: 'books', count: 2, internalScore: 0.9 }],
        brand: [{ key: 'Acme', count: 2, doc_count_error: 0 }],
        price: [{ key: '*-10000', count: 2, to: 10000, extra: true }],
      } as unknown as SearchResult['facets'];
      const h = await harness(era, () =>
        json(200, searchResult([hit(1)], 2, facets)),
      );
      const result = await call(h, 'list_facets', {});
      expect(result.structuredContent).toEqual({
        total: 2,
        categories: [{ key: 'books', count: 2 }],
        brands: [{ key: 'Acme', count: 2 }],
        priceBuckets: [{ key: '*-10000', count: 2, to: 10000 }],
      });
    });

    it.each([
      // [page, size, total, hits, hasMore, nextPage, text]
      [
        2,
        10,
        20,
        10,
        false,
        undefined,
        '20 products match; showing 11–20 (page 2).',
      ],
      [
        2,
        10,
        21,
        10,
        true,
        3,
        '21 products match; showing 11–20 (page 2). More: call search_products with page: 3.',
      ],
      [1, 10, 0, 0, false, undefined, 'No products match these filters.'],
      [
        1,
        10,
        1,
        1,
        false,
        undefined,
        '1 product matches; showing 1–1 (page 1).',
      ],
      [
        4,
        10,
        25,
        0,
        false,
        undefined,
        '25 products match, but page 4 is past the last page (3).',
      ],
      [
        100,
        100,
        50000,
        100,
        true,
        undefined,
        '50000 products match; showing 9901–10000 (page 100). More match than search can page through (10000); narrow the filters to see the rest.',
      ],
      [
        999,
        10,
        50000,
        10,
        true,
        1000,
        '50000 products match; showing 9981–9990 (page 999). More: call search_products with page: 1000.',
      ],
    ] as const)(
      'page %i × size %i of %i total (%i hits) → hasMore %s, nextPage %s',
      async (page, size, total, count, hasMore, nextPage, text) => {
        const hits = Array.from({ length: count }, (_, i) => hit(i + 1));
        const h = await harness(era, () =>
          json(200, searchResult(hits, total)),
        );
        const result = await call(h, 'search_products', { page, size });
        const data = result.structuredContent as Record<string, unknown>;
        expect(data.hasMore).toBe(hasMore);
        expect(data.nextPage).toBe(nextPage);
        expect('nextPage' in data).toBe(nextPage !== undefined);
        expect(textOf(result).split('\n\n')[0]).toBe(text);
      },
    );

    it('rejects a bad call before it reaches catalog-api (the SDK validation text)', async () => {
      const h = await harness(era);
      const tooBig = await call(h, 'search_products', { size: 150 });
      expect(tooBig.isError).toBe(true);
      expect(textOf(tooBig)).toMatch(/Input validation error.*size.*100/);
      const unknown = await call(h, 'search_products', { limit: 5 });
      expect(unknown.isError).toBe(true);
      expect(textOf(unknown)).toMatch(/limit/);
      const window = await call(h, 'search_products', { page: 101, size: 100 });
      expect(window.isError).toBe(true);
      expect(textOf(window)).toMatch(/10000/);
      expect(h.requests).toHaveLength(0);
    });
  });

  describe('get_product', () => {
    it('returns the full product with its version and a formatted price', async () => {
      const h = await harness(era, () => json(200, product));
      const result = await call(h, 'get_product', { id: ID });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        ...product,
        price: '799.00 EGP',
      });
      expect(textOf(result).split('\n\n')[0]).toBe(
        'Product 1 (SKU-1): 799.00 EGP, stock 1, version 3.',
      );
      expect(h.requests[0]?.pathname).toBe(`/products/${ID}`);
    });

    it('a 404 is an isError result with the §4.3 shape', async () => {
      const h = await harness(era, () =>
        json(404, { statusCode: 404, message: 'product not found' }),
      );
      const result = await call(h, 'get_product', { id: ID });
      expect(result.isError).toBe(true);
      // Text only (ADR-0005): errorOf also checks there's no structuredContent.
      expect(errorOf(result)).toEqual({
        code: 'NOT_FOUND',
        message: 'product not found',
        retryable: false,
        hint: 'check the id; use search_products to find it',
      });
    });

    it('rejects an id that is not a UUID without calling catalog-api', async () => {
      const h = await harness(era);
      const result = await call(h, 'get_product', { id: 'SEED-04007' });
      expect(result.isError).toBe(true);
      expect(h.requests).toHaveLength(0);
    });
  });

  describe('list_facets', () => {
    it('asks for one hit with the filters, and returns only the counts', async () => {
      const h = await harness(era, () =>
        json(
          200,
          searchResult([hit(1)], 118, {
            category: [{ key: 'books', count: 118 }],
            brand: [
              { key: 'Acme', count: 100 },
              { key: 'Zeta', count: 18 },
            ],
            price: [{ key: '10000-50000', count: 118, from: 10000, to: 50000 }],
          }),
        ),
      );
      const result = await call(h, 'list_facets', {
        category: 'books',
        maxStock: 5,
      });
      expect(result.structuredContent).toEqual({
        total: 118,
        categories: [{ key: 'books', count: 118 }],
        brands: [
          { key: 'Acme', count: 100 },
          { key: 'Zeta', count: 18 },
        ],
        priceBuckets: [
          { key: '10000-50000', count: 118, from: 10000, to: 50000 },
        ],
      });
      expect(textOf(result).split('\n\n')[0]).toBe(
        '118 products match: 1 category, 2 brands, 1 price bucket.',
      );
      expect(Object.fromEntries(h.requests[0]?.searchParams ?? [])).toEqual({
        category: 'books',
        maxStock: '5',
        size: '1',
      });
    });
  });

  describe('reliability and logs', () => {
    it('a read retried twice still succeeds, and the tool call log line says so', async () => {
      const h = await harness(
        era,
        () => json(503, { message: 'search-service is unavailable' }),
        () => json(503, { message: 'search-service is unavailable' }),
        () => json(200, product),
      );
      const result = await call(h, 'get_product', { id: ID });
      expect(result.isError).toBeFalsy();
      const toolLines = h.logs.filter((l) => l.msg === 'tool call');
      expect(toolLines).toHaveLength(1);
      expect(toolLines[0]).toMatchObject({
        level: 'info',
        tool: 'get_product',
        outcome: 'ok',
        requests: 3,
        retries: 2,
      });
      expect(typeof toolLines[0]?.durationMs).toBe('number');
      // The catalog request lines carry the same correlation id.
      const ids = new Set(h.logs.map((l) => l.correlationId));
      expect(ids.size).toBe(1);
      expect(toolLines[0]?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('a failed call is logged with its code', async () => {
      const h = await harness(era, () => json(404, { message: 'not found' }));
      await call(h, 'get_product', { id: ID });
      expect(h.logs.find((l) => l.msg === 'tool call')).toMatchObject({
        tool: 'get_product',
        outcome: 'error',
        code: 'NOT_FOUND',
        requests: 1,
        retries: 0,
      });
    });

    it('no error result carries the key, a stack trace or the upstream body (Review Focus 2)', async () => {
      const body = `<html>proxy error ${KEY}\n    at handler (/srv/app.js:1:1)</html>`;
      const raw = (status: number) => () =>
        new Response(body, {
          status,
          headers: { 'content-type': 'text/html' },
        });
      const timeout = () => {
        throw new DOMException(`timed out ${KEY}`, 'TimeoutError');
      };
      const refused = () => {
        throw Object.assign(new TypeError(`fetch failed ${KEY}`), {
          cause: { code: 'ECONNREFUSED' },
        });
      };
      const cases: Handler[][] = [
        [raw(500)],
        [raw(400)],
        [raw(401)],
        [raw(200)], // a 2xx that isn't JSON
        [raw(503), raw(503), raw(503)],
        [timeout, timeout, timeout],
        [refused, refused, refused],
        // catalog-api's JSON `message` is copied into the result, so an
        // upstream that echoes the Authorization header (a gateway, a wrong
        // CATALOG_API_URL) must not leak the key through it (review I1).
        [
          () =>
            json(400, { message: [`bad header Bearer ${KEY}`, 'q too long'] }),
        ],
        [() => json(403, { message: `scope too low for ${KEY}` })],
        [() => json(404, { message: KEY })],
      ];
      for (const steps of cases) {
        const h = await harness(era, ...steps);
        const result = await call(h, 'get_product', { id: ID });
        expect(result.isError).toBe(true);
        expect(errorOf(result).code).toMatch(
          /^(INTERNAL|VALIDATION|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|UNAVAILABLE)$/,
        );
        const everything = JSON.stringify(result);
        expect(everything).not.toContain(KEY);
        expect(everything).not.toContain('proxy error');
        expect(everything).not.toMatch(/\s+at \S+ \(/);
        expect(h.logs.map((l) => JSON.stringify(l)).join('')).not.toContain(
          KEY,
        );
      }
    });
  });
});

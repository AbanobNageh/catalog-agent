import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '../catalog/types.js';
import { Fixtures } from '../testing/fixtures.js';
import { errorOf } from '../testing/mcp.js';
import { MAIN, serverEnv } from '../testing/stdio.js';

// The read tools against catalog-api v1.1.0, through the real stdio server
// (§4.5). Products of their own in category it-<runid>-tools; SEED-* is never
// touched.

const fixtures = new Fixtures('tools');
const STOCKS = [9, 0, 5, 2];
let products: Product[] = [];
let client: Client;

async function connect(env = serverEnv()): Promise<Client> {
  const c = new Client({ name: 'tools-int', version: '0' });
  await c.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env,
      stderr: 'pipe',
    }),
  );
  return c;
}

beforeAll(async () => {
  for (const stock of STOCKS) products.push(await fixtures.create({ stock }));
  client = await connect();
});

afterAll(async () => {
  await client?.close();
  await fixtures.cleanup();
});

const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

describe('search_products', () => {
  it('finds low stock with maxStock and stock_asc, as compact hits', async () => {
    const result = await call('search_products', {
      category: fixtures.category,
      maxStock: 5,
      sort: 'stock_asc',
    });
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as {
      hits: Record<string, unknown>[];
      total: number;
      hasMore: boolean;
    };
    expect(data.total).toBe(3);
    expect(data.hasMore).toBe(false);
    expect(data.hits.map((h) => h.stock)).toEqual([0, 2, 5]);
    expect(Object.keys(data.hits[0] ?? {}).sort()).toEqual([
      'brand',
      'category',
      'currency',
      'id',
      'name',
      'price',
      'priceCents',
      'sku',
      'stock',
    ]);
    expect(data.hits[0]).toMatchObject({
      priceCents: 79900,
      price: '799.00 EGP',
      currency: 'EGP',
    });
  });

  it('pages: size 1 says there is more and which page is next', async () => {
    const first = await call('search_products', {
      category: fixtures.category,
      sort: 'stock_asc',
      size: 1,
    });
    expect(first.structuredContent).toMatchObject({
      total: 4,
      page: 1,
      size: 1,
      hasMore: true,
      nextPage: 2,
      hits: [{ stock: 0 }],
    });
    const second = await call('search_products', {
      category: fixtures.category,
      sort: 'stock_asc',
      size: 1,
      page: 2,
    });
    expect(second.structuredContent).toMatchObject({ hits: [{ stock: 2 }] });
  });

  it('includes the facets when asked', async () => {
    const result = await call('search_products', {
      category: fixtures.category,
      includeFacets: true,
    });
    expect(result.structuredContent).toMatchObject({
      facets: {
        categories: [{ key: fixtures.category, count: 4 }],
        brands: [{ key: 'ItBrand', count: 4 }],
      },
    });
  });
});

describe('get_product', () => {
  it('returns the full product with its version and a formatted price', async () => {
    const [p] = products;
    const result = await call('get_product', { id: p?.id });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ ...p, price: '799.00 EGP' });
  });

  it('an unknown id is NOT_FOUND, with the hint', async () => {
    const result = await call('get_product', { id: randomUUID() });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toMatchObject({
      code: 'NOT_FOUND',
      retryable: false,
      hint: 'check the id; use search_products to find it',
    });
  });
});

describe('list_facets', () => {
  it('counts the products matching the filters', async () => {
    const result = await call('list_facets', {
      category: fixtures.category,
      inStock: true,
    });
    expect(result.structuredContent).toMatchObject({
      total: 3,
      categories: [{ key: fixtures.category, count: 3 }],
      brands: [{ key: 'ItBrand', count: 3 }],
    });
  });
});

describe('a server configured with an unknown key', () => {
  it('reports UNAUTHORIZED as a configuration problem', async () => {
    const other = await connect(
      serverEnv({
        CATALOG_API_KEY: 'not-a-real-key-but-long-enough-0000000000',
      }),
    );
    try {
      const result = await other.callTool({
        name: 'list_facets',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(errorOf(result)).toMatchObject({
        code: 'UNAUTHORIZED',
        retryable: false,
        hint: "the MCP server's catalog key is missing or wrong (configuration problem)",
      });
    } finally {
      await other.close();
    }
  });
});

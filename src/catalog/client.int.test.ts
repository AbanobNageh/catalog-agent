import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  capturingLogger,
  Fixtures,
  KEYS,
} from '../testing/fixtures.js';
import { CatalogClient } from './client.js';
import type { CatalogError } from './errors.js';

// Against the Compose stack (catalog-api v1.1.0 on :3100), no faults.
const fx = new Fixtures('client');
const { logger, lines } = capturingLogger();
const client = (apiKey: string = KEYS.write) =>
  new CatalogClient({ baseUrl: BASE_URL, apiKey, timeoutMs: 5000, logger });

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as CatalogError,
  );

beforeAll(async () => {
  await fx.create({ stock: 9 });
  await fx.create({ stock: 2 });
  await fx.create({ stock: 0 });
});
afterAll(() => fx.cleanup());

describe('CatalogClient against catalog-api v1.1.0', () => {
  it("search: maxStock and stock_asc, within this run's category", async () => {
    const result = await client(KEYS.read).search({
      category: fx.category,
      maxStock: 5,
      sort: 'stock_asc',
    });
    expect(result.total).toBe(2);
    expect(result.hits.map((h) => h.stock)).toEqual([0, 2]);
    expect(result.hits[0]).not.toHaveProperty('version');
    expect(result.facets.category).toEqual([{ key: fx.category, count: 2 }]);
  });

  it('get, then a conditional update: version + 1', async () => {
    const created = await fx.create({ stock: 3 });
    const read = await client(KEYS.read).getProduct(created.id);
    expect(read.version).toBe(1);

    const result = await client().updateProduct(read.id, { stock: 23 }, 1);
    expect(result).toMatchObject({
      confirmedAfterTimeout: false,
      attempts: 1,
      product: { stock: 23, version: 2 },
    });
    expect(await fx.get(read.id)).toMatchObject({ stock: 23, version: 2 });
  });

  it('a planted concurrent update: STALE_VERSION with the current version, and theirs kept', async () => {
    const created = await fx.create({ stock: 3 });
    await fx.plantUpdate(created.id, { stock: 2 }, 1); // a sale, version 2

    const err = await rejection(
      client().updateProduct(created.id, { stock: 13 }, 1),
    );
    expect(err).toMatchObject({
      code: 'STALE_VERSION',
      status: 412,
      retryable: true,
      details: { currentVersion: 2 },
    });
    expect(await fx.get(created.id)).toMatchObject({ stock: 2, version: 2 });
  });

  it('create with a duplicate sku: SKU_EXISTS', async () => {
    const created = await fx.create();
    const err = await rejection(
      client().createProduct(fx.newProduct({ sku: created.sku })),
    );
    expect(err).toMatchObject({ code: 'SKU_EXISTS', status: 409 });
  });

  it("the read key on a write: FORBIDDEN, with the API's scope message", async () => {
    const created = await fx.create();
    const err = await rejection(
      client(KEYS.read).updateProduct(created.id, { stock: 1 }, 1),
    );
    expect(err).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(err.message).toMatch(/needs the write scope/);
    expect((await fx.get(created.id)).version).toBe(1);
  });

  it('an unknown key: UNAUTHORIZED', async () => {
    const err = await rejection(
      client('unknown-key-'.padEnd(40, 'x')).search({}),
    );
    expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('a random id: NOT_FOUND; a malformed id: VALIDATION', async () => {
    const reader = client(KEYS.read);
    expect(
      await rejection(
        reader.getProduct('00000000-0000-4000-8000-000000000000'),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(await rejection(reader.getProduct('not-a-uuid'))).toMatchObject({
      code: 'VALIDATION',
      status: 400,
    });
  });

  it("a bad body: VALIDATION with the API's messages joined", async () => {
    const err = await rejection(
      client().createProduct(fx.newProduct({ priceCents: -1 })),
    );
    expect(err).toMatchObject({ code: 'VALIDATION', status: 400 });
    expect(err.message).toMatch(/priceCents must not be less than 0/);
  });

  it('never logged a key', () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const key of Object.values(KEYS)) {
      expect(lines.join('')).not.toContain(key);
    }
  });
});

import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFaultProxy, type FaultProxy } from '../testing/fault-proxy.js';
import { BASE_URL, Fixtures, KEYS } from '../testing/fixtures.js';
import { errorOf } from '../testing/mcp.js';
import { MAIN, serverEnv } from '../testing/stdio.js';

// The write tools against catalog-api v1.1.0, through the real stdio server
// (§4.5, ADR-0006): every §4.3 row the write tools can cause. Products of their
// own in category it-<runid>-writes; SEED-* is never touched. Each check reads
// the product back straight from catalog-api, not through the tools.

const fixtures = new Fixtures('writes');
const open: Client[] = [];

/** A spawned server, write access with the write key unless overridden. */
async function connect(
  overrides: Record<string, string | undefined> = {},
): Promise<Client> {
  const client = new Client({ name: 'writes-int', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env: serverEnv({
        CATALOG_API_KEY: KEYS.write,
        CATALOG_ACCESS: 'write',
        ...overrides,
      }),
      stderr: 'pipe',
    }),
  );
  open.push(client);
  return client;
}

let writer: Client;

beforeAll(async () => {
  writer = await connect();
});

afterAll(async () => {
  await Promise.all(open.map((c) => c.close()));
  await fixtures.cleanup();
});

const call = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

const data = (result: { structuredContent?: unknown }) =>
  result.structuredContent as Record<string, unknown>;

describe('set_stock and set_price (§4.5)', () => {
  it('get_product, then set_stock: the version goes up by one and the stock is set', async () => {
    const p = await fixtures.create({ stock: 2 });
    const got = data(await call(writer, 'get_product', { id: p.id }));
    const result = await call(writer, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: got.version,
      dryRun: false,
    });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toMatchObject({
      dryRun: false,
      previous: { stock: 2 },
      current: { stock: 40 },
      changed: true,
      version: p.version + 1,
      confirmedAfterTimeout: false,
    });
    const after = await fixtures.get(p.id);
    expect(after).toMatchObject({ stock: 40, version: p.version + 1 });
  });

  it('a concurrent update planted after the read gives STALE_VERSION with the current version', async () => {
    const p = await fixtures.create({ stock: 2 });
    const got = data(await call(writer, 'get_product', { id: p.id }));
    await fixtures.plantUpdate(p.id, { stock: 77 }, p.version);
    const result = await call(writer, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: got.version,
      dryRun: false,
    });
    expect(errorOf(result)).toMatchObject({
      code: 'STALE_VERSION',
      retryable: true,
      details: { currentVersion: p.version + 1 },
      hint: `the product changed (current version ${p.version + 1}); call get_product, check the change still makes sense, then retry with expectedVersion ${p.version + 1}`,
    });
    // The other client's write stands.
    expect(await fixtures.get(p.id)).toMatchObject({
      stock: 77,
      version: p.version + 1,
    });
  });

  it('dryRun writes nothing', async () => {
    const p = await fixtures.create({ stock: 2 });
    const result = await call(writer, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: p.version,
      dryRun: true,
    });
    expect(data(result)).toEqual({
      dryRun: true,
      id: p.id,
      sku: p.sku,
      name: p.name,
      current: { stock: 2 },
      proposed: { stock: 40 },
      wouldChange: true,
      version: p.version,
    });
    const after = await fixtures.get(p.id);
    expect(after).toMatchObject({ stock: 2, version: p.version });
    expect(after.updatedAt).toBe(p.updatedAt);
  });

  it('a no-op writes nothing: the version stays', async () => {
    const p = await fixtures.create({ stock: 2 });
    const result = await call(writer, 'set_stock', {
      id: p.id,
      stock: 2,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(data(result)).toMatchObject({ changed: false, version: p.version });
    const after = await fixtures.get(p.id);
    expect(after.version).toBe(p.version);
    expect(after.updatedAt).toBe(p.updatedAt);
  });

  it('set_price sets the price in cents and reports it formatted', async () => {
    const p = await fixtures.create({ priceCents: 79900 });
    const result = await call(writer, 'set_price', {
      id: p.id,
      priceCents: 125050,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(data(result)).toMatchObject({
      previous: { priceCents: 79900, price: '799.00 EGP', currency: 'EGP' },
      current: { priceCents: 125050, price: '1250.50 EGP', currency: 'EGP' },
      version: p.version + 1,
    });
    expect(await fixtures.get(p.id)).toMatchObject({
      priceCents: 125050,
      stock: p.stock,
    });
  });

  it('an unknown id is NOT_FOUND', async () => {
    const result = await call(writer, 'set_stock', {
      id: randomUUID(),
      stock: 1,
      expectedVersion: 1,
      dryRun: false,
    });
    expect(errorOf(result)).toMatchObject({
      code: 'NOT_FOUND',
      retryable: false,
      hint: 'check the id; use search_products to find it',
    });
  });
});

describe('create_product', () => {
  it('creates a product that get_product then returns', async () => {
    const sku = fixtures.sku();
    const result = await call(writer, 'create_product', {
      ...fixtures.newProduct(),
      sku,
    });
    expect(result.isError).toBeFalsy();
    const created = data(result);
    expect(created).toMatchObject({
      sku,
      category: fixtures.category,
      currency: 'EGP',
      price: '799.00 EGP',
      version: 1,
    });
    const got = await call(writer, 'get_product', { id: created.id });
    expect(data(got)).toEqual(created);
  });

  it('a duplicate sku is SKU_EXISTS, and nothing is created', async () => {
    const p = await fixtures.create();
    const before = (await fixtures.all()).length;
    const result = await call(writer, 'create_product', {
      ...fixtures.newProduct(),
      sku: p.sku,
    });
    expect(errorOf(result)).toMatchObject({
      code: 'SKU_EXISTS',
      retryable: false,
      hint: 'a product with this sku already exists',
    });
    expect(await fixtures.all()).toHaveLength(before);
  });
});

describe('CATALOG_ACCESS and the key: the two layers (ADR-0006)', () => {
  it('write access with the read key: catalog-api refuses every write with 403 FORBIDDEN', async () => {
    const p = await fixtures.create({ stock: 2 });
    const reader = await connect({ CATALOG_API_KEY: KEYS.read });
    const set = await call(reader, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(errorOf(set)).toMatchObject({
      code: 'FORBIDDEN',
      retryable: false,
      hint: expect.stringMatching(/write scope/),
    });
    const create = await call(reader, 'create_product', {
      ...fixtures.newProduct(),
    });
    expect(errorOf(create)).toMatchObject({ code: 'FORBIDDEN' });
    expect(await fixtures.get(p.id)).toMatchObject({
      stock: 2,
      version: p.version,
    });
  });

  it('read access: the write tools are not listed, and calling one is an unknown tool', async () => {
    const reader = await connect({
      CATALOG_API_KEY: KEYS.read,
      CATALOG_ACCESS: 'read',
    });
    const { tools } = await reader.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'search_products',
      'get_product',
      'list_facets',
    ]);
    await expect(
      call(reader, 'set_stock', {
        id: randomUUID(),
        stock: 1,
        expectedVersion: 1,
        dryRun: false,
      }),
    ).rejects.toThrow('Tool set_stock not found');
  });

  it('an unknown key is UNAUTHORIZED, a configuration problem', async () => {
    const p = await fixtures.create();
    const stranger = await connect({
      CATALOG_API_KEY: 'not-a-real-key-but-long-enough-0000000000',
    });
    const result = await call(stranger, 'set_stock', {
      id: p.id,
      stock: 9,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(errorOf(result)).toMatchObject({
      code: 'UNAUTHORIZED',
      hint: "the MCP server's catalog key is missing or wrong (configuration problem)",
    });
  });
});

describe('through the fault proxy (§4.3 UNAVAILABLE and INTERNAL, §4.4)', () => {
  // Well clear of a normal write (about 1 s), so only the injected faults time out.
  const TIMEOUT_MS = '3000';
  let proxy: FaultProxy;
  let faulty: Client;

  beforeAll(async () => {
    proxy = await startFaultProxy(BASE_URL);
    faulty = await connect({
      CATALOG_API_URL: proxy.url,
      CATALOG_TIMEOUT_MS: TIMEOUT_MS,
    });
  });

  afterAll(async () => {
    await faulty?.close();
    await proxy?.close();
  });

  it('the first read unavailable: a plain UNAVAILABLE, and nothing written', async () => {
    const p = await fixtures.create({ stock: 2 });
    proxy.next({ status: 503 }, { status: 503 }, { status: 503 });
    const result = await call(faulty, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: p.version,
      dryRun: false,
    });
    const error = errorOf(result);
    expect(error).toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
      hint: 'temporary; retry later',
    });
    expect(error.details).toBeUndefined();
    expect(await fixtures.get(p.id)).toMatchObject({ version: p.version });
  });

  it('the PATCH landed but its response was lost: confirmed after the timeout', async () => {
    const p = await fixtures.create({ stock: 2 });
    proxy.next('pass', 'cutAfterForward');
    const result = await call(faulty, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(result.isError).toBeFalsy();
    expect(data(result)).toMatchObject({
      current: { stock: 40 },
      version: p.version + 1,
      confirmedAfterTimeout: true,
    });
    expect(await fixtures.get(p.id)).toMatchObject({
      stock: 40,
      version: p.version + 1,
    });
  });

  it("a create whose response was lost: UNAVAILABLE with the create hint, and the hint's search finds it", async () => {
    const product = {
      ...fixtures.newProduct(),
      name: `Lost create ${randomUUID().slice(0, 8)}`,
    };
    proxy.next('cutAfterForward');
    const result = await call(faulty, 'create_product', product);
    expect(errorOf(result)).toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
      details: { outcome: 'unknown', cause: 'timeout' },
      // The exact text is pinned in write-tools.test.ts.
      hint: expect.stringMatching(
        /^the product may have been created\. .*sort newest.*retry with the same sku/,
      ),
    });
    // Following the hint, through the tools:
    const found = data(
      await call(writer, 'search_products', {
        q: product.name,
        category: product.category,
        sort: 'newest',
      }),
    );
    expect((found.hits as { sku: string }[]).map((h) => h.sku)).toContain(
      product.sku,
    );
    // And the hint's promise: a retry with the same sku can't duplicate it.
    const retry = await call(faulty, 'create_product', product);
    expect(errorOf(retry)).toMatchObject({ code: 'SKU_EXISTS' });
    const copies = (await fixtures.all()).filter((p) => p.sku === product.sku);
    expect(copies).toHaveLength(1);
  });

  it("a write planted between our read and our PATCH: catalog-api's own 412, as STALE_VERSION (review 6)", async () => {
    const p = await fixtures.create({ stock: 2 });
    // The first read passes; just before the PATCH is forwarded, another
    // client writes. Our pre-read saw the old version, so only If-Match can
    // catch this.
    proxy.next('pass', {
      before: () => fixtures.plantUpdate(p.id, { stock: 77 }, p.version),
    });
    const result = await call(faulty, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(errorOf(result)).toMatchObject({
      code: 'STALE_VERSION',
      // catalog-api's message, not our pre-read's (the same wording).
      message: `product changed: you sent version ${p.version}, current is ${p.version + 1}`,
      details: { currentVersion: p.version + 1 },
    });
    expect(proxy.log.slice(-2).map((r) => `${r.method} ${r.fault}`)).toEqual([
      'GET pass',
      'PATCH before',
    ]);
    expect(await fixtures.get(p.id)).toMatchObject({
      stock: 77,
      version: p.version + 1,
    });
  });

  it('a 500 on the PATCH is INTERNAL, and is not retried', async () => {
    const p = await fixtures.create({ stock: 2 });
    proxy.next('pass', { status: 500 });
    const before = proxy.log.length;
    const result = await call(faulty, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(errorOf(result)).toMatchObject({
      code: 'INTERNAL',
      retryable: false,
    });
    expect(proxy.log.slice(before).map((r) => r.method)).toEqual([
      'GET',
      'PATCH',
    ]);
  });

  it('a 500 from catalog-api is INTERNAL, and is not retried', async () => {
    const p = await fixtures.create();
    proxy.next({ status: 500 });
    const before = proxy.log.length;
    const result = await call(faulty, 'set_stock', {
      id: p.id,
      stock: 40,
      expectedVersion: p.version,
      dryRun: false,
    });
    expect(errorOf(result)).toMatchObject({
      code: 'INTERNAL',
      retryable: false,
    });
    expect(proxy.log.length - before).toBe(1);
  });
});

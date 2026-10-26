import { afterEach, describe, expect, it } from 'vitest';
import type { Product } from '../catalog/types.js';
import {
  call,
  closeAll,
  harness,
  json,
  KEY,
  summaryOf,
  timeout,
  type Handler,
} from '../testing/harness.js';
import { ERAS, errorOf } from '../testing/mcp.js';

// MCP-level tests (§4.5) of the write tools, in both protocol eras: the tool
// list per CATALOG_ACCESS, every path of the set tools' flow (ADR-0006), and
// create_product. catalog-api is a scripted fake behind a real CatalogClient.

afterEach(closeAll);

const ID = '01150e76-a154-4f63-a9b7-497146a129f0';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: ID,
  sku: 'SKU-1',
  name: 'Product 1',
  description: 'A product',
  category: 'books',
  brand: 'Acme',
  priceCents: 79900,
  currency: 'EGP',
  stock: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 3,
  ...overrides,
});

const ok =
  (p: Product): Handler =>
  () =>
    json(200, p);

const stale =
  (sent: number, current: number): Handler =>
  () =>
    json(412, {
      statusCode: 412,
      message: `product changed: you sent version ${sent}, current is ${current}`,
      error: 'Precondition Failed',
      currentVersion: current,
    });

/**
 * create_product's hint after an unknown outcome (ADR-0006). Newest first, so
 * the new product heads the hits even when names repeat. And the same sku
 * can't make a duplicate, so a retry with it is safe (review 4).
 */
const CREATE_UNKNOWN_HINT =
  'the product may have been created. Call search_products with q set to its name, category set to its category and sort newest, and look for its sku in the hits. If it is not there, retry with the same sku: that cannot create a duplicate, and SKU_EXISTS then means the product was created. Never change the sku to get past SKU_EXISTS';

const READ_TOOLS = ['search_products', 'get_product', 'list_facets'];
const WRITE_TOOLS = ['create_product', 'set_price', 'set_stock'];

describe.each(ERAS)('write tools (%s era)', (era) => {
  const write = (...steps: Handler[]) => harness(era, 'write', ...steps);

  describe('CATALOG_ACCESS', () => {
    it('write lists the read tools, then the write tools, with their annotations', async () => {
      const h = await write();
      const { tools } = await h.client.listTools();
      expect(tools.map((t) => t.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      for (const name of READ_TOOLS) {
        expect(byName[name]?.annotations).toEqual({
          readOnlyHint: true,
          openWorldHint: false,
        });
      }
      expect(byName.create_product?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      for (const name of ['set_price', 'set_stock']) {
        expect(byName[name]?.annotations).toEqual({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        });
      }
      for (const name of WRITE_TOOLS) {
        const tool = byName[name];
        expect(tool?.title).toBeTruthy();
        expect(tool?.outputSchema).toBeDefined();
        expect(tool?.inputSchema.additionalProperties).toBe(false);
      }
      expect(byName.set_stock?.inputSchema.required?.sort()).toEqual([
        'dryRun',
        'expectedVersion',
        'id',
        'stock',
      ]);
      expect(byName.set_price?.inputSchema.required?.sort()).toEqual([
        'dryRun',
        'expectedVersion',
        'id',
        'priceCents',
      ]);
      expect(byName.create_product?.inputSchema.required?.sort()).toEqual([
        'brand',
        'category',
        'description',
        'name',
        'priceCents',
        'sku',
        'stock',
      ]);
    });

    it('read registers no write tool: a call to one fails, and nothing reaches catalog-api', async () => {
      const h = await harness(era, 'read');
      const { tools } = await h.client.listTools();
      expect(tools.map((t) => t.name)).toEqual(READ_TOOLS);
      // An unknown tool is a protocol error (JSON-RPC -32602), not a tool
      // result: the tool doesn't exist, so there's nothing to run.
      for (const name of WRITE_TOOLS) {
        await expect(
          call(h, name, {
            id: ID,
            stock: 5,
            expectedVersion: 3,
            dryRun: false,
          }),
        ).rejects.toThrow(`Tool ${name} not found`);
      }
      expect(h.sent).toHaveLength(0);
    });
  });

  describe('set_stock', () => {
    const args = (stock: number, dryRun: boolean, expectedVersion = 3) => ({
      id: ID,
      stock,
      expectedVersion,
      dryRun,
    });

    it('a dry run reads the product and writes nothing', async () => {
      const h = await write(ok(product()));
      const result = await call(h, 'set_stock', args(50, true));
      expect(result.isError).toBeFalsy();
      expect(h.sent.map((r) => r.method)).toEqual(['GET']);
      expect(h.sent[0]?.url.pathname).toBe(`/products/${ID}`);
      expect(result.structuredContent).toEqual({
        dryRun: true,
        id: ID,
        sku: 'SKU-1',
        name: 'Product 1',
        current: { stock: 4 },
        proposed: { stock: 50 },
        wouldChange: true,
        version: 3,
      });
      expect(summaryOf(result)).toBe(
        'Dry run: stock of Product 1 (SKU-1) would go from 4 to 50. Nothing was written. To apply it, call set_stock with dryRun: false and expectedVersion 3.',
      );
    });

    it('a dry run with nothing to change says so', async () => {
      const h = await write(ok(product()));
      const result = await call(h, 'set_stock', args(4, true));
      expect(result.structuredContent).toMatchObject({
        dryRun: true,
        current: { stock: 4 },
        proposed: { stock: 4 },
        wouldChange: false,
        version: 3,
      });
      expect(summaryOf(result)).toBe(
        'Dry run: stock of Product 1 (SKU-1) is already 4; set_stock would change nothing.',
      );
      expect(h.sent).toHaveLength(1);
    });

    it('a dry run with a stale expectedVersion is STALE_VERSION, so it says the real call would fail', async () => {
      const h = await write(ok(product({ version: 5 })));
      const result = await call(h, 'set_stock', args(50, true));
      expect(errorOf(result)).toEqual({
        code: 'STALE_VERSION',
        message: 'product changed: you sent version 3, current is 5',
        retryable: true,
        hint: 'the product changed (current version 5); call get_product, check the change still makes sense, then retry with expectedVersion 5',
        details: { currentVersion: 5 },
      });
      expect(h.sent).toHaveLength(1);
    });

    it('applies the change: a GET, then a PATCH of exactly that field with If-Match', async () => {
      const h = await write(
        ok(product()),
        ok(product({ stock: 50, version: 4 })),
      );
      const result = await call(h, 'set_stock', args(50, false));
      expect(result.isError).toBeFalsy();
      expect(h.sent.map((r) => r.method)).toEqual(['GET', 'PATCH']);
      const patch = h.sent[1];
      expect(patch?.url.pathname).toBe(`/products/${ID}`);
      expect(patch?.body).toStrictEqual({ stock: 50 });
      expect(patch?.ifMatch).toBe('"3"');
      expect(result.structuredContent).toEqual({
        dryRun: false,
        id: ID,
        sku: 'SKU-1',
        name: 'Product 1',
        previous: { stock: 4 },
        current: { stock: 50 },
        changed: true,
        version: 4,
        confirmedAfterTimeout: false,
      });
      expect(summaryOf(result)).toBe(
        'Stock of Product 1 (SKU-1) set from 4 to 50; now version 4.',
      );
    });

    it('a no-op sends no PATCH, so the version stays (ADR-0006)', async () => {
      const h = await write(ok(product({ stock: 50 })));
      const result = await call(h, 'set_stock', args(50, false));
      expect(result.isError).toBeFalsy();
      expect(h.sent.map((r) => r.method)).toEqual(['GET']);
      expect(result.structuredContent).toEqual({
        dryRun: false,
        id: ID,
        sku: 'SKU-1',
        name: 'Product 1',
        previous: { stock: 50 },
        current: { stock: 50 },
        changed: false,
        version: 3,
        confirmedAfterTimeout: false,
      });
      expect(summaryOf(result)).toBe(
        'Stock of Product 1 (SKU-1) is already 50; nothing was written (still version 3).',
      );
    });

    it('checks the version before the value: a stale call is STALE_VERSION even if the value matches', async () => {
      const h = await write(ok(product({ stock: 50, version: 4 })));
      const result = await call(h, 'set_stock', args(50, false));
      expect(errorOf(result)).toMatchObject({
        code: 'STALE_VERSION',
        details: { currentVersion: 4 },
      });
      expect(h.sent).toHaveLength(1);
    });

    it('stale at the first read: STALE_VERSION and no PATCH', async () => {
      const h = await write(ok(product({ version: 4 })));
      const result = await call(h, 'set_stock', args(50, false));
      expect(errorOf(result)).toMatchObject({
        code: 'STALE_VERSION',
        message: 'product changed: you sent version 3, current is 4',
        details: { currentVersion: 4 },
      });
      expect(h.sent.map((r) => r.method)).toEqual(['GET']);
    });

    it('a first read older than expectedVersion (a cached copy behind) defers to If-Match: the PATCH is sent (review 1)', async () => {
      // Versions only go up, so an older read is catalog-api's Redis copy
      // lagging a write (its cache delete can fail silently). The read's
      // value can't be trusted either: no no-op answer, even if it matches.
      const h = await write(
        ok(product({ stock: 50, version: 3 })),
        ok(product({ stock: 50, version: 5 })),
      );
      const result = await call(h, 'set_stock', args(50, false, 4));
      expect(result.isError).toBeFalsy();
      expect(h.sent.map((r) => r.method)).toEqual(['GET', 'PATCH']);
      expect(h.sent[1]?.ifMatch).toBe('"4"');
      expect(result.structuredContent).toMatchObject({
        current: { stock: 50 },
        changed: true,
        version: 5,
      });
    });

    it('a first read older than expectedVersion, and the PATCH says stale: STALE_VERSION from catalog-api', async () => {
      const h = await write(ok(product({ version: 3 })), stale(4, 6));
      const result = await call(h, 'set_stock', args(50, false, 4));
      expect(errorOf(result)).toMatchObject({
        code: 'STALE_VERSION',
        details: { currentVersion: 6 },
      });
    });

    it('a dry run cannot defer: an older first read is still STALE_VERSION', async () => {
      const h = await write(ok(product({ version: 3 })));
      const result = await call(h, 'set_stock', args(50, true, 4));
      expect(errorOf(result)).toMatchObject({
        code: 'STALE_VERSION',
        details: { currentVersion: 3 },
      });
      expect(h.sent).toHaveLength(1);
    });

    it('a 412 on the PATCH (a write landed between our read and ours) is STALE_VERSION with the current version', async () => {
      const h = await write(ok(product()), stale(3, 4));
      const result = await call(h, 'set_stock', args(50, false));
      expect(errorOf(result)).toEqual({
        code: 'STALE_VERSION',
        message: 'product changed: you sent version 3, current is 4',
        retryable: true,
        hint: 'the product changed (current version 4); call get_product, check the change still makes sense, then retry with expectedVersion 4',
        details: { currentVersion: 4 },
      });
      expect(h.sent.map((r) => r.method)).toEqual(['GET', 'PATCH']);
    });

    it('a PATCH that times out but applied is confirmed by the re-read (ADR-0004)', async () => {
      const h = await write(
        ok(product()),
        timeout,
        ok(product({ stock: 50, version: 4 })),
      );
      const result = await call(h, 'set_stock', args(50, false));
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        dryRun: false,
        previous: { stock: 4 },
        current: { stock: 50 },
        changed: true,
        version: 4,
        confirmedAfterTimeout: true,
      });
      expect(summaryOf(result)).toBe(
        'Stock of Product 1 (SKU-1) set from 4 to 50; now version 4 (confirmed after a timeout).',
      );
      expect(h.sent.map((r) => r.method)).toEqual(['GET', 'PATCH', 'GET']);
      expect(h.logs.find((l) => l.msg === 'tool call')).toMatchObject({
        tool: 'set_stock',
        outcome: 'ok',
        requests: 3,
      });
    });

    it('both attempts unconfirmed: UNAVAILABLE, the outcome unknown, and "read the product before retrying"', async () => {
      const h = await write(
        ok(product()),
        timeout,
        ok(product()),
        timeout,
        ok(product()),
      );
      const result = await call(h, 'set_stock', args(50, false));
      expect(errorOf(result)).toMatchObject({
        code: 'UNAVAILABLE',
        retryable: true,
        hint: 'the change may have been applied; read the product before retrying',
        details: { outcome: 'unknown' },
      });
      expect(h.sent.map((r) => r.method)).toEqual([
        'GET',
        'PATCH',
        'GET',
        'PATCH',
        'GET',
      ]);
    });

    describe('a cancelled call writes nothing more (review 2)', () => {
      // The MCP client sends notifications/cancelled (2025) or drops the
      // request (2026); the server's handler sees ctx.mcpReq.signal abort.
      const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

      it('cancelled during the first read: no PATCH', async () => {
        const cancel = new AbortController();
        const h = await write(async () => {
          cancel.abort();
          await settle();
          return json(200, product());
        });
        const outcome = h.client
          .callTool(
            { name: 'set_stock', arguments: args(50, false) },
            { signal: cancel.signal },
          )
          .catch((err: unknown) => err);
        expect(await outcome).toBeInstanceOf(Error);
        await settle();
        expect(h.sent.map((r) => r.method)).toEqual(['GET']);
      });

      it("cancelled after a PATCH timed out: the client's one retry isn't sent", async () => {
        const cancel = new AbortController();
        const h = await write(
          ok(product()),
          async () => {
            cancel.abort();
            await settle();
            return timeout(new URL('http://x'), h.sent[1]!);
          },
          ok(product()),
        );
        const outcome = h.client
          .callTool(
            { name: 'set_stock', arguments: args(50, false) },
            { signal: cancel.signal },
          )
          .catch((err: unknown) => err);
        expect(await outcome).toBeInstanceOf(Error);
        await settle();
        expect(h.sent.map((r) => r.method)).toEqual(['GET', 'PATCH', 'GET']);
      });
    });

    it('the first read failing is a plain UNAVAILABLE: nothing was written', async () => {
      const down: Handler = () => json(503, { message: 'unavailable' });
      const h = await write(down, down, down);
      const result = await call(h, 'set_stock', args(50, false));
      const error = errorOf(result);
      expect(error).toMatchObject({
        code: 'UNAVAILABLE',
        retryable: true,
        hint: 'temporary; retry later',
      });
      expect(error.details).toBeUndefined();
      expect(h.sent.map((r) => r.method)).toEqual(['GET', 'GET', 'GET']);
    });

    it('an unknown id is NOT_FOUND from the first read', async () => {
      const h = await write(() =>
        json(404, { message: `product ${ID} not found` }),
      );
      const result = await call(h, 'set_stock', args(50, false));
      expect(errorOf(result)).toMatchObject({
        code: 'NOT_FOUND',
        hint: 'check the id; use search_products to find it',
      });
      expect(h.sent).toHaveLength(1);
    });

    it("the read key's 403 on the PATCH is FORBIDDEN, with the API's message as the hint", async () => {
      const message = 'this endpoint needs the write scope; your key has read';
      const h = await write(ok(product()), () => json(403, { message }));
      const result = await call(h, 'set_stock', args(50, false));
      expect(errorOf(result)).toEqual({
        code: 'FORBIDDEN',
        message,
        retryable: false,
        hint: message,
      });
    });
  });

  describe('set_price', () => {
    const args = (priceCents: number, dryRun: boolean) => ({
      id: ID,
      priceCents,
      expectedVersion: 3,
      dryRun,
    });

    it('a dry run shows the price in both forms', async () => {
      const h = await write(ok(product()));
      const result = await call(h, 'set_price', args(89900, true));
      expect(result.structuredContent).toEqual({
        dryRun: true,
        id: ID,
        sku: 'SKU-1',
        name: 'Product 1',
        current: { priceCents: 79900, price: '799.00 EGP', currency: 'EGP' },
        proposed: { priceCents: 89900, price: '899.00 EGP', currency: 'EGP' },
        wouldChange: true,
        version: 3,
      });
      expect(summaryOf(result)).toBe(
        'Dry run: price of Product 1 (SKU-1) would go from 799.00 EGP (79900) to 899.00 EGP (89900). Nothing was written. To apply it, call set_price with dryRun: false and expectedVersion 3.',
      );
      expect(h.sent).toHaveLength(1);
    });

    it('applies the change: the PATCH body is exactly the price', async () => {
      const h = await write(
        ok(product()),
        ok(product({ priceCents: 89900, version: 4 })),
      );
      const result = await call(h, 'set_price', args(89900, false));
      expect(h.sent[1]?.body).toStrictEqual({ priceCents: 89900 });
      expect(h.sent[1]?.ifMatch).toBe('"3"');
      expect(result.structuredContent).toMatchObject({
        previous: { priceCents: 79900, price: '799.00 EGP' },
        current: { priceCents: 89900, price: '899.00 EGP' },
        changed: true,
        version: 4,
      });
      expect(summaryOf(result)).toBe(
        'Price of Product 1 (SKU-1) set from 799.00 EGP (79900) to 899.00 EGP (89900); now version 4.',
      );
    });

    it('a no-op sends no PATCH', async () => {
      const h = await write(ok(product()));
      const result = await call(h, 'set_price', args(79900, false));
      expect(result.structuredContent).toMatchObject({
        changed: false,
        version: 3,
      });
      expect(summaryOf(result)).toBe(
        'Price of Product 1 (SKU-1) is already 799.00 EGP (79900); nothing was written (still version 3).',
      );
      expect(h.sent).toHaveLength(1);
    });
  });

  describe('create_product', () => {
    const input = {
      sku: 'SKU-1',
      name: 'Product 1',
      description: 'A product',
      category: 'books',
      brand: 'Acme',
      priceCents: 79900,
      stock: 4,
    };
    const created = () => json(201, product({ version: 1 }));

    it('creates the product and returns it with its version and price', async () => {
      const h = await write(created);
      const result = await call(h, 'create_product', input);
      expect(result.isError).toBeFalsy();
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.method).toBe('POST');
      expect(h.sent[0]?.url.pathname).toBe('/products');
      // No currency key at all when it's left out: catalog-api defaults it.
      expect(h.sent[0]?.body).toStrictEqual(input);
      expect(result.structuredContent).toEqual({
        ...product({ version: 1 }),
        price: '799.00 EGP',
      });
      expect(summaryOf(result)).toBe(
        `Created Product 1 (SKU-1): id ${ID}, 799.00 EGP, stock 4, version 1.`,
      );
    });

    it('passes the currency when given', async () => {
      const h = await write(() =>
        json(201, product({ version: 1, currency: 'USD' })),
      );
      await call(h, 'create_product', { ...input, currency: 'USD' });
      expect(h.sent[0]?.body).toStrictEqual({ ...input, currency: 'USD' });
    });

    it('a taken sku is SKU_EXISTS', async () => {
      const h = await write(() =>
        json(409, { statusCode: 409, message: 'sku already exists' }),
      );
      const result = await call(h, 'create_product', input);
      expect(errorOf(result)).toEqual({
        code: 'SKU_EXISTS',
        message: 'sku already exists',
        retryable: false,
        hint: 'a product with this sku already exists',
      });
    });

    it('a timeout is never retried: UNAVAILABLE, the outcome unknown, and how to look for the product', async () => {
      const h = await write(timeout);
      const result = await call(h, 'create_product', input);
      expect(errorOf(result)).toMatchObject({
        code: 'UNAVAILABLE',
        retryable: true,
        hint: CREATE_UNKNOWN_HINT,
        details: { outcome: 'unknown', cause: 'timeout' },
      });
      expect(h.sent).toHaveLength(1);
    });

    it("the read key's 403 is FORBIDDEN", async () => {
      const message = 'this endpoint needs the write scope; your key has read';
      const h = await write(() => json(403, { message }));
      const result = await call(h, 'create_product', input);
      expect(errorOf(result)).toMatchObject({
        code: 'FORBIDDEN',
        hint: message,
      });
    });
  });

  it('rejects a bad call before it reaches catalog-api (the SDK validation text)', async () => {
    const h = await write();
    const cases: [string, Record<string, unknown>, RegExp][] = [
      [
        'set_stock',
        { id: ID, stock: -1, expectedVersion: 3, dryRun: true },
        /stock/,
      ],
      ['set_stock', { id: ID, stock: 5, expectedVersion: 3 }, /dryRun/],
      ['set_stock', { id: ID, stock: 5, dryRun: false }, /expectedVersion/],
      [
        'set_stock',
        { id: ID, delta: 5, stock: 5, expectedVersion: 3, dryRun: false },
        /delta/,
      ],
      [
        'set_price',
        { id: ID, priceCents: 1.5, expectedVersion: 3, dryRun: true },
        /priceCents/,
      ],
      ['create_product', { name: 'x' }, /sku/],
    ];
    for (const [name, args, pattern] of cases) {
      const result = await call(h, name, args);
      expect(result.isError).toBe(true);
      expect(summaryOf(result)).toMatch(/Input validation error/);
      expect(summaryOf(result)).toMatch(pattern);
    }
    expect(h.sent).toHaveLength(0);
  });

  it('no write-tool error result carries the key, a stack trace or the upstream body', async () => {
    const body = `<html>proxy error ${KEY}\n    at handler (/srv/app.js:1:1)</html>`;
    const raw =
      (status: number): Handler =>
      () =>
        new Response(body, {
          status,
          headers: { 'content-type': 'text/html' },
        });
    const setArgs = { id: ID, stock: 50, expectedVersion: 3, dryRun: false };
    const createArgs = {
      sku: 'SKU-1',
      name: 'Product 1',
      description: '',
      category: 'books',
      brand: 'Acme',
      priceCents: 1,
      stock: 1,
    };
    const cases: [string, Record<string, unknown>, Handler[]][] = [
      ['set_stock', setArgs, [ok(product()), raw(500)]],
      ['set_stock', setArgs, [ok(product()), raw(200)]],
      [
        'set_stock',
        setArgs,
        [ok(product()), () => json(403, { message: `no ${KEY}` })],
      ],
      [
        'set_stock',
        setArgs,
        [ok(product()), () => json(409, { message: KEY })],
      ],
      ['set_stock', setArgs, [raw(500)]],
      ['create_product', createArgs, [raw(400)]],
      ['create_product', createArgs, [raw(201)]],
      [
        'create_product',
        createArgs,
        [() => json(409, { message: `dup ${KEY}` })],
      ],
    ];
    for (const [name, args, steps] of cases) {
      const h = await write(...steps);
      const result = await call(h, name, args);
      expect(result.isError).toBe(true);
      const everything = JSON.stringify(result);
      expect(everything).not.toContain(KEY);
      expect(everything).not.toContain('proxy error');
      expect(everything).not.toMatch(/\s+at \S+ \(/);
      expect(h.logs.map((l) => JSON.stringify(l)).join('')).not.toContain(KEY);
    }
  });
});

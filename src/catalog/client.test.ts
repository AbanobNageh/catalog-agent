import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../log.js';
import { CatalogClient } from './client.js';
import { CatalogError } from './errors.js';
import type { Clock } from './retry.js';
import type { Product } from './types.js';

const KEY = 'dev-write-key-not-secret-000000000000000';
const BASE = 'http://catalog.test';
const ID = '11111111-1111-4111-8111-111111111111';

interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}
type Step = (req: Recorded) => Response | Error;

/** A fetch that answers from a script, one step per request, and records the requests. */
function scriptedFetch(...steps: Step[]) {
  const requests: Recorded[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const req: Recorded = {
      method: init.method ?? 'GET',
      url: new URL(input instanceof Request ? input.url : input),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    const step = steps.shift();
    if (!step) {
      return Promise.reject(
        new Error(`unexpected request ${req.method} ${req.url.href}`),
      );
    }
    const result = step(req);
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const timeout = () => () =>
  Object.assign(new Error('The operation was aborted'), {
    name: 'TimeoutError',
  });
const refused = () => () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
  });
const stale = (current: number) =>
  json(412, {
    statusCode: 412,
    message: `product changed: you sent version 1, current is ${current}`,
    error: 'Precondition Failed',
    currentVersion: current,
  });

const product = (overrides: Partial<Product> = {}): Product => ({
  id: ID,
  sku: 'IT-1',
  name: 'Lamp',
  description: 'A lamp',
  category: 'it-test',
  brand: 'Acme',
  priceCents: 79900,
  currency: 'EGP',
  stock: 3,
  createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
  version: 1,
  ...overrides,
});

const instantClock: Clock = { now: () => 0, sleep: () => Promise.resolve() };

function client(fetch: typeof globalThis.fetch, lines: string[] = []) {
  return new CatalogClient({
    baseUrl: BASE,
    apiKey: KEY,
    timeoutMs: 5000,
    fetch,
    clock: instantClock,
    random: () => 0,
    logger: createLogger({ write: (l) => lines.push(l), level: 'debug' }),
  });
}

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as CatalogError,
  );

describe('CatalogClient requests', () => {
  it('search sends only the defined parameters, with the key', async () => {
    const f = scriptedFetch(json(200, { hits: [], total: 0, facets: {} }));
    await client(f.fetch).search({
      category: 'books',
      maxStock: 5,
      sort: 'stock_asc',
      inStock: false,
      q: undefined,
    });
    const [req] = f.requests;
    expect(req?.method).toBe('GET');
    expect(req?.url.pathname).toBe('/products/search');
    expect(Object.fromEntries(req?.url.searchParams ?? [])).toEqual({
      category: 'books',
      maxStock: '5',
      sort: 'stock_asc',
      inStock: 'false',
    });
    expect(req?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(req?.headers.get('accept')).toBe('application/json');
  });

  it('getProduct encodes the id into the path', async () => {
    const f = scriptedFetch(json(200, product()));
    await expect(client(f.fetch).getProduct(ID)).resolves.toEqual(product());
    expect(f.requests[0]?.url.pathname).toBe(`/products/${ID}`);
  });

  it('createProduct POSTs the JSON body', async () => {
    const f = scriptedFetch(json(201, product()));
    const input = {
      sku: 'IT-1',
      name: 'Lamp',
      description: 'A lamp',
      category: 'it-test',
      brand: 'Acme',
      priceCents: 79900,
      stock: 3,
    };
    await client(f.fetch).createProduct(input);
    expect(f.requests[0]).toMatchObject({ method: 'POST', body: input });
    expect(f.requests[0]?.headers.get('content-type')).toBe('application/json');
  });

  it('updateProduct PATCHes with If-Match: "<expectedVersion>"', async () => {
    const f = scriptedFetch(json(200, product({ stock: 23, version: 2 })));
    const result = await client(f.fetch).updateProduct(ID, { stock: 23 }, 1);
    expect(result).toEqual({
      product: product({ stock: 23, version: 2 }),
      confirmedAfterTimeout: false,
      attempts: 1,
    });
    expect(f.requests[0]).toMatchObject({
      method: 'PATCH',
      body: { stock: 23 },
    });
    expect(f.requests[0]?.headers.get('if-match')).toBe('"1"');
  });
});

describe('CatalogClient read retries', () => {
  it('retries a GET on 503, a timeout and a connection error', async () => {
    const f = scriptedFetch(
      json(503, { message: 'search is temporarily unavailable' }),
      timeout(),
      json(200, { hits: [], total: 0, facets: {} }),
    );
    await client(f.fetch).search({});
    expect(f.requests).toHaveLength(3);

    const g = scriptedFetch(refused(), json(200, product()));
    await client(g.fetch).getProduct(ID);
    expect(g.requests).toHaveLength(2);
  });

  it('gives up after 2 retries with UNAVAILABLE', async () => {
    const f = scriptedFetch(timeout(), timeout(), timeout());
    const err = await rejection(client(f.fetch).getProduct(ID));
    expect(err).toMatchObject({ code: 'UNAVAILABLE', retries: 2 });
    expect(f.requests).toHaveLength(3);
  });

  it('never retries a 4xx or a 500', async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      const f = scriptedFetch(json(status, { message: 'no' }));
      await rejection(client(f.fetch).getProduct(ID));
      expect(f.requests).toHaveLength(1);
    }
  });
});

describe('CatalogClient create (never retried)', () => {
  it.each([
    ['a timeout', timeout()],
    ['a 503', json(503, { message: 'unavailable' })],
    ['a connection error', refused()],
  ])(
    '%s: one POST, then UNAVAILABLE with an unknown outcome',
    async (_, step) => {
      const f = scriptedFetch(step);
      const err = await rejection(
        client(f.fetch).createProduct({
          sku: 'IT-1',
          name: 'n',
          description: 'd',
          category: 'c',
          brand: 'b',
          priceCents: 1,
          stock: 1,
        }),
      );
      expect(err).toMatchObject({
        code: 'UNAVAILABLE',
        details: { outcome: 'unknown' },
      });
      expect(f.requests).toHaveLength(1);
    },
  );

  it('a duplicate sku is SKU_EXISTS', async () => {
    const f = scriptedFetch(json(409, { message: 'sku already exists' }));
    const err = await rejection(
      client(f.fetch).createProduct({
        sku: 'SEED-00001',
        name: 'n',
        description: 'd',
        category: 'c',
        brand: 'b',
        priceCents: 1,
        stock: 1,
      }),
    );
    expect(err.code).toBe('SKU_EXISTS');
  });
});

/**
 * ADR-0004: a PATCH that times out (or gets a 503 or a connection error) is
 * re-read, never blindly retried. The script is the sequence of requests.
 */
describe('CatalogClient conditional update: confirm after a timeout', () => {
  const ours = product({ stock: 23, version: 2 });
  const update = (f: ReturnType<typeof scriptedFetch>, lines?: string[]) =>
    client(f.fetch, lines).updateProduct(ID, { stock: 23 }, 1);
  const methods = (f: ReturnType<typeof scriptedFetch>) =>
    f.requests.map((r) => r.method);

  it('landed: the re-read shows our values at version + 1 → confirmed', async () => {
    const f = scriptedFetch(timeout(), json(200, ours));
    await expect(update(f)).resolves.toEqual({
      product: ours,
      confirmedAfterTimeout: true,
      attempts: 1,
    });
    expect(methods(f)).toEqual(['PATCH', 'GET']);
  });

  it.each([
    ['a 503', json(503, { message: 'unavailable' })],
    ['a connection error', refused()],
  ])('also after %s', async (_, step) => {
    const f = scriptedFetch(step, json(200, ours));
    await expect(update(f)).resolves.toMatchObject({
      confirmedAfterTimeout: true,
    });
  });

  it('not landed: still at expectedVersion → one retry with the same If-Match → 200', async () => {
    const f = scriptedFetch(timeout(), json(200, product()), json(200, ours));
    await expect(update(f)).resolves.toEqual({
      product: ours,
      confirmedAfterTimeout: false,
      attempts: 2,
    });
    expect(methods(f)).toEqual(['PATCH', 'GET', 'PATCH']);
    expect(f.requests[2]?.headers.get('if-match')).toBe('"1"');
  });

  it("the retry's 412 is our first attempt landing late → re-read → confirmed", async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product()),
      stale(2),
      json(200, ours),
    );
    await expect(update(f)).resolves.toEqual({
      product: ours,
      confirmedAfterTimeout: true,
      attempts: 2,
    });
    expect(methods(f)).toEqual(['PATCH', 'GET', 'PATCH', 'GET']);
  });

  it("the retry's 412 from someone else's write → STALE_VERSION", async () => {
    const theirs = product({ stock: 2, version: 2 });
    const f = scriptedFetch(
      timeout(),
      json(200, product()),
      stale(2),
      json(200, theirs),
    );
    const err = await rejection(update(f));
    expect(err).toMatchObject({
      code: 'STALE_VERSION',
      retryable: true,
      details: { currentVersion: 2 },
    });
  });

  it('the retry times out too and nothing changed → UNAVAILABLE, outcome unknown, no third PATCH', async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product()),
      timeout(),
      json(200, product()),
    );
    const err = await rejection(update(f));
    expect(err).toMatchObject({
      code: 'UNAVAILABLE',
      details: { outcome: 'unknown' },
    });
    expect(methods(f)).toEqual(['PATCH', 'GET', 'PATCH', 'GET']);
  });

  it('the retry times out but landed → confirmed', async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product()),
      timeout(),
      json(200, ours),
    );
    await expect(update(f)).resolves.toMatchObject({
      confirmedAfterTimeout: true,
      attempts: 2,
    });
  });

  it('a concurrent write (other values at version + 1) → STALE_VERSION, no retry', async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product({ stock: 2, version: 2 })),
    );
    const err = await rejection(update(f));
    expect(err).toMatchObject({
      code: 'STALE_VERSION',
      details: { currentVersion: 2 },
    });
    expect(methods(f)).toEqual(['PATCH', 'GET']);
  });

  it('our values but at version + 2 → STALE_VERSION (someone else wrote too)', async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product({ stock: 23, version: 3 })),
    );
    const err = await rejection(update(f));
    expect(err).toMatchObject({
      code: 'STALE_VERSION',
      details: { currentVersion: 3 },
    });
  });

  it('every changed field must match, not just one', async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product({ stock: 23, priceCents: 1, version: 2 })),
    );
    const err = await rejection(
      client(f.fetch).updateProduct(ID, { stock: 23, priceCents: 2 }, 1),
    );
    expect(err.code).toBe('STALE_VERSION');
  });

  it('the product is gone → NOT_FOUND', async () => {
    const f = scriptedFetch(timeout(), json(404, { message: 'not found' }));
    expect((await rejection(update(f))).code).toBe('NOT_FOUND');
  });

  it('the re-read fails too (with its own retries) → UNAVAILABLE, outcome unknown', async () => {
    const f = scriptedFetch(timeout(), timeout(), timeout(), timeout());
    const err = await rejection(update(f));
    expect(err).toMatchObject({
      code: 'UNAVAILABLE',
      details: { outcome: 'unknown' },
    });
    expect(methods(f)).toEqual(['PATCH', 'GET', 'GET', 'GET']);
  });

  it('a 412 on the first attempt is STALE_VERSION at once: no re-read', async () => {
    const f = scriptedFetch(stale(5));
    const err = await rejection(update(f));
    expect(err).toMatchObject({
      code: 'STALE_VERSION',
      status: 412,
      details: { currentVersion: 5 },
    });
    expect(methods(f)).toEqual(['PATCH']);
  });

  it.each([400, 403, 404, 500])(
    'a %i on the first attempt is returned as is: no re-read, no retry',
    async (status) => {
      const f = scriptedFetch(json(status, { message: 'no' }));
      await rejection(update(f));
      expect(methods(f)).toEqual(['PATCH']);
    },
  );

  it('logs every request with the call context, and never the key', async () => {
    const lines: string[] = [];
    const f = scriptedFetch(
      timeout(),
      json(200, product()),
      stale(2),
      json(200, ours),
    );
    await client(f.fetch, lines).updateProduct(ID, { stock: 23 }, 1, {
      tool: 'set_stock',
      correlationId: 'corr-1',
    });
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        tool: 'set_stock',
        correlationId: 'corr-1',
      });
    }
    expect(entries[0]).toMatchObject({
      method: 'PATCH',
      path: `/products/${ID}`,
      code: 'UNAVAILABLE',
    });
    expect(typeof entries[0]?.durationMs).toBe('number');
    expect(entries[1]).toMatchObject({ method: 'GET', status: 200 });
    expect(lines.join('')).not.toContain(KEY);
  });

  it('each request line carries its retry number (§4.4: the retry count)', async () => {
    const lines: string[] = [];
    const f = scriptedFetch(timeout(), timeout(), json(200, product()));
    await client(f.fetch, lines).getProduct(ID);
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.map((e) => e.retry)).toEqual([0, 1, 2]);
  });

  it('the retried PATCH is logged as retry 1', async () => {
    const lines: string[] = [];
    const f = scriptedFetch(timeout(), json(200, product()), json(200, ours));
    await update(f, lines);
    const patches = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.method === 'PATCH');
    expect(patches.map((e) => e.retry)).toEqual([0, 1]);
  });

  it('generates a correlation id when the caller gives none', async () => {
    const lines: string[] = [];
    const f = scriptedFetch(json(200, product()));
    await client(f.fetch, lines).getProduct(ID);
    const [entry] = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entry?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// The tool layer passes one stats object per tool call and logs it (§4.4: the
// retry count). A successful read's retries are otherwise lost.
describe('CatalogClient call stats', () => {
  const fresh = () => ({ requests: 0, retries: 0 });
  const ours = product({ stock: 23, version: 2 });

  it('a read that succeeds after 2 retries counts 3 requests and 2 retries', async () => {
    const stats = fresh();
    const f = scriptedFetch(timeout(), json(503, {}), json(200, product()));
    await client(f.fetch).getProduct(ID, { stats });
    expect(stats).toEqual({ requests: 3, retries: 2 });
  });

  it('a failed read fills the stats too', async () => {
    const stats = fresh();
    const f = scriptedFetch(timeout(), timeout(), timeout());
    await rejection(client(f.fetch).search({}, { stats }));
    expect(stats).toEqual({ requests: 3, retries: 2 });
  });

  it('a non-retried failure counts one request', async () => {
    const stats = fresh();
    const f = scriptedFetch(json(404, { message: 'not found' }));
    await rejection(client(f.fetch).getProduct(ID, { stats }));
    expect(stats).toEqual({ requests: 1, retries: 0 });
  });

  it("an update's re-read and retry are counted", async () => {
    const stats = fresh();
    const f = scriptedFetch(timeout(), json(200, product()), json(200, ours));
    await client(f.fetch).updateProduct(ID, { stock: 23 }, 1, { stats });
    // PATCH (timeout), GET (re-read), PATCH (retry 1)
    expect(stats).toEqual({ requests: 3, retries: 1 });
  });

  it('the stats object is not written into the log lines', async () => {
    const lines: string[] = [];
    const f = scriptedFetch(json(200, product()));
    await client(f.fetch, lines).getProduct(ID, { stats: fresh() });
    expect(lines.join('')).not.toContain('"stats"');
  });
});

describe('CatalogClient with real fetch', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
  });

  it('the timeout covers the body: headers then a stall still time out', async () => {
    server = createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"id":'); // and never finish
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    const c = new CatalogClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: KEY,
      timeoutMs: 150,
      clock: instantClock,
      random: () => 0,
      logger: createLogger({ write: () => {} }),
    });
    const started = performance.now();
    const err = await rejection(c.getProduct(ID));
    expect(err).toMatchObject({
      code: 'UNAVAILABLE',
      details: { cause: 'timeout' },
    });
    // 3 attempts × 150 ms, with no waits between them (random 0).
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

// Fixes from the M1 fresh review.
describe('CatalogClient after an ambiguous first attempt (review I1)', () => {
  const update = (f: ReturnType<typeof scriptedFetch>) =>
    client(f.fetch).updateProduct(ID, { stock: 23 }, 1);

  it('the re-read gets a 500 → UNAVAILABLE, outcome unknown (the PATCH may still land)', async () => {
    const f = scriptedFetch(timeout(), json(500, { message: 'db blip' }));
    expect(await rejection(update(f))).toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
      details: { outcome: 'unknown' },
    });
  });

  it('the retry gets a 500 → UNAVAILABLE, outcome unknown (the first PATCH may still land)', async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product()),
      json(500, { message: 'db blip' }),
    );
    expect(await rejection(update(f))).toMatchObject({
      code: 'UNAVAILABLE',
      details: { outcome: 'unknown' },
    });
  });

  it('NOT_FOUND and STALE_VERSION stay as they are', async () => {
    const gone = scriptedFetch(timeout(), json(404, { message: 'gone' }));
    expect((await rejection(update(gone))).code).toBe('NOT_FOUND');
    const theirs = scriptedFetch(
      timeout(),
      json(200, product({ stock: 2, version: 2 })),
    );
    expect((await rejection(update(theirs))).code).toBe('STALE_VERSION');
  });

  it('a 404 on the retry (deleted meanwhile) stays NOT_FOUND', async () => {
    const f = scriptedFetch(
      timeout(),
      json(200, product()),
      json(404, { message: 'gone' }),
    );
    expect((await rejection(update(f))).code).toBe('NOT_FOUND');
  });

  it('keeps the retry count of a failed re-read (review M6)', async () => {
    const f = scriptedFetch(timeout(), timeout(), timeout(), timeout());
    expect(await rejection(update(f))).toMatchObject({ retries: 2 });
  });
});

describe('CatalogClient review fixes', () => {
  it('rejects an empty change before sending anything (review M1)', async () => {
    const f = scriptedFetch();
    const err = await rejection(client(f.fetch).updateProduct(ID, {}, 1));
    expect(err).toMatchObject({ code: 'VALIDATION', retryable: false });
    expect(f.requests).toHaveLength(0);
  });

  it('a 2xx body that is not JSON is INTERNAL, not a raw SyntaxError with a body snippet (review M5)', async () => {
    const html = () =>
      new Response('<html><body>proxy page</body></html>', { status: 200 });
    const read = await rejection(
      client(scriptedFetch(html).fetch).getProduct(ID),
    );
    expect(read).toBeInstanceOf(CatalogError);
    expect(read).toMatchObject({ code: 'INTERNAL' });
    expect(read.message).not.toContain('<html>');

    const write = await rejection(
      client(scriptedFetch(html).fetch).updateProduct(ID, { stock: 1 }, 1),
    );
    // A 200 means the write happened, but its result is unreadable.
    expect(write).toMatchObject({
      code: 'INTERNAL',
      details: { outcome: 'unknown' },
    });
  });

  it('never puts the key in an error message or details (review M4)', async () => {
    const scripts = [
      [timeout(), timeout(), timeout(), timeout()],
      [refused(), json(500, { message: 'x' })],
      [
        timeout(),
        json(200, product()),
        stale(2),
        json(200, product({ stock: 2, version: 2 })),
      ],
      [
        json(403, {
          message: 'this endpoint needs the write scope; your key has read',
        }),
      ],
    ];
    for (const steps of scripts) {
      const err = await rejection(
        client(scriptedFetch(...steps).fetch).updateProduct(
          ID,
          { stock: 23 },
          1,
        ),
      );
      expect(`${err.message} ${JSON.stringify(err.details)}`).not.toContain(
        KEY,
      );
    }
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFaultProxy, type FaultProxy } from '../testing/fault-proxy.js';
import {
  BASE_URL,
  capturingLogger,
  Fixtures,
  KEYS,
} from '../testing/fixtures.js';
import { CatalogClient } from './client.js';
import type { CatalogError } from './errors.js';

// ADR-0004's branches, driven through the fault proxy in front of the real
// catalog-api. Every test checks the end state with a fresh GET.
const fx = new Fixtures('confirm');
const { logger, lines } = capturingLogger();
// Well above a normal write (about 1 s: search-service waits for an
// OpenSearch refresh), so only the injected faults cause timeouts.
const TIMEOUT_MS = 3000;

let proxy: FaultProxy;
let client: CatalogClient;

beforeEach(async () => {
  proxy = await startFaultProxy(BASE_URL);
  client = new CatalogClient({
    baseUrl: proxy.url,
    apiKey: KEYS.write,
    timeoutMs: TIMEOUT_MS,
    logger,
  });
});
afterEach(() => proxy.close());
afterAll(() => fx.cleanup());

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as CatalogError,
  );
const steps = () => proxy.log.map((r) => `${r.method} ${r.fault}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('conditional update after a lost request or response', () => {
  it('the write landed but its response was lost → confirmed, version + 1 exactly', async () => {
    const p = await fx.create({ stock: 3 });
    proxy.next('cutAfterForward');

    const result = await client.updateProduct(p.id, { stock: 23 }, 1);

    expect(result).toMatchObject({ confirmedAfterTimeout: true, attempts: 1 });
    expect(await fx.get(p.id)).toMatchObject({ stock: 23, version: 2 });
    expect(steps()).toEqual(['PATCH cutAfterForward', 'GET pass']);
  });

  it('the request never arrived → one retry with the same If-Match → applied once', async () => {
    const p = await fx.create({ stock: 3 });
    proxy.next('hang');

    const result = await client.updateProduct(p.id, { stock: 23 }, 1);

    expect(result).toMatchObject({ confirmedAfterTimeout: false, attempts: 2 });
    expect(await fx.get(p.id)).toMatchObject({ stock: 23, version: 2 });
    expect(steps()).toEqual(['PATCH hang', 'GET pass', 'PATCH pass']);
  });

  it('a 503 on the PATCH (from a proxy in front) → re-read → retry → applied once', async () => {
    const p = await fx.create({ stock: 3 });
    proxy.next({ status: 503 });

    const result = await client.updateProduct(p.id, { stock: 23 }, 1);

    expect(result.attempts).toBe(2);
    expect(await fx.get(p.id)).toMatchObject({ stock: 23, version: 2 });
  });

  it('never arrived, and someone else wrote meanwhile → STALE_VERSION; theirs kept', async () => {
    const p = await fx.create({ stock: 3 });
    proxy.next('hang');

    const pending = rejection(client.updateProduct(p.id, { stock: 13 }, 1));
    await wait(200);
    await fx.plantUpdate(p.id, { stock: 2 }, 1); // a sale while we wait

    expect(await pending).toMatchObject({
      code: 'STALE_VERSION',
      details: { currentVersion: 2 },
    });
    expect(await fx.get(p.id)).toMatchObject({ stock: 2, version: 2 });
    expect(steps()).toEqual(['PATCH hang', 'GET pass']);
  });

  it('landed, then someone else wrote before the re-read → STALE_VERSION; no overwrite', async () => {
    const p = await fx.create({ stock: 3 });
    proxy.next('cutAfterForward');

    const pending = rejection(client.updateProduct(p.id, { stock: 23 }, 1));
    await wait(300); // ours has landed (version 2); the client is still waiting
    await fx.plantUpdate(p.id, { stock: 22 }, 2);

    expect(await pending).toMatchObject({
      code: 'STALE_VERSION',
      details: { currentVersion: 3 },
    });
    expect(await fx.get(p.id)).toMatchObject({ stock: 22, version: 3 });
  });
});

describe('read retries through the proxy', () => {
  it('two 503s, then success: 3 GETs', async () => {
    const p = await fx.create();
    proxy.next({ status: 503 }, { status: 503 });

    await expect(client.getProduct(p.id)).resolves.toMatchObject({ id: p.id });
    expect(steps()).toEqual(['GET status 503', 'GET status 503', 'GET pass']);
  });

  it('three 503s: UNAVAILABLE after 2 retries', async () => {
    const p = await fx.create();
    proxy.next({ status: 503 }, { status: 503 }, { status: 503 });

    expect(await rejection(client.getProduct(p.id))).toMatchObject({
      code: 'UNAVAILABLE',
      retries: 2,
    });
    expect(proxy.log).toHaveLength(3);
  });
});

describe('create is never retried', () => {
  it('the request never arrived → UNAVAILABLE, outcome unknown; one POST; no product', async () => {
    const input = fx.newProduct();
    proxy.next('hang');

    expect(await rejection(client.createProduct(input))).toMatchObject({
      code: 'UNAVAILABLE',
      details: { outcome: 'unknown' },
    });
    expect(steps()).toEqual(['POST hang']);
    expect((await fx.all()).filter((p) => p.sku === input.sku)).toHaveLength(0);
  });

  it('it landed but the response was lost → UNAVAILABLE, outcome unknown; exactly one product', async () => {
    const input = fx.newProduct();
    proxy.next('cutAfterForward');

    expect(await rejection(client.createProduct(input))).toMatchObject({
      code: 'UNAVAILABLE',
      details: { outcome: 'unknown' },
    });
    expect(steps()).toEqual(['POST cutAfterForward']);
    expect((await fx.all()).filter((p) => p.sku === input.sku)).toHaveLength(1);
  });
});

describe('logs', () => {
  it('never logged a key', () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const key of Object.values(KEYS)) {
      expect(lines.join('')).not.toContain(key);
    }
  });
});

import { randomBytes } from 'node:crypto';
import { createLogger, type Logger } from '../log.js';
import type { NewProduct, Product } from '../catalog/types.js';

// Test-only helpers for the integration tests (`*.int.test.ts`). They talk to
// catalog-api with plain fetch, not with the client under test.

export const BASE_URL = process.env.CATALOG_API_URL ?? 'http://localhost:3100';

/** The Compose dev keys: public in product-catalog, NOT secret. */
export const KEYS = {
  read: 'dev-read-key-not-secret-0000000000000000',
  write: 'dev-write-key-not-secret-000000000000000',
  admin: 'dev-admin-key-not-secret-000000000000000',
} as const;

/** Unique per test run, so runs never see each other's products. */
export const RUN_ID = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

async function api(
  method: string,
  path: string,
  key: string,
  { body, ifMatch }: { body?: unknown; ifMatch?: number } = {},
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ifMatch !== undefined) headers['if-match'] = `"${ifMatch}"`;
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectOk<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * Products for one test file, all in category `it-<runid>-<suite>`
 * (REQUIREMENTS.md §4.5). Never touches SEED-* products. cleanup() deletes
 * everything in the category with the admin key.
 */
export class Fixtures {
  readonly category: string;
  private count = 0;

  constructor(private readonly suite: string) {
    this.category = `it-${RUN_ID}-${suite}`;
  }

  /** A unique SKU in this suite. */
  sku(): string {
    return `IT-${RUN_ID}-${this.suite}-${++this.count}`;
  }

  newProduct(overrides: Partial<NewProduct> = {}): NewProduct {
    return {
      sku: this.sku(),
      name: 'Integration test product',
      description: 'Created by an integration test; deleted afterwards',
      category: this.category,
      brand: 'ItBrand',
      priceCents: 79900,
      stock: 3,
      ...overrides,
    };
  }

  async create(overrides: Partial<NewProduct> = {}): Promise<Product> {
    return expectOk<Product>(
      await api('POST', '/products', KEYS.write, {
        body: this.newProduct(overrides),
      }),
      'fixture create',
    );
  }

  /** A fresh read, straight from catalog-api. */
  async get(id: string): Promise<Product> {
    return expectOk<Product>(
      await api('GET', `/products/${id}`, KEYS.read),
      'fixture get',
    );
  }

  /** Another client's write: a conditional PATCH with the write key. */
  async plantUpdate(
    id: string,
    changes: Partial<NewProduct>,
    ifMatch: number,
  ): Promise<Product> {
    return expectOk<Product>(
      await api('PATCH', `/products/${id}`, KEYS.write, {
        body: changes,
        ifMatch,
      }),
      'planted update',
    );
  }

  /** Every product in this suite's category, from Postgres (paged list, not search). */
  async all(): Promise<Product[]> {
    const found: Product[] = [];
    // Search is updated synchronously on each write, but filter on the list to
    // be independent of search-service (which pause.int.test.ts pauses).
    for (let page = 1; ; page++) {
      const { items } = await expectOk<{ items: Product[] }>(
        await api('GET', `/products?page=${page}&limit=100`, KEYS.read),
        'fixture list',
      );
      found.push(...items.filter((p) => p.category === this.category));
      // Newest first: once a page is older than this run, stop.
      if (
        items.length < 100 ||
        items.every((p) => !p.category.startsWith(`it-${RUN_ID}`))
      ) {
        return found;
      }
    }
  }

  async cleanup(): Promise<void> {
    for (const product of await this.all()) {
      const res = await api('DELETE', `/products/${product.id}`, KEYS.admin);
      if (!res.ok && res.status !== 404) {
        throw new Error(`cleanup ${product.id}: ${res.status}`);
      }
    }
  }
}

/** A logger that keeps its lines, so tests can check what was logged. */
export function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({ write: (l) => lines.push(l), level: 'debug' }),
  };
}

import { describe, expect, it } from 'vitest';
import {
  createProductInput,
  getProductInput,
  INT32_MAX,
  listFacetsInput,
  searchProductsInput,
  setPriceInput,
  setStockInput,
} from './schemas.js';

const ok =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (value: unknown) =>
    schema.safeParse(value).success;

describe('search_products input (catalog-api v1.1.0 bounds)', () => {
  const valid = ok(searchProductsInput);

  it('fills the defaults: page 1, size 10, no facets', () => {
    expect(searchProductsInput.parse({})).toEqual({
      page: 1,
      size: 10,
      includeFacets: false,
    });
  });

  it.each([
    ['q', 'x'.repeat(200), 'x'.repeat(201)],
    ['q', 'a', ''],
    ['category', 'books', ''],
    ['brand', 'Acme', ''],
    ['minPrice', 0, -1],
    ['minPrice', INT32_MAX, INT32_MAX + 1],
    ['maxPrice', INT32_MAX, INT32_MAX + 1],
    ['maxStock', 0, -1],
    ['maxStock', INT32_MAX, INT32_MAX + 1],
    ['page', 1, 0],
    ['size', 1, 0],
    ['size', 100, 101],
  ] as const)('%s: %j is accepted, %j is not', (field, good, bad) => {
    expect(valid({ [field]: good })).toBe(true);
    expect(valid({ [field]: bad })).toBe(false);
  });

  it('integers only, for prices, stock, page and size', () => {
    for (const field of ['minPrice', 'maxPrice', 'maxStock', 'page', 'size']) {
      expect(valid({ [field]: 1.5 })).toBe(false);
      expect(valid({ [field]: '5' })).toBe(false);
    }
  });

  it('sort is one of the API values', () => {
    for (const sort of [
      'relevance',
      'price_asc',
      'price_desc',
      'newest',
      'stock_asc',
    ]) {
      expect(valid({ sort })).toBe(true);
    }
    expect(valid({ sort: 'stock_desc' })).toBe(false);
  });

  it('maxPrice below minPrice is rejected; equal is fine', () => {
    expect(valid({ minPrice: 500, maxPrice: 500 })).toBe(true);
    expect(valid({ minPrice: 500, maxPrice: 499 })).toBe(false);
  });

  it('page × size can be at most 10,000', () => {
    expect(valid({ page: 100, size: 100 })).toBe(true);
    expect(valid({ page: 101, size: 100 })).toBe(false);
    expect(valid({ page: 1000 })).toBe(true); // size defaults to 10
    expect(valid({ page: 1001 })).toBe(false);
  });

  it('an unknown argument is rejected, not silently dropped', () => {
    expect(valid({ limit: 5 })).toBe(false);
  });
});

describe('list_facets input', () => {
  const valid = ok(listFacetsInput);

  it('takes the same filters', () => {
    expect(
      valid({
        q: 'novel',
        category: 'books',
        brand: 'Acme',
        minPrice: 0,
        maxPrice: 100,
        maxStock: 5,
        inStock: true,
      }),
    ).toBe(true);
    expect(valid({ maxPrice: 1, minPrice: 2 })).toBe(false);
  });

  it('has no paging or sort', () => {
    expect(valid({ sort: 'newest' })).toBe(false);
    expect(valid({ page: 1 })).toBe(false);
    expect(valid({ size: 1 })).toBe(false);
  });
});

describe('get_product input', () => {
  const valid = ok(getProductInput);

  it('id is a UUID', () => {
    expect(valid({ id: '01150e76-a154-4f63-a9b7-497146a129f0' })).toBe(true);
    expect(valid({ id: 'SEED-04007' })).toBe(false);
    expect(valid({})).toBe(false);
  });

  it('an unknown argument is rejected', () => {
    expect(
      valid({ id: '01150e76-a154-4f63-a9b7-497146a129f0', version: 1 }),
    ).toBe(false);
  });
});

describe('create_product input (catalog-api v1.1.0 CreateProductDto)', () => {
  const valid = ok(createProductInput);
  const base = {
    sku: 'BOO-PAP-900',
    name: 'A book',
    description: 'About things',
    category: 'books',
    brand: 'Papyrus',
    priceCents: 79900,
    stock: 3,
  };

  it('takes the create fields; currency is optional', () => {
    expect(createProductInput.parse(base)).toEqual(base);
    expect(valid({ ...base, currency: 'USD' })).toBe(true);
  });

  it.each([
    'sku',
    'name',
    'description',
    'category',
    'brand',
    'priceCents',
    'stock',
  ])('requires %s', (field) => {
    const { [field as keyof typeof base]: _, ...rest } = base;
    expect(valid(rest)).toBe(false);
  });

  it.each([
    ['sku', 'S', ''],
    ['name', 'N', ''],
    ['category', 'c', ''],
    ['brand', 'B', ''],
    ['priceCents', 0, -1],
    ['priceCents', INT32_MAX, INT32_MAX + 1],
    ['stock', 0, -1],
    ['stock', INT32_MAX, INT32_MAX + 1],
    ['currency', 'EGP', 'egp'],
    ['currency', 'EUR', 'EG1'],
    ['currency', 'USD', 'EGPP'],
    ['currency', 'GBP', 'EG'],
  ] as const)('%s: %j is accepted, %j is not', (field, good, bad) => {
    expect(valid({ ...base, [field]: good })).toBe(true);
    expect(valid({ ...base, [field]: bad })).toBe(false);
  });

  it('description may be empty, as catalog-api allows', () => {
    expect(valid({ ...base, description: '' })).toBe(true);
  });

  it('integers only for the price and stock', () => {
    expect(valid({ ...base, priceCents: 799.5 })).toBe(false);
    expect(valid({ ...base, stock: '3' })).toBe(false);
  });

  it('an unknown field is rejected', () => {
    expect(valid({ ...base, version: 1 })).toBe(false);
    expect(valid({ ...base, id: '01150e76-a154-4f63-a9b7-497146a129f0' })).toBe(
      false,
    );
  });
});

describe.each([
  ['set_price', setPriceInput, 'priceCents'],
  ['set_stock', setStockInput, 'stock'],
] as const)('%s input', (_, schema, field) => {
  const valid = ok(schema);
  const base = {
    id: '01150e76-a154-4f63-a9b7-497146a129f0',
    [field]: 50,
    expectedVersion: 3,
    dryRun: true,
  };

  it('takes the id, an absolute value, expectedVersion and dryRun', () => {
    expect(schema.parse(base)).toEqual(base);
    expect(valid({ ...base, dryRun: false })).toBe(true);
  });

  it.each(['id', field, 'expectedVersion', 'dryRun'])('requires %s', (name) => {
    const { [name]: _, ...rest } = base;
    expect(valid(rest)).toBe(false);
  });

  it.each([
    [field, 0, -1],
    [field, INT32_MAX, INT32_MAX + 1],
    // If-Match takes versions from "1" to int32 max (catalog-api's if-match.ts).
    ['expectedVersion', 1, 0],
    ['expectedVersion', INT32_MAX, INT32_MAX + 1],
  ] as const)('%s: %j is accepted, %j is not', (name, good, bad) => {
    expect(valid({ ...base, [name]: good })).toBe(true);
    expect(valid({ ...base, [name]: bad })).toBe(false);
  });

  it('rejects a non-UUID id, non-integers and a non-boolean dryRun', () => {
    expect(valid({ ...base, id: 'SEED-04007' })).toBe(false);
    expect(valid({ ...base, [field]: 1.5 })).toBe(false);
    expect(valid({ ...base, expectedVersion: '3' })).toBe(false);
    expect(valid({ ...base, dryRun: 'false' })).toBe(false);
  });

  it('absolute values only: a delta, or any other field, is rejected', () => {
    expect(valid({ ...base, delta: 5 })).toBe(false);
    const other = field === 'stock' ? 'priceCents' : 'stock';
    expect(valid({ ...base, [other]: 1 })).toBe(false);
  });
});

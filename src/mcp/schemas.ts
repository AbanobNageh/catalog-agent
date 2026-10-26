import * as z from 'zod';
import { SEARCH_SORTS } from '../catalog/types.js';

// Tool input and output schemas. Each tool's `inputSchema` is turned into the
// JSON Schema the model sees in `tools/list`, and the SDK validates every call
// against it before the handler runs, so a bad call never reaches
// catalog-api. The bounds are catalog-api v1.1.0's (REQUIREMENTS.md §3.2);
// contract.int.test.ts checks them against its live /docs-json.

/** catalog-api's integers are int32. A bare z.int() would advertise ±2^53. */
export const INT32_MAX = 2_147_483_647;

/** search-service can't page past this many results (page × size). */
export const SEARCH_WINDOW = 10_000;

export const DEFAULT_PAGE_SIZE = 10;

const nonNegativeInt = () => z.int().min(0).max(INT32_MAX);

/** The search filters, shared by search_products and list_facets. */
const filters = {
  q: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Free text, fuzzy-matched on name and description. Up to 200 characters.',
    ),
  category: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Exact category, case-sensitive: "books" matches, "Books" matches nothing. list_facets lists the values.',
    ),
  brand: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Exact brand, case-sensitive: "Acme" matches, "acme" matches nothing. list_facets lists the values.',
    ),
  minPrice: nonNegativeInt()
    .optional()
    .describe('Lowest price, inclusive, in integer cents: 79900 = 799.00 EGP.'),
  maxPrice: nonNegativeInt()
    .optional()
    .describe(
      'Highest price, inclusive, in integer cents: 79900 = 799.00 EGP.',
    ),
  maxStock: nonNegativeInt()
    .optional()
    .describe(
      'Only products with stock at or below this many units. 0 = out of stock.',
    ),
  inStock: z
    .boolean()
    .optional()
    .describe('true: only products with stock > 0. false: only stock = 0.'),
};

const priceRange = {
  check: (v: {
    minPrice?: number | undefined;
    maxPrice?: number | undefined;
  }) =>
    v.minPrice === undefined ||
    v.maxPrice === undefined ||
    v.maxPrice >= v.minPrice,
  params: { message: 'maxPrice must be at least minPrice', path: ['maxPrice'] },
};

// Strict objects: an unknown argument (say `limit` for `size`) is rejected
// with a message naming it, instead of being dropped without a word.
export const searchProductsInput = z
  .strictObject({
    ...filters,
    sort: z
      .enum(SEARCH_SORTS)
      .optional()
      .describe(
        'relevance (the default; it needs q, and without q it is the same as newest), price_asc, price_desc, newest, or stock_asc (lowest stock first). Ties are ordered by id.',
      ),
    page: z
      .int()
      .min(1)
      .max(SEARCH_WINDOW)
      .default(1)
      .describe('Page number, from 1.'),
    size: z
      .int()
      .min(1)
      .max(100)
      .default(DEFAULT_PAGE_SIZE)
      .describe(
        `Hits per page, 1-100 (default ${DEFAULT_PAGE_SIZE}). page × size can be at most ${SEARCH_WINDOW}.`,
      ),
    includeFacets: z
      .boolean()
      .default(false)
      .describe(
        'Also return counts for the matching products: the top 20 categories, the top 50 brands, and the price buckets.',
      ),
  })
  .refine(priceRange.check, priceRange.params)
  .refine((v) => v.page * v.size <= SEARCH_WINDOW, {
    message: `page × size must be at most ${SEARCH_WINDOW}; narrow the filters instead of paging further`,
    path: ['page'],
  });

export const listFacetsInput = z
  .strictObject(filters)
  .refine(priceRange.check, priceRange.params);

export const getProductInput = z.strictObject({
  id: z
    .uuid()
    .describe('The product id (a UUID), as search_products returns it.'),
});

// Outputs: what structuredContent carries. The SDK checks every successful
// result against these before it's sent.

const bucket = z.object({ key: z.string(), count: z.int() });

const priceBucket = bucket.extend({
  from: z.int().optional().describe('Integer cents, inclusive.'),
  to: z.int().optional().describe('Integer cents, exclusive.'),
});

const facets = z.object({
  categories: z.array(bucket).describe('The top 20 categories by count.'),
  brands: z.array(bucket).describe('The top 50 brands by count.'),
  priceBuckets: z.array(priceBucket),
});

const money = {
  priceCents: z.int().describe('Integer cents: 79900 = 799.00 EGP.'),
  price: z.string().describe('The same price, formatted: "799.00 EGP".'),
  currency: z.string(),
};

export const compactHit = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  brand: z.string(),
  ...money,
  stock: z.int(),
});

export const searchProductsOutput = z.object({
  hits: z.array(compactHit),
  total: z.int().describe('How many products match, across all pages.'),
  page: z.int(),
  size: z.int(),
  hasMore: z.boolean().describe('More matching products after this page.'),
  nextPage: z
    .int()
    .optional()
    .describe('The page to ask for next; absent when it cannot be fetched.'),
  facets: facets.optional(),
});

export const productOutput = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  brand: z.string(),
  ...money,
  stock: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z
    .int()
    .describe(
      'Raised by every change. A write must send it as expectedVersion.',
    ),
});

export const listFacetsOutput = facets.extend({
  total: z.int().describe('How many products match the filters.'),
});

export type SearchProductsInput = z.infer<typeof searchProductsInput>;
export type ListFacetsInput = z.infer<typeof listFacetsInput>;
export type SearchProductsOutput = z.infer<typeof searchProductsOutput>;
export type ProductOutput = z.infer<typeof productOutput>;
export type ListFacetsOutput = z.infer<typeof listFacetsOutput>;
export type Facets = z.infer<typeof facets>;

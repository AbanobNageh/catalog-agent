// catalog-api v1.1.0's shapes (REQUIREMENTS.md §3.2; /docs-json is the source of truth).

/** A product as `GET`, `POST` and `PATCH /products/:id` return it. */
export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  /** Integer cents: 79900 = 799.00 in `currency`. */
  priceCents: number;
  /** ISO 4217, for example EGP. */
  currency: string;
  stock: number;
  createdAt: string;
  updatedAt: string;
  /** +1 on every write. Send it back as `If-Match: "<version>"`. */
  version: number;
}

/** A search hit has no `version`, and may be stale: read the product before writing it. */
export type SearchHit = Omit<Product, 'version'>;

export interface Bucket {
  key: string;
  count: number;
}

export interface PriceBucket extends Bucket {
  /** Cents, inclusive. */
  from?: number;
  /** Cents, exclusive. */
  to?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  /** Counts over the filtered results only. */
  facets: { category: Bucket[]; brand: Bucket[]; price: PriceBucket[] };
}

export const SEARCH_SORTS = [
  'relevance',
  'price_asc',
  'price_desc',
  'newest',
  'stock_asc',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Every parameter is optional; an explicit `undefined` is left out of the query. */
export interface SearchParams {
  q?: string | undefined;
  category?: string | undefined;
  brand?: string | undefined;
  /** Cents, inclusive. */
  minPrice?: number | undefined;
  /** Cents, inclusive. */
  maxPrice?: number | undefined;
  /** stock ≤ maxStock. */
  maxStock?: number | undefined;
  inStock?: boolean | undefined;
  sort?: SearchSort | undefined;
  page?: number | undefined;
  size?: number | undefined;
}

/** The body of `POST /products`. */
export interface NewProduct {
  sku: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  priceCents: number;
  stock: number;
  /** Defaults to EGP. */
  currency?: string;
}

/** Fields a conditional update can set: any subset of the create fields. */
export type ProductChanges = Partial<NewProduct>;

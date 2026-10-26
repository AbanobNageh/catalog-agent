import { randomUUID } from 'node:crypto';
import { createLogger, type Logger } from '../log.js';
import {
  CatalogError,
  fromNetworkError,
  fromResponse,
  type CatalogOp,
} from './errors.js';
import { systemClock, withReadRetries, type Clock } from './retry.js';
import type {
  NewProduct,
  Product,
  ProductChanges,
  SearchParams,
  SearchResult,
} from './types.js';

export interface CatalogClientOptions {
  /** Without a trailing slash (loadConfig strips it). */
  baseUrl: string;
  /** Sent as `Authorization: Bearer`; never logged or put in an error. */
  apiKey: string;
  /** Per request, response body included. */
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  random?: () => number;
  logger?: Logger;
}

/** Who a call is for, so its log lines can be tied to one tool call. */
export interface CallContext {
  tool?: string;
  correlationId?: string;
}

export interface UpdateResult {
  product: Product;
  /** True when the PATCH timed out (or failed) but a re-read proved it applied. */
  confirmedAfterTimeout: boolean;
  /** PATCH requests sent: 1, or 2 after a retry. */
  attempts: number;
}

const MAX_READ_RETRIES = 2;

type Reread = { kind: 'ours'; product: Product } | { kind: 'untouched' };

/**
 * The only way the tools reach catalog-api (REQUIREMENTS.md §4.4). Reads are
 * retried on transient failures; writes never blindly. A conditional update
 * whose outcome is unknown is settled by re-reading the product (ADR-0004).
 */
export class CatalogClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly logger: Logger;

  constructor(private readonly options: CatalogClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.logger = options.logger ?? createLogger();
  }

  search(params: SearchParams, ctx?: CallContext): Promise<SearchResult> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) query.set(name, String(value));
    }
    const qs = query.size > 0 ? `?${query.toString()}` : '';
    return this.read<SearchResult>(
      'search',
      `/products/search${qs}`,
      this.context(ctx),
    );
  }

  getProduct(id: string, ctx?: CallContext): Promise<Product> {
    return this.read<Product>('get', productPath(id), this.context(ctx));
  }

  /**
   * Never retried: there's no idempotency key and no lookup by SKU, so after
   * a timeout nobody can tell whether the product was created.
   */
  async createProduct(input: NewProduct, ctx?: CallContext): Promise<Product> {
    try {
      return await this.send<Product>(
        'create',
        'POST',
        '/products',
        this.context(ctx),
        { body: input },
      );
    } catch (err) {
      if (isTransient(err)) {
        throw outcomeUnknown(err, 'the product may have been created');
      }
      throw err;
    }
  }

  /**
   * A conditional PATCH (`If-Match: "<expectedVersion>"`). After a timeout, a
   * 503 or a connection error, the product is re-read: our values at
   * expectedVersion + 1 mean it applied; still at expectedVersion means retry
   * once; anything else is STALE_VERSION. The retry's own 412 or timeout is
   * settled the same way, because it can be our first attempt landing late.
   * Both attempts carry the same If-Match, so at most one can commit.
   */
  async updateProduct(
    id: string,
    changes: ProductChanges,
    expectedVersion: number,
    ctx?: CallContext,
  ): Promise<UpdateResult> {
    if (Object.keys(changes).length === 0) {
      // catalog-api would answer 400 too; and an empty change would "match"
      // any product in the confirm check.
      throw new CatalogError(
        'VALIDATION',
        'at least one field is required',
        false,
      );
    }
    const context = this.context(ctx);
    let attempts = 0;
    const patch = () =>
      this.send<Product>('update', 'PATCH', productPath(id), context, {
        body: changes,
        ifMatch: expectedVersion,
        retry: attempts++,
      });
    const done = (product: Product, confirmedAfterTimeout: boolean) => {
      this.logger.info('conditional update', {
        ...context,
        id,
        attempts,
        confirmedAfterTimeout,
        version: product.version,
      });
      return { product, confirmedAfterTimeout, attempts };
    };

    try {
      return done(await patch(), false);
    } catch (err) {
      // A first-attempt 412 can't be our own write: STALE_VERSION as is.
      if (!isTransient(err)) throw err;
    }

    const first = await this.reread(id, changes, expectedVersion, context);
    if (first.kind === 'ours') return done(first.product, true);

    try {
      return done(await patch(), false);
    } catch (err) {
      // From here on the first attempt may still land, so a plain failure
      // would be a lie: anything but a timeout-like error, a 412 (re-checked
      // below) or a deleted product is reported with the outcome unknown.
      if (isNotFound(err)) throw err;
      if (!isTransient(err) && !isStale(err)) {
        throw outcomeUnknown(err, 'an earlier attempt may still apply');
      }
    }

    const second = await this.reread(id, changes, expectedVersion, context);
    if (second.kind === 'ours') return done(second.product, true);
    // Both attempts failed, and either may still be in flight upstream.
    throw new CatalogError(
      'UNAVAILABLE',
      'catalog-api did not confirm the change after one retry; read the product before trying again',
      true,
      undefined,
      { outcome: 'unknown' },
    );
  }

  /** Decides what a write whose outcome is unknown did, from the product's state now. */
  private async reread(
    id: string,
    changes: ProductChanges,
    expectedVersion: number,
    context: Required<CallContext>,
  ): Promise<Reread> {
    let product: Product;
    try {
      product = await this.read<Product>('get', productPath(id), context);
    } catch (err) {
      // Any failure but "gone" leaves the write's outcome unknown, a 500 too.
      if (isNotFound(err)) throw err;
      throw outcomeUnknown(err, 'the change may have been applied');
    }
    if (product.version === expectedVersion) return { kind: 'untouched' };
    if (
      product.version === expectedVersion + 1 &&
      hasValues(product, changes)
    ) {
      return { kind: 'ours', product };
    }
    throw new CatalogError(
      'STALE_VERSION',
      `product changed: you sent version ${expectedVersion}, current is ${product.version}`,
      true,
      undefined,
      { currentVersion: product.version },
    );
  }

  private async read<T>(
    op: CatalogOp,
    path: string,
    context: Required<CallContext>,
  ): Promise<T> {
    const { value } = await withReadRetries(
      (retry) => this.send<T>(op, 'GET', path, context, { retry }),
      {
        clock: this.clock,
        random: this.random,
        maxRetries: MAX_READ_RETRIES,
      },
    );
    return value;
  }

  /**
   * One HTTP request, one log line. `retry` is 0 for a first try, then 1, 2…
   * Throws a CatalogError for any failure.
   */
  private async send<T>(
    op: CatalogOp,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    context: Required<CallContext>,
    {
      body,
      ifMatch,
      retry = 0,
    }: { body?: unknown; ifMatch?: number; retry?: number } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.apiKey}`,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (ifMatch !== undefined) headers['if-match'] = `"${ifMatch}"`;

    const started = this.clock.now();
    const log = (fields: Record<string, unknown>) =>
      this.logger.info('catalog request', {
        ...context,
        op,
        method,
        path: path.split('?')[0],
        retry,
        durationMs: Math.round(this.clock.now() - started),
        ...fields,
      });

    let status: number;
    let text: string;
    try {
      const res = await this.fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Covers the response body too: text() below aborts with it.
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      const error = fromNetworkError(err);
      log({ code: error.code, cause: error.details?.cause });
      throw error;
    }

    if (status < 200 || status > 299) {
      const error = fromResponse(status, text, { op });
      log({ status, code: error.code });
      throw error;
    }
    log({ status });
    try {
      return JSON.parse(text) as T;
    } catch {
      // Not catalog-api's JSON (a proxy's page?). SyntaxError's message would
      // quote the body, so it isn't passed on. After a 2xx write, the write
      // happened but its result can't be read.
      throw new CatalogError(
        'INTERNAL',
        `catalog-api returned ${status} with a body that is not JSON`,
        false,
        status,
        method === 'GET' ? undefined : { outcome: 'unknown' },
      );
    }
  }

  private context(ctx: CallContext = {}): Required<CallContext> {
    return {
      tool: ctx.tool ?? 'none',
      correlationId: ctx.correlationId ?? randomUUID(),
    };
  }
}

function productPath(id: string): string {
  return `/products/${encodeURIComponent(id)}`;
}

function isTransient(err: unknown): err is CatalogError {
  return err instanceof CatalogError && err.code === 'UNAVAILABLE';
}

function isStale(err: unknown): err is CatalogError {
  return err instanceof CatalogError && err.code === 'STALE_VERSION';
}

function isNotFound(err: unknown): err is CatalogError {
  return err instanceof CatalogError && err.code === 'NOT_FOUND';
}

function hasValues(product: Product, changes: ProductChanges): boolean {
  return Object.entries(changes).every(
    ([field, value]) => product[field as keyof Product] === value,
  );
}

/**
 * A write whose outcome can't be known: retryable only after a re-read, which
 * the tools' hint says. A non-CatalogError is a bug, and is rethrown as is.
 */
function outcomeUnknown(err: unknown, what: string): CatalogError {
  if (!(err instanceof CatalogError)) throw err;
  const unknown = new CatalogError(
    'UNAVAILABLE',
    `${err.message}; ${what}`,
    true,
    err.status,
    { ...err.details, outcome: 'unknown' },
  );
  unknown.retries = err.retries;
  return unknown;
}

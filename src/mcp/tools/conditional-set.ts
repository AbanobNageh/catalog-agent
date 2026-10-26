import type { CallContext, CatalogClient } from '../../catalog/client.js';
import { CatalogError } from '../../catalog/errors.js';
import type { Product, ProductChanges } from '../../catalog/types.js';
import { toolSuccess, type ToolResult } from '../results.js';

/** What differs between set_price and set_stock. */
export interface SetField<V extends object> {
  tool: 'set_price' | 'set_stock';
  /** The one product field the tool writes. */
  field: 'priceCents' | 'stock';
  /** For the summary line: "stock", "price". */
  label: string;
  /** The values shown in the result for `value` (the price adds its formatted form). */
  values(value: number, currency: string): V;
  /** How `value` reads in the summary: "50", "799.00 EGP (79900)". */
  show(value: number, currency: string): string;
}

export interface SetRequest {
  id: string;
  /** The absolute value to set. */
  value: number;
  expectedVersion: number;
  dryRun: boolean;
}

/** A set tool's structuredContent: the setOutput schema in schemas.ts. */
export interface SetResult<V extends object> {
  dryRun: boolean;
  id: string;
  sku: string;
  name: string;
  current: V;
  version: number;
  proposed?: V;
  wouldChange?: boolean;
  previous?: V;
  changed?: boolean;
  confirmedAfterTimeout?: boolean;
}

/**
 * The set tools' flow (ADR-0006):
 * 1. Read the product. A version other than expectedVersion is STALE_VERSION,
 *    the same answer catalog-api's If-Match gives, dry run or not, so a
 *    preview also says whether the real call would go through.
 * 2. dryRun: report the current and proposed values. Nothing is written.
 * 3. The value is already there: success with changed: false, and no PATCH.
 *    catalog-api would raise the version even for a no-op, which would weaken
 *    ADR-0004's confirm check.
 * 4. Otherwise the conditional update (ADR-0004), with only this one field in
 *    the body. A write landing between our read and our PATCH makes the
 *    PATCH a 412: STALE_VERSION.
 */
export async function conditionalSet<V extends object>(
  client: CatalogClient,
  ctx: CallContext,
  spec: SetField<V>,
  { id, value, expectedVersion, dryRun }: SetRequest,
): Promise<ToolResult<SetResult<V>>> {
  const before = await client.getProduct(id, ctx);
  // Versions only go up, so a read older than expectedVersion is catalog-api's
  // Redis copy lagging a write (its cache delete can fail silently). A real
  // call then trusts neither the read's version nor its value, and lets
  // If-Match decide; its 412 also clears the stale copy. A dry run can't
  // defer, so it reports the version it saw.
  const behind = before.version < expectedVersion;
  if (behind && !dryRun) {
    return apply(client, ctx, spec, before, value, expectedVersion);
  }
  if (before.version !== expectedVersion) {
    throw new CatalogError(
      'STALE_VERSION',
      `product changed: you sent version ${expectedVersion}, current is ${before.version}`,
      true,
      undefined,
      { currentVersion: before.version },
    );
  }

  const { currency } = before;
  const now = before[spec.field];
  const show = (v: number) => spec.show(v, currency);
  const who = `${before.name} (${before.sku})`;
  const Label = spec.label[0]?.toUpperCase() + spec.label.slice(1);
  const base = { id: before.id, sku: before.sku, name: before.name };
  const current = spec.values(now, currency);

  if (dryRun) {
    const wouldChange = now !== value;
    return toolSuccess(
      wouldChange
        ? `Dry run: ${spec.label} of ${who} would go from ${show(now)} to ${show(value)}. Nothing was written. To apply it, call ${spec.tool} with dryRun: false and expectedVersion ${before.version}.`
        : `Dry run: ${spec.label} of ${who} is already ${show(now)}; ${spec.tool} would change nothing.`,
      {
        dryRun: true,
        ...base,
        current,
        proposed: spec.values(value, currency),
        wouldChange,
        version: before.version,
      },
    );
  }

  if (now === value) {
    return toolSuccess(
      `${Label} of ${who} is already ${show(now)}; nothing was written (still version ${before.version}).`,
      {
        dryRun: false,
        ...base,
        previous: current,
        current,
        changed: false,
        version: before.version,
        confirmedAfterTimeout: false,
      },
    );
  }

  return apply(client, ctx, spec, before, value, expectedVersion);
}

/**
 * The conditional update (ADR-0004), with only this one field in the body.
 * `before` is the first read: its values become `previous`.
 */
async function apply<V extends object>(
  client: CatalogClient,
  ctx: CallContext,
  spec: SetField<V>,
  before: Product,
  value: number,
  expectedVersion: number,
): Promise<ToolResult<SetResult<V>>> {
  if (ctx.signal?.aborted) {
    // The MCP client cancelled the call (during the first read, for example):
    // nothing was sent, and nothing will be.
    throw new CatalogError(
      'UNAVAILABLE',
      'the call was cancelled before the change was sent',
      true,
      undefined,
      { cause: 'cancelled' },
    );
  }
  // Exactly one field, never `undefined`: the PATCH body is { stock: 50 }.
  const changes: ProductChanges = { [spec.field]: value };
  const { product: after, confirmedAfterTimeout } = await client.updateProduct(
    before.id,
    changes,
    expectedVersion,
    ctx,
  );
  const was = spec.show(before[spec.field], before.currency);
  const now = spec.show(after[spec.field], after.currency);
  const confirmed = confirmedAfterTimeout ? ' (confirmed after a timeout)' : '';
  const Label = spec.label[0]?.toUpperCase() + spec.label.slice(1);
  return toolSuccess(
    `${Label} of ${after.name} (${after.sku}) set from ${was} to ${now}; now version ${after.version}${confirmed}.`,
    {
      dryRun: false,
      id: after.id,
      sku: after.sku,
      name: after.name,
      previous: spec.values(before[spec.field], before.currency),
      current: spec.values(after[spec.field], after.currency),
      changed: true,
      version: after.version,
      confirmedAfterTimeout,
    },
  );
}

import type { ToolAnnotations } from '@modelcontextprotocol/server';

/**
 * Tool annotations are hints to the host about a tool's behaviour, which a host
 * may use for its approval prompts. Claude Code v2.1.310 still asks before a
 * read-only tool (the M4 demo); its MCP docs say it uses readOnlyHint to run
 * such calls in parallel. They don't enforce anything: catalog-api's key
 * scope does.
 * - readOnlyHint: the tool changes nothing.
 * - openWorldHint: false, because it reaches one closed catalogue, not the
 *   open web.
 * destructiveHint and idempotentHint only mean something when readOnlyHint is
 * false (the MCP spec), so the read tools leave them out.
 */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

/**
 * create_product (ADR-0006): it only adds a product, so not destructive. Not
 * idempotent: a repeat is SKU_EXISTS, or a second product if the sku differs.
 */
export const ADDITIVE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/**
 * set_price, set_stock (ADR-0006):
 * - destructiveHint: true, because they overwrite the old value (the spec's
 *   false means "only additive updates")
 * - idempotentHint: true, because a repeat with the same expectedVersion
 *   gets STALE_VERSION and changes nothing (If-Match)
 */
export const CONDITIONAL_OVERWRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

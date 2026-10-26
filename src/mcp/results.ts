import {
  CatalogError,
  type CatalogErrorCode,
  type CatalogErrorDetails,
} from '../catalog/errors.js';

/**
 * A tool result (the answer to an MCP `tools/call`). `structuredContent` is
 * the machine-readable result, matching the tool's `outputSchema`; `content`
 * is what a reader sees. Per ADR-0005, the text is a summary line plus the
 * same JSON, so a host that forwards only `content` still gives the model the
 * data (the spec's "SHOULD also return the serialized JSON").
 */
export interface ToolResult<T extends object> {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent: T;
}

/**
 * A tool execution error: still a normal result, which the host passes to the
 * model so it can recover. Text only (ADR-0005): the spec says structured
 * results MUST match the tool's outputSchema, which describes a success, so
 * an error object there is rejected by strict clients such as MCP Inspector.
 * The §4.3 object travels as JSON in the text instead, as GitHub's MCP server
 * does.
 */
export interface ToolErrorResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError: true;
}

/** The §4.3 error shape, carried as JSON at the end of an error result's text. */
export interface ToolErrorData {
  code: CatalogErrorCode;
  message: string;
  retryable: boolean;
  /** What the model should do next. */
  hint: string;
  details?: CatalogErrorDetails;
}

/** A tool's own wording for hints that depend on what the tool did. */
export interface ToolHints {
  /**
   * For a write whose outcome is unknown (`details.outcome: 'unknown'`). The
   * default suits an update; create_product says how to look for the product.
   */
  outcomeUnknown?: string;
}

export function toolSuccess<T extends object>(
  summary: string,
  data: T,
): ToolResult<T> {
  return { content: [text(summary, data)], structuredContent: data };
}

const INTERNAL_HINT =
  'an unexpected error; retrying the same call will not help';

/**
 * The §4.3 object for anything a tool threw, built from a CatalogError's
 * fields only, never from the Error object itself (its stack, status or
 * retry count). Anything else thrown is a bug in this server: INTERNAL with a
 * fixed message, because its own message could hold anything.
 */
export function errorData(err: unknown, hints: ToolHints = {}): ToolErrorData {
  return err instanceof CatalogError
    ? {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        hint: hintFor(err, hints),
        ...(err.details ? { details: { ...err.details } } : {}),
      }
    : {
        code: 'INTERNAL',
        message: 'internal error in the MCP server',
        retryable: false,
        hint: INTERNAL_HINT,
      };
}

/** The `isError: true` result for an error: a summary line, then its JSON. */
export function toolError(data: ToolErrorData): ToolErrorResult {
  const summary = `Error ${data.code}: ${data.message}. Hint: ${data.hint}.`;
  return { content: [text(summary, data)], isError: true };
}

/** The hints of REQUIREMENTS.md §4.3. */
function hintFor(err: CatalogError, hints: ToolHints): string {
  if (err.details?.outcome === 'unknown') {
    return (
      hints.outcomeUnknown ??
      'the change may have been applied; read the product before retrying'
    );
  }
  switch (err.code) {
    case 'VALIDATION':
    case 'FORBIDDEN':
      // catalog-api's own message already says what's wrong (the fields, or
      // the scope that's needed).
      return err.message;
    case 'UNAUTHORIZED':
      return "the MCP server's catalog key is missing or wrong (configuration problem)";
    case 'NOT_FOUND':
      return 'check the id; use search_products to find it';
    case 'SKU_EXISTS':
      return 'a product with this sku already exists';
    case 'STALE_VERSION': {
      const v = err.details?.currentVersion;
      return v === undefined
        ? 'the product changed; call get_product for its current version, check the change still makes sense, then retry with that version'
        : `the product changed (current version ${v}); call get_product, check the change still makes sense, then retry with expectedVersion ${v}`;
    }
    case 'UNAVAILABLE':
      return 'temporary; retry later';
    case 'INTERNAL':
      return INTERNAL_HINT;
  }
}

function text(summary: string, data: object) {
  return {
    type: 'text' as const,
    text: `${summary}\n\n${JSON.stringify(data)}`,
  };
}

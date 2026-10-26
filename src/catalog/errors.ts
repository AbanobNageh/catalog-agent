/** The error codes an agent sees (REQUIREMENTS.md §4.3). The hints are added by the tools (M3). */
export type CatalogErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SKU_EXISTS'
  | 'STALE_VERSION'
  | 'UNAVAILABLE'
  | 'INTERNAL';

export interface CatalogErrorDetails {
  /** On STALE_VERSION: the product's version now. */
  currentVersion?: number;
  /** On UNAVAILABLE: `timeout`, or the system error code such as `ECONNREFUSED`. */
  cause?: string;
  /** On a write that failed in a way that can't tell whether it was applied. */
  outcome?: 'unknown';
}

/** The operation a call was for; a status can mean different things per operation. */
export type CatalogOp = 'search' | 'get' | 'create' | 'update';

/**
 * A failed catalog-api call, already classified. `message` is catalog-api's
 * own message, cut short; never the raw body, a stack trace or the key.
 */
export class CatalogError extends Error {
  override name = 'CatalogError';
  /** How many times the call was retried before giving up (for the logs). */
  retries = 0;

  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly details?: CatalogErrorDetails,
  ) {
    super(message);
  }
}

const MAX_MESSAGE_LENGTH = 500;

/** Classifies a non-2xx response from catalog-api. */
export function fromResponse(
  status: number,
  bodyText: string,
  { op }: { op: CatalogOp },
): CatalogError {
  const body = parseBody(bodyText);
  const message = apiMessage(body) ?? `catalog-api returned ${status}`;
  const error = (
    code: CatalogErrorCode,
    retryable = false,
    details?: CatalogErrorDetails,
  ) => new CatalogError(code, message, retryable, status, details);

  switch (status) {
    case 400:
      return error('VALIDATION');
    case 401:
      return error('UNAUTHORIZED');
    case 403:
      return error('FORBIDDEN');
    case 404:
      return error('NOT_FOUND');
    case 409:
      // On these endpoints, a 409 means the sku belongs to another product:
      // on create, or on an update that changes the sku.
      return error(
        op === 'create' || op === 'update' ? 'SKU_EXISTS' : 'INTERNAL',
      );
    case 412: {
      const currentVersion = body?.currentVersion;
      return error(
        'STALE_VERSION',
        true,
        typeof currentVersion === 'number' ? { currentVersion } : undefined,
      );
    }
    case 503:
      return error('UNAVAILABLE', true);
    default:
      return error('INTERNAL');
  }
}

/**
 * Classifies a rejected `fetch`: a timeout or a network failure is UNAVAILABLE.
 * fetch rejects with a TypeError on network failure and a DOMException named
 * TimeoutError/AbortError on timeout. They're matched by name, not
 * instanceof, because fetch's errors come from Node's own realm. fetch's own
 * message isn't copied: for a bad header it repeats the header's value.
 * Anything else is a bug, and is rethrown.
 */
export function fromNetworkError(err: unknown): CatalogError {
  const { name, cause } = (err ?? {}) as {
    name?: unknown;
    cause?: { code?: unknown };
  };
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new CatalogError(
      'UNAVAILABLE',
      'catalog-api did not answer in time',
      true,
      undefined,
      { cause: 'timeout' },
    );
  }
  if (name === 'TypeError') {
    const code = typeof cause?.code === 'string' ? cause.code : 'network';
    return new CatalogError(
      'UNAVAILABLE',
      `catalog-api is unreachable (${code})`,
      true,
      undefined,
      { cause: code },
    );
  }
  throw err;
}

function parseBody(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** NestJS puts a string in `message`, or a list of strings for validation errors. */
function apiMessage(body: Record<string, unknown> | undefined) {
  const message = body?.message;
  const text = Array.isArray(message)
    ? message.filter((m) => typeof m === 'string').join('; ')
    : typeof message === 'string'
      ? message
      : undefined;
  return text ? text.slice(0, MAX_MESSAGE_LENGTH) : undefined;
}

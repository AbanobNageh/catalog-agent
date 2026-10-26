export interface CatalogConfig {
  /** Base URL of catalog-api, without a trailing slash. */
  catalogApiUrl: string;
  /** Bearer key for catalog-api. Never log it or put it in a tool result. */
  catalogApiKey: string;
  /** Per-request timeout for catalog-api calls, body included (ADR-0004). */
  timeoutMs: number;
  /**
   * Which tools exist (ADR-0006). `read` registers only the read tools, so the
   * write tools aren't in tools/list at all; `write` adds them. The key's
   * scope is the second layer: catalog-api refuses writes with a read key.
   */
  access: CatalogAccess;
}

export type CatalogAccess = 'read' | 'write';

/** The user's choice (ADR-0006): writes on, like most MCP servers. .env.example sets read. */
const DEFAULT_ACCESS: CatalogAccess = 'write';

const TIMEOUT_MS = { default: 5000, min: 100, max: 60_000 };

/** The Compose stack's catalog-api (REQUIREMENTS.md §2.6). */
const DEFAULT_CATALOG_API_URL = 'http://localhost:3100';

/** catalog-api's own minimum (product-catalog ADR-0020): a shorter key can't match. */
const MIN_API_KEY_LENGTH = 32;

/**
 * Visible ASCII only: what an `Authorization: Bearer <key>` header can carry.
 * A trailing newline or a non-ASCII character would load fine, and then fetch
 * would throw an error that repeats the whole header value, key included.
 */
const API_KEY_FORMAT = /^[\x21-\x7E]+$/;

/**
 * Builds the config from environment variables. Collects every problem before
 * throwing, so a misconfigured server shows all of them at startup at once.
 * Messages name the variable, never its value: a key pasted into the wrong
 * variable, or a URL with credentials in it, must not reach a log.
 */
export function loadConfig(env: NodeJS.ProcessEnv): CatalogConfig {
  const errors: string[] = [];

  const catalogApiUrl = (
    env.CATALOG_API_URL ?? DEFAULT_CATALOG_API_URL
  ).replace(/\/+$/, '');
  if (!isHttpUrl(catalogApiUrl)) {
    errors.push('CATALOG_API_URL must be an http(s) URL with a host');
  } else if (hasExtras(catalogApiUrl)) {
    // fetch refuses a URL with credentials and repeats it in the error; a
    // query or fragment would break joining paths onto the base URL.
    errors.push(
      'CATALOG_API_URL must not include credentials, a query or a fragment',
    );
  }

  const catalogApiKey = env.CATALOG_API_KEY ?? '';
  if (!catalogApiKey) {
    errors.push('CATALOG_API_KEY is required');
  } else if (!API_KEY_FORMAT.test(catalogApiKey)) {
    errors.push('CATALOG_API_KEY must be printable ASCII without spaces');
  } else if (catalogApiKey.length < MIN_API_KEY_LENGTH) {
    errors.push(
      `CATALOG_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters`,
    );
  }

  const timeoutMs = wholeNumber(env.CATALOG_TIMEOUT_MS, TIMEOUT_MS.default);
  if (
    timeoutMs === undefined ||
    timeoutMs < TIMEOUT_MS.min ||
    timeoutMs > TIMEOUT_MS.max
  ) {
    errors.push(
      `CATALOG_TIMEOUT_MS must be a whole number from ${TIMEOUT_MS.min} to ${TIMEOUT_MS.max}`,
    );
  }

  const access = env.CATALOG_ACCESS ?? DEFAULT_ACCESS;
  if (access !== 'read' && access !== 'write') {
    errors.push('CATALOG_ACCESS must be read or write');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }
  return {
    catalogApiUrl,
    catalogApiKey,
    timeoutMs: timeoutMs ?? 0,
    access: access as CatalogAccess,
  };
}

/** Digits only (no sign, decimals, exponent or spaces); unset means the default. */
function wholeNumber(
  value: string | undefined,
  fallback: number,
): number | undefined {
  if (value === undefined) return fallback;
  return /^\d{1,9}$/.test(value) ? Number(value) : undefined;
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol, host } = new URL(value);
  return (protocol === 'http:' || protocol === 'https:') && host !== '';
}

function hasExtras(value: string): boolean {
  const { username, password } = new URL(value);
  // Checked on the raw string too: an empty `?` or `#` parses to ''.
  return username !== '' || password !== '' || /[?#]/.test(value);
}

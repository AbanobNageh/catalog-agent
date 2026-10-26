import { randomUUID } from 'node:crypto';
import type { CallContext, CatalogClient } from '../catalog/client.js';
import { CatalogError } from '../catalog/errors.js';
import type { Logger } from '../log.js';
import {
  errorData,
  toolError,
  type ToolErrorData,
  type ToolErrorResult,
  type ToolResult,
} from './results.js';

/** What every tool needs: the only path to catalog-api, and the stderr logger. */
export interface ToolDeps {
  client: CatalogClient;
  logger: Logger;
}

/**
 * Runs one tool call: gives it a correlation id and a stats object (passed to
 * every catalog request it makes), turns anything thrown into an `isError`
 * result (ADR-0005), and writes one `tool call` log line with the duration,
 * the outcome, and the request and retry counts (§4.4).
 */
export async function runTool<T extends object>(
  tool: string,
  logger: Logger,
  fn: (ctx: CallContext) => Promise<ToolResult<T>>,
): Promise<ToolResult<T> | ToolErrorResult> {
  const ctx = {
    tool,
    correlationId: randomUUID(),
    stats: { requests: 0, retries: 0 },
  };
  const started = performance.now();
  let result: ToolResult<T> | ToolErrorResult;
  let error: ToolErrorData | undefined;
  try {
    result = await fn(ctx);
  } catch (err) {
    error = errorData(err);
    result = toolError(error);
    if (!(err instanceof CatalogError)) {
      // A bug, not a catalog error: log its name so it can be found, never
      // its message or stack (either could hold anything).
      logger.error('tool failed', {
        tool,
        correlationId: ctx.correlationId,
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }
  }
  logger.info('tool call', {
    tool,
    correlationId: ctx.correlationId,
    durationMs: Math.round(performance.now() - started),
    outcome: error ? 'error' : 'ok',
    ...(error ? { code: error.code } : {}),
    requests: ctx.stats.requests,
    retries: ctx.stats.retries,
  });
  return result;
}

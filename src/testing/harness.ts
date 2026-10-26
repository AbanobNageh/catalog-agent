import type { Client } from '@modelcontextprotocol/client';
import { expect } from 'vitest';
import { CatalogClient } from '../catalog/client.js';
import type { CatalogAccess } from '../config.js';
import { createLogger } from '../log.js';
import { createServer } from '../mcp/server.js';
import { connect, type Era } from './mcp.js';

// The MCP-level test harness (§4.5): a real MCP client talks to the real
// server in-process, in the era under test. catalog-api is a scripted fake
// fetch behind a real CatalogClient, so the whole path below the tools is real.

export const KEY = 'dev-read-key-not-secret-0000000000000000';

/** One request the fake catalog-api received. */
export interface SentRequest {
  method: string;
  url: URL;
  /** The parsed JSON body, if there was one. */
  body: unknown;
  ifMatch: string | null;
}

/** One scripted answer: return a Response, or throw as fetch would. */
export type Handler = (
  url: URL,
  sent: SentRequest,
) => Response | Promise<Response>;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** What fetch throws when AbortSignal.timeout fires. */
export const timeout: Handler = () => {
  throw new DOMException(
    'The operation was aborted due to timeout',
    'TimeoutError',
  );
};

export interface Harness {
  client: Client;
  /** Every request's URL, in order. */
  requests: URL[];
  /** Every request in full, in order. */
  sent: SentRequest[];
  logs: Record<string, unknown>[];
}

const open: Client[] = [];

/** Call from afterEach in every file that uses harness(). */
export async function closeAll(): Promise<void> {
  await Promise.all(open.splice(0).map((c) => c.close()));
}

/**
 * A connected client in `era`, on a server built with `access`, whose
 * catalog-api answers each request with the next step. A request with no step
 * left fails the test.
 */
export async function harness(
  era: Era,
  access: CatalogAccess,
  ...steps: Handler[]
): Promise<Harness> {
  const requests: URL[] = [];
  const sent: SentRequest[] = [];
  const lines: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    const request: SentRequest = {
      method: init?.method ?? 'GET',
      url,
      body:
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : undefined,
      ifMatch: headers.get('if-match'),
    };
    requests.push(url);
    sent.push(request);
    const step = steps.shift();
    if (!step)
      throw new Error(`unexpected request ${request.method} ${url.pathname}`);
    return step(url, request);
  }) as typeof globalThis.fetch;
  const logger = createLogger({ write: (l) => lines.push(l) });
  const catalog = new CatalogClient({
    baseUrl: 'http://catalog.test',
    apiKey: KEY,
    timeoutMs: 1000,
    fetch,
    clock: { now: () => 0, sleep: () => Promise.resolve() },
    logger,
  });
  const client = await connect(era, () =>
    createServer({ client: catalog, logger, access }),
  );
  open.push(client);
  // Every test runs in the era it says it does (M2 Review Focus 7).
  expect(client.getProtocolEra()).toBe(era);
  return {
    client,
    requests,
    sent,
    get logs() {
      return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    },
  };
}

export const call = (
  h: Harness,
  name: string,
  args: Record<string, unknown> = {},
) => h.client.callTool({ name, arguments: args });

export const textOf = (result: { content?: unknown }) =>
  ((result.content as { text: string }[])[0]?.text ?? '') as string;

/** The summary line: the text before the JSON (ADR-0005). */
export const summaryOf = (result: { content?: unknown }) =>
  textOf(result).split('\n\n')[0];

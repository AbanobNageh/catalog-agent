import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Test-only. One fault per request, in the order queued:
 * - 'hang': never forward, never answer (the request "never arrived")
 * - 'cutAfterForward': forward, wait for the full upstream response, then
 *   never answer (the write "landed, but the response was lost")
 * - { status }: answer with that status without forwarding
 */
export type Fault = 'hang' | 'cutAfterForward' | { status: number };

export interface FaultProxy {
  /** Point the client here instead of at catalog-api. */
  url: string;
  /** Queue faults for the next requests; requests with none pass through. */
  next(...faults: Fault[]): void;
  /** What each request got, in order. */
  log: { method: string; path: string; fault: string }[];
  /** Ends any hanging requests and frees the port. */
  close(): Promise<void>;
}

/** Request headers worth forwarding to catalog-api, and response headers worth returning. */
const REQUEST_HEADERS = ['authorization', 'accept', 'content-type', 'if-match'];
const RESPONSE_HEADERS = ['content-type', 'etag', 'www-authenticate'];

/**
 * A tiny HTTP proxy in front of catalog-api that can lose a request or a
 * response on purpose, so the client's confirm-after-timeout branches can be
 * driven against the real API (ADR-0004).
 */
export async function startFaultProxy(
  upstreamUrl: string,
): Promise<FaultProxy> {
  const queue: Fault[] = [];
  const log: FaultProxy['log'] = [];

  const server = createServer((req, res) => {
    // The fault belongs to the request in arrival order, before its body is read.
    const fault = queue.shift();
    // An upstream that's down, or a client that aborts mid-body: drop the
    // connection, so the client sees a network error.
    handle(req, res, fault).catch(() => res.destroy());
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    fault: Fault | undefined,
  ) {
    const entry = {
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      fault: describe(fault),
    };
    log.push(entry);
    const body = await readBody(req);

    if (fault === 'hang') return; // keep the socket open, answer nothing
    if (typeof fault === 'object') {
      res.writeHead(fault.status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          statusCode: fault.status,
          message: 'injected by the fault proxy',
          error: 'Injected',
        }),
      );
      return;
    }

    const headers: Record<string, string> = {};
    for (const name of REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const upstream = await fetch(`${upstreamUrl}${entry.path}`, {
      method: entry.method,
      headers,
      ...(body === '' ? {} : { body }),
    });
    const text = await upstream.text();
    if (fault === 'cutAfterForward') return; // the upstream did the work; lose the answer

    const out: Record<string, string> = {};
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) out[name] = value;
    }
    res.writeHead(upstream.status, out);
    res.end(text);
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    next: (...faults) => void queue.push(...faults),
    log,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function describe(fault: Fault | undefined): string {
  if (fault === undefined) return 'pass';
  return typeof fault === 'object' ? `status ${fault.status}` : fault;
}

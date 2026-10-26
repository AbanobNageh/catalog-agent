import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFaultProxy, type FaultProxy } from './fault-proxy.js';

/** An upstream that echoes what it received, and counts requests. */
let upstream: Server;
let upstreamUrl: string;
let hits: number;
let proxy: FaultProxy;

beforeEach(async () => {
  hits = 0;
  upstream = createServer((req, res) => {
    hits++;
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', etag: '"7"' });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          ifMatch: req.headers['if-match'],
          body,
        }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve),
  );
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  proxy = await startFaultProxy(upstreamUrl);
});

afterEach(async () => {
  await proxy.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

const call = (timeoutMs = 2000) =>
  fetch(`${proxy.url}/products/abc?x=1`, {
    method: 'PATCH',
    headers: {
      authorization: 'Bearer k',
      'if-match': '"3"',
      'content-type': 'application/json',
    },
    body: '{"stock":2}',
    signal: AbortSignal.timeout(timeoutMs),
  });

const timedOut = (p: Promise<unknown>) =>
  p.then(
    () => 'answered',
    (err: unknown) => (err as Error).name,
  );

describe('startFaultProxy', () => {
  it('passes requests through: method, path, headers, body, status, etag', async () => {
    const res = await call();
    expect(res.status).toBe(201);
    expect(res.headers.get('etag')).toBe('"7"');
    expect(await res.json()).toEqual({
      method: 'PATCH',
      url: '/products/abc?x=1',
      authorization: 'Bearer k',
      ifMatch: '"3"',
      body: '{"stock":2}',
    });
    expect(hits).toBe(1);
  });

  it('a status fault answers without forwarding', async () => {
    proxy.next({ status: 503 });
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ statusCode: 503 });
    expect(hits).toBe(0);
  });

  it("'hang' never forwards and never answers: the request never arrived", async () => {
    proxy.next('hang');
    expect(await timedOut(call(200))).toBe('TimeoutError');
    expect(hits).toBe(0);
  });

  it("'cutAfterForward' forwards, then never answers: the write landed, the response is lost", async () => {
    proxy.next('cutAfterForward');
    expect(await timedOut(call(300))).toBe('TimeoutError');
    expect(hits).toBe(1);
  });

  it('uses one queued fault per request, in order, then passes through', async () => {
    proxy.next({ status: 503 }, { status: 502 });
    expect((await call()).status).toBe(503);
    expect((await call()).status).toBe(502);
    expect((await call()).status).toBe(201);
    expect(hits).toBe(1);
    expect(proxy.log.map((r) => r.fault)).toEqual([
      'status 503',
      'status 502',
      'pass',
    ]);
  });

  it('an unreachable upstream closes the socket instead of an unhandled rejection', async () => {
    const dead = await startFaultProxy('http://127.0.0.1:1'); // nothing listens
    try {
      const outcome = await fetch(`${dead.url}/x`, {
        signal: AbortSignal.timeout(2000),
      }).then(
        () => 'answered',
        (err: unknown) => (err as Error).name,
      );
      expect(outcome).toBe('TypeError');
    } finally {
      await dead.close();
    }
  });

  it('close() ends hanging requests and frees the port', async () => {
    proxy.next('hang');
    const pending = timedOut(call(5000));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await proxy.close();
    expect(await pending).toBe('TypeError'); // the socket was closed
    expect(await timedOut(call(500))).toBe('TypeError'); // connection refused
  });
});

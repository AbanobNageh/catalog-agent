import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFaultProxy, type FaultProxy } from '../testing/fault-proxy.js';
import { BASE_URL, KEYS } from '../testing/fixtures.js';
import { ERAS } from '../testing/mcp.js';
import {
  MAIN,
  RawStdioServer,
  safeParse,
  serverEnv,
} from '../testing/stdio.js';

// The real server over the real stdio transport (§4.1, §4.5): node
// dist/main.js as a child process, as Claude Code and Inspector run it.

describe('stdout carries only JSON-RPC (Review Focus 1)', () => {
  let proxy: FaultProxy;
  beforeAll(async () => {
    proxy = await startFaultProxy(BASE_URL);
  });
  afterAll(() => proxy.close());

  it('on every path: handshake, list, results, tool errors, retries, protocol errors', async () => {
    // Through the fault proxy, so a read can time out and be retried.
    const server = RawStdioServer.start(
      serverEnv({ CATALOG_API_URL: proxy.url, CATALOG_TIMEOUT_MS: '1000' }),
    );

    const init = await server.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-test', version: '0' },
    });
    expect(init.result?.serverInfo).toEqual({
      name: 'catalog-agent',
      version: '0.0.0',
    });
    server.send({ method: 'notifications/initialized' });

    const list = await server.request(2, 'tools/list');
    const listed = (list.result?.tools ?? []) as { name: string }[];
    expect(listed.map((t) => t.name)).toEqual([
      'search_products',
      'get_product',
      'list_facets',
    ]);

    const search = await server.request(3, 'tools/call', {
      name: 'search_products',
      arguments: { category: 'books', maxStock: 5, sort: 'stock_asc', size: 3 },
    });
    const { hits } = (search.result?.structuredContent ?? { hits: [] }) as {
      hits: { id: string }[];
    };
    expect(hits.length).toBeGreaterThan(0);

    const missing = await server.request(4, 'tools/call', {
      name: 'get_product',
      arguments: { id: randomUUID() },
    });
    expect(missing.result?.isError).toBe(true);

    // The first GET hangs and times out; the retry succeeds.
    proxy.next('hang');
    const retried = await server.request(5, 'tools/call', {
      name: 'get_product',
      arguments: { id: hits[0]?.id },
    });
    expect(retried.result?.isError).toBeFalsy();

    const invalid = await server.request(6, 'tools/call', {
      name: 'search_products',
      arguments: { size: 150 },
    });
    expect(invalid.result?.isError).toBe(true);

    const unknownTool = await server.request(7, 'tools/call', {
      name: 'delete_product',
      arguments: {},
    });
    expect(unknownTool.error).toBeDefined();

    const facets = await server.request(8, 'tools/call', {
      name: 'list_facets',
      arguments: { category: 'books' },
    });
    expect(facets.result?.isError).toBeFalsy();

    expect(await server.close()).toBe(0);

    // Every stdout line is a JSON-RPC 2.0 message; nothing else got through.
    // (The SDK's own client tolerates a stray line, so it can't check this.)
    expect(server.stdout.length).toBeGreaterThanOrEqual(8);
    for (const line of server.stdout) {
      const message = safeParse(line);
      expect(message, `not JSON on stdout: ${line}`).toBeDefined();
      expect(message?.jsonrpc).toBe('2.0');
    }
    // The logs went to stderr, as JSON lines, and recorded the retry.
    const logs = server.stderr.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(logs.find((l) => l.msg === 'server started')).toBeDefined();
    expect(
      logs.find(
        (l) =>
          l.msg === 'tool call' && l.tool === 'get_product' && l.retries === 1,
      ),
    ).toMatchObject({ outcome: 'ok', requests: 2 });
    expect(server.stderr.join('\n')).not.toContain(KEYS.read);
  });

  it('a configuration error exits 1, says why on stderr, and writes nothing to stdout', async () => {
    const server = RawStdioServer.start(
      serverEnv({ CATALOG_API_KEY: 'too-short', CATALOG_TIMEOUT_MS: 'soon' }),
    );
    expect(await server.exit()).toBe(1);
    expect(server.stdout).toEqual([]);
    const [entry] = server.stderr.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(entry).toMatchObject({
      level: 'error',
      msg: 'invalid configuration',
    });
    expect(entry?.problems).toContain(
      'CATALOG_API_KEY must be at least 32 characters',
    );
    expect(entry?.problems).toContain(
      'CATALOG_TIMEOUT_MS must be a whole number',
    );
    expect(server.stderr.join('\n')).not.toContain('too-short');
  });
});

describe.each(ERAS)('over stdio with the SDK client (%s era)', (era) => {
  it('connects in that era, lists the tools and calls one', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env: serverEnv(),
      stderr: 'pipe',
    });
    const client = new Client(
      { name: 'stdio-test', version: '0' },
      era === 'modern'
        ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
        : {},
    );
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe(era);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([
        'search_products',
        'get_product',
        'list_facets',
      ]);
      const result = await client.callTool({
        name: 'list_facets',
        arguments: { category: 'books' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        categories: [{ key: 'books' }],
      });
    } finally {
      await client.close();
    }
  });
});

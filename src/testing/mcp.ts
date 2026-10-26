import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';

/**
 * The two protocol eras (ADR-0005). `legacy` is every 2025 revision: the
 * client opens with an `initialize` handshake. `modern` is 2026-07-28:
 * stateless, with a `_meta` envelope on every request instead.
 */
export type Era = 'legacy' | 'modern';
export const ERAS: readonly Era[] = ['legacy', 'modern'];

const CLIENT_INFO = { name: 'catalog-agent-tests', version: '0.0.0' };

/**
 * The §4.3 error object of an `isError` result (ADR-0005). Error results
 * carry it as JSON at the end of their one text block, never as
 * structuredContent; this checks both.
 */
export function errorOf(result: {
  content?: unknown;
  isError?: unknown;
  structuredContent?: unknown;
}): Record<string, unknown> {
  if (result.isError !== true) throw new Error('not an error result');
  if (result.structuredContent !== undefined) {
    throw new Error('an error result must not carry structuredContent');
  }
  const [block] = (result.content ?? []) as { type: string; text: string }[];
  if (block?.type !== 'text') throw new Error('no text block');
  return JSON.parse(
    block.text.slice(block.text.lastIndexOf('\n\n') + 2),
  ) as Record<string, unknown>;
}

/**
 * An MCP client connected in-process to a fresh server from `factory`, with
 * no network. InMemoryTransport only speaks the 2025 era, so the 2026 client
 * goes through createMcpHandler's fetch function instead: the URL is never
 * dialled. Both ends of the in-memory pair come from the same package.
 */
export async function connect(
  era: Era,
  factory: () => McpServer,
): Promise<Client> {
  if (era === 'legacy') {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await factory().connect(serverSide);
    const client = new Client(CLIENT_INFO);
    await client.connect(clientSide);
    return client;
  }
  const handler = createMcpHandler(factory);
  const transport = new StreamableHTTPClientTransport(
    new URL('http://mcp.test/mcp'),
    { fetch: (url, init) => handler.fetch(new Request(url, init)) },
  );
  const client = new Client(CLIENT_INFO, {
    versionNegotiation: { mode: { pin: '2026-07-28' } },
  });
  await client.connect(transport);
  return client;
}

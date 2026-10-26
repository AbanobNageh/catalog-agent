import { McpServer } from '@modelcontextprotocol/server';
import type { ToolDeps } from './tool-call.js';
import { registerGetProduct } from './tools/get-product.js';
import { registerListFacets } from './tools/list-facets.js';
import { registerSearchProducts } from './tools/search-products.js';

/** What `tools/list` and the handshake report. Same as package.json; M4 bumps both. */
export const SERVER_INFO = { name: 'catalog-agent', version: '0.0.0' };

/**
 * The MCP server: a set of tools over catalog-api. Only read tools for now
 * (M2). Delete and reindex are never exposed (§4.2). A fresh instance per
 * connection: serveStdio and createMcpHandler call this as a factory.
 */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(SERVER_INFO);
  // Registration order is the order of tools/list, which the spec wants stable.
  registerSearchProducts(server, deps);
  registerGetProduct(server, deps);
  registerListFacets(server, deps);
  return server;
}

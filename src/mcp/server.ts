import { McpServer } from '@modelcontextprotocol/server';
import type { CatalogAccess } from '../config.js';
import type { ToolDeps } from './tool-call.js';
import { registerCreateProduct } from './tools/create-product.js';
import { registerGetProduct } from './tools/get-product.js';
import { registerListFacets } from './tools/list-facets.js';
import { registerSearchProducts } from './tools/search-products.js';
import { registerSetPrice } from './tools/set-price.js';
import { registerSetStock } from './tools/set-stock.js';

/** What `tools/list` and the handshake report. Same as package.json; M4 bumps both. */
export const SERVER_INFO = { name: 'catalog-agent', version: '0.0.0' };

export interface ServerDeps extends ToolDeps {
  /** CATALOG_ACCESS (ADR-0006): `read` registers the read tools only. */
  access: CatalogAccess;
}

/**
 * The MCP server: a set of tools over catalog-api. With `read` access the
 * write tools are never registered, so they aren't in tools/list and a call
 * to one is an unknown tool; catalog-api's key scope is the second layer.
 * Delete and reindex are never exposed (§4.2). A fresh instance per
 * connection: serveStdio and createMcpHandler call this as a factory.
 */
export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO);
  // Registration order is the order of tools/list, which the spec wants stable.
  registerSearchProducts(server, deps);
  registerGetProduct(server, deps);
  registerListFacets(server, deps);
  if (deps.access === 'write') {
    registerCreateProduct(server, deps);
    registerSetPrice(server, deps);
    registerSetStock(server, deps);
  }
  return server;
}

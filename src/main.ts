import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { CatalogClient } from './catalog/client.js';
import { loadConfig, type CatalogConfig } from './config.js';
import { loadDotEnv } from './env.js';
import { createLogger } from './log.js';
import { createServer, SERVER_INFO } from './mcp/server.js';

// The MCP server's entry point, run as `node dist/main.js` by an MCP host
// (Claude Code via .mcp.json, MCP Inspector). The host starts it as a child
// process and speaks JSON-RPC over its stdin and stdout: the stdio transport.
// So stdout is the protocol, and every log line goes to stderr.

const logger = createLogger();

// The repo root's .env (dist/../.env), wherever the host starts us from. A
// .env that exists but can't be read (a directory, no permission) is a
// config error: one JSON line and exit 1, not Node's stack trace.
try {
  loadDotEnv(new URL('../.env', import.meta.url));
} catch (err) {
  logger.error('cannot read .env', {
    cause: (err as { code?: unknown }).code ?? 'unknown',
  });
  process.exit(1);
}

let config: CatalogConfig;
try {
  config = loadConfig(process.env);
} catch (err) {
  // loadConfig's message names the variables, never their values.
  logger.error('invalid configuration', {
    problems: err instanceof Error ? err.message : 'unknown',
  });
  process.exit(1);
}

const client = new CatalogClient({
  baseUrl: config.catalogApiUrl,
  apiKey: config.catalogApiKey,
  timeoutMs: config.timeoutMs,
  logger,
});

// serveStdio owns the stdio transport and serves both protocol eras: a 2025
// client's `initialize` handshake and stateless 2026-07-28 requests. It calls
// the factory for the server instance that answers the connection.
const access = config.access;
const handle = serveStdio(() => createServer({ client, logger, access }));

logger.info('server started', {
  ...SERVER_INFO,
  catalogApiUrl: config.catalogApiUrl,
  timeoutMs: config.timeoutMs,
  access,
});

// When stdin closes, the transport closes by itself. A signal closes it too.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void handle.close().finally(() => process.exit(0));
  });
}

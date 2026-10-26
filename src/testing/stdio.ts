import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASE_URL, KEYS } from './fixtures.js';

/** The built entry point: build.global.ts builds it before the int tests. */
export const MAIN = fileURLToPath(
  new URL('../../dist/main.js', import.meta.url),
);

/**
 * A clean environment for the spawned server: only what Node needs to start
 * on Windows and Linux, plus the server's own variables. Every CATALOG_*
 * variable is set, so a developer's .env (which only fills unset variables)
 * can't change a test. `undefined` leaves a variable out.
 */
export function serverEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    CATALOG_API_URL: BASE_URL,
    CATALOG_API_KEY: KEYS.read,
    CATALOG_TIMEOUT_MS: '5000',
    CATALOG_ACCESS: 'read',
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  );
}

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * The real server as a child process, driven by hand with raw JSON-RPC lines,
 * so the test sees every byte the server writes to stdout and stderr. stdin
 * stays open until close(): on end-of-file the server drops requests still in
 * flight, unanswered (the SDK's documented stdio behaviour).
 */
export class RawStdioServer {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  private readonly exited: Promise<number | null>;
  private waiters: (() => void)[] = [];

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    lines(child.stdout, (line) => {
      this.stdout.push(line);
      for (const wake of this.waiters.splice(0)) wake();
    });
    lines(child.stderr, (line) => this.stderr.push(line));
    this.exited = new Promise((resolve) => child.on('exit', resolve));
  }

  static start(env: Record<string, string>): RawStdioServer {
    return new RawStdioServer(
      spawn(process.execPath, [MAIN], { env, stdio: 'pipe' }),
    );
  }

  send(message: Record<string, unknown>): void {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`,
    );
  }

  /** Sends a request and waits for the response with its id. */
  async request(
    id: number,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<JsonRpcMessage> {
    this.send({ id, method, params });
    for (;;) {
      const found = this.stdout
        .map((l) => safeParse(l))
        .find((m) => m?.id === id && m.method === undefined);
      if (found) return found;
      await new Promise<void>((wake) => this.waiters.push(wake));
    }
  }

  /** Ends stdin, the way a host disconnects, and waits for the exit code. */
  async close(): Promise<number | null> {
    this.child.stdin.end();
    return this.exited;
  }

  /** Waits for the process to exit on its own (a startup failure). */
  exit(): Promise<number | null> {
    return this.exited;
  }
}

function lines(stream: NodeJS.ReadableStream, onLine: (l: string) => void) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, at).replace(/\r$/, ''));
      buffer = buffer.slice(at + 1);
    }
  });
  stream.on('end', () => {
    if (buffer) onLine(buffer);
  });
}

export function safeParse(line: string): JsonRpcMessage | undefined {
  try {
    return JSON.parse(line) as JsonRpcMessage;
  } catch {
    return undefined;
  }
}

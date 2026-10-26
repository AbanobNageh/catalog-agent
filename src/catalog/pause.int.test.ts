import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  capturingLogger,
  Fixtures,
  KEYS,
} from '../testing/fixtures.js';
import { CatalogClient } from './client.js';

// The confirm-after-timeout path with no fake in between (ADR-0004).
// catalog-api v1.1.0 commits a PATCH to Postgres, then waits for search-service
// to index it. Normally that takes about 1 s (search-service writes with
// refresh=wait_for, and OpenSearch refreshes every second). With
// search-service paused, catalog-api waits its full 2 s index timeout: the
// write has landed, and the response comes late. A client timeout between the
// two, 1.5 s, gives up only on the paused write.
const TIMEOUT_MS = 1500;
const fx = new Fixtures('pause');
const compose = (command: 'pause' | 'unpause') =>
  execFileSync('docker', ['compose', command, 'search-service'], {
    stdio: 'pipe',
  });

afterAll(() => fx.cleanup());

describe('a real late response (search-service paused)', () => {
  it('the client times out, re-reads, and reports the write as confirmed', async () => {
    const p = await fx.create({ stock: 3 });
    const { logger, lines } = capturingLogger();
    const client = new CatalogClient({
      baseUrl: BASE_URL,
      apiKey: KEYS.write,
      timeoutMs: TIMEOUT_MS,
      logger,
    });

    // Control: without the pause, the same client's write answers in time.
    // Without this, a timeout below the normal latency would pass the test
    // for the wrong reason.
    await expect(
      client.updateProduct(p.id, { stock: 4 }, 1),
    ).resolves.toMatchObject({ confirmedAfterTimeout: false, attempts: 1 });
    lines.length = 0;

    compose('pause');
    let result;
    try {
      result = await client.updateProduct(p.id, { stock: 23 }, 2);
    } finally {
      compose('unpause'); // always: the stack is shared
    }

    expect(result).toMatchObject({ confirmedAfterTimeout: true, attempts: 1 });
    expect(await fx.get(p.id)).toMatchObject({ stock: 23, version: 3 });
    // The PATCH really did time out; the confirm was a GET.
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries[0]).toMatchObject({
      method: 'PATCH',
      code: 'UNAVAILABLE',
      cause: 'timeout',
    });
    expect(entries[1]).toMatchObject({ method: 'GET', status: 200 });
  });
});

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Vitest global setup for the `int` project: the stdio tests spawn the built
 * server (`node dist/main.js`), so build it first. tsc from node_modules, run
 * with this Node, so it works the same on Windows and in CI. TypeScript 7's
 * export map hides bin/tsc, so it's found next to its package.json.
 */
export default function setup(): void {
  const pkg = createRequire(import.meta.url).resolve('typescript/package.json');
  const tsc = join(dirname(pkg), 'bin', 'tsc');
  try {
    execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
      stdio: 'inherit',
    });
  } catch {
    // Vitest 5 crashes while printing a setup error's stack ("code.charCodeAt
    // is not a function", then "No test files found"). Exit with the reason
    // instead; tsc's own errors are already printed above.
    process.stderr.write(
      '\nThe build failed (tsc errors above), so the int tests did not run.\n',
    );
    process.exit(1);
  }
}

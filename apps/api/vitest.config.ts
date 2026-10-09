import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Latency benchmarks depend on the machine; they run apart with `pnpm test:perf`.
    exclude: ['**/node_modules/**', 'test/perf/**'],
    setupFiles: ['./test/setup.ts'],
    // Each worker has its own database (see `testDatabaseUrl`), so files can run in parallel.
    // Hashing (argon2id) and database round trips are CPU-bound, and parallel workers share the
    // machine, so the default 5 s / 10 s limits flag slow runs instead of hangs.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

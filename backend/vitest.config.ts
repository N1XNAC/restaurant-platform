import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests hit a real Prisma/SQLite database and run bcrypt
    // hashing. The 5s default is tight when the three test files run in
    // parallel on a busy machine, which produced spurious timeouts.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

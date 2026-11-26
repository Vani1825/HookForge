import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    env: {
      WEBHOOK_SECRET_ENCRYPTION_KEY: 'xtjJgOfow8xiWAGfiGe6t0aS9tD2ml8WQyA+524ki7A=',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});

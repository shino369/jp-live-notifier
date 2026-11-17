import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['extension/src/lib/**/*.js', 'extension/src/sites/**/*.js'],
      reporter: ['text-summary'],
    },
  },
});

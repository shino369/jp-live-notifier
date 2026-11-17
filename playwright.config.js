import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  timeout: 120_000,
  reporter: 'list',
  workers: 1,
  outputDir: './tmp/e2e-results',
});

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'tmp/**', 'test/fixtures/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Japanese text patterns match the full-width space (U+3000) on purpose.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
    },
  },
  {
    // Extension code: pages, the service worker, and the offscreen document.
    files: ['extension/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
      },
    },
  },
  {
    // Tests run in Node (some in jsdom), with Vitest globals.
    files: ['test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.vitest },
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Playwright specs run in Node; their evaluate() callbacks run in the
    // extension, where chrome.* exists.
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.webextensions } },
  },
  prettier,
];

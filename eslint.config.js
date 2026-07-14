// Flat ESLint config (ESLint 9). Minimal, TypeScript-aware, non-opinionated on
// formatting — the goal is to catch real mistakes, not to bikeshed style, since
// this repo is meant to be copied and extended by people adding new channels.
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    // Skip build output, deps, and this config file itself (it's CommonJS —
    // `require` is correct here and shouldn't be linted by the TS ruleset).
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused args are fine when prefixed with `_` — the channel stubs and the
      // _channel-template deliberately have not-yet-used parameters.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);

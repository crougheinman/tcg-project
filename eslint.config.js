import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// Flat config. Until now ESLint was never installed, so the two
// `eslint-disable-next-line react-hooks/exhaustive-deps` comments in the tree
// were inert — nothing was checking them.
export default tseslint.config(
  { ignores: ['dist', 'android', 'ios', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Vite HMR wants a module to export only components.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `_unused` is the project's existing convention for a deliberately
      // ignored binding (see the `_e` in CardView's drag handler).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests and tooling: node globals, and `any` is fine in a fixture.
    files: ['**/__tests__/**', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);

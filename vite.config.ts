import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// vitest/config re-exports vite's defineConfig and adds the `test` field typing.
// The `environment` lives in vitest.workspace.ts, which runs this config twice —
// once under node for the pure core, once under jsdom for the store and UI.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
  },
});

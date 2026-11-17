import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isSecretKey } from './src/net/keys';

// vitest/config re-exports vite's defineConfig and adds the `test` field typing.
// The `environment` lives in vitest.workspace.ts, which runs this config twice —
// once under node for the pure core, once under jsdom for the store and UI.
export default defineConfig(({ mode }) => {
  // Every VITE_ value is copied into the public JavaScript bundle. Fail the build rather than ship a secret
  // (service_role / sb_secret_) key to every visitor. The app also refuses one at runtime (net/keys.ts), but
  // by then it would already be in the bundle.
  for (const [name, value] of Object.entries(loadEnv(mode, process.cwd(), 'VITE_'))) {
    if (value && isSecretKey(value.trim())) {
      throw new Error(
        `${name} holds a secret Supabase key, and VITE_ variables are public (they are bundled into the site). ` +
          'Use the publishable key (sb_publishable_...) in VITE_SUPABASE_PUBLISHABLE_KEY instead.',
      );
    }
  }
  return {
    plugins: [react()],
    test: {
      globals: true,
    },
  };
});

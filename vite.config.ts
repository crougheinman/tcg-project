import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// vitest/config re-exports vite's defineConfig and adds the `test` field typing.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
  },
});

import { defineWorkspace } from 'vitest/config';

// Two projects, because the code splits cleanly in two and the halves want
// different environments:
//
//   engine — the pure, deterministic core (engine / ai / cards / net sequencing).
//            Runs in `node`: no DOM, nothing to stub, fastest possible.
//   ui     — everything that touches the browser. The store reads localStorage
//            at module scope, so before this project existed it could not even be
//            IMPORTED under the node environment, which is why the PvP actor
//            guard and reconnect replay had no coverage at all.
//
// Keep new logic in the engine project where you can. The ui project is for code
// that genuinely needs a DOM.
export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: {
      name: 'engine',
      environment: 'node',
      include: ['src/{engine,ai,cards,net,audio}/**/*.test.{ts,tsx}'],
    },
  },
  {
    extends: './vite.config.ts',
    test: {
      name: 'ui',
      environment: 'jsdom',
      include: ['src/{store,ui}/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
  },
]);

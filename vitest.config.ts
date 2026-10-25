import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@aura-lie/security': resolve(__dirname, './packages/security/src/index.ts'),
      '@aura-lie/shared': resolve(__dirname, './packages/shared/src/index.ts'),
      '@aura-lie/router': resolve(__dirname, './packages/router/src/index.ts'),
      '@aura-lie/core-mode': resolve(__dirname, './packages/core-mode/src/index.ts'),
      '@aura-lie/memory': resolve(__dirname, './packages/memory/src/index.ts'),
      '@aura-lie/humanizer': resolve(__dirname, './packages/humanizer/src/index.ts'),
      '@aura-lie/truth': resolve(__dirname, './packages/truth/src/index.ts'),
      '@aura-lie/providers': resolve(__dirname, './packages/providers/src/index.ts'),
      '@aura-lie/core': resolve(__dirname, './packages/core/src/index.ts'),
      '@aura-lie/search': resolve(__dirname, './packages/search/src/index.ts'),
      '@aura-lie/claim-verify': resolve(__dirname, './packages/claim-verify/src/index.ts'),
      '@aura-lie/orchestrator': resolve(__dirname, './packages/orchestrator/src/index.ts'),
      '@aura-lie/proactive': resolve(__dirname, './packages/proactive/src/index.ts'),
      '@aura-lie/data': resolve(__dirname, './packages/data/src/index.ts'),
      '@aura-lie/personas': resolve(__dirname, './packages/personas/src/index.ts'),
      '@aura-lie/stream': resolve(__dirname, './packages/stream/src/index.ts'),
      '@aura-lie/embed': resolve(__dirname, './packages/embed/src/index.ts'),
      '@aura-lie/library': resolve(__dirname, './packages/library/src/index.ts'),
      '@aura-lie/commands': resolve(__dirname, './packages/commands/src/index.ts'),
      '@aura-lie/intent': resolve(__dirname, './packages/intent/src/index.ts'),
      '@aura-lie/promises': resolve(__dirname, './packages/promises/src/index.ts'),
    },
  },
});
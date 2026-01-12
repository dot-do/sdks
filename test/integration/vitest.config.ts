import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: [],
    deps: {
      interopDefault: true,
    },
  },
  resolve: {
    alias: {
      'platform.do': '../../packages/typescript/dotdo/src/index.ts',
      'rpc.do': '../../packages/typescript/rpc/src/index.ts',
      'capnweb': '../../src/index.ts',
    },
  },
});

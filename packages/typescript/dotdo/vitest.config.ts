import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      'rpc.do': resolve(__dirname, '../rpc/src/index.ts'),
      '@dotdo/capnweb': resolve(__dirname, '../capnweb/src/index.ts'),
    },
  },
});

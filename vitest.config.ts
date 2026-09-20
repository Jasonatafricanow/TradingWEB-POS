import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.native.test.ts', 'src/**/*.native.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    clearMocks: true,
  },
});

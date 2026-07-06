import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/component/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        // P-53: liberamos `src/app/**/page.tsx` do exclude pra medir
        // cobertura dos forms cobertos por testes de componente. Layouts
        // e wrappers puros (loading/error/not-found/template) seguem
        // excluídos — não têm lógica testável.
        'src/app/**/{layout,loading,error,not-found,template}.tsx',
        'src/components/ui/**',
      ],
    },
    setupFiles: ['tests/env-setup.ts', 'tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

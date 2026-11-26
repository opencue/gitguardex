import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ['**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts'])
]);

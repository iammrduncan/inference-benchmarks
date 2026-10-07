import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.venv/**', '**/coverage/**', '**/.next/**', '**/next-env.d.ts', '.playwright-mcp/**', '.artifacts/**', 'site/out/**', 'site/public/results/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx', 'apps/**/*.ts', 'apps/**/*.tsx', 'runner/**/*.ts', 'site/**/*.ts', 'site/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
);

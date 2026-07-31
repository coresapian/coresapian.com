import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow underscore-prefixed identifiers to mark intentional discards
      // (e.g. `_alpha` params matching the GameSubsystem.update signature).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // React 19's react-hooks v6 flags setState-in-effect broadly, but the
      // canonical "subscribe to external system + read initial value" pattern
      // (engine loading state, matchMedia, game event subscriptions) trips it
      // even though those are documented-legitimate uses. Demote to warning.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // shadcn/ui primitives legitimately co-locate component + variant constants
    // (cva schemas, button variants) — the react-refresh rule is too strict here.
    // Same for app-owned shared UI modules (item visuals, menu chrome) that pair
    // a presentational component with a small type/lookup helper.
    files: [
      'src/components/ui/**/*.{ts,tsx}',
      'src/components/game/itemVisual.tsx',
      'src/components/game/menus/menuShared.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Server-side API code runs in Node, not the browser — give it node globals
    // so process/Buffer/__dirname resolve cleanly.
    files: ['api/**/*.{ts,tsx}', 'db/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])

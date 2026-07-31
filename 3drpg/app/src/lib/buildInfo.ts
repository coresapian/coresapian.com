// ============================================================================
// CORESAPIAN — src/lib/buildInfo.ts (SCAFFOLD-OWNED, FROZEN)
// Build version stamp injected by vite.config.ts `define` at build time.
// Falls back to "dev" for local dev / type-check contexts.
// ============================================================================

declare const __BUILD_VERSION__: string;

export const BUILD_VERSION: string =
  typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

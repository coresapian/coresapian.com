import { createRouter, publicQuery } from "./middleware";
import { gameRouter } from "./game/router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  // Non-realtime game reads: realm census + character debug fetch (gdd §10).
  game: gameRouter,
});

export type AppRouter = typeof appRouter;

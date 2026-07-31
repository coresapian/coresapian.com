// ============================================================================
// api/game/router.ts — tRPC gameRouter: non-realtime reads (gdd §10).
//   game.realmCensus  -> players online per realm (all nine, zero-filled)
//   game.character    -> stored character by playerId (debug)
// ============================================================================

import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { loadPlayer } from "../queries/players";
import { getPresence, realmCensus } from "./state";

export const gameRouter = createRouter({
  realmCensus: publicQuery.query(() => ({
    ts: Date.now(),
    online: realmCensus(),
  })),

  character: publicQuery
    .input(z.object({ playerId: z.string().min(1).max(36) }))
    .query(async ({ input }) => {
      const stored = await loadPlayer(input.playerId);
      if (!stored) return null;
      const live = getPresence(input.playerId);
      return { ...stored, online: live !== undefined };
    }),
});

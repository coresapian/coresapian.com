// ============================================================================
// CORESAPIAN — src/game/combat/netClaims.ts (combat-ai)
//
// Attack-claim handoff to the net transport. Per orchestrator grant, the
// audio-net agent imports EXACTLY `drainAttackClaims` from this file (the one
// sanctioned cross-agent import exception). Combat pushes one claim per
// successful local hit; audio-net drains the queue each net tick and wraps
// each claim in an AttackClaimMsg ({ t: 'attack', ...claim }).
//
// Claims are typed per contracts/netcode.ts (AttackClaimMsg minus the tag).
// ============================================================================

import type { AttackClaimMsg } from '../../../contracts/netcode';

/** Everything in AttackClaimMsg except the `t` discriminator. */
export type AttackClaim = Omit<AttackClaimMsg, 't'>;

// Ring buffer: claims older than one net batch are dropped oldest-first so a
// stalled transport can never grow memory or replay ancient swings.
const MAX_PENDING_CLAIMS = 64;
const pending: AttackClaim[] = [];

/** Push a claim (called by the combat subsystem after a confirmed local hit). */
export function pushAttackClaim(claim: AttackClaim): void {
  pending.push(claim);
  if (pending.length > MAX_PENDING_CLAIMS) pending.splice(0, pending.length - MAX_PENDING_CLAIMS);
}

/**
 * Drain all pending claims (oldest first). Called by audio-net once per
 * transport flush. Returns a fresh array; the internal queue is cleared.
 */
export function drainAttackClaims(): AttackClaim[] {
  if (pending.length === 0) return [];
  return pending.splice(0, pending.length);
}

/** Test/dispose helper — clears without reading. */
export function clearAttackClaims(): void {
  pending.length = 0;
}

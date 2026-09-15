/**
 * Network protocol contract, shared by client and server.
 *
 * The sync model (02, 05):
 *   - Client sends INTENT ("I want to step up"), never a position. A client
 *     that could set its own x/y could walk through walls, and 02 rules it out
 *     explicitly.
 *   - Server computes the target from ITS OWN authoritative position, validates
 *     it against shared collision, and applies it. The client's idea of where
 *     it is never enters the calculation.
 *   - Client predicts locally so movement stays responsive (02 asks for
 *     client-side prediction with reconciliation, not lockstep).
 *   - Every intent carries a sequence number. The server echoes the last one it
 *     processed, which is what lets the client tell "the server hasn't caught
 *     up yet" apart from "the server disagrees with me" — see reconciliation
 *     in NetworkClient.
 */

import type { Direction, PlayerStatus } from './types.js';

/** Room type name registered with Colyseus. One generic room serves every zone. */
export const ZONE_ROOM_TYPE = 'zone';

/** Client -> server message names. */
export const CLIENT_MESSAGE = {
  /** Request one tile step in a direction. */
  move: 'move',
  /** Turn without moving (tap-to-turn, or facing a wall). */
  face: 'face',
  /** Status change driven by location + action, never a manual toggle (11). */
  status: 'status',
  /** Order (or put down) a cafe drink. Cosmetic only. */
  drink: 'drink',
  /**
   * Pause or resume the current focus session. `{ paused: boolean }`.
   *
   * Only ever SUBTRACTS time. The server still times the session from its own
   * clock; this tells it which stretches not to count. A message that could add
   * time would let a client award itself hours, which is the one thing the
   * progression system cannot tolerate.
   */
  focusPause: 'focus_pause',
} as const;

export interface FocusPauseIntent {
  paused: boolean;
}

/** Server -> client message names. */
export const SERVER_MESSAGE = {
  /**
   * Sent when the server rejects an intent (illegal step, rate limited). The
   * client snaps back to the authoritative position.
   */
  correction: 'correction',
} as const;

export interface MoveIntent {
  dir: Direction;
  /** Monotonic per-client counter. */
  seq: number;
}

export interface FaceIntent {
  facing: Direction;
  seq: number;
}

export interface StatusIntent {
  status: PlayerStatus;
}

export interface DrinkIntent {
  /** A drink id, or '' to put it down. Validated server-side. */
  drink: string;
}

export interface CorrectionMessage {
  x: number;
  y: number;
  facing: Direction;
  /** The last intent the server actually processed. */
  seq: number;
  reason: 'blocked' | 'rate_limited' | 'desync';
}

export interface JoinOptions {
  zoneId: string;
  displayName: string;
  spriteKey: string;
  /**
   * Stable identity across sessions, so study time and high scores accumulate
   * against a person rather than a socket. Phase 3 generates this client-side;
   * Supabase auth replaces where it comes from, not how it is used.
   */
  userId?: string;
  /**
   * Zone the player is arriving FROM, so the server can place them at the
   * matching entry point rather than the generic spawn — walking back and
   * forth through a door should put you on the correct side of it (03).
   *
   * The server owns position, so it must resolve this; if the client picked
   * its own arrival tile the server would immediately overrule it.
   */
  fromZone?: string;
}

/**
 * Server-side movement rate limit.
 *
 * A legitimate client sends at most one step per walkTileMs (130ms). This floor
 * sits below that so normal play is never throttled by frame jitter or a burst
 * after a stall, while still capping a client that tries to move far faster
 * than a person can walk. Anti-abuse basics are explicitly in scope at MVP (05).
 */
export const MOVE_RATE_LIMIT = {
  /** Minimum ms between accepted moves. */
  minIntervalMs: 90,
  /** Allowance for brief bursts, in moves. */
  burst: 3,
} as const;

export const CHAT_RATE_LIMIT = {
  minIntervalMs: 500,
  burst: 5,
} as const;

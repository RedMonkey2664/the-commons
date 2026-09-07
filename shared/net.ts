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
} as const;

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

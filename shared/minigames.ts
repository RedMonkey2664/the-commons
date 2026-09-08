/**
 * Minigame protocol — 06.
 *
 * A minigame is one self-contained Phaser Scene plus one entry in
 * minigames.config.ts. The Arcade reads the config, places a cabinet per entry,
 * and launches the matching scene by key. It never learns anything about what
 * the minigame does.
 *
 * Solo games run entirely client-side. Multiplayer games run their round in a
 * Colyseus room, because 06 requires scores and round outcomes to be computed
 * server-side rather than trusted from clients.
 */

import type { PlayerRef } from './types.js';

/** Colyseus room type for same-room multiplayer minigames. */
export const MINIGAME_ROOM_TYPE = 'minigame';

/** Client -> server, inside a minigame room. */
export const MINIGAME_CLIENT_MESSAGE = {
  /** Mark yourself ready in the lobby. */
  ready: 'mg:ready',
  /** Submit an answer/action for the current round. */
  answer: 'mg:answer',
  /** Leave mid-round; 11 allows a graceful forfeit. */
  forfeit: 'mg:forfeit',
} as const;

/** Server -> client, inside a minigame room. */
export const MINIGAME_SERVER_MESSAGE = {
  /** A new question/round has begun. */
  round: 'mg:round',
  /**
   * Something happened DURING a round that clients must see but could not be
   * told in advance.
   *
   * Reaction Tap is the reason this exists: the moment the light turns green
   * cannot be in the round payload, or a client could schedule a perfect tap
   * before it arrives. The server holds it back and fires this instead.
   */
  cue: 'mg:cue',
  /** The round resolved; carries per-player results. */
  result: 'mg:result',
  /** The whole game finished; carries final standings. */
  finished: 'mg:finished',
} as const;

export type MinigamePhase = 'lobby' | 'countdown' | 'playing' | 'between' | 'finished';

export interface TriviaQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Never sent to clients while the round is live. */
  answerIndex?: number;
}

export interface RoundPayload {
  index: number;
  total: number;
  question: TriviaQuestion;
  /** Milliseconds allowed for this round. */
  durationMs: number;
}

export interface RoundResultPayload {
  correctIndex: number;
  /** playerId -> whether they got it right, and their running score. */
  scores: Array<{ playerId: string; displayName: string; correct: boolean; score: number }>;
}

export interface FinishedPayload {
  standings: Array<{ playerId: string; displayName: string; score: number }>;
}

export interface MinigameJoinOptions {
  minigameId: string;
  displayName: string;
  userId: string;
}

/**
 * The interface every minigame scene implements (06).
 *
 * `reportScore` is the only route a score takes out of a minigame, which is
 * what lets the Arcade persist results without knowing the game's rules.
 */
export interface MinigameScene {
  onStart(players: PlayerRef[]): void;
  onEnd(): void;
  reportScore(playerId: string, score: number): void;
}

/**
 * Reaction Tap (06).
 *
 * Shared because the client needs the window length to draw its timer, and the
 * server needs it to score. One definition, imported by both.
 *
 * The honest caveat, stated in the game itself: the server measures when your
 * tap ARRIVES, so your network latency is part of your time. Measuring on the
 * client would be fairer and completely unenforceable — a client could report
 * 3ms every round. 06 requires round outcomes to be computed server-side, and
 * this is what that costs. For a group laughing at each other it is the right
 * trade; it would be the wrong one for a leaderboard that mattered.
 */
export const REACTION_TAP_RULES = {
  rounds: 5,
  /** Random hold before the light turns green. */
  minHoldMs: 1200,
  maxHoldMs: 4200,
  /** How long the light stays green before the round is a bust. */
  windowMs: 2500,
  countdownMs: 2500,
  revealMs: 2400,
  lobbyWaitMs: 20_000,
  /** Points for an instant reaction, decaying across the window. */
  maxPoints: 120,
  minPoints: 10,
  /** Tapping before green scores nothing, and it says so. */
  falseStartPoints: 0,
} as const;

/**
 * Round pacing (11): "rounds should target 2-5 minutes".
 * Difficulty may ramp within a session but resets per session — no
 * meta-progression gating content.
 */
/**
 * Word Rush (Phase 6) — 1-4 players, server-authoritative.
 *
 * One rack of letters per round, one word each, longest word wins. Scoring is
 * length-first and speed-second on purpose: rewarding speed above all would
 * make it a typing race, and the interesting decision is "do I submit `rain`
 * now or hunt for `trained`".
 */
export const WORD_RUSH_RULES = {
  rounds: 5,
  /** Time to find and submit one word. */
  roundMs: 25_000,
  revealMs: 3200,
  countdownMs: 3000,
  lobbyWaitMs: 20_000,
  minWordLength: 3,
  /** Points per letter, squared — 'trained' is worth far more than 'rain'. */
  pointsPerLetter: 6,
  /** Added on top, decaying to zero at the buzzer, so ties break on speed. */
  maxSpeedBonus: 25,
} as const;

export const TRIVIA_RULES = {
  questionsPerGame: 8,
  /** Time to answer one question. */
  roundMs: 12_000,
  /** Pause on the answer reveal before the next question. */
  revealMs: 2600,
  /** Countdown before the first question, so late joiners can settle. */
  countdownMs: 3000,
  /** Full marks for an instant answer, decaying to this floor at the buzzer. */
  minPoints: 40,
  maxPoints: 100,
  /** Lobby waits this long for others before starting solo. */
  lobbyWaitMs: 20_000,
} as const;

export const MEMORY_MATCH_RULES = {
  /** 6 pairs on a 4x3 grid — a 2-5 minute round without being tedious. */
  pairs: 6,
  columns: 4,
  /** How long a mismatched pair stays face-up before flipping back. */
  mismatchHoldMs: 700,
  /** Base score per matched pair, before the time bonus. */
  pairPoints: 100,
  /** Bonus points remaining at the start, decaying over the round. */
  timeBonus: 600,
  timeBonusWindowMs: 90_000,
  /** Points lost per mismatched flip, floored at zero overall. */
  mismatchPenalty: 15,
} as const;

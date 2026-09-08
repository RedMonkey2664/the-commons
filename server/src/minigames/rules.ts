/**
 * Multiplayer minigame rules.
 *
 * MinigameRoom used to BE Trivia Blitz: its question bank, its scoring, its
 * timings. A comment claimed adding a second multiplayer game would need "a
 * rules object, not a room class" — this file is that claim being cashed in.
 *
 * A rules module owns everything game-specific:
 *   - how many rounds and how long each lasts
 *   - what the client is told about a round (the PUBLIC payload)
 *   - what the server keeps back (the SECRET — the answer)
 *   - how an answer scores
 *   - what is revealed afterwards
 *
 * MinigameRoom owns everything else: the lobby, the clock, the phase machine,
 * per-player state, forfeit handling, and persistence. Neither knows the other's
 * business, which is what 06 asks for.
 */

import type { TriviaQuestion } from '@commons/shared';
import { REACTION_TAP_RULES, TRIVIA_RULES } from '@commons/shared';
import { TRIVIA_QUESTIONS } from './triviaQuestions.js';

export interface RoundCue {
  /** Ms after the round starts to broadcast this. */
  atMs: number;
  payload: unknown;
}

export interface BuiltRound {
  /** Sent to clients. Must never contain the answer. */
  payload: unknown;
  /** Kept on the server for scoring. */
  secret: unknown;
  durationMs: number;
  /**
   * Mid-round broadcasts. Used when clients must learn something only at the
   * moment it happens — see MINIGAME_SERVER_MESSAGE.cue.
   */
  cues?: RoundCue[];
}

export interface ScoredAnswer {
  correct: boolean;
  points: number;
}

export interface MinigameRules {
  readonly id: string;
  readonly roundsPerGame: number;
  readonly countdownMs: number;
  readonly revealMs: number;
  readonly lobbyWaitMs: number;

  /** Called once per game, before the first round, to set up any state. */
  prepare(): void;

  buildRound(index: number): BuiltRound | null;

  /**
   * Is this payload a plausible answer at all?
   *
   * Separate from score() because the ROOM needs to know before it marks a
   * player as having answered. The rules refactor briefly lost this, and any
   * malformed or stale message then burned a player's single answer — and
   * could end the round early for everyone.
   */
  isValidAnswer(secret: unknown, answer: unknown): boolean;

  /**
   * Score one answer.
   *
   * @param elapsedMs time from the round starting to the answer ARRIVING at the
   *                  server. Measured server-side on purpose (06): a client that
   *                  reported its own timing could report zero.
   */
  score(secret: unknown, answer: unknown, elapsedMs: number, durationMs: number): ScoredAnswer;

  /** Public information about the round, sent once it is over. */
  reveal(secret: unknown): unknown;
}

// ---------------------------------------------------------------------------
// Trivia Blitz
// ---------------------------------------------------------------------------

interface TriviaSecret {
  answerIndex: number;
  optionCount: number;
}

class TriviaRules implements MinigameRules {
  readonly id = 'trivia_blitz';
  readonly roundsPerGame = TRIVIA_RULES.questionsPerGame;
  readonly countdownMs = TRIVIA_RULES.countdownMs;
  readonly revealMs = TRIVIA_RULES.revealMs;
  readonly lobbyWaitMs = TRIVIA_RULES.lobbyWaitMs;

  private questions: TriviaQuestion[] = [];

  prepare(): void {
    this.questions = shuffle([...TRIVIA_QUESTIONS]).slice(0, this.roundsPerGame);
  }

  buildRound(index: number): BuiltRound | null {
    const question = this.questions[index];
    if (!question) return null;

    return {
      // The answer index is stripped here, at the boundary. A client that
      // received it could win every round without playing.
      payload: {
        question: { id: question.id, prompt: question.prompt, options: question.options },
      },
      secret: {
        answerIndex: question.answerIndex ?? 0,
        optionCount: question.options.length,
      } satisfies TriviaSecret,
      durationMs: TRIVIA_RULES.roundMs,
    };
  }

  isValidAnswer(secret: unknown, answer: unknown): boolean {
    const { optionCount } = secret as TriviaSecret;
    const index = Number((answer as { index?: unknown })?.index);
    return Number.isInteger(index) && index >= 0 && index < optionCount;
  }

  score(secret: unknown, answer: unknown, elapsedMs: number, durationMs: number): ScoredAnswer {
    const { answerIndex, optionCount } = secret as TriviaSecret;
    const index = Number((answer as { index?: unknown })?.index);

    if (!Number.isInteger(index) || index < 0 || index >= optionCount) {
      return { correct: false, points: 0 };
    }
    if (index !== answerIndex) return { correct: false, points: 0 };

    // Faster answers score more, floored so a late correct answer still beats
    // a wrong one.
    const t = 1 - Math.max(0, Math.min(durationMs, elapsedMs)) / durationMs;
    const span = TRIVIA_RULES.maxPoints - TRIVIA_RULES.minPoints;
    return { correct: true, points: Math.round(TRIVIA_RULES.minPoints + span * t) };
  }

  reveal(secret: unknown): unknown {
    return { correctIndex: (secret as TriviaSecret).answerIndex };
  }
}

// ---------------------------------------------------------------------------
// Reaction Tap — 06's third minigame
// ---------------------------------------------------------------------------

/**
 * "classic 'tap when the light turns green' reflex test, simple to build,
 * naturally competitive/funny in a group."
 *
 * Timings live in shared/minigames.ts because the client draws against the same
 * window the server scores against.
 */

interface ReactionSecret {
  /** Ms after the round starts that the light turns green. */
  goAfterMs: number;
}

class ReactionRules implements MinigameRules {
  readonly id = 'reaction_tap';
  readonly roundsPerGame = REACTION_TAP_RULES.rounds;
  readonly countdownMs = REACTION_TAP_RULES.countdownMs;
  readonly revealMs = REACTION_TAP_RULES.revealMs;
  readonly lobbyWaitMs = REACTION_TAP_RULES.lobbyWaitMs;

  prepare(): void {
    // Nothing to set up: every round is generated fresh.
  }

  buildRound(index: number): BuiltRound | null {
    if (index >= this.roundsPerGame) return null;

    const span = REACTION_TAP_RULES.maxHoldMs - REACTION_TAP_RULES.minHoldMs;
    const goAfterMs = Math.round(REACTION_TAP_RULES.minHoldMs + Math.random() * span);

    return {
      // Clients are told the round has begun but NOT when the light turns.
      // Sending goAfterMs would let a client schedule a perfect tap; the cue
      // below fires at the moment instead.
      payload: { holdHint: 'wait for green' },
      secret: { goAfterMs } satisfies ReactionSecret,
      durationMs: goAfterMs + REACTION_TAP_RULES.windowMs,
      cues: [{ atMs: goAfterMs, payload: { go: true } }],
    };
  }

  isValidAnswer(_secret: unknown, answer: unknown): boolean {
    // A tap carries no data beyond having happened.
    return (answer as { tapped?: unknown } | null)?.tapped === true;
  }

  score(secret: unknown, _answer: unknown, elapsedMs: number): ScoredAnswer {
    const { goAfterMs } = secret as ReactionSecret;
    const reactionMs = elapsedMs - goAfterMs;

    // Tapped before the light: a false start scores nothing.
    if (reactionMs < 0) return { correct: false, points: REACTION_TAP_RULES.falseStartPoints };
    if (reactionMs > REACTION_TAP_RULES.windowMs) return { correct: false, points: 0 };

    const t = 1 - reactionMs / REACTION_TAP_RULES.windowMs;
    const span = REACTION_TAP_RULES.maxPoints - REACTION_TAP_RULES.minPoints;
    return { correct: true, points: Math.round(REACTION_TAP_RULES.minPoints + span * t) };
  }

  reveal(secret: unknown): unknown {
    return { goAfterMs: (secret as ReactionSecret).goAfterMs };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Adding a multiplayer minigame: write a rules class, add one line here, add
 * the config entry. MinigameRoom does not change.
 */
const RULES_FACTORIES: Record<string, () => MinigameRules> = {
  trivia_blitz: () => new TriviaRules(),
  reaction_tap: () => new ReactionRules(),
};

export function rulesFor(minigameId: string): MinigameRules | undefined {
  return RULES_FACTORIES[minigameId]?.();
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

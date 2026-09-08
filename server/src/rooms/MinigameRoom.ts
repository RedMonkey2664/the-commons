/**
 * Same-room multiplayer minigames — 06.
 *
 * "Keep multiplayer minigame state server-authoritative same as world movement
 * — scores and round outcomes are computed server-side, not trusted from
 * clients."
 *
 * So: the server owns the question bank, the clock and the scoring. Clients
 * receive a question WITHOUT its answer, send back an index, and are told what
 * happened. A client cannot know the answer before the reveal, and cannot
 * report its own score.
 *
 * One generic room serves every multiplayer minigame, matched on `minigameId`
 * the same way ZoneRoom is matched on `zoneId`. Adding a second multiplayer
 * game means adding a rules object, not a room class.
 */

import { Room, type Client } from 'colyseus';
import { ArraySchema, Schema, type } from '@colyseus/schema';
import type {
  FinishedPayload,
  MinigameJoinOptions,
  MinigamePhase,
  RoundPayload,
  RoundResultPayload,
  TriviaQuestion,
} from '@commons/shared';
import {
  MINIGAME_CLIENT_MESSAGE,
  MINIGAME_SERVER_MESSAGE,
  TRIVIA_RULES,
  getMinigame,
} from '@commons/shared';
import { TRIVIA_QUESTIONS } from '../minigames/triviaQuestions.js';
import { getStore } from '../db/client.js';

class MinigamePlayer extends Schema {
  @type('string') id = '';
  @type('string') userId = '';
  @type('string') displayName = '';
  @type('number') score = 0;
  @type('boolean') ready = false;
  @type('boolean') answered = false;
}

class MinigameState extends Schema {
  @type('string') minigameId = '';
  @type('string') phase: MinigamePhase = 'lobby';
  @type('number') roundIndex = 0;
  // Annotated: TRIVIA_RULES is `as const`, so this would otherwise infer the
  // literal type 8 and reject any other round count.
  @type('number') totalRounds: number = TRIVIA_RULES.questionsPerGame;
  @type([MinigamePlayer]) players = new ArraySchema<MinigamePlayer>();
}

/** What the server remembers about the live round; never synced. */
interface LiveRound {
  question: TriviaQuestion;
  answerIndex: number;
  startedAt: number;
  /** playerId -> answer index and the moment it arrived. */
  answers: Map<string, { index: number; at: number }>;
}

export class MinigameRoom extends Room<MinigameState> {
  override maxClients = 4;

  private questions: TriviaQuestion[] = [];
  private round?: LiveRound;
  private timer?: NodeJS.Timeout;
  private lobbyTimer?: NodeJS.Timeout;

  override onCreate(options: { minigameId?: string }): void {
    const minigameId = options.minigameId ?? 'trivia_blitz';
    const config = getMinigame(minigameId);

    this.setState(new MinigameState());
    this.state.minigameId = minigameId;
    this.maxClients = config?.maxPlayers ?? 4;

    this.setMetadata({ minigameId });

    this.onMessage(MINIGAME_CLIENT_MESSAGE.ready, (client) => this.handleReady(client));
    this.onMessage(MINIGAME_CLIENT_MESSAGE.answer, (client, message: { index?: number }) => {
      this.handleAnswer(client, message);
    });
    this.onMessage(MINIGAME_CLIENT_MESSAGE.forfeit, (client) => {
      // 11 allows a graceful forfeit; leaving mid-round is not a penalty.
      void this.onLeave(client);
    });

    console.log(`[minigame] room created: ${minigameId} (${this.roomId})`);
  }

  override onJoin(client: Client, options: MinigameJoinOptions): void {
    const player = new MinigamePlayer();
    player.id = client.sessionId;
    player.userId = typeof options?.userId === 'string' ? options.userId : client.sessionId;
    player.displayName = sanitizeName(options?.displayName);
    this.state.players.push(player);

    // 06: the cabinet opens a "waiting for players" lobby so friends standing
    // nearby can join before the round begins. It cannot wait forever, so a
    // solo player starts on the timer instead of being stuck.
    if (this.state.phase === 'lobby' && !this.lobbyTimer) {
      this.lobbyTimer = setTimeout(() => this.begin(), TRIVIA_RULES.lobbyWaitMs);
    }
  }

  override onLeave(client: Client): void {
    const index = this.state.players.findIndex((p) => p.id === client.sessionId);
    if (index >= 0) this.state.players.splice(index, 1);

    if (this.state.players.length === 0) {
      this.clearTimers();
      return;
    }
    // Everyone still here has answered — don't make them wait out the clock
    // for someone who left.
    if (this.state.phase === 'playing' && this.everyoneAnswered()) this.resolveRound();
  }

  override onDispose(): void {
    this.clearTimers();
    console.log(`[minigame] room disposed: ${this.state.minigameId} (${this.roomId})`);
  }

  // -- lobby ---------------------------------------------------------------

  private handleReady(client: Client): void {
    const player = this.state.players.find((p) => p.id === client.sessionId);
    if (!player || this.state.phase !== 'lobby') return;
    player.ready = true;

    if (this.state.players.every((p) => p.ready)) this.begin();
  }

  private begin(): void {
    if (this.state.phase !== 'lobby') return;
    this.clearTimers();

    this.questions = pickQuestions(TRIVIA_RULES.questionsPerGame);
    this.state.roundIndex = 0;
    this.state.totalRounds = this.questions.length;
    this.state.phase = 'countdown';

    this.timer = setTimeout(() => this.startRound(), TRIVIA_RULES.countdownMs);
  }

  // -- rounds --------------------------------------------------------------

  private startRound(): void {
    const question = this.questions[this.state.roundIndex];
    if (!question) {
      this.finish();
      return;
    }

    this.round = {
      question,
      answerIndex: question.answerIndex ?? 0,
      startedAt: Date.now(),
      answers: new Map(),
    };

    for (const player of this.state.players) player.answered = false;
    this.state.phase = 'playing';

    // The answer index is stripped before this leaves the server. A client that
    // received it could win every round without playing.
    const payload: RoundPayload = {
      index: this.state.roundIndex,
      total: this.state.totalRounds,
      question: { id: question.id, prompt: question.prompt, options: question.options },
      durationMs: TRIVIA_RULES.roundMs,
    };
    this.broadcast(MINIGAME_SERVER_MESSAGE.round, payload);

    this.timer = setTimeout(() => this.resolveRound(), TRIVIA_RULES.roundMs);
  }

  private handleAnswer(client: Client, message: { index?: number }): void {
    if (this.state.phase !== 'playing' || !this.round) return;

    const player = this.state.players.find((p) => p.id === client.sessionId);
    if (!player || player.answered) return; // first answer only; no changing it

    const index = Number(message?.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.round.question.options.length) {
      return;
    }

    player.answered = true;
    this.round.answers.set(client.sessionId, { index, at: Date.now() });

    if (this.everyoneAnswered()) this.resolveRound();
  }

  private everyoneAnswered(): boolean {
    return this.state.players.length > 0 && this.state.players.every((p) => p.answered);
  }

  private resolveRound(): void {
    if (!this.round || this.state.phase !== 'playing') return;
    this.clearTimers();

    const { answerIndex, startedAt } = this.round;
    const results: RoundResultPayload['scores'] = [];

    for (const player of this.state.players) {
      const answer = this.round.answers.get(player.id);
      const correct = answer?.index === answerIndex;

      if (correct && answer) {
        // Faster answers score more, floored so a late correct answer still
        // beats a wrong one. Computed from the SERVER's clock.
        const elapsed = Math.max(0, Math.min(TRIVIA_RULES.roundMs, answer.at - startedAt));
        const t = 1 - elapsed / TRIVIA_RULES.roundMs;
        const span = TRIVIA_RULES.maxPoints - TRIVIA_RULES.minPoints;
        player.score += Math.round(TRIVIA_RULES.minPoints + span * t);
      }

      results.push({
        playerId: player.id,
        displayName: player.displayName,
        correct,
        score: player.score,
      });
    }

    this.state.phase = 'between';
    this.broadcast(MINIGAME_SERVER_MESSAGE.result, {
      correctIndex: answerIndex,
      scores: results,
    } satisfies RoundResultPayload);

    this.round = undefined;
    this.state.roundIndex += 1;

    this.timer = setTimeout(() => {
      if (this.state.roundIndex >= this.state.totalRounds) this.finish();
      else this.startRound();
    }, TRIVIA_RULES.revealMs);
  }

  private finish(): void {
    this.clearTimers();
    this.state.phase = 'finished';

    const standings = [...this.state.players]
      .map((p) => ({ playerId: p.id, displayName: p.displayName, score: p.score, userId: p.userId }))
      .sort((a, b) => b.score - a.score);

    this.broadcast(MINIGAME_SERVER_MESSAGE.finished, {
      standings: standings.map(({ playerId, displayName, score }) => ({ playerId, displayName, score })),
    } satisfies FinishedPayload);

    void this.persistScores(standings);
  }

  /** Scores reach the database from HERE, never from a client message. */
  private async persistScores(
    standings: Array<{ userId: string; displayName: string; score: number }>,
  ): Promise<void> {
    const store = getStore();
    for (const entry of standings) {
      if (entry.score <= 0) continue;
      try {
        await store.upsertUser({
          id: entry.userId,
          displayName: entry.displayName,
          spriteKey: 'char_player',
        });
        await store.submitScore({
          minigameId: this.state.minigameId,
          userId: entry.userId,
          displayName: entry.displayName,
          score: entry.score,
          achievedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn('[minigame] failed to persist score:', (error as Error).message);
      }
    }
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.timer = undefined;
    this.lobbyTimer = undefined;
  }
}

/** Fisher-Yates over a copy, so a session's questions are a fresh shuffle. */
function pickQuestions(count: number): TriviaQuestion[] {
  const pool = [...TRIVIA_QUESTIONS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function sanitizeName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const cleaned = text.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : 'Wanderer';
}

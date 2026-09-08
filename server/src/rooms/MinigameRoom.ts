/**
 * Same-room multiplayer minigames — 06.
 *
 * "Keep multiplayer minigame state server-authoritative same as world movement
 * — scores and round outcomes are computed server-side, not trusted from
 * clients."
 *
 * This room owns the lobby, the clock, the phase machine, per-player state,
 * forfeits and persistence. It owns NO game rules: those come from a rules
 * module (server/src/minigames/rules.ts) selected by `minigameId`.
 *
 * That split is what makes 06's plugin claim true for multiplayer games as well
 * as solo ones — Reaction Tap was added as a rules class and a config entry,
 * with no change to this file.
 */

import { Room, type Client } from 'colyseus';
import { ArraySchema, Schema, type } from '@colyseus/schema';
import type { MinigameJoinOptions, MinigamePhase } from '@commons/shared';
import { MINIGAME_CLIENT_MESSAGE, MINIGAME_SERVER_MESSAGE, getMinigame } from '@commons/shared';
import { rulesFor, type BuiltRound, type MinigameRules } from '../minigames/rules.js';
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
  @type('number') totalRounds = 0;
  @type([MinigamePlayer]) players = new ArraySchema<MinigamePlayer>();
}

/** The live round. Never synced — `secret` is the whole point. */
interface LiveRound extends BuiltRound {
  startedAt: number;
  answers: Map<string, { answer: unknown; at: number }>;
}

export class MinigameRoom extends Room<MinigameState> {
  override maxClients = 4;

  private rules!: MinigameRules;
  private round?: LiveRound;
  private timer?: NodeJS.Timeout;
  private lobbyTimer?: NodeJS.Timeout;
  /** Mid-round cue timers, cleared with the round. */
  private cueTimers: NodeJS.Timeout[] = [];

  override onCreate(options: { minigameId?: string }): void {
    const minigameId = options.minigameId ?? 'trivia_blitz';
    const config = getMinigame(minigameId);
    const rules = rulesFor(minigameId);

    if (!rules) {
      // A config entry pointing at rules that do not exist would strand players
      // in a lobby forever; fail loudly at creation instead.
      throw new Error(`No multiplayer rules registered for "${minigameId}"`);
    }
    this.rules = rules;

    this.setState(new MinigameState());
    this.state.minigameId = minigameId;
    this.state.totalRounds = rules.roundsPerGame;
    this.maxClients = config?.maxPlayers ?? 4;
    this.setMetadata({ minigameId });

    this.onMessage(MINIGAME_CLIENT_MESSAGE.ready, (client) => this.handleReady(client));
    this.onMessage(MINIGAME_CLIENT_MESSAGE.answer, (client, message: unknown) => {
      this.handleAnswer(client, message);
    });
    this.onMessage(MINIGAME_CLIENT_MESSAGE.forfeit, (client) => {
      // 11 allows a graceful forfeit. client.leave() so the socket actually
      // closes and onLeave runs exactly once.
      client.leave();
    });

    console.log(`[minigame] room created: ${minigameId} (${this.roomId})`);
  }

  override onJoin(client: Client, options: MinigameJoinOptions): void {
    const player = new MinigamePlayer();
    player.id = client.sessionId;
    player.userId = typeof options?.userId === 'string' ? options.userId : client.sessionId;
    player.displayName = sanitizeName(options?.displayName);
    this.state.players.push(player);

    // 06: the cabinet opens a "waiting for players" lobby so friends nearby can
    // join before the round begins. It cannot wait forever, so a solo player
    // starts on the timer rather than being stuck.
    if (this.state.phase === 'lobby' && !this.lobbyTimer) {
      this.lobbyTimer = setTimeout(() => this.begin(), this.rules.lobbyWaitMs);
    }
  }

  override onLeave(client: Client): void {
    const index = this.state.players.findIndex((p) => p.id === client.sessionId);
    if (index >= 0) this.state.players.splice(index, 1);

    if (this.state.players.length === 0) {
      this.clearTimers();
      return;
    }
    // Everyone still here has answered — don't make them wait out the clock for
    // someone who left.
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

    // Stop matchmaking into a game already underway: a late joiner's `ready`
    // would be ignored and they would finish on zero having seen nothing.
    void this.lock();

    this.rules.prepare();
    this.state.roundIndex = 0;
    this.state.totalRounds = this.rules.roundsPerGame;
    this.state.phase = 'countdown';

    this.timer = setTimeout(() => this.startRound(), this.rules.countdownMs);
  }

  // -- rounds --------------------------------------------------------------

  private startRound(): void {
    const built = this.rules.buildRound(this.state.roundIndex);
    if (!built) {
      this.finish();
      return;
    }

    this.round = { ...built, startedAt: Date.now(), answers: new Map() };
    for (const player of this.state.players) player.answered = false;
    this.state.phase = 'playing';

    this.broadcast(MINIGAME_SERVER_MESSAGE.round, {
      index: this.state.roundIndex,
      total: this.state.totalRounds,
      durationMs: built.durationMs,
      ...(built.payload as Record<string, unknown>),
    });

    const live = this.round;
    for (const cue of built.cues ?? []) {
      this.cueTimers.push(
        setTimeout(() => {
          // Bound to THIS round: one that resolved early (everyone answered)
          // must not fire a stale cue into the next one.
          if (this.round === live && this.state.phase === 'playing') {
            this.broadcast(MINIGAME_SERVER_MESSAGE.cue, cue.payload);
          }
        }, cue.atMs),
      );
    }

    this.timer = setTimeout(() => this.resolveRound(), built.durationMs);
  }

  private handleAnswer(client: Client, message: unknown): void {
    if (this.state.phase !== 'playing' || !this.round) return;

    const player = this.state.players.find((p) => p.id === client.sessionId);
    if (!player || player.answered) return; // first answer only; no changing it

    // Validate BEFORE marking them as having answered: a malformed or stale
    // message must not burn their one answer, nor end the round early for
    // everyone else by completing the "all answered" check.
    if (!this.rules.isValidAnswer(this.round.secret, message)) return;

    player.answered = true;
    // Timed on ARRIVAL, by the server's clock. A client-reported time could be
    // anything the client liked.
    this.round.answers.set(client.sessionId, { answer: message, at: Date.now() });

    if (this.everyoneAnswered()) this.resolveRound();
  }

  private everyoneAnswered(): boolean {
    return this.state.players.length > 0 && this.state.players.every((p) => p.answered);
  }

  private resolveRound(): void {
    const round = this.round;
    if (!round || this.state.phase !== 'playing') return;
    this.clearTimers();

    const scores: Array<{ playerId: string; displayName: string; correct: boolean; score: number }> = [];

    for (const player of this.state.players) {
      const submitted = round.answers.get(player.id);
      let correct = false;

      if (submitted) {
        const elapsed = submitted.at - round.startedAt;
        const result = this.rules.score(round.secret, submitted.answer, elapsed, round.durationMs);
        correct = result.correct;
        player.score += result.points;
      }

      scores.push({
        playerId: player.id,
        displayName: player.displayName,
        correct,
        score: player.score,
      });
    }

    this.state.phase = 'between';
    this.broadcast(MINIGAME_SERVER_MESSAGE.result, {
      ...(this.rules.reveal(round.secret) as Record<string, unknown>),
      scores,
    });

    this.round = undefined;
    this.state.roundIndex += 1;

    this.timer = setTimeout(() => {
      if (this.state.roundIndex >= this.state.totalRounds) this.finish();
      else this.startRound();
    }, this.rules.revealMs);
  }

  private finish(): void {
    this.clearTimers();
    this.state.phase = 'finished';

    const standings = [...this.state.players]
      .map((p) => ({ playerId: p.id, displayName: p.displayName, score: p.score, userId: p.userId }))
      .sort((a, b) => b.score - a.score);

    this.broadcast(MINIGAME_SERVER_MESSAGE.finished, {
      standings: standings.map(({ playerId, displayName, score }) => ({ playerId, displayName, score })),
    });

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
    for (const cue of this.cueTimers) clearTimeout(cue);
    this.cueTimers = [];
    this.timer = undefined;
    this.lobbyTimer = undefined;
  }
}

function sanitizeName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const cleaned = text.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : 'Wanderer';
}

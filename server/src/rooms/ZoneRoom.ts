/**
 * One generic, config-driven room type that serves EVERY zone.
 *
 * 02 maps zones onto Colyseus rooms 1:1, and the config-over-code rule means
 * adding the Library must not mean writing a LibraryRoom. Clients join this
 * room type filtered by `zoneId`, so everyone who asks for 'cafe' lands in the
 * same Cafe room, and a brand new zone needs only its entry in zones.config.ts.
 *
 * Authority model (02, 05):
 *   - The client sends intent only. Targets are computed from the SERVER's
 *     position, so a hostile client cannot teleport or clip through walls.
 *   - Collision comes from the shared parser over the shared map JSON.
 *   - Rejected intents produce a correction the client snaps to.
 */

import { Room, type Client } from 'colyseus';
import type {
  ChatMessage,
  ChatSayIntent,
  Direction,
  DrinkIntent,
  FaceIntent,
  JoinOptions,
  MoveIntent,
  StatusIntent,
  ZoneConfig,
  ZoneId,
} from '@commons/shared';
import {
  CHAT_CLIENT_MESSAGE,
  CHAT_LIMITS,
  CHAT_RATE_LIMIT,
  CHAT_SERVER_MESSAGE,
  CLIENT_MESSAGE,
  JUKEBOX_CLIENT_MESSAGE,
  JUKEBOX_SERVER_MESSAGE,
  MAX_STUDY_SECONDS,
  MIN_STUDY_SECONDS,
  MOVE_RATE_LIMIT,
  SERVER_MESSAGE,
  getZone,
  isValidDrinkId,
  resolveEntryPoint,
  tileInFront,
} from '@commons/shared';
import type { JukeboxRejected, JukeboxState, QueueIntent } from '@commons/shared';
import { PlayerSchema, ZoneState } from '../schemas/PlayerState.js';
import { loadZoneMap, type ServerZoneMap } from '../world/zoneMaps.js';
import { getStore } from '../db/client.js';
import { Jukebox, zoneHasJukebox } from './jukebox.js';

const VALID_DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const VALID_STATUSES = ['idle', 'studying', 'listening', 'afk'] as const;

/** Per-client throttle state. Not synced — server bookkeeping only. */
interface ClientBudget {
  /** Token bucket for movement intents. */
  tokens: number;
  lastRefillAt: number;
  /** Separate bucket for chat, so talking never eats a player's move budget. */
  chatTokens: number;
  chatRefillAt: number;
}

/**
 * An open study session.
 *
 * 11: study time is "a passive byproduct, not a feature you use" — time accrues
 * while status is `studying`, and the row is written when it stops. Held
 * server-side so the duration comes from the server clock rather than a number
 * a client reports about itself.
 */
interface OpenStudySession {
  userId: string;
  displayName: string;
  startedAt: number;
}

export class ZoneRoom extends Room<ZoneState> {
  /** 2-8 people per room is the design target (02); this is a safety ceiling. */
  override maxClients = 24;

  private zone!: ZoneConfig;
  private zoneMap!: ServerZoneMap;
  private readonly budgets = new Map<string, ClientBudget>();
  private readonly studySessions = new Map<string, OpenStudySession>();
  /** Only zones that actually have one (Cafe, Park). */
  private jukebox?: Jukebox;
  /** Stable user id per session, so persistence is not keyed on a socket. */
  private readonly userIds = new Map<string, string>();

  override onCreate(options: { zoneId?: string }): void {
    this.zone = resolveZone(options.zoneId);
    this.zoneMap = loadZoneMap(this.zone);
    this.setState(new ZoneState());

    // Rooms are matched on this, so one room exists per zone.
    this.setMetadata({ zoneId: this.zone.id, displayName: this.zone.displayName });

    this.onMessage(CLIENT_MESSAGE.move, (client, message: MoveIntent) => {
      this.handleMove(client, message);
    });

    this.onMessage(CLIENT_MESSAGE.face, (client, message: FaceIntent) => {
      this.handleFace(client, message);
    });

    this.onMessage(CLIENT_MESSAGE.status, (client, message: StatusIntent) => {
      this.handleStatus(client, message);
    });

    this.onMessage(CLIENT_MESSAGE.drink, (client, message: DrinkIntent) => {
      const player = this.state.players.get(client.sessionId);
      // Validated against the shared list rather than trusted: it is only
      // cosmetic, but an unvalidated string here would sync arbitrary client
      // text to every other player in the room, which is a different problem.
      if (!player || !isValidDrinkId(message?.drink)) return;
      player.drink = message.drink;
    });

    this.onMessage(CHAT_CLIENT_MESSAGE.say, (client, message: ChatSayIntent) => {
      this.handleChat(client, message);
    });

    // 03 puts a jukebox in the Cafe and a bandstand in the Park; every other
    // zone gets no jukebox state at all rather than an inert one.
    if (zoneHasJukebox(this.zone.interactables)) {
      this.jukebox = new Jukebox({
        broadcastState: (state) => this.broadcast(JUKEBOX_SERVER_MESSAGE.state, state),
        rejectTo: (sessionId, message) => {
          this.clients.find((c) => c.sessionId === sessionId)?.send(
            JUKEBOX_SERVER_MESSAGE.rejected,
            message satisfies JukeboxRejected,
          );
        },
        listenerCount: () => this.clients.length,
      });

      this.onMessage(JUKEBOX_CLIENT_MESSAGE.queue, (client, message: QueueIntent) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || typeof message?.trackId !== 'string') return;
        this.jukebox?.request(client.sessionId, player.displayName, message.trackId);
      });

      this.onMessage(JUKEBOX_CLIENT_MESSAGE.skip, (client) => {
        this.jukebox?.voteSkip(client.sessionId);
      });
    }

    console.log(`[zone] room created: ${this.zone.displayName} (${this.roomId})`);
  }

  override onJoin(client: Client, options: JoinOptions): void {
    // Arriving from a specific zone lands you at that door's entry point;
    // arriving fresh uses the map's spawn. Resolved here because the server
    // owns position — a client-chosen arrival tile would just be overruled.
    const from = options?.fromZone;
    const spawn = from
      ? resolveEntryPoint(this.zone, from as ZoneId)
      : this.zoneMap.spawnPoint;

    const player = new PlayerSchema();
    player.id = client.sessionId;
    // Phase 1 auth stub: a name typed at the title screen, sanitized here.
    // Real accounts arrive in Phase 3 (Supabase), and this is the seam.
    player.displayName = sanitizeName(options?.displayName);
    player.spriteKey = typeof options?.spriteKey === 'string' ? options.spriteKey : 'char_remote';
    // Never spawn anyone inside a wall, whatever the config claims.
    const safeSpawn = this.zoneMap.isWalkable(spawn) ? spawn : this.zoneMap.spawnPoint;
    player.x = safeSpawn.x;
    player.y = safeSpawn.y;
    player.facing = 'down';
    player.status = 'idle';

    this.state.players.set(client.sessionId, player);
    this.budgets.set(client.sessionId, {
      tokens: MOVE_RATE_LIMIT.burst,
      lastRefillAt: Date.now(),
      chatTokens: CHAT_RATE_LIMIT.burst,
      chatRefillAt: Date.now(),
    });

    // Phase 3 identity: a stable id supplied by the client, falling back to the
    // session. Supabase auth replaces where this comes from, not how it is used.
    const userId = typeof options?.userId === 'string' && options.userId.length > 0
      ? options.userId
      : client.sessionId;
    this.userIds.set(client.sessionId, userId);

    void getStore()
      .upsertUser({ id: userId, displayName: player.displayName, spriteKey: player.spriteKey })
      .catch((error: unknown) => {
        console.warn('[zone] could not record user:', (error as Error).message);
      });

    // Send the jukebox state to the new arrival only: everyone else already
    // has it, and the clock they are playing against must not be reset.
    if (this.jukebox) {
      this.jukebox.onFirstListener();
      client.send(JUKEBOX_SERVER_MESSAGE.state, this.jukebox.snapshot() satisfies JukeboxState);
    }

    console.log(`[zone] ${player.displayName} joined ${this.zone.displayName} (${this.clients.length} present)`);
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);

    // Walking out mid-session still counts the time up to now. Without this,
    // leaving the Library would silently discard the whole session.
    this.closeStudySession(client.sessionId);

    this.state.players.delete(client.sessionId);
    this.budgets.delete(client.sessionId);
    this.userIds.delete(client.sessionId);
    this.jukebox?.onLeave(client.sessionId);
    console.log(`[zone] ${player?.displayName ?? client.sessionId} left ${this.zone.displayName}`);
  }

  /**
   * The user id this room recorded for a session, or undefined.
   *
   * Exposed so the voice token endpoint can derive identity from the room's own
   * record rather than from whatever the HTTP caller claims to be.
   */
  userIdFor(sessionId: string): string | undefined {
    return this.userIds.get(sessionId);
  }

  displayNameFor(sessionId: string): string | undefined {
    return this.state.players.get(sessionId)?.displayName;
  }

  override onDispose(): void {
    this.jukebox?.dispose();
    // Anyone still seated when the room dies keeps the time they accrued.
    for (const sessionId of [...this.studySessions.keys()]) this.closeStudySession(sessionId);
    console.log(`[zone] room disposed: ${this.zone.displayName} (${this.roomId})`);
  }

  // -- message handlers ----------------------------------------------------

  private handleMove(client: Client, message: MoveIntent): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const direction = message?.dir;
    if (!isDirection(direction)) return;

    const seq = Number.isFinite(message?.seq) ? Math.trunc(message.seq) : 0;

    if (!this.spendMoveToken(client.sessionId)) {
      this.sendCorrection(client, player, seq, 'rate_limited');
      return;
    }

    // Target is computed from the SERVER's position. The client never supplies
    // one, so there is nothing to spoof.
    const target = tileInFront({ x: player.x, y: player.y }, direction);

    // Facing updates even on a blocked move — the player turns to face the
    // obstacle (04), and interaction targeting depends on facing.
    player.facing = direction;

    if (!this.zoneMap.isWalkable(target)) {
      player.lastSeq = seq;
      this.sendCorrection(client, player, seq, 'blocked');
      return;
    }

    player.x = target.x;
    player.y = target.y;
    player.lastSeq = seq;
  }

  private handleFace(client: Client, message: FaceIntent): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!isDirection(message?.facing)) return;

    // Turning is synced state, so an unthrottled client could spam facing
    // flips and make the server broadcast patches to every peer in the room.
    // Same bucket as movement — 05 asks for interaction triggers to be rate
    // limited, not just movement.
    if (!this.spendMoveToken(client.sessionId)) return;
    if (player.facing === message.facing) return;

    player.facing = message.facing;
    if (Number.isFinite(message?.seq)) player.lastSeq = Math.trunc(message.seq);
  }

  private handleStatus(client: Client, message: StatusIntent): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!VALID_STATUSES.includes(message?.status as (typeof VALID_STATUSES)[number])) return;
    if (player.status === message.status) return;
    if (!this.spendMoveToken(client.sessionId)) return;

    const wasStudying = player.status === 'studying';
    player.status = message.status;

    // Status IS the study timer (11) — there is no separate start/stop.
    if (message.status === 'studying' && !wasStudying) {
      this.openStudySession(client.sessionId, player.displayName);
    } else if (wasStudying) {
      this.closeStudySession(client.sessionId);
    }
  }

  private handleChat(client: Client, message: ChatSayIntent): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const raw = typeof message?.text === 'string' ? message.text : '';
    // Collapse whitespace so a wall of newlines cannot inflate one message.
    const text = raw.replace(/\s+/g, ' ').trim();

    if (text.length === 0) {
      client.send(CHAT_SERVER_MESSAGE.rejected, { reason: 'empty' });
      return;
    }
    if (text.length > CHAT_LIMITS.maxLength) {
      client.send(CHAT_SERVER_MESSAGE.rejected, { reason: 'too_long' });
      return;
    }
    if (!this.spendChatToken(client.sessionId)) {
      client.send(CHAT_SERVER_MESSAGE.rejected, { reason: 'rate_limited' });
      return;
    }

    // Timestamped and id'd by the SERVER, so ordering does not depend on
    // client clocks and a client cannot forge either.
    this.broadcast(CHAT_SERVER_MESSAGE.message, {
      id: `${this.roomId}-${Date.now()}-${client.sessionId}`,
      authorId: client.sessionId,
      displayName: player.displayName,
      text,
      sentAt: Date.now(),
    } satisfies ChatMessage);
  }

  // -- study time ----------------------------------------------------------

  private openStudySession(sessionId: string, displayName: string): void {
    const userId = this.userIds.get(sessionId);
    if (!userId) return;
    this.studySessions.set(sessionId, { userId, displayName, startedAt: Date.now() });
  }

  private closeStudySession(sessionId: string): void {
    const open = this.studySessions.get(sessionId);
    if (!open) return;
    this.studySessions.delete(sessionId);

    const seconds = Math.floor((Date.now() - open.startedAt) / 1000);
    if (seconds < MIN_STUDY_SECONDS) return; // a misclick is not study time
    const clamped = Math.min(seconds, MAX_STUDY_SECONDS);

    void getStore()
      .recordStudySession({
        userId: open.userId,
        zoneId: this.zone.id,
        seconds: clamped,
        endedAt: new Date().toISOString(),
      })
      .then((totals) => {
        console.log(
          `[study] ${open.displayName} +${clamped}s in ${this.zone.id} ` +
            `(total ${Math.round(totals.totalSeconds / 60)}m)`,
        );
      })
      .catch((error: unknown) => {
        console.warn('[study] could not record session:', (error as Error).message);
      });
  }

  // -- helpers -------------------------------------------------------------

  /** Token bucket: steady rate with a small burst allowance (05 anti-abuse). */
  private spendMoveToken(sessionId: string): boolean {
    const budget = this.budgets.get(sessionId);
    if (!budget) return false;

    const now = Date.now();
    const refill = (now - budget.lastRefillAt) / MOVE_RATE_LIMIT.minIntervalMs;
    if (refill > 0) {
      budget.tokens = Math.min(MOVE_RATE_LIMIT.burst, budget.tokens + refill);
      budget.lastRefillAt = now;
    }

    if (budget.tokens < 1) return false;
    budget.tokens -= 1;
    return true;
  }

  /** Chat has its own bucket: talking must never eat a player's move budget. */
  private spendChatToken(sessionId: string): boolean {
    const budget = this.budgets.get(sessionId);
    if (!budget) return false;

    const now = Date.now();
    const refill = (now - budget.chatRefillAt) / CHAT_RATE_LIMIT.minIntervalMs;
    if (refill > 0) {
      budget.chatTokens = Math.min(CHAT_RATE_LIMIT.burst, budget.chatTokens + refill);
      budget.chatRefillAt = now;
    }

    if (budget.chatTokens < 1) return false;
    budget.chatTokens -= 1;
    return true;
  }

  private sendCorrection(
    client: Client,
    player: PlayerSchema,
    seq: number,
    reason: 'blocked' | 'rate_limited' | 'desync',
  ): void {
    client.send(SERVER_MESSAGE.correction, {
      x: player.x,
      y: player.y,
      facing: player.facing,
      seq,
      reason,
    });
  }
}

function resolveZone(zoneId: string | undefined): ZoneConfig {
  try {
    return getZone((zoneId ?? 'town_square') as ZoneId);
  } catch {
    return getZone('town_square');
  }
}

function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (VALID_DIRECTIONS as readonly string[]).includes(value);
}

/** Names come from an untrusted client. Keep them short and printable. */
function sanitizeName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  const cleaned = text.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : 'Wanderer';
}

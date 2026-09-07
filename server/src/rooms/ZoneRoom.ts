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
import type { Direction, JoinOptions, MoveIntent, FaceIntent, StatusIntent, ZoneConfig, ZoneId } from '@commons/shared';
import {
  CLIENT_MESSAGE,
  MOVE_RATE_LIMIT,
  SERVER_MESSAGE,
  getZone,
  resolveEntryPoint,
  tileInFront,
} from '@commons/shared';
import { PlayerSchema, ZoneState } from '../schemas/PlayerState.js';
import { loadZoneMap, type ServerZoneMap } from '../world/zoneMaps.js';

const VALID_DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const VALID_STATUSES = ['idle', 'studying', 'listening', 'afk'] as const;

/** Per-client throttle state. Not synced — server bookkeeping only. */
interface ClientBudget {
  /** Token bucket for movement intents. */
  tokens: number;
  lastRefillAt: number;
}

export class ZoneRoom extends Room<ZoneState> {
  /** 2-8 people per room is the design target (02); this is a safety ceiling. */
  override maxClients = 24;

  private zone!: ZoneConfig;
  private zoneMap!: ServerZoneMap;
  private readonly budgets = new Map<string, ClientBudget>();

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
    this.budgets.set(client.sessionId, { tokens: MOVE_RATE_LIMIT.burst, lastRefillAt: Date.now() });

    console.log(`[zone] ${player.displayName} joined ${this.zone.displayName} (${this.clients.length} present)`);
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.budgets.delete(client.sessionId);
    console.log(`[zone] ${player?.displayName ?? client.sessionId} left ${this.zone.displayName}`);
  }

  override onDispose(): void {
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

    player.status = message.status;
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

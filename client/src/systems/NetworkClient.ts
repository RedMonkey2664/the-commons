/**
 * Colyseus client wrapper.
 *
 * Owns the connection and the outgoing sequence counter; knows nothing about
 * Phaser. MultiplayerSystem turns these callbacks into sprites.
 */

import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import type {
  CorrectionMessage,
  Direction,
  PlayerStatus,
  ZoneId,
} from '@commons/shared';
import { CLIENT_MESSAGE, SERVER_MESSAGE, ZONE_ROOM_TYPE } from '@commons/shared';

/** Mirrors PlayerSchema on the server. */
export interface NetworkPlayer {
  id: string;
  displayName: string;
  spriteKey: string;
  x: number;
  y: number;
  facing: Direction;
  status: PlayerStatus;
  currentMinigame: string;
  lastSeq: number;
}

/**
 * Structural view of the room's `players` collection.
 *
 * The Colyseus schema classes live on the server, so the client receives state
 * reflectively and `room.state` is untyped. Rather than duplicating the schema
 * classes here just to satisfy the compiler, we name the two callbacks we
 * actually use. NetworkPlayer above is the field contract.
 */
interface PlayerCollectionCallbacks {
  onAdd(callback: (player: NetworkPlayer, sessionId: string) => void): void;
  onRemove(callback: (player: NetworkPlayer, sessionId: string) => void): void;
}

export interface NetworkHandlers {
  onPlayerAdd?: (player: NetworkPlayer, sessionId: string) => void;
  onPlayerRemove?: (sessionId: string) => void;
  onPlayerChange?: (player: NetworkPlayer, sessionId: string) => void;
  onCorrection?: (message: CorrectionMessage) => void;
  onError?: (error: Error) => void;
  onLeave?: (code: number) => void;
}

/**
 * Server URL, in priority order:
 *   1. `localStorage['commons.serverUrl']` — a runtime override, so a client can
 *      be pointed at a staging server (or a deliberately dead port, which is how
 *      the offline-fallback test forces a connection failure) without a rebuild.
 *   2. VITE_SERVER_URL at build time.
 *   3. Local development default.
 */
export function resolveServerUrl(): string {
  try {
    const override = localStorage.getItem('commons.serverUrl');
    if (override) return override;
  } catch {
    /* private windows throw on storage access; fall through */
  }
  return (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? 'ws://localhost:2567';
}

export const DEFAULT_SERVER_URL = 'ws://localhost:2567';

export class NetworkClient {
  private readonly client: Client;
  private room?: Room;
  private handlers: NetworkHandlers = {};
  /** In-flight join, so leave() can wait for it instead of no-opping. */
  private joining?: Promise<void>;
  /** Set when leave() is called before the join lands. */
  private abandoned = false;

  /** Monotonic intent counter, echoed back by the server as `lastSeq`. */
  private seq = 0;

  constructor(serverUrl: string = resolveServerUrl()) {
    this.client = new Client(serverUrl);
  }

  get sessionId(): string | undefined {
    return this.room?.sessionId;
  }

  get isConnected(): boolean {
    return this.room !== undefined;
  }

  /** The last sequence number this client sent. */
  get lastSentSeq(): number {
    return this.seq;
  }

  async joinZone(
    zoneId: ZoneId,
    identity: { displayName: string; spriteKey: string; fromZone?: string },
    handlers: NetworkHandlers,
  ): Promise<void> {
    this.joining = this.doJoin(zoneId, identity, handlers);
    try {
      await this.joining;
    } finally {
      this.joining = undefined;
    }
  }

  private async doJoin(
    zoneId: ZoneId,
    identity: { displayName: string; spriteKey: string; fromZone?: string },
    handlers: NetworkHandlers,
  ): Promise<void> {
    this.handlers = handlers;

    // filterBy(['zoneId']) on the server means this lands everyone asking for
    // the same zone in the same room instance.
    const room = await this.client.joinOrCreate(ZONE_ROOM_TYPE, {
      zoneId,
      displayName: identity.displayName,
      spriteKey: identity.spriteKey,
      fromZone: identity.fromZone,
    });
    // Walking out of the zone while the join was still in flight: the room
    // exists now, so leave it immediately rather than staying silently joined
    // to a zone the player is no longer in.
    if (this.abandoned) {
      void room.leave();
      return;
    }
    this.room = room;

    const $ = getStateCallbacks(room);
    const players = $(room.state).players as unknown as PlayerCollectionCallbacks;

    players.onAdd((player: NetworkPlayer, sessionId: string) => {
      this.handlers.onPlayerAdd?.(player, sessionId);

      // Fires for every field change on this player thereafter.
      $(player).onChange(() => {
        this.handlers.onPlayerChange?.(player, sessionId);
      });
    });

    players.onRemove((_player: NetworkPlayer, sessionId: string) => {
      this.handlers.onPlayerRemove?.(sessionId);
    });

    room.onMessage(SERVER_MESSAGE.correction, (message: CorrectionMessage) => {
      this.handlers.onCorrection?.(message);
    });

    room.onError((code, message) => {
      this.handlers.onError?.(new Error(`room error ${code}: ${message ?? ''}`));
    });

    room.onLeave((code) => {
      this.room = undefined;
      this.handlers.onLeave?.(code);
    });
  }

  /**
   * Send a step intent. Returns the sequence number it was sent with.
   *
   * The counter only advances when a message is ACTUALLY sent. Bumping it for
   * an intent that went nowhere (a step taken during the async join) would
   * leave lastSentSeq permanently ahead of the server's echo, and
   * reconciliation — which waits for the server to catch up — would never run
   * again for the whole session.
   */
  sendMove(dir: Direction): number {
    if (!this.room) return this.seq;
    this.seq += 1;
    this.room.send(CLIENT_MESSAGE.move, { dir, seq: this.seq });
    return this.seq;
  }

  sendFace(facing: Direction): number {
    if (!this.room) return this.seq;
    this.seq += 1;
    this.room.send(CLIENT_MESSAGE.face, { facing, seq: this.seq });
    return this.seq;
  }

  sendStatus(status: PlayerStatus): void {
    this.room?.send(CLIENT_MESSAGE.status, { status });
  }

  async leave(): Promise<void> {
    this.abandoned = true;

    // A join in flight has no room to leave yet; wait for it so doJoin() can
    // see `abandoned` and drop the connection it just opened.
    if (this.joining) {
      await this.joining.catch(() => undefined);
    }

    const room = this.room;
    this.room = undefined;
    await room?.leave().catch(() => undefined);
  }
}

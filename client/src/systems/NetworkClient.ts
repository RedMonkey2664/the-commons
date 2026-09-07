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

export const DEFAULT_SERVER_URL =
  (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? 'ws://localhost:2567';

export class NetworkClient {
  private readonly client: Client;
  private room?: Room;
  private handlers: NetworkHandlers = {};

  /** Monotonic intent counter, echoed back by the server as `lastSeq`. */
  private seq = 0;

  constructor(serverUrl: string = DEFAULT_SERVER_URL) {
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
    identity: { displayName: string; spriteKey: string },
    handlers: NetworkHandlers,
  ): Promise<void> {
    this.handlers = handlers;

    // filterBy(['zoneId']) on the server means this lands everyone asking for
    // the same zone in the same room instance.
    const room = await this.client.joinOrCreate(ZONE_ROOM_TYPE, {
      zoneId,
      displayName: identity.displayName,
      spriteKey: identity.spriteKey,
    });
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

  /** Send a step intent. Returns the sequence number it was sent with. */
  sendMove(dir: Direction): number {
    this.seq += 1;
    this.room?.send(CLIENT_MESSAGE.move, { dir, seq: this.seq });
    return this.seq;
  }

  sendFace(facing: Direction): number {
    this.seq += 1;
    this.room?.send(CLIENT_MESSAGE.face, { facing, seq: this.seq });
    return this.seq;
  }

  sendStatus(status: PlayerStatus): void {
    this.room?.send(CLIENT_MESSAGE.status, { status });
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = undefined;
    await room?.leave();
  }
}

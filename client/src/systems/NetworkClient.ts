/**
 * Colyseus client wrapper.
 *
 * Owns the connection and the outgoing sequence counter; knows nothing about
 * Phaser. MultiplayerSystem turns these callbacks into sprites.
 */

import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import type {
  ChatMessage,
  ChatRejected,
  CorrectionMessage,
  Direction,
  JukeboxRejected,
  JukeboxState,
  PlayerStatus,
  ZoneId,
} from '@commons/shared';
import {
  CHAT_CLIENT_MESSAGE,
  CHAT_SERVER_MESSAGE,
  CLIENT_MESSAGE,
  JUKEBOX_CLIENT_MESSAGE,
  JUKEBOX_SERVER_MESSAGE,
  SERVER_MESSAGE,
  ZONE_ROOM_TYPE,
} from '@commons/shared';

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
  /** Cafe drink being carried, '' for none (03). */
  drink: string;
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
  onChat?: (message: ChatMessage) => void;
  onChatRejected?: (message: ChatRejected) => void;
  onJukebox?: (state: JukeboxState) => void;
  onJukeboxRejected?: (message: JukeboxRejected) => void;
  onError?: (error: Error) => void;
  onLeave?: (code: number) => void;
}

const SERVER_URL_KEY = 'commons.serverUrl';

/**
 * Turn anything a person might paste into a WebSocket URL.
 *
 * People copy `https://abc.lhr.life` out of a tunnel's output, not
 * `wss://abc.lhr.life` — so accept both schemes and both spellings, and reject
 * anything that is not a URL rather than handing a malformed string to the
 * socket, where it fails much later and far less clearly.
 */
export function normaliseServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
  if (!secure && parsed.protocol !== 'http:' && parsed.protocol !== 'ws:') return null;

  return `${secure ? 'wss' : 'ws'}://${parsed.host}`;
}

/** Forget a stored server, so the page falls back to its own origin. */
export function clearStoredServerUrl(): void {
  try {
    localStorage.removeItem(SERVER_URL_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** The server this client is pointed at, if one was explicitly chosen. */
export function storedServerUrl(): string | null {
  try {
    return localStorage.getItem(SERVER_URL_KEY);
  } catch {
    return null;
  }
}

/**
 * Server URL, in priority order:
 *   1. `?server=` in the address bar, which is also remembered.
 *   2. `localStorage['commons.serverUrl']` — the remembered choice, and how the
 *      offline-fallback test forces a connection failure.
 *   3. VITE_SERVER_URL at build time.
 *   4. THE PAGE'S OWN ORIGIN, in a production build.
 *   5. Local development default.
 *
 * Rules 1 and 4 are the ones that matter, and they cover the two ways this game
 * actually gets played.
 *
 * Rule 4: the game server can serve the built client itself, and when it does
 * there is exactly one origin — so the right server URL is "wherever this page
 * came from". No build-time variable to forget, no CORS, and the scheme follows
 * the page, so HTTPS gets wss:// rather than a ws:// URL the browser blocks as
 * mixed content.
 *
 * Rule 1 exists because a statically hosted client (Vercel, GitHub Pages) can
 * never be same-origin with a game server — those hosts do not run persistent
 * WebSocket processes. Freezing the URL in at build time meant every change of
 * server needed a rebuild and redeploy, which is why the first deployment sat
 * on a stale localhost default. A URL given at runtime lets one deployed client
 * point at whatever server is up today, including a temporary tunnel.
 *
 * The dev default is reached only when `import.meta.env.DEV` is true. Vite
 * replaces that with `false` in a production build and drops the branch, so the
 * localhost string is not merely unused in a deployed bundle — it is absent.
 */
export function resolveServerUrl(): string {
  try {
    const requested = new URLSearchParams(window.location.search).get('server');
    if (requested) {
      const normalised = normaliseServerUrl(requested);
      if (normalised) {
        // Remembered, so a shared link works once and then keeps working
        // without the query string trailing behind it forever.
        localStorage.setItem(SERVER_URL_KEY, normalised);
        return normalised;
      }
      console.warn(`[net] ignoring unusable ?server= value: ${requested}`);
    }

    const override = localStorage.getItem(SERVER_URL_KEY);
    if (override) return override;
  } catch {
    /* private windows throw on storage access; fall through */
  }

  const configured = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  if (configured) return configured;

  if (import.meta.env.DEV) return 'ws://localhost:2567';

  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`;
}

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

  /** Colyseus room id, used as proof of presence when minting a voice token. */
  get roomId(): string | undefined {
    return this.room?.roomId;
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
    identity: { displayName: string; spriteKey: string; fromZone?: string; userId?: string },
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
    identity: { displayName: string; spriteKey: string; fromZone?: string; userId?: string },
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
      userId: identity.userId,
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

    room.onMessage(CHAT_SERVER_MESSAGE.message, (message: ChatMessage) => {
      this.handlers.onChat?.(message);
    });

    room.onMessage(CHAT_SERVER_MESSAGE.rejected, (message: ChatRejected) => {
      this.handlers.onChatRejected?.(message);
    });

    room.onMessage(JUKEBOX_SERVER_MESSAGE.state, (state: JukeboxState) => {
      this.handlers.onJukebox?.(state);
    });

    room.onMessage(JUKEBOX_SERVER_MESSAGE.rejected, (message: JukeboxRejected) => {
      this.handlers.onJukeboxRejected?.(message);
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

  /** Pause or resume the open focus session. Only ever subtracts time. */
  sendFocusPause(paused: boolean): void {
    this.room?.send(CLIENT_MESSAGE.focusPause, { paused });
  }

  /** Order a drink, or '' to put it down. Cosmetic; the server validates it. */
  sendDrink(drink: string): void {
    this.room?.send(CLIENT_MESSAGE.drink, { drink });
  }

  sendChat(text: string): void {
    this.room?.send(CHAT_CLIENT_MESSAGE.say, { text });
  }

  queueTrack(trackId: string): void {
    this.room?.send(JUKEBOX_CLIENT_MESSAGE.queue, { trackId });
  }

  voteSkipTrack(): void {
    this.room?.send(JUKEBOX_CLIENT_MESSAGE.skip, {});
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

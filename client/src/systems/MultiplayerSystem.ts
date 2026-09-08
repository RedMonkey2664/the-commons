/**
 * Turns network state into sprites, and keeps the local player honest.
 *
 * Two jobs:
 *
 * 1. REMOTE ROSTER — add/move/remove a RemotePlayer per other session.
 *
 * 2. RECONCILIATION — the local player moves immediately on input (prediction,
 *    per 02), while the server independently validates and applies the same
 *    move. Those two can disagree, and the interesting part is telling apart
 *    the two reasons they might:
 *
 *      - The server simply hasn't processed our latest intent yet. Its position
 *        is STALE, not authoritative-and-different. Snapping here would yank
 *        the player backwards on every single step — the classic rubber-band.
 *      - The server processed everything we sent and still disagrees (it
 *        rejected a move as blocked, or we desynced). Now it is right and we
 *        snap.
 *
 *    `lastSeq` is what separates them: the server echoes the last intent it
 *    processed, so we only trust its position once it has caught up with us.
 */

import type Phaser from 'phaser';
import type { CorrectionMessage, PlayerStatus, TileCoord } from '@commons/shared';
import { RemotePlayer } from '../entities/RemotePlayer';
import { rememberPerson } from '../ui/FriendsPanel';
import type { Player } from '../entities/Player';
import type { NetworkClient, NetworkPlayer } from './NetworkClient';

export interface MultiplayerSystemOptions {
  scene: Phaser.Scene;
  network: NetworkClient;
  player: Player;
  /** Display name of the zone, recorded against people we meet here. */
  zoneName: string;
  /** Called when someone joins or leaves, for the "friend joined" popup. */
  onRosterChange?: (event: 'join' | 'leave', displayName: string) => void;
}

export class MultiplayerSystem {
  private readonly remotes = new Map<string, RemotePlayer>();
  private readonly scene: Phaser.Scene;
  private readonly network: NetworkClient;
  private readonly player: Player;
  private readonly zoneName: string;
  private readonly onRosterChange?: (event: 'join' | 'leave', displayName: string) => void;

  /** Suppresses the join popup for players already present when we arrived. */
  private initialSyncDone = false;

  /**
   * Last status actually SENT.
   *
   * Deliberately not read back off the player: Player.sit() sets its own status
   * before this is called, so a guard comparing against the player would always
   * see them as equal and never send anything. Tracking what went over the wire
   * is the only thing that answers "does the server already know?".
   */
  private lastSentStatus: PlayerStatus = 'idle';

  constructor(options: MultiplayerSystemOptions) {
    this.scene = options.scene;
    this.network = options.network;
    this.player = options.player;
    this.zoneName = options.zoneName;
    this.onRosterChange = options.onRosterChange;

    // Anyone already in the room arrives as a burst of onAdd calls; treat the
    // rest of this tick as initial sync so we don't pop a banner per person.
    this.scene.time.delayedCall(0, () => {
      this.initialSyncDone = true;
    });
  }

  get remoteCount(): number {
    return this.remotes.size;
  }

  /** Exposed for the sync test harness. */
  get remoteSnapshot(): Array<{
    id: string;
    x: number;
    y: number;
    facing: string;
    status: string;
    displayName: string;
  }> {
    return [...this.remotes.values()].map((r) => ({
      id: r.id,
      x: r.tile.x,
      y: r.tile.y,
      facing: r.facing,
      status: r.status,
      displayName: r.displayName,
    }));
  }

  /** Everyone else in this room, for the friends panel. */
  get roster(): Array<{ displayName: string; status: string }> {
    return [...this.remotes.values()].map((r) => ({
      displayName: r.displayName,
      status: r.status,
    }));
  }

  handlePlayerAdd(state: NetworkPlayer, sessionId: string): void {
    if (sessionId === this.network.sessionId) {
      // Our own avatar is the locally predicted one; adopt the server spawn.
      this.player.movement.teleport({ x: state.x, y: state.y }, state.facing);
      return;
    }

    if (this.remotes.has(sessionId)) return;

    const remote = new RemotePlayer(this.scene, {
      id: sessionId,
      displayName: state.displayName,
      spriteKey: state.spriteKey,
      tile: { x: state.x, y: state.y },
      facing: state.facing,
      status: state.status,
    });
    this.remotes.set(sessionId, remote);
    // Remembered locally so they still appear in the friends panel, offline,
    // after they leave. Replaced by a real friends table in Phase 3.
    rememberPerson(state.displayName, this.zoneName);

    if (this.initialSyncDone) this.onRosterChange?.('join', state.displayName);
  }

  handlePlayerChange(state: NetworkPlayer, sessionId: string): void {
    if (sessionId === this.network.sessionId) {
      this.reconcileLocal(state);
      return;
    }

    const remote = this.remotes.get(sessionId);
    if (!remote) return;

    remote.moveTo({ x: state.x, y: state.y }, state.facing);
    if (remote.status !== state.status) remote.applyStatus(state.status);
  }

  handlePlayerRemove(sessionId: string): void {
    const remote = this.remotes.get(sessionId);
    if (!remote) return;
    const { displayName } = remote;
    this.remotes.delete(sessionId);
    remote.destroy();
    this.onRosterChange?.('leave', displayName);
  }

  /**
   * The server rejected an intent.
   *
   * Still subject to the same staleness rule as reconcileLocal: a correction
   * describes the world as of `message.seq`. If we have sent intents since, its
   * position is already out of date and snapping to it would rubber-band the
   * player backwards — which a burst hitting the rate limiter can trigger
   * during entirely legitimate play.
   */
  handleCorrection(message: CorrectionMessage): void {
    if (message.seq < this.network.lastSentSeq) return;
    this.snapLocalTo({ x: message.x, y: message.y });
    this.player.movement.face(message.facing);
  }

  /**
   * Only trust the server's position once it has processed everything we sent.
   * While intents are in flight, its position is stale by definition.
   */
  private reconcileLocal(state: NetworkPlayer): void {
    const caughtUp = state.lastSeq >= this.network.lastSentSeq;
    if (!caughtUp) return;

    const local = this.player.tile;
    if (local.x === state.x && local.y === state.y) return;

    this.snapLocalTo({ x: state.x, y: state.y });
  }

  private snapLocalTo(tile: TileCoord): void {
    // Mid-step is exactly when a correction is most likely, and teleport()
    // stops the in-flight tween rather than letting it land on a stale tile.
    this.player.movement.teleport(tile);
  }

  pushStatus(status: PlayerStatus): void {
    if (this.lastSentStatus === status) return;
    this.lastSentStatus = status;
    this.player.status = status;
    this.network.sendStatus(status);
  }

  destroy(): void {
    for (const remote of this.remotes.values()) remote.destroy();
    this.remotes.clear();
  }
}

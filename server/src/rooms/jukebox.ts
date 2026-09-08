/**
 * Shared jukebox, server-side.
 *
 * Owns the queue AND the clock. Clients are told when the current track
 * started, in server time, and work out their own offset from that — which is
 * what makes two people who arrived ten seconds apart genuinely hear the same
 * bar at the same moment (03: "the point is listening together").
 *
 * Extracted from ZoneRoom because only some zones have a jukebox, and a zone
 * that does not should carry none of this.
 */

import type {
  JukeboxRejected,
  JukeboxState,
  QueueEntry,
  Track,
} from '@commons/shared';
import { JUKEBOX_LIMITS, TRACKS, getTrack } from '@commons/shared';

export interface JukeboxHost {
  /** Broadcast state to everyone in the zone. */
  broadcastState(state: JukeboxState): void;
  /** Tell one requester their request was refused. */
  rejectTo(sessionId: string, message: JukeboxRejected): void;
  /** How many people are in the room, for the skip threshold. */
  listenerCount(): number;
}

export class Jukebox {
  private now: QueueEntry | null = null;
  private startedAt = 0;
  private queue: QueueEntry[] = [];
  private skipVotes = new Set<string>();
  private lastRequestAt = new Map<string, number>();
  private advanceTimer?: NodeJS.Timeout;
  private disposed = false;

  constructor(private readonly host: JukeboxHost) {}

  /**
   * Start something playing when the first person arrives.
   *
   * 03 frames the Park bandstand as ambient and the Cafe as an active queue,
   * but in both cases walking into an empty room to silence reads as broken
   * rather than restful, so an idle jukebox seeds itself.
   */
  onFirstListener(): void {
    if (this.now || this.queue.length > 0) return;
    const seed = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    if (seed) {
      this.queue.push({ track: seed, requestedBy: 'the room', requestedById: 'system' });
      this.advance();
    }
  }

  request(sessionId: string, displayName: string, trackId: string): void {
    const now = Date.now();
    const last = this.lastRequestAt.get(sessionId) ?? 0;

    if (now - last < JUKEBOX_LIMITS.minRequestIntervalMs) {
      this.host.rejectTo(sessionId, { reason: 'rate_limited' });
      return;
    }

    // Stamped on every ATTEMPT, not only on success. Recording it after the
    // validation below let a client spam unknown-track or queue-full requests
    // in a tight loop and never trip the limiter, because a rejected request
    // never updated the clock it is measured against.
    this.lastRequestAt.set(sessionId, now);
    if (this.queue.length >= JUKEBOX_LIMITS.maxQueue) {
      this.host.rejectTo(sessionId, { reason: 'queue_full' });
      return;
    }

    const track = getTrack(trackId);
    if (!track) {
      this.host.rejectTo(sessionId, { reason: 'unknown_track' });
      return;
    }

    this.queue.push({ track, requestedBy: displayName, requestedById: sessionId });

    // Nothing playing: start immediately rather than waiting for a timer.
    if (!this.now) this.advance();
    else this.publish();
  }

  /**
   * Skip is a vote, not a button.
   *
   * One person silencing a track everyone else is listening to is exactly the
   * shared-state problem 03 warns about; a majority of the people actually in
   * the room decides.
   */
  voteSkip(sessionId: string): void {
    if (!this.now) return;
    this.skipVotes.add(sessionId);

    const listeners = Math.max(1, this.host.listenerCount());
    const needed = Math.ceil(listeners * JUKEBOX_LIMITS.skipThreshold);

    if (this.skipVotes.size >= needed) this.advance();
    else this.publish();
  }

  /** Someone left; their skip vote leaves with them. */
  onLeave(sessionId: string): void {
    this.skipVotes.delete(sessionId);
    this.lastRequestAt.delete(sessionId);

    if (this.host.listenerCount() <= 0) {
      // Empty room: stop the clock rather than playing to nobody.
      this.stop();
      return;
    }
    // Their vote may have been the one holding the threshold above the count.
    if (this.now && this.skipVotes.size > 0) {
      const listeners = Math.max(1, this.host.listenerCount());
      if (this.skipVotes.size >= Math.ceil(listeners * JUKEBOX_LIMITS.skipThreshold)) {
        this.advance();
        return;
      }
    }
    this.publish();
  }

  /** Current state, for a client that just joined. */
  snapshot(): JukeboxState {
    return {
      now: this.now,
      startedAt: this.startedAt,
      serverNow: Date.now(),
      queue: [...this.queue],
      skipVotes: this.skipVotes.size,
      listeners: this.host.listenerCount(),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  // -- internals -----------------------------------------------------------

  private advance(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.skipVotes.clear();

    const next = this.queue.shift() ?? null;
    this.now = next;
    this.startedAt = Date.now();

    if (next) {
      // Schedule the next advance from the track's own length, so the server
      // clock stays the single source of truth for what is playing.
      this.advanceTimer = setTimeout(
        () => this.advance(),
        next.track.durationMs + JUKEBOX_LIMITS.gapMs,
      );
    }

    this.publish();
  }

  private stop(): void {
    this.clearTimer();
    this.now = null;
    this.startedAt = 0;
    this.queue = [];
    this.skipVotes.clear();
    if (!this.disposed) this.publish();
  }

  private clearTimer(): void {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = undefined;
  }

  private publish(): void {
    if (this.disposed) return;
    this.host.broadcastState(this.snapshot());
  }
}

/** Which zones have a jukebox, from the zone's own interactables (03). */
export function zoneHasJukebox(interactables: string[]): boolean {
  return interactables.some((id) => id === 'jukebox' || id === 'bandstand');
}

export type { Track };

/**
 * Shared jukebox — 03 and 11.
 *
 * "Jukebox is shared state, not per-player — one queue per room (Cafe, Park
 * bandstand), because the point is listening together, not each person hearing
 * their own private track while standing near each other."
 *
 * That sentence is the whole design constraint. The server owns the queue AND
 * the playback clock: it records when the current track started, and every
 * client computes its own offset from that. Nobody's audio position is
 * authoritative except the server's, so two people who joined ten seconds apart
 * are genuinely at the same point in the same track.
 *
 * ---------------------------------------------------------------------------
 * ON THE MUSIC ITSELF
 *
 * 03 asks for "a curated royalty-free lo-fi/ambient playlist". There is no
 * audio in this repo and licensed tracks cannot be invented, so tracks are
 * SYNTHESISED in the browser from the parameters below — the same approach the
 * tilesets take. That has one property that matters here: a generated track is
 * deterministic and seekable by construction, so joining halfway through lands
 * on the right bar rather than needing to stream from a byte offset.
 *
 * Swapping in real audio later means giving a track an `audioUrl` and loading
 * it under that key; the queue, the sync model and the UI do not change.
 * 03 also flags this: if user-submitted links are ever allowed, the licensing
 * question has to be answered first.
 * ---------------------------------------------------------------------------
 */

export const JUKEBOX_CLIENT_MESSAGE = {
  /** Add a track to the back of the shared queue. */
  queue: 'jb:queue',
  /** Vote to skip the current track. */
  skip: 'jb:skip',
} as const;

export const JUKEBOX_SERVER_MESSAGE = {
  /** Full queue + clock state. Sent on join and on every change. */
  state: 'jb:state',
  /** Request refused (rate limited, queue full, unknown track). */
  rejected: 'jb:rejected',
} as const;

export type TrackMood = 'lofi' | 'ambient' | 'warm' | 'night';

/**
 * A track description. Everything needed to synthesise it deterministically,
 * plus the metadata the UI shows.
 */
export interface Track {
  id: string;
  title: string;
  artist: string;
  mood: TrackMood;
  bpm: number;
  /** Root note as a MIDI number. 57 = A3. */
  root: number;
  /** Scale degrees of the chord loop, in semitones from the root. */
  progression: number[];
  /** Bars in the loop; the track repeats this until its duration elapses. */
  barsPerLoop: number;
  /** Total length. Kept explicit so the server can schedule the next track. */
  durationMs: number;
  /** Set when real audio replaces the synth. Nothing else changes. */
  audioUrl?: string;
}

export interface QueueEntry {
  track: Track;
  /** Who put it on, for the "queued by" line. */
  requestedBy: string;
  requestedById: string;
}

export interface JukeboxState {
  /** Currently playing, or null when the queue is empty. */
  now: QueueEntry | null;
  /**
   * Server clock reading when `now` started. Clients derive their playback
   * offset from this rather than from when they happened to hear about it.
   */
  startedAt: number;
  /** Server clock at the moment this state was sent, for round-trip estimation. */
  serverNow: number;
  queue: QueueEntry[];
  /** Session ids that have voted to skip the current track. */
  skipVotes: number;
  listeners: number;
}

export interface QueueIntent {
  trackId: string;
}

export interface JukeboxRejected {
  reason: 'rate_limited' | 'queue_full' | 'unknown_track' | 'no_jukebox';
}

export const JUKEBOX_LIMITS = {
  maxQueue: 12,
  /** One request per player per this window. */
  minRequestIntervalMs: 4000,
  /** Fraction of listeners that must vote to skip. */
  skipThreshold: 0.5,
  /** Gap between tracks, so one does not slam into the next. */
  gapMs: 1500,
} as const;

/**
 * The catalogue.
 *
 * Deliberately small and hand-tuned rather than generated: these are the
 * "curated playlist" from 03, just described as parameters instead of files.
 * Progressions are common, slow and non-resolving on purpose — this is music to
 * work and talk over, not music to listen to.
 */
export const TRACKS: Track[] = [
  {
    id: 'rain_window',
    title: 'Rain on the Window',
    artist: 'the commons',
    mood: 'lofi',
    bpm: 82,
    root: 57, // A3
    progression: [0, -4, -7, -5], // Am - F - D - E, voiced downward
    barsPerLoop: 4,
    durationMs: 117_000,
  },
  {
    id: 'third_floor',
    title: 'Third Floor, Still Here',
    artist: 'the commons',
    mood: 'lofi',
    bpm: 76,
    root: 50, // D3
    progression: [0, 5, 3, -2],
    barsPerLoop: 4,
    durationMs: 126_000,
  },
  {
    id: 'late_bus',
    title: 'Late Bus Home',
    artist: 'the commons',
    mood: 'night',
    bpm: 70,
    root: 53, // F3
    progression: [0, 4, -3, 2],
    barsPerLoop: 4,
    durationMs: 137_000,
  },
  {
    id: 'coffee_hum',
    title: 'Coffee Machine Hum',
    artist: 'the commons',
    mood: 'warm',
    bpm: 94,
    root: 60, // C4
    progression: [0, -3, 5, 2],
    barsPerLoop: 4,
    durationMs: 102_000,
  },
  {
    id: 'two_weeks',
    title: 'Two Weeks Left',
    artist: 'the commons',
    mood: 'ambient',
    bpm: 64,
    root: 52, // E3
    progression: [0, 7, 3, 5],
    barsPerLoop: 8,
    durationMs: 148_000,
  },
  {
    id: 'nobody_awake',
    title: "Nobody's Awake",
    artist: 'the commons',
    mood: 'night',
    bpm: 68,
    root: 55, // G3
    progression: [0, -5, -2, -7],
    barsPerLoop: 4,
    durationMs: 131_000,
  },
];

export function getTrack(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}

/** Length of one loop of a track, in ms. Four beats to the bar. */
export function loopLengthMs(track: Track): number {
  return (60_000 / track.bpm) * 4 * track.barsPerLoop;
}

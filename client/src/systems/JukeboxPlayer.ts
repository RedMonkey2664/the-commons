/**
 * Jukebox audio, synthesised in the browser.
 *
 * There is no audio in this repo (see the note in shared/jukebox.ts), so tracks
 * are generated from their parameters with Web Audio. That is not only a
 * licensing dodge — it gives the property this feature actually needs:
 *
 *   A generated track is DETERMINISTIC and SEEKABLE. The server says "this
 *   track started at T"; a client that walks in 40 seconds later computes its
 *   offset and schedules from the correct bar. With a streamed file that would
 *   need a byte-range seek; here it is arithmetic.
 *
 * The synth is deliberately plain — a pad, a bass, a soft hat, a little noise.
 * This is music to work and talk over (11's Cafe and Park), so it stays out of
 * the way by design.
 *
 * Swapping in real audio: give a Track an `audioUrl`, load and play it at the
 * computed offset. The sync model and everything above it is unchanged.
 */

import type { Track } from '@commons/shared';
import { loopLengthMs } from '@commons/shared';

/** How far ahead notes are scheduled. Long enough to be gapless, short enough to stop quickly. */
const SCHEDULE_AHEAD_S = 0.7;
const SCHEDULE_TICK_MS = 220;

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Deterministic per-track variation, so a track sounds the same every time. */
function seedFrom(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export class JukeboxPlayer {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuffer?: AudioBuffer;
  /**
   * Output stage for the CURRENT track.
   *
   * Every voice connects here rather than straight to master, so stopping a
   * track can silence notes that were already scheduled ahead of it. Without
   * this a skip leaves the previous pad and its bar-long hiss ringing over the
   * next track for several seconds.
   */
  private trackGain?: GainNode;

  private track?: Track;
  /** AudioContext time corresponding to beat 0 of the track. */
  private originTime = 0;
  private nextBeat = 0;
  private timer?: number;
  private volume = 0.5;
  private muted = false;

  /** Browsers block audio until a gesture; this reports whether we are live. */
  get isRunning(): boolean {
    return this.ctx?.state === 'running' && this.track !== undefined;
  }

  get needsGesture(): boolean {
    return this.ctx !== undefined && this.ctx.state === 'suspended';
  }

  get currentTrackId(): string | undefined {
    return this.track?.id;
  }

  /**
   * Called from a user gesture. Browsers refuse to start audio otherwise, and
   * the jukebox should not look broken because of it — the UI prompts instead.
   */
  async unlock(): Promise<void> {
    this.ensureContext();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.5;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume * 0.5;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Play `track`, already `offsetMs` into it.
   *
   * The offset is the whole point: it comes from the server's clock, so
   * everyone in the room lands on the same bar regardless of when they walked
   * in (03 — "the point is listening together").
   */
  play(track: Track, offsetMs: number): void {
    this.ensureContext();
    if (!this.ctx) return;

    // Same track already running at roughly the right place: leave it alone
    // rather than restarting and audibly stuttering on every state broadcast.
    if (this.track?.id === track.id) {
      const drift = Math.abs(this.currentOffsetMs() - offsetMs);
      if (drift < 900) return;
    }

    this.stop(false);
    this.track = track;

    // Fresh bus for this track; every voice below connects to it.
    this.trackGain = this.ctx.createGain();
    this.trackGain.gain.value = 1;
    if (this.master) this.trackGain.connect(this.master);

    const secondsPerBeat = 60 / track.bpm;
    const offsetBeats = (offsetMs / 1000) / secondsPerBeat;

    // Anchor beat 0 in the past so "now" lands at the right point in the loop.
    this.originTime = this.ctx.currentTime - offsetBeats * secondsPerBeat;
    this.nextBeat = Math.ceil(offsetBeats);

    this.timer = window.setInterval(() => this.schedule(), SCHEDULE_TICK_MS);
    this.schedule();
  }

  stop(clearTrack = true): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }

    // Fade the whole track bus out fast, then drop it. Scheduled voices are
    // still connected to it, so they go quiet with it instead of playing on.
    const ctx = this.ctx;
    const gain = this.trackGain;
    this.trackGain = undefined;
    if (ctx && gain) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.06);
      window.setTimeout(() => gain.disconnect(), 400);
    }

    if (clearTrack) this.track = undefined;
  }

  destroy(): void {
    this.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    this.master = undefined;
  }

  /** Where we currently are in the track, in ms. */
  currentOffsetMs(): number {
    if (!this.ctx || !this.track) return 0;
    return (this.ctx.currentTime - this.originTime) * 1000;
  }

  // -- synthesis ------------------------------------------------------------

  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume * 0.5;

    // A gentle low-pass keeps the whole thing behind conversation rather than
    // on top of it — this is background music by design (11).
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.4;

    this.master.connect(filter);
    filter.connect(this.ctx.destination);

    // Short noise buffer, reused for hats and vinyl hiss.
    const length = Math.floor(this.ctx.sampleRate * 0.5);
    this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  /** Schedule every beat that falls inside the lookahead window. */
  private schedule(): void {
    const ctx = this.ctx;
    const track = this.track;
    if (!ctx || !track || !this.trackGain) return;

    const secondsPerBeat = 60 / track.bpm;
    const horizon = ctx.currentTime + SCHEDULE_AHEAD_S;

    while (this.originTime + this.nextBeat * secondsPerBeat < horizon) {
      const when = this.originTime + this.nextBeat * secondsPerBeat;
      if (when >= ctx.currentTime) this.playBeat(track, this.nextBeat, when);
      this.nextBeat += 1;
    }
  }

  private playBeat(track: Track, beat: number, when: number): void {
    const beatsPerLoop = track.barsPerLoop * 4;
    const beatInLoop = ((beat % beatsPerLoop) + beatsPerLoop) % beatsPerLoop;
    const bar = Math.floor(beatInLoop / 4);
    const beatInBar = beatInLoop % 4;

    const chordStep = track.progression[bar % track.progression.length] ?? 0;
    const rng = makeRng(seedFrom(track.id) + beat);

    // Pad: a soft triad, once per bar, held across it.
    if (beatInBar === 0) {
      const secondsPerBeat = 60 / track.bpm;
      for (const interval of [0, 3, 7, 10]) {
        this.pad(midiToHz(track.root + chordStep + interval), when, secondsPerBeat * 4);
      }
    }

    // Bass on 1 and 3, an octave down.
    if (beatInBar === 0 || beatInBar === 2) {
      this.bass(midiToHz(track.root + chordStep - 12), when);
    }

    // Hat on the offbeats, with a little humanising.
    if (beatInBar === 1 || beatInBar === 3) {
      this.hat(when + (rng() - 0.5) * 0.012, 0.12);
    } else if (rng() > 0.72) {
      this.hat(when + 0.5 * (60 / track.bpm), 0.06);
    }

    // Vinyl hiss, once a bar, quiet.
    if (beatInBar === 0) this.hiss(when, (60 / track.bpm) * 4);
  }

  private pad(frequency: number, when: number, duration: number): void {
    const ctx = this.ctx;
    const out = this.trackGain;
    if (!ctx || !out) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    // Slight detune gives the pad width without a second voice.
    osc.detune.value = (Math.random() - 0.5) * 8;

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.06, when + duration * 0.25);
    gain.gain.linearRampToValueAtTime(0, when + duration);

    osc.connect(gain);
    gain.connect(out);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  private bass(frequency: number, when: number): void {
    const ctx = this.ctx;
    const out = this.trackGain;
    if (!ctx || !out) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.16, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.55);

    osc.connect(gain);
    gain.connect(out);
    osc.start(when);
    osc.stop(when + 0.6);
  }

  private hat(when: number, level: number): void {
    const ctx = this.ctx;
    const out = this.trackGain;
    if (!ctx || !out || !this.noiseBuffer) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.06);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(when);
    source.stop(when + 0.08);
  }

  private hiss(when: number, duration: number): void {
    const ctx = this.ctx;
    const out = this.trackGain;
    if (!ctx || !out || !this.noiseBuffer) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0.008;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(when);
    source.stop(when + duration);
  }
}

export { loopLengthMs };

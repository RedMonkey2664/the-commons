/**
 * Sound design pass — 08's Phase 5 "sound design pass".
 *
 * Synthesised, like the jukebox and the art: there are no audio files in this
 * repo and none can be invented. Web Audio is enough for the short, functional
 * sounds a game like this needs — a footstep, a bump, a page of dialogue, a
 * click.
 *
 * Two rules hold everything here together:
 *
 *   1. NOTHING is louder than the conversation. 11 wants the Cafe and Park to
 *      be places people talk in; a game that chirps over them is worse than a
 *      silent one. Every level here is deliberately low.
 *   2. Nothing plays before a gesture. Browsers block audio until the player
 *      interacts, and a silent failure at boot must not leave the whole system
 *      dead afterwards — the context is created lazily on first use.
 */

const MASTER_LEVEL = 0.22;

type Ctx = AudioContext;

class SfxEngine {
  private ctx?: Ctx;
  private master?: GainNode;
  private muted = false;
  /** Guards against a burst of identical sounds in one frame. */
  private lastPlayedAt = new Map<string, number>();

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_LEVEL;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Safe to call repeatedly; only the first call after a gesture does work. */
  unlock(): void {
    this.ensure();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private ensure(): Ctx | undefined {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Rate-limit a sound so repeats cannot stack into a buzz. */
  private allow(key: string, minGapMs: number): boolean {
    const now = performance.now();
    const last = this.lastPlayedAt.get(key) ?? 0;
    if (now - last < minGapMs) return false;
    this.lastPlayedAt.set(key, now);
    return true;
  }

  private blip(
    frequency: number,
    durationS: number,
    type: OscillatorType,
    level: number,
    slideTo?: number,
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || ctx.state !== 'running') return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + durationS);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationS);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + durationS + 0.02);
  }

  private noise(durationS: number, level: number, highpass: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || ctx.state !== 'running') return;

    const length = Math.max(1, Math.floor(ctx.sampleRate * durationS));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpass;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationS);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + durationS + 0.02);
  }

  // -- the actual sounds ----------------------------------------------------

  /** One footfall. Alternates pitch so a walk cycle does not sound mechanical. */
  step(parity: number): void {
    if (!this.allow('step', 90)) return;
    this.noise(0.055, 0.16, parity % 2 === 0 ? 900 : 1150);
  }

  /** Walking into something solid. Paired with the 60ms bump nudge in 10. */
  bump(): void {
    if (!this.allow('bump', 140)) return;
    this.blip(150, 0.09, 'square', 0.1, 70);
  }

  /** Per-character dialogue tick. Quiet and short — it runs 30 times a second. */
  dialogueTick(): void {
    if (!this.allow('dialogue', 28)) return;
    this.blip(660 + Math.random() * 90, 0.028, 'square', 0.035);
  }

  /** Advancing or closing a dialogue box. */
  dialogueAdvance(): void {
    this.blip(520, 0.07, 'triangle', 0.07, 720);
  }

  /** Opening a panel. */
  uiOpen(): void {
    this.blip(420, 0.09, 'triangle', 0.07, 640);
  }

  uiClose(): void {
    this.blip(560, 0.09, 'triangle', 0.06, 380);
  }

  /** Sitting down at a pod or bench. */
  sit(): void {
    this.noise(0.13, 0.09, 400);
  }

  /** A reward beat — matched to the item popup in 10. */
  reward(): void {
    this.blip(660, 0.1, 'triangle', 0.09);
    window.setTimeout(() => this.blip(880, 0.14, 'triangle', 0.08), 90);
  }

  /** Someone spoke in chat. */
  chat(): void {
    if (!this.allow('chat', 200)) return;
    this.blip(760, 0.05, 'sine', 0.05);
  }

  /** Walking through a door into another zone. */
  transition(): void {
    this.blip(300, 0.22, 'sine', 0.07, 180);
  }
}

export const sfx = new SfxEngine();

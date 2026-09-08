/**
 * Rhythm Tap — 06's fifth minigame, solo.
 *
 * "ties back into the music theme of the whole game (jukebox tracks double as
 * rhythm-game tracks) — nice full-circle feature once the jukebox system
 * exists."
 *
 * That is exactly what this does: the note chart is generated from a jukebox
 * Track's own bpm and progression, and the backing music is the same synth the
 * Cafe uses. Adding a track to the jukebox adds a rhythm chart for free, with
 * no chart authoring at all.
 *
 * Solo and client-scored, like Memory Match — the timing that matters is
 * between your key and your speakers, and routing it through a server would
 * make it worse rather than fairer.
 */

import Phaser from 'phaser';
import type { PlayerRef, Track } from '@commons/shared';
import { COLORS, TRACKS, TYPOGRAPHY, getMinigame, hex } from '@commons/shared';
import { BaseMinigameScene } from './BaseMinigameScene';
import { JukeboxPlayer } from '../../systems/JukeboxPlayer';
import { session } from '../../session';

const RULES = {
  /** Lanes, mapped to D F J K. */
  lanes: 4,
  keys: ['D', 'F', 'J', 'K'] as const,
  /** How long a note takes to fall from the top to the judgement line. */
  approachMs: 1800,
  /** Timing windows, in ms either side of the beat. */
  perfectMs: 55,
  goodMs: 110,
  okMs: 175,
  points: { perfect: 100, good: 60, ok: 25, miss: 0 },
  /** Bars of the track to chart. Keeps a run in 06's 2-5 minute band. */
  bars: 24,
  /** Lead-in before the first note, so the player can settle. */
  leadInMs: 2600,
} as const;

type Judgement = 'perfect' | 'good' | 'ok' | 'miss';

interface Note {
  lane: number;
  /** Ms from chart start when this note should be hit. */
  timeMs: number;
  hit: boolean;
  judged: boolean;
}

export class RhythmTapScene extends BaseMinigameScene {
  private graphics!: Phaser.GameObjects.Graphics;
  private judgementText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private trackText!: Phaser.GameObjects.Text;

  private audio = new JukeboxPlayer();
  private track!: Track;
  private notes: Note[] = [];

  private startedAt = 0;
  private running = false;
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private counts: Record<Judgement, number> = { perfect: 0, good: 0, ok: 0, miss: 0 };
  private laneFlash = [0, 0, 0, 0];
  private panel = { x: 0, y: 0, width: 0, height: 0 };

  constructor() {
    super(
      getMinigame('rhythm_tap') ?? {
        id: 'rhythm_tap',
        displayName: 'Rhythm Tap',
        cabinetSpriteKey: 'obj_cabinet_lit',
        sceneKey: 'RhythmTapScene',
        minPlayers: 1,
        maxPlayers: 1,
      },
    );
  }

  onStart(_players: PlayerRef[]): void {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
    this.laneFlash = [0, 0, 0, 0];

    this.track = TRACKS[Math.floor(Math.random() * TRACKS.length)]!;
    this.notes = buildChart(this.track);

    this.graphics = this.add.graphics().setDepth(3);

    this.trackText = this.add
      .text(0, 0, `${this.track.title} — ${this.track.bpm}bpm`, {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5, 0)
      .setDepth(4)
      .setAlpha(0.75);

    this.comboText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '24px',
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setDepth(4);

    this.judgementText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '20px',
        color: COLORS.hudAccent,
      })
      .setOrigin(0.5)
      .setDepth(4);

    for (let lane = 0; lane < RULES.lanes; lane += 1) {
      this.input.keyboard?.on(`keydown-${RULES.keys[lane]}`, () => this.hitLane(lane));
    }

    this.statusText.setText(`${RULES.keys.join('  ')}   ·   ESC to quit`);

    // Launching a minigame from a cabinet is itself a gesture, so audio is
    // already unlocked; this is belt and braces for a direct scene start.
    void this.audio.unlock().then(() => {
      this.audio.setVolume(0.65);
      this.audio.play(this.track, 0);
      this.startedAt = this.time.now + RULES.leadInMs;
      this.running = true;
    });
  }

  override onEnd(): void {
    this.running = false;
    this.audio.destroy();
  }

  // -- play -----------------------------------------------------------------

  private chartTimeMs(): number {
    return this.time.now - this.startedAt;
  }

  private hitLane(lane: number): void {
    if (!this.running) return;
    this.laneFlash[lane] = this.time.now;

    const now = this.chartTimeMs();
    let best: Note | undefined;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const note of this.notes) {
      if (note.judged || note.lane !== lane) continue;
      const delta = Math.abs(note.timeMs - now);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = note;
      }
    }

    if (!best || bestDelta > RULES.okMs) return; // nothing near enough to judge

    best.judged = true;
    best.hit = true;

    const judgement: Judgement =
      bestDelta <= RULES.perfectMs ? 'perfect' : bestDelta <= RULES.goodMs ? 'good' : 'ok';

    this.counts[judgement] += 1;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);

    // Combo multiplier caps quickly: this should reward staying in time, not
    // turn the last thirty seconds into the only part that counts.
    const multiplier = 1 + Math.min(this.combo, 20) * 0.02;
    this.score += Math.round(RULES.points[judgement] * multiplier);

    this.judgementText.setText(judgement.toUpperCase());
    this.judgementText.setColor(
      judgement === 'perfect' ? COLORS.hudAccent
        : judgement === 'good' ? COLORS.statusStudying
          : COLORS.hudText,
    );
  }

  override update(): void {
    if (!this.running) return;

    const now = this.chartTimeMs();

    // Anything past the window without a hit is a miss, and breaks the combo.
    for (const note of this.notes) {
      if (note.judged || note.timeMs > now - RULES.okMs) continue;
      note.judged = true;
      this.counts.miss += 1;
      this.combo = 0;
      this.judgementText.setText('MISS');
      this.judgementText.setColor(COLORS.statusAfk);
    }

    this.comboText.setText(this.combo > 2 ? `${this.combo}x` : '');
    this.draw();

    const last = this.notes[this.notes.length - 1];
    if (last && now > last.timeMs + 1500) this.finishChart();
  }

  private finishChart(): void {
    if (!this.running) return;
    this.running = false;
    this.audio.stop();

    this.reportScore(session.userId, this.score);
    const hits = this.counts.perfect + this.counts.good + this.counts.ok;
    const accuracy = this.notes.length > 0 ? Math.round((hits / this.notes.length) * 100) : 0;

    void this.finishRun(
      `${this.track.title}\n${accuracy}% hit  ·  best combo ${this.bestCombo}\n` +
        `${this.counts.perfect} perfect  ${this.counts.good} good  ${this.counts.ok} ok  ${this.counts.miss} missed`,
    );
  }

  // -- drawing --------------------------------------------------------------

  private draw(): void {
    const g = this.graphics;
    g.clear();
    if (!this.panel.width) return;

    const { x: px, y: py, width, height } = this.panel;
    const laneWidth = Math.min(86, (width - 80) / RULES.lanes);
    const boardWidth = laneWidth * RULES.lanes;
    const left = px + (width - boardWidth) / 2;
    const top = py + 96;
    const judgeY = py + height - 120;
    const fallDistance = judgeY - top;
    const now = this.chartTimeMs();

    // Lanes
    for (let lane = 0; lane < RULES.lanes; lane += 1) {
      const lx = left + lane * laneWidth;
      g.fillStyle(hex(COLORS.hudBg), lane % 2 === 0 ? 0.5 : 0.35);
      g.fillRect(lx, top, laneWidth - 3, fallDistance + 40);

      // Key flash on press, so input always feels acknowledged.
      const since = this.time.now - (this.laneFlash[lane] ?? 0);
      if (since < 140) {
        g.fillStyle(hex(COLORS.hudAccent), 0.28 * (1 - since / 140));
        g.fillRect(lx, top, laneWidth - 3, fallDistance + 40);
      }
    }

    // Judgement line
    g.fillStyle(hex(COLORS.hudAccent), 0.9);
    g.fillRect(left, judgeY, boardWidth - 3, 4);

    // Notes
    for (const note of this.notes) {
      if (note.judged) continue;
      const remaining = note.timeMs - now;
      if (remaining > RULES.approachMs || remaining < -RULES.okMs) continue;

      const progress = 1 - remaining / RULES.approachMs;
      const y = top + fallDistance * progress;
      const lx = left + note.lane * laneWidth;

      g.fillStyle(hex(COLORS.interactBubbleMark), 1);
      g.fillRoundedRect(lx + 6, y - 9, laneWidth - 15, 18, 5);
      g.fillStyle(hex(COLORS.hudText), 0.35);
      g.fillRect(lx + 9, y - 6, laneWidth - 21, 3);
    }

    // Key legend under the line
    for (let lane = 0; lane < RULES.lanes; lane += 1) {
      const lx = left + lane * laneWidth;
      g.fillStyle(hex(COLORS.hudText), 0.18);
      g.fillRoundedRect(lx + 6, judgeY + 12, laneWidth - 15, 26, 5);
    }

    this.trackText.setPosition(px + width / 2, py + 62);
    this.comboText.setPosition(px + width / 2, judgeY - 70);
    this.judgementText.setPosition(px + width / 2, judgeY - 34);
  }

  protected override onLayout(x: number, y: number, width: number, height: number): void {
    this.panel = { x, y, width, height };
  }
}

/**
 * Build a chart from a track's own musical parameters.
 *
 * Notes land on eighths, with the density following the bar: downbeats always,
 * offbeats sometimes, and a busier pattern where the chord changes. Seeded from
 * the track id so a given track always plays the same chart — a rhythm game
 * whose notes moved between runs would be unlearnable.
 */
function buildChart(track: Track): Note[] {
  let seed = 0;
  for (let i = 0; i < track.id.length; i += 1) seed = (seed * 31 + track.id.charCodeAt(i)) >>> 0;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const msPerBeat = 60_000 / track.bpm;
  const notes: Note[] = [];
  let lane = 0;

  for (let bar = 0; bar < RULES.bars; bar += 1) {
    for (let eighth = 0; eighth < 8; eighth += 1) {
      const onBeat = eighth % 2 === 0;
      const isDownbeat = eighth === 0;
      const chance = isDownbeat ? 1 : onBeat ? 0.72 : 0.34;
      if (rng() > chance) continue;

      // Walk the lane rather than jumping randomly: patterns you can learn.
      lane = (lane + 1 + Math.floor(rng() * (RULES.lanes - 1))) % RULES.lanes;

      notes.push({
        lane,
        timeMs: bar * msPerBeat * 4 + eighth * (msPerBeat / 2),
        hit: false,
        judged: false,
      });
    }
  }

  return notes.sort((a, b) => a.timeMs - b.timeMs);
}

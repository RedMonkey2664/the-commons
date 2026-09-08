/**
 * Stack Tower — Phase 6, solo.
 *
 * 06's launch set is built; this is the first cabinet added purely because the
 * plugin pattern made it cheap, which is the phase's whole point. It is also
 * deliberately the only game in the arcade whose skill is *timing a single
 * press* rather than reacting, remembering, knowing or typing — the existing
 * five were starting to rhyme.
 *
 * The rule that makes it a game rather than a toy: a block only keeps the part
 * that overlaps the one below, so every slightly-late press permanently narrows
 * the tower. You are never killed by one mistake, you are killed by five.
 *
 * Entirely client-side, one score, submitted through the base class's normal
 * route. No networking and no knowledge of the Arcade.
 */

import Phaser from 'phaser';
import type { PlayerRef } from '@commons/shared';
import { COLORS, TYPOGRAPHY, getMinigame, hex } from '@commons/shared';
import { BaseMinigameScene } from './BaseMinigameScene';
import { session } from '../../session';
import { sfx } from '../../systems/Sfx';

const RULES = {
  blockHeight: 26,
  /** Width of the foundation, in px. */
  startWidth: 240,
  /** Sideways speed of the first block, px/sec. */
  startSpeed: 210,
  /** Added per block placed, so the tower tightens as it grows. */
  speedRamp: 11,
  maxSpeed: 640,
  /** Below this the tower is too thin to continue and the run ends. */
  minWidth: 12,
  /** Overlap within this many px counts as perfect: no trim, and a bonus. */
  perfectTolerance: 4,
  pointsPerBlock: 10,
  perfectBonus: 25,
  /** How many blocks are visible before the view scrolls. */
  visibleRows: 9,
} as const;

interface Block {
  /** Centre x, in playfield space. */
  x: number;
  width: number;
  colorIndex: number;
}

export class StackTowerScene extends BaseMinigameScene {
  static readonly KEY = 'StackTowerScene';

  private graphics!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private judgementText!: Phaser.GameObjects.Text;

  private stack: Block[] = [];
  /** The block currently sliding, above the top of the stack. */
  private moving?: Block;
  private direction: 1 | -1 = 1;
  private speed: number = RULES.startSpeed;
  private running = false;
  private score = 0;
  private perfectStreak = 0;

  constructor() {
    super(getMinigame('stack_tower')!);
  }

  onStart(_players: PlayerRef[]): void {
    this.stack = [];
    this.moving = undefined;
    this.speed = RULES.startSpeed;
    this.score = 0;
    this.perfectStreak = 0;
    this.running = false;

    this.graphics = this.add.graphics();
    this.playfield.add(this.graphics);

    this.hudText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize + 2}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5, 0);
    this.playfield.add(this.hudText);

    this.judgementText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '20px',
        color: COLORS.hudAccent,
      })
      .setOrigin(0.5);
    this.playfield.add(this.judgementText);

    // Foundation, centred and not scored: you are placing block 2 first.
    this.stack.push({ x: 0, width: RULES.startWidth, colorIndex: 0 });
    this.spawnBlock();
    this.running = true;

    this.input.keyboard?.on('keydown-SPACE', this.drop, this);
    this.input.on('pointerdown', this.drop, this);
  }

  override onEnd(): void {
    this.running = false;
    this.input.keyboard?.off('keydown-SPACE', this.drop, this);
    this.input.off('pointerdown', this.drop, this);
  }

  private spawnBlock(): void {
    const top = this.stack[this.stack.length - 1]!;
    // Always enters from the side it is travelling towards, so the player can
    // read the direction before it matters.
    this.direction = this.stack.length % 2 === 0 ? 1 : -1;
    this.moving = {
      x: this.direction === 1 ? -this.halfSpan() : this.halfSpan(),
      width: top.width,
      colorIndex: this.stack.length,
    };
  }

  /** Half the width the moving block may travel across, in px. */
  private halfSpan(): number {
    return Math.max(160, Math.min(this.scale.gameSize.width, 900) / 2 - 40);
  }

  private drop(): void {
    if (!this.running || !this.moving) return;

    const below = this.stack[this.stack.length - 1]!;
    const moving = this.moving;
    const offset = moving.x - below.x;
    const overlap = below.width - Math.abs(offset);

    if (overlap <= 0) {
      // Missed the tower entirely.
      this.moving = undefined;
      this.running = false;
      sfx.bump();
      void this.finishRun(
        `${this.stack.length - 1} blocks stacked. The last one went straight past.`,
      );
      return;
    }

    const perfect = Math.abs(offset) <= RULES.perfectTolerance;
    if (perfect) {
      // Snapped, and NOT trimmed — otherwise a perfect drop would still shave a
      // pixel or two and the tower could never be recovered once it narrowed.
      this.stack.push({ x: below.x, width: below.width, colorIndex: moving.colorIndex });
      this.perfectStreak += 1;
      this.score += RULES.pointsPerBlock + RULES.perfectBonus * this.perfectStreak;
      this.judgementText.setText(
        this.perfectStreak > 1 ? `PERFECT x${this.perfectStreak}` : 'PERFECT',
      );
      sfx.reward();
    } else {
      this.stack.push({ x: below.x + offset / 2, width: overlap, colorIndex: moving.colorIndex });
      this.perfectStreak = 0;
      this.score += RULES.pointsPerBlock;
      this.judgementText.setText('');
      sfx.uiOpen();
    }

    this.speed = Math.min(RULES.maxSpeed, this.speed + RULES.speedRamp);

    const placed = this.stack[this.stack.length - 1]!;
    if (placed.width < RULES.minWidth) {
      this.moving = undefined;
      this.running = false;
      void this.finishRun(`${this.stack.length - 1} blocks. It got too thin to build on.`);
      return;
    }

    this.spawnBlock();
  }

  override update(_time: number, delta: number): void {
    if (!this.running || !this.moving) {
      this.draw();
      return;
    }

    const span = this.halfSpan();
    this.moving.x += this.direction * this.speed * (delta / 1000);
    if (this.moving.x > span) {
      this.moving.x = span;
      this.direction = -1;
    } else if (this.moving.x < -span) {
      this.moving.x = -span;
      this.direction = 1;
    }

    this.draw();
  }

  protected override onLayout(): void {
    this.draw();
  }

  private blockColor(index: number): number {
    // A slow hue walk so the tower reads as one object with height, rather than
    // a pile of unrelated bricks.
    const palette = [
      COLORS.statusListening,
      COLORS.hudAccent,
      COLORS.statusStudying,
      COLORS.interactBubbleMark,
      COLORS.flowerYellow,
    ];
    return hex(palette[index % palette.length]!);
  }

  private draw(): void {
    if (!this.graphics) return;

    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    const baseY = height - 120;

    this.graphics.clear();

    // Scroll once the tower is taller than the view, so the top stays visible.
    const overflow = Math.max(0, this.stack.length - RULES.visibleRows);
    const shift = overflow * RULES.blockHeight;

    this.stack.forEach((block, index) => {
      const y = baseY - index * RULES.blockHeight + shift;
      if (y < -RULES.blockHeight || y > height) return;

      this.graphics.fillStyle(this.blockColor(block.colorIndex), 1);
      this.graphics.fillRect(cx + block.x - block.width / 2, y, block.width, RULES.blockHeight - 2);

      // top highlight, so the stack has a readable direction
      this.graphics.fillStyle(0xffffff, 0.16);
      this.graphics.fillRect(cx + block.x - block.width / 2, y, block.width, 3);
    });

    if (this.moving) {
      const y = baseY - this.stack.length * RULES.blockHeight + shift;
      this.graphics.fillStyle(this.blockColor(this.moving.colorIndex), 1);
      this.graphics.fillRect(
        cx + this.moving.x - this.moving.width / 2,
        y,
        this.moving.width,
        RULES.blockHeight - 2,
      );
      this.graphics.fillStyle(0xffffff, 0.3);
      this.graphics.fillRect(cx + this.moving.x - this.moving.width / 2, y, this.moving.width, 3);
    }

    const top = this.stack[this.stack.length - 1];
    this.hudText
      .setPosition(cx, 70)
      .setText(
        `${this.stack.length - 1} blocks    ${this.score} pts    width ${Math.round(top?.width ?? 0)}`,
      );
    this.judgementText.setPosition(cx, 108);

    if (this.running) this.reportScore(session.userId, this.score);
  }
}

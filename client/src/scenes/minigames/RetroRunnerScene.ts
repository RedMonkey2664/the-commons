/**
 * Retro Runner — 06's fourth minigame, solo.
 *
 * "simple endless side-scroller/obstacle-dodge, more build effort, good
 * 'flagship' cabinet once the pattern is proven."
 *
 * Entirely client-side: one player, one score, submitted through the base
 * class's normal route. No networking, no store access, no knowledge of the
 * Arcade — the same plugin contract Memory Match satisfies.
 *
 * 11's difficulty note is honoured literally: speed ramps WITHIN a run and
 * resets when the run ends. There is no meta-progression gating anything.
 */

import Phaser from 'phaser';
import type { PlayerRef } from '@commons/shared';
import { COLORS, TYPOGRAPHY, getMinigame, hex } from '@commons/shared';
import { BaseMinigameScene } from './BaseMinigameScene';
import { session } from '../../session';

const RULES = {
  /** Ground-level speed at the start, px/sec. */
  startSpeed: 260,
  /** Added per second survived, so a run tightens without becoming unfair. */
  speedRamp: 9,
  maxSpeed: 620,
  gravity: 2100,
  jumpVelocity: -740,
  /** A second, weaker jump — forgiving without trivialising the game. */
  doubleJumpVelocity: -600,
  runnerSize: 34,
  groundHeight: 64,
  /** Points per second survived. */
  pointsPerSecond: 12,
  /** Bonus for each obstacle cleared. */
  clearBonus: 25,
  minGapPx: 260,
  maxGapPx: 470,
  /**
   * Clear runway before the first obstacle, in px.
   *
   * Explicit rather than falling out of the panel width: that made the opening
   * gap depend on window size, and on a wide screen gave three seconds of empty
   * running before anything happened. About a second and a half at start speed
   * is enough to get your hands ready.
   */
  startRunwayPx: 420,
} as const;

interface Obstacle {
  x: number;
  width: number;
  height: number;
  cleared: boolean;
}

export class RetroRunnerScene extends BaseMinigameScene {
  private graphics!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;

  private panel = { x: 0, y: 0, width: 0, height: 0 };
  private obstacles: Obstacle[] = [];

  private runnerY = 0;
  private runnerVy = 0;
  private jumpsUsed = 0;
  private grounded = true;

  // Annotated: RULES is `as const`, so this would infer the literal type 260.
  private speed: number = RULES.startSpeed;
  private distance = 0;
  private elapsedMs = 0;
  private cleared = 0;
  private running = false;
  private nextSpawnX: number = 0;
  private legPhase = 0;

  constructor() {
    super(
      getMinigame('retro_runner') ?? {
        id: 'retro_runner',
        displayName: 'Retro Runner',
        cabinetSpriteKey: 'obj_cabinet_lit',
        sceneKey: 'RetroRunnerScene',
        minPlayers: 1,
        maxPlayers: 1,
      },
    );
  }

  onStart(_players: PlayerRef[]): void {
    this.graphics = this.add.graphics().setDepth(3);
    this.hudText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize + 2}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5, 0)
      .setDepth(4);

    this.reset();

    this.input.on('pointerdown', () => this.jump());
    this.input.keyboard?.on('keydown-SPACE', () => this.jump());
    this.input.keyboard?.on('keydown-UP', () => this.jump());
    this.input.keyboard?.on('keydown-W', () => this.jump());

    this.statusText.setText('SPACE or click to jump   ·   ESC to quit');
  }

  override onEnd(): void {
    this.running = false;
  }

  private reset(): void {
    this.obstacles = [];
    this.runnerY = 0;
    this.runnerVy = 0;
    this.jumpsUsed = 0;
    this.grounded = true;
    this.speed = RULES.startSpeed;
    this.distance = 0;
    this.elapsedMs = 0;
    this.cleared = 0;
    this.running = true;
    this.nextSpawnX = RULES.startRunwayPx;
  }

  private jump(): void {
    if (!this.running) return;

    if (this.grounded) {
      this.runnerVy = RULES.jumpVelocity;
      this.grounded = false;
      this.jumpsUsed = 1;
      return;
    }
    if (this.jumpsUsed < 2) {
      this.runnerVy = RULES.doubleJumpVelocity;
      this.jumpsUsed = 2;
    }
  }

  override update(_time: number, delta: number): void {
    if (!this.running || !this.panel.width) return;

    const dt = Math.min(delta, 50) / 1000; // clamp: a stalled tab must not teleport
    this.elapsedMs += dt * 1000;

    this.speed = Math.min(RULES.maxSpeed, RULES.startSpeed + (this.elapsedMs / 1000) * RULES.speedRamp);
    const dx = this.speed * dt;
    this.distance += dx;

    // -- runner physics --
    this.runnerVy += RULES.gravity * dt;
    this.runnerY += this.runnerVy * dt;
    if (this.runnerY >= 0) {
      this.runnerY = 0;
      this.runnerVy = 0;
      this.grounded = true;
      this.jumpsUsed = 0;
    }
    this.legPhase += dx * 0.05;

    // -- obstacles --
    for (const obstacle of this.obstacles) obstacle.x -= dx;
    this.obstacles = this.obstacles.filter((o) => o.x + o.width > -40);

    this.nextSpawnX -= dx;
    if (this.nextSpawnX <= 0) {
      const height = 34 + Math.random() * 46;
      this.obstacles.push({
        x: this.panel.width + 40,
        width: 22 + Math.random() * 26,
        height,
        cleared: false,
      });
      // Gap shrinks with speed but never below a jumpable distance.
      const gapSpan = RULES.maxGapPx - RULES.minGapPx;
      const tightness = (this.speed - RULES.startSpeed) / (RULES.maxSpeed - RULES.startSpeed);
      this.nextSpawnX = RULES.minGapPx + gapSpan * (1 - tightness) * Math.random() + RULES.minGapPx * 0.4;
    }

    this.checkCollisions();
    this.draw();
  }

  private runnerRect(): { x: number; y: number; w: number; h: number } {
    const size = RULES.runnerSize;
    return {
      x: this.panel.width * 0.22,
      y: this.groundY() - size + this.runnerY,
      w: size,
      h: size,
    };
  }

  private groundY(): number {
    return this.panel.height - RULES.groundHeight;
  }

  private checkCollisions(): void {
    const runner = this.runnerRect();

    for (const obstacle of this.obstacles) {
      const ox = obstacle.x;
      const oy = this.groundY() - obstacle.height;

      const overlaps =
        runner.x < ox + obstacle.width &&
        runner.x + runner.w > ox &&
        runner.y + runner.h > oy;

      if (overlaps) {
        this.crash();
        return;
      }

      if (!obstacle.cleared && ox + obstacle.width < runner.x) {
        obstacle.cleared = true;
        this.cleared += 1;
      }
    }
  }

  private currentScore(): number {
    return Math.max(
      0,
      Math.round((this.elapsedMs / 1000) * RULES.pointsPerSecond + this.cleared * RULES.clearBonus),
    );
  }

  private crash(): void {
    if (!this.running) return;
    this.running = false;

    const score = this.currentScore();
    this.reportScore(session.userId, score);

    // A beat before the summary, so the crash registers as a crash.
    this.cameras.main.shake(180, 0.006);
    this.time.delayedCall(420, () => {
      void this.finishRun(
        `Ran ${Math.round(this.distance / 10)}m\nand cleared ${this.cleared} obstacle${this.cleared === 1 ? '' : 's'}`,
      );
    });
  }

  // -- drawing --------------------------------------------------------------

  private draw(): void {
    const g = this.graphics;
    g.clear();

    const { x: px, y: py, width, height } = this.panel;
    const groundY = this.groundY();

    g.translateCanvas(px, py);

    // Parallax hills, so speed is legible without a background image.
    g.fillStyle(hex(COLORS.arcadeBg), 0.35);
    const hillOffset = (this.distance * 0.25) % 260;
    for (let i = -1; i < width / 260 + 1; i += 1) {
      const hx = i * 260 - hillOffset;
      g.fillCircle(hx + 130, groundY + 40, 110);
    }

    // Ground
    g.fillStyle(hex(COLORS.storefront), 1);
    g.fillRect(0, groundY, width, height - groundY);
    g.fillStyle(hex(COLORS.hudAccent), 0.7);
    g.fillRect(0, groundY, width, 3);

    // Ground dashes give a sense of motion at speed.
    g.fillStyle(hex(COLORS.hudText), 0.18);
    const dashOffset = this.distance % 80;
    for (let i = -1; i < width / 80 + 1; i += 1) {
      g.fillRect(i * 80 - dashOffset, groundY + 22, 40, 3);
    }

    // Obstacles
    for (const obstacle of this.obstacles) {
      const oy = groundY - obstacle.height;
      g.fillStyle(hex(COLORS.interactBubbleMark), 1);
      g.fillRoundedRect(obstacle.x, oy, obstacle.width, obstacle.height, 4);
      g.fillStyle(hex(COLORS.hudText), 0.25);
      g.fillRect(obstacle.x + 3, oy + 3, obstacle.width - 6, 3);
    }

    // Runner
    const runner = this.runnerRect();
    g.fillStyle(hex(COLORS.playerBody), 1);
    g.fillRoundedRect(runner.x, runner.y, runner.w, runner.h, 6);
    g.fillStyle(hex(COLORS.skin), 1);
    g.fillRect(runner.x + 8, runner.y + 6, runner.w - 16, 12);

    // Legs pump on the ground and tuck in the air — cheap, reads instantly.
    g.fillStyle(hex(COLORS.playerBody), 1);
    if (this.grounded) {
      const swing = Math.sin(this.legPhase) * 8;
      g.fillRect(runner.x + 6, runner.y + runner.h, 6, 10 + swing);
      g.fillRect(runner.x + runner.w - 12, runner.y + runner.h, 6, 10 - swing);
    } else {
      g.fillRect(runner.x + 8, runner.y + runner.h, 6, 6);
      g.fillRect(runner.x + runner.w - 14, runner.y + runner.h, 6, 6);
    }

    g.translateCanvas(-px, -py);

    this.hudText.setText(
      `${this.currentScore()}     ${Math.round(this.distance / 10)}m     ${Math.round(this.speed)}px/s`,
    );
  }

  protected override onLayout(x: number, y: number, width: number, height: number): void {
    this.panel = { x, y, width, height };
    this.hudText?.setPosition(x + width / 2, y + 62);
  }
}

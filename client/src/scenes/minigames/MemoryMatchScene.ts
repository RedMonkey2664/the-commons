/**
 * Memory Match — 06's first minigame, solo.
 *
 * "flip-tile pairs game, simplest possible build, good first minigame to prove
 * the plugin pattern end-to-end."
 *
 * Note what this file does NOT contain: no networking, no store access, no
 * knowledge of the Arcade or the zone it was launched from, no leaderboard
 * code. It builds a grid, handles clicks, and calls reportScore. That is the
 * whole plugin contract.
 */

import Phaser from 'phaser';
import type { PlayerRef } from '@commons/shared';
import { COLORS, MEMORY_MATCH_RULES as RULES, TYPOGRAPHY, hex } from '@commons/shared';
import { BaseMinigameScene } from './BaseMinigameScene';
import { session } from '../../session';
import { getMinigame } from '@commons/shared';

/** Face symbols. Shapes as well as colours, so pairs are not colour-only. */
const FACES: Array<{ symbol: string; color: string }> = [
  { symbol: '★', color: '#F2CE5C' },
  { symbol: '●', color: '#4A9DD9' },
  { symbol: '▲', color: '#E8613C' },
  { symbol: '■', color: '#3E8E6F' },
  { symbol: '♦', color: '#E88BA8' },
  { symbol: '✦', color: '#B48BE8' },
  { symbol: '♥', color: '#C4644A' },
  { symbol: '⬢', color: '#7FBA78' },
];

interface Card {
  index: number;
  faceIndex: number;
  container: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Graphics;
  faceText: Phaser.GameObjects.Text;
  matched: boolean;
  faceUp: boolean;
}

export class MemoryMatchScene extends BaseMinigameScene {
  private cards: Card[] = [];
  private firstPick?: Card;
  private locked = false;
  private matches = 0;
  private mismatches = 0;
  private startedAt = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private flipTimer?: Phaser.Time.TimerEvent;

  constructor() {
    // getMinigame is the single source of truth for id/name/scene key, so this
    // scene cannot drift from the config the Arcade places a cabinet from.
    super(
      getMinigame('memory_match') ?? {
        id: 'memory_match',
        displayName: 'Memory Match',
        cabinetSpriteKey: 'obj_cabinet_lit',
        sceneKey: 'MemoryMatchScene',
        minPlayers: 1,
        maxPlayers: 1,
      },
    );
  }

  onStart(_players: PlayerRef[]): void {
    this.cards = [];
    this.firstPick = undefined;
    this.locked = false;
    this.matches = 0;
    this.mismatches = 0;
    this.startedAt = this.time.now;

    this.scoreText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize + 2}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5, 0)
      .setDepth(3);

    this.buildDeck();
    this.refreshScore();
    this.statusText.setText('click a card   ·   ESC to quit');
  }

  override onEnd(): void {
    this.flipTimer?.remove();
    this.flipTimer = undefined;
  }

  // -- deck -----------------------------------------------------------------

  private buildDeck(): void {
    const faceIndices: number[] = [];
    for (let i = 0; i < RULES.pairs; i += 1) {
      faceIndices.push(i, i);
    }

    // Fisher-Yates, so every run is a genuinely different layout.
    for (let i = faceIndices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [faceIndices[i], faceIndices[j]] = [faceIndices[j]!, faceIndices[i]!];
    }

    faceIndices.forEach((faceIndex, index) => {
      const container = this.add.container(0, 0);
      const back = this.add.graphics();
      const face = FACES[faceIndex % FACES.length]!;

      const faceText = this.add
        .text(0, 0, face.symbol, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: '44px',
          color: face.color,
        })
        .setOrigin(0.5)
        .setVisible(false);

      container.add([back, faceText]);
      container.setSize(96, 120);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-48, -60, 96, 120),
        Phaser.Geom.Rectangle.Contains,
      );
      container.on('pointerdown', () => this.flip(index));
      container.on('pointerover', () => this.scene.isActive() && this.input.setDefaultCursor('pointer'));
      container.on('pointerout', () => this.input.setDefaultCursor('default'));

      const card: Card = { index, faceIndex, container, back, faceText, matched: false, faceUp: false };
      this.cards.push(card);
      this.playfield.add(container);
      this.drawCard(card);
    });
  }

  private drawCard(card: Card): void {
    const w = 96;
    const h = 120;
    const g = card.back;
    g.clear();

    if (card.matched) {
      g.fillStyle(hex(COLORS.statusStudying), 0.28);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      g.lineStyle(2, hex(COLORS.statusStudying), 0.9);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      return;
    }

    if (card.faceUp) {
      g.fillStyle(hex(COLORS.dialogueBoxBg), 1);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      g.lineStyle(2, hex(COLORS.hudAccent), 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      return;
    }

    // Face down: a patterned back, so the grid reads as cards not buttons.
    g.fillStyle(hex(COLORS.arcadeBg), 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    g.lineStyle(2, hex(COLORS.hudAccent), 0.55);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    g.lineStyle(1, hex(COLORS.hudAccent), 0.3);
    for (let i = -h / 2 + 12; i < h / 2 - 8; i += 12) {
      g.lineBetween(-w / 2 + 10, i, w / 2 - 10, i - 10);
    }
  }

  // -- play -----------------------------------------------------------------

  private flip(index: number): void {
    if (this.locked) return;
    const card = this.cards[index];
    if (!card || card.matched || card.faceUp) return;

    this.showFace(card, true);

    if (!this.firstPick) {
      this.firstPick = card;
      return;
    }

    const first = this.firstPick;
    this.firstPick = undefined;

    if (first.faceIndex === card.faceIndex) {
      first.matched = true;
      card.matched = true;
      this.matches += 1;
      this.drawCard(first);
      this.drawCard(card);
      this.refreshScore();

      if (this.matches === RULES.pairs) this.win();
      return;
    }

    // Mismatch: hold both face-up briefly so the player can actually see them.
    this.mismatches += 1;
    this.locked = true;
    this.refreshScore();
    this.flipTimer = this.time.delayedCall(RULES.mismatchHoldMs, () => {
      this.showFace(first, false);
      this.showFace(card, false);
      this.locked = false;
    });
  }

  private showFace(card: Card, faceUp: boolean): void {
    card.faceUp = faceUp;
    card.faceText.setVisible(faceUp);
    this.drawCard(card);

    // A quick squash reads as a flip without needing two card textures.
    this.tweens.add({
      targets: card.container,
      scaleX: 0.82,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  private currentScore(): number {
    const base = this.matches * RULES.pairPoints;
    const elapsed = this.time.now - this.startedAt;
    // Time bonus decays over the window, so being quick is worth something but
    // running out of clock never turns the score negative.
    const remaining = Math.max(0, 1 - elapsed / RULES.timeBonusWindowMs);
    const bonus = this.matches === RULES.pairs ? Math.round(RULES.timeBonus * remaining) : 0;
    const penalty = this.mismatches * RULES.mismatchPenalty;
    return Math.max(0, base + bonus - penalty);
  }

  private refreshScore(): void {
    this.scoreText.setText(
      `pairs ${this.matches}/${RULES.pairs}     misses ${this.mismatches}     score ${this.currentScore()}`,
    );
  }

  private win(): void {
    const score = this.currentScore();
    const seconds = Math.round((this.time.now - this.startedAt) / 1000);
    this.reportScore(session.userId, score);
    void this.finishRun(`All pairs found in ${seconds}s\nwith ${this.mismatches} misses`);
  }

  // -- layout ---------------------------------------------------------------

  protected override onLayout(x: number, y: number, width: number, height: number): void {
    if (!this.cards.length) return;

    const columns = RULES.columns;
    const rows = Math.ceil(this.cards.length / columns);
    const cardW = 96;
    const cardH = 120;
    const gapX = 18;
    const gapY = 18;

    const gridW = columns * cardW + (columns - 1) * gapX;
    const gridH = rows * cardH + (rows - 1) * gapY;
    const originX = x + (width - gridW) / 2 + cardW / 2;
    const originY = y + (height - gridH) / 2 + cardH / 2 + 14;

    this.cards.forEach((card, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      card.container.setPosition(originX + col * (cardW + gapX), originY + row * (cardH + gapY));
    });

    this.scoreText?.setPosition(x + width / 2, y + 62);
  }
}

/**
 * Base class for every minigame — 06's plugin seam.
 *
 * Handles everything a minigame should NOT have to reimplement: presenting
 * itself over the paused zone, a consistent frame and header, Esc to quit,
 * reporting a score, and showing the leaderboard afterwards.
 *
 * A minigame subclass implements three things: build the playfield, handle
 * input, and call `reportScore` when the run ends. It never touches the
 * network, the store, the Arcade, or the zone it was launched from.
 *
 * Adding minigame #5 is: one scene file extending this, one entry in
 * minigames.config.ts. Nothing else in the codebase changes.
 */

import Phaser from 'phaser';
import type { MinigameConfig, MinigameScene, PlayerRef } from '@commons/shared';
import { COLORS, TYPOGRAPHY, UI, hex } from '@commons/shared';
import { session } from '../../session';
import { fetchScores, type ScoreRow } from '../../systems/scoreClient';

export interface MinigameSceneData {
  /** Zone scene to resume when this exits. */
  returnScene: string;
}

export abstract class BaseMinigameScene extends Phaser.Scene implements MinigameScene {
  protected readonly minigame: MinigameConfig;

  /** Everything the subclass draws goes in here, so teardown is one call. */
  protected playfield!: Phaser.GameObjects.Container;
  protected headerText!: Phaser.GameObjects.Text;
  protected statusText!: Phaser.GameObjects.Text;

  private chrome!: Phaser.GameObjects.Graphics;
  private scrim!: Phaser.GameObjects.Rectangle;
  private returnScene = 'TownSquareScene';
  private finished = false;
  private reported = new Map<string, number>();

  protected constructor(minigame: MinigameConfig) {
    super({ key: minigame.sceneKey });
    this.minigame = minigame;
  }

  init(data: MinigameSceneData): void {
    this.returnScene = data?.returnScene ?? 'TownSquareScene';
    // Phaser reuses scene instances, so per-run state must be reset here.
    this.finished = false;
    this.reported = new Map();
  }

  create(): void {
    this.scrim = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.72).setOrigin(0, 0).setDepth(0);
    this.chrome = this.add.graphics().setDepth(1);

    this.headerText = this.add
      .text(0, 0, this.minigame.displayName.toUpperCase(), {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '26px',
        color: COLORS.hudText,
      })
      .setOrigin(0.5, 0)
      .setDepth(3);

    this.statusText = this.add
      .text(0, 0, 'ESC to quit', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5, 1)
      .setDepth(3)
      .setAlpha(0.7);

    this.playfield = this.add.container(0, 0).setDepth(2);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    this.input.keyboard?.on('keydown-ESC', () => this.quit());

    this.cameras.main.fadeIn(UI.panel.slideMs, 0, 0, 0);

    const players: PlayerRef[] = [
      {
        id: session.userId,
        displayName: session.displayName ?? 'Wanderer',
        spriteKey: session.spriteKey,
      },
    ];
    this.onStart(players);
  }

  // -- MinigameScene contract ----------------------------------------------

  abstract onStart(players: PlayerRef[]): void;

  onEnd(): void {
    // Subclasses override to tear down timers; the base handles the rest.
  }

  /**
   * The single route a score takes out of a minigame. Persisting happens here
   * so no minigame needs to know the store exists.
   */
  reportScore(playerId: string, score: number): void {
    this.reported.set(playerId, Math.max(0, Math.round(score)));
  }

  /** Call when the run is over. Shows the board, then returns to the Arcade. */
  protected async finishRun(summary: string): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.onEnd();

    const myScore = this.reported.get(session.userId) ?? 0;
    this.statusText.setText('SPACE to return');

    const board = await this.submitAndFetchBoard(myScore);
    this.showResults(summary, myScore, board);

    this.input.keyboard?.once('keydown-SPACE', () => this.quit());
  }

  /**
   * Solo games post their score over HTTP. Multiplayer games are scored by the
   * server and must NOT post — that would let a client set its own result,
   * which 06 rules out.
   */
  protected async submitAndFetchBoard(score: number): Promise<ScoreRow[]> {
    const soloScored = this.minigame.maxPlayers <= 1;
    try {
      return await fetchScores(this.minigame.id, soloScored ? score : undefined);
    } catch {
      return [];
    }
  }

  protected showResults(summary: string, score: number, board: ScoreRow[]): void {
    this.playfield.removeAll(true);

    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    const top = height * 0.3;

    this.playfield.add(
      this.add
        .text(cx, top, summary, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: '22px',
          color: COLORS.hudText,
          align: 'center',
        })
        .setOrigin(0.5, 0),
    );

    this.playfield.add(
      this.add
        .text(cx, top + 44, `${score}`, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: '52px',
          color: COLORS.hudAccent,
        })
        .setOrigin(0.5, 0),
    );

    const boardTitle = board.length > 0 ? 'BEST SCORES' : 'no scores recorded yet';
    this.playfield.add(
      this.add
        .text(cx, top + 116, boardTitle, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize}px`,
          color: COLORS.hudText,
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.7),
    );

    board.slice(0, 8).forEach((row, index) => {
      const mine = row.userId === session.userId;
      this.playfield.add(
        this.add
          .text(
            cx,
            top + 146 + index * 26,
            `${index + 1}.  ${row.displayName.padEnd(16, ' ')}${row.score}`,
            {
              fontFamily: TYPOGRAPHY.dialogueFont,
              fontSize: `${TYPOGRAPHY.hudFontSize + 1}px`,
              color: mine ? COLORS.hudAccent : COLORS.hudText,
            },
          )
          .setOrigin(0.5, 0)
          .setAlpha(mine ? 1 : 0.8),
      );
    });
  }

  // -- chrome ---------------------------------------------------------------

  protected quit(): void {
    if (!this.scene.isActive()) return;
    this.onEnd();
    this.cameras.main.fadeOut(UI.panel.slideMs, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop();
      // The zone was paused, not stopped — resuming puts the player back
      // exactly where they were standing, still facing the cabinet.
      this.scene.resume(this.returnScene);
    });
  }

  private layout(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;

    this.scrim.setSize(width, height);

    const panelWidth = Math.min(width - 80, 900);
    const panelHeight = Math.min(height - 80, 660);
    const x = Math.round((width - panelWidth) / 2);
    const y = Math.round((height - panelHeight) / 2);

    this.chrome.clear();
    this.chrome.fillStyle(hex(COLORS.transitionFade), 0.94);
    this.chrome.fillRoundedRect(x, y, panelWidth, panelHeight, 18);
    this.chrome.lineStyle(2, hex(COLORS.hudAccent), 0.85);
    this.chrome.strokeRoundedRect(x, y, panelWidth, panelHeight, 18);
    this.chrome.fillStyle(hex(COLORS.hudAccent), 1);
    this.chrome.fillRoundedRect(x + 18, y + 14, panelWidth - 36, 3, 2);

    this.headerText.setPosition(width / 2, y + 26);
    this.statusText.setPosition(width / 2, y + panelHeight - 18);

    this.onLayout(x, y, panelWidth, panelHeight);
  }

  /** Subclasses reposition their playfield here. */
  protected onLayout(_x: number, _y: number, _width: number, _height: number): void {}
}

/**
 * Reaction Tap — 06's third minigame, 1-4 players in the same room.
 *
 * "classic 'tap when the light turns green' reflex test, simple to build,
 * naturally competitive/funny in a group."
 *
 * This client shows a light and sends "tapped". It is not told when the light
 * will turn — that arrives as a cue at the moment it happens, precisely so a
 * client cannot schedule a perfect tap. The server times the arrival and scores
 * it, per 06.
 *
 * The game says out loud that your latency counts against you. That is a real
 * consequence of server-side scoring and players deserve to know it rather than
 * wonder why the person on the fast connection always wins.
 */

import Phaser from 'phaser';
import type { FinishedPayload, PlayerRef } from '@commons/shared';
import {
  COLORS,
  MINIGAME_CLIENT_MESSAGE,
  MINIGAME_ROOM_TYPE,
  MINIGAME_SERVER_MESSAGE,
  TYPOGRAPHY,
  getMinigame,
  hex,
} from '@commons/shared';
import { Client, type Room } from 'colyseus.js';
import { BaseMinigameScene } from './BaseMinigameScene';
import { session } from '../../session';

type LightState = 'idle' | 'waiting' | 'go' | 'tapped' | 'falseStart';

interface ReactionRoundMessage {
  index: number;
  total: number;
  durationMs: number;
}

interface ReactionResultMessage {
  goAfterMs: number;
  scores: Array<{ playerId: string; displayName: string; correct: boolean; score: number }>;
}

export class ReactionTapScene extends BaseMinigameScene {
  private room?: Room;
  private light!: Phaser.GameObjects.Graphics;
  private lightLabel!: Phaser.GameObjects.Text;
  private caption!: Phaser.GameObjects.Text;
  private scoreboard!: Phaser.GameObjects.Text;

  private lightState: LightState = 'idle';
  private goAtLocal = 0;
  private panel = { x: 0, y: 0, width: 0, height: 0 };

  constructor() {
    super(
      getMinigame('reaction_tap') ?? {
        id: 'reaction_tap',
        displayName: 'Reaction Tap',
        cabinetSpriteKey: 'obj_cabinet_lit',
        sceneKey: 'ReactionTapScene',
        minPlayers: 1,
        maxPlayers: 4,
      },
    );
  }

  onStart(_players: PlayerRef[]): void {
    this.lightState = 'idle';
    this.goAtLocal = 0;

    this.light = this.add.graphics().setDepth(3);

    this.lightLabel = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '30px',
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setDepth(4);

    this.caption = this.add
      .text(0, 0, 'looking for a cabinet…', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize + 1}px`,
        color: COLORS.hudText,
        align: 'center',
        wordWrap: { width: 520 },
      })
      .setOrigin(0.5, 0)
      .setDepth(3)
      .setAlpha(0.8);

    this.scoreboard = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setDepth(3)
      .setAlpha(0.85);

    // Tap = click anywhere, or Space. Both routed through one handler so the
    // false-start rule cannot differ between them.
    this.input.on('pointerdown', () => this.tap());
    this.input.keyboard?.on('keydown-SPACE', () => this.tap());

    this.statusText.setText('waiting for players   ·   ESC to quit');
    this.drawLight();
    void this.connect();
  }

  override onEnd(): void {
    const room = this.room;
    this.room = undefined;
    void room?.leave().catch(() => undefined);
  }

  // -- networking -----------------------------------------------------------

  private async connect(): Promise<void> {
    try {
      const client = new Client(session.serverUrl);
      const room = await client.joinOrCreate(MINIGAME_ROOM_TYPE, {
        minigameId: this.minigame.id,
        displayName: session.displayName ?? 'Wanderer',
        userId: session.userId,
      });

      if (!this.scene.isActive()) {
        void room.leave().catch(() => undefined);
        return;
      }
      this.room = room;

      room.onMessage(MINIGAME_SERVER_MESSAGE.round, (payload: ReactionRoundMessage) => {
        this.beginRound(payload);
      });

      // The light turning green. Deliberately not in the round payload.
      room.onMessage(MINIGAME_SERVER_MESSAGE.cue, () => this.turnGreen());

      room.onMessage(MINIGAME_SERVER_MESSAGE.result, (payload: ReactionResultMessage) => {
        this.showResult(payload);
      });

      room.onMessage(MINIGAME_SERVER_MESSAGE.finished, (payload: FinishedPayload) => {
        this.showFinished(payload);
      });

      room.onLeave(() => {
        this.room = undefined;
      });

      room.send(MINIGAME_CLIENT_MESSAGE.ready, {});
      this.caption.setText(
        'waiting for players…\n\nwhen the light turns green, tap.\n' +
          'tap early and the round is a bust.',
      );
    } catch (error) {
      if (!this.scene.isActive()) return;
      this.caption.setText(
        'Reaction Tap needs the game server.\n\nIt is timed server-side so nobody\ncan report their own reaction.',
      );
      this.statusText.setText('ESC to return');
      console.warn('[reaction] could not join room:', (error as Error).message);
    }
  }

  // -- rounds ---------------------------------------------------------------

  private beginRound(payload: ReactionRoundMessage): void {
    this.lightState = 'waiting';
    this.goAtLocal = 0;
    this.headerText.setText(
      `${this.minigame.displayName.toUpperCase()}   ${payload.index + 1}/${payload.total}`,
    );
    this.caption.setText('wait for green…');
    this.statusText.setText('do not tap yet');
    this.drawLight();
  }

  private turnGreen(): void {
    if (this.lightState !== 'waiting') return;
    this.lightState = 'go';
    // Local only, for the on-screen readout. The SERVER's timing is what scores.
    this.goAtLocal = this.time.now;
    this.caption.setText('TAP');
    this.statusText.setText('now');
    this.drawLight();
  }

  private tap(): void {
    if (!this.room) return;

    if (this.lightState === 'waiting') {
      // False start. Still sent: the server scores it as such, and pretending
      // locally that it did not happen would desync the two.
      this.lightState = 'falseStart';
      this.caption.setText('too early');
      this.drawLight();
      this.room.send(MINIGAME_CLIENT_MESSAGE.answer, { tapped: true });
      return;
    }

    if (this.lightState !== 'go') return;

    this.lightState = 'tapped';
    const localMs = Math.round(this.time.now - this.goAtLocal);
    this.caption.setText(`${localMs}ms on your screen`);
    this.statusText.setText('waiting for the others');
    this.drawLight();
    this.room.send(MINIGAME_CLIENT_MESSAGE.answer, { tapped: true });
  }

  private showResult(payload: ReactionResultMessage): void {
    const mine = payload.scores.find((s) => s.playerId === this.room?.sessionId);

    // Read the outcome BEFORE resetting the light: checking lightState after
    // setting it to 'idle' could never have matched 'falseStart'.
    const wasFalseStart = this.lightState === 'falseStart';
    this.lightState = 'idle';
    this.drawLight();

    this.caption.setText(
      mine?.correct ? 'in time' : wasFalseStart ? 'false start — no points' : 'missed it',
    );

    this.scoreboard.setText(
      [...payload.scores]
        .sort((a, b) => b.score - a.score)
        .map((s) => `${s.displayName}  ${s.score}`)
        .join('     '),
    );
  }

  private showFinished(payload: FinishedPayload): void {
    this.light.clear();
    this.lightLabel.setText('');
    this.caption.setText('');
    this.scoreboard.setText('');

    const mine = payload.standings.find((s) => s.playerId === this.room?.sessionId);
    this.reportScore(session.userId, mine?.score ?? 0);

    const position = payload.standings.findIndex((s) => s.playerId === this.room?.sessionId) + 1;
    void this.finishRun(
      payload.standings.length > 1
        ? `Finished ${position} of ${payload.standings.length}`
        : 'Round complete',
    );
  }

  // -- drawing --------------------------------------------------------------

  private drawLight(): void {
    const g = this.light;
    g.clear();
    if (!this.panel.width) return;

    const cx = this.panel.x + this.panel.width / 2;
    const cy = this.panel.y + this.panel.height / 2 - 20;
    const radius = 92;

    const fill = {
      idle: COLORS.hudBg,
      waiting: COLORS.interactBubbleMark,
      go: COLORS.statusStudying,
      tapped: COLORS.hudAccent,
      falseStart: COLORS.statusAfk,
    }[this.lightState];

    g.fillStyle(hex(fill), this.lightState === 'idle' ? 0.4 : 0.9);
    g.fillCircle(cx, cy, radius);
    g.lineStyle(4, hex(COLORS.hudText), 0.35);
    g.strokeCircle(cx, cy, radius);

    // Glow when live, so "green" is unmistakable at a glance.
    if (this.lightState === 'go') {
      g.fillStyle(hex(COLORS.statusStudying), 0.18);
      g.fillCircle(cx, cy, radius + 26);
    }

    // Shape as well as colour, per 07's colourblind-safe note.
    const glyph = {
      idle: '',
      waiting: 'WAIT',
      go: 'TAP',
      tapped: 'OK',
      falseStart: 'X',
    }[this.lightState];
    this.lightLabel.setPosition(cx, cy).setText(glyph);
  }

  protected override onLayout(x: number, y: number, width: number, height: number): void {
    this.panel = { x, y, width, height };
    this.caption?.setPosition(x + width / 2, y + height / 2 + 96);
    this.caption?.setWordWrapWidth(Math.min(520, width - 100));
    this.scoreboard?.setPosition(x + width / 2, y + height - 62);
    this.drawLight();
  }
}

/**
 * Trivia Blitz — 06's second minigame, 1-4 players in the same room.
 *
 * This client renders and sends one thing: which option you tapped. It does not
 * know the answer (the server strips it from the question), does not run the
 * clock that scores you, and does not compute or submit its own score. All of
 * that is MinigameRoom's, because 06 requires round outcomes to be computed
 * server-side rather than trusted from clients.
 *
 * A consequence worth stating: with the server unreachable this game cannot be
 * played at all, and says so. Faking a local round would mean inventing scores
 * that could never be reconciled with a real leaderboard.
 */

import Phaser from 'phaser';
import type {
  FinishedPayload,
  PlayerRef,
  RoundPayload,
  RoundResultPayload,
} from '@commons/shared';
import {
  COLORS,
  MINIGAME_CLIENT_MESSAGE,
  MINIGAME_ROOM_TYPE,
  MINIGAME_SERVER_MESSAGE,
  TRIVIA_RULES,
  TYPOGRAPHY,
  getMinigame,
  hex,
} from '@commons/shared';
import { Client, type Room } from 'colyseus.js';
import { BaseMinigameScene } from './BaseMinigameScene';
import { session } from '../../session';

interface OptionButton {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  index: number;
}

export class TriviaBlitzScene extends BaseMinigameScene {
  private room?: Room;
  private promptText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Graphics;
  private scoreboard!: Phaser.GameObjects.Text;
  private options: OptionButton[] = [];

  private roundEndsAt = 0;
  private answered = false;
  private finalScore = 0;
  private panel = { x: 0, y: 0, width: 0, height: 0 };

  constructor() {
    super(
      getMinigame('trivia_blitz') ?? {
        id: 'trivia_blitz',
        displayName: 'Trivia Blitz',
        cabinetSpriteKey: 'obj_cabinet_lit',
        sceneKey: 'TriviaBlitzScene',
        minPlayers: 1,
        maxPlayers: 4,
      },
    );
  }

  onStart(_players: PlayerRef[]): void {
    this.options = [];
    this.answered = false;
    this.finalScore = 0;

    this.promptText = this.add
      .text(0, 0, 'looking for a cabinet…', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '22px',
        color: COLORS.hudText,
        align: 'center',
        wordWrap: { width: 620 },
      })
      .setOrigin(0.5, 0)
      .setDepth(3);

    this.timerBar = this.add.graphics().setDepth(3);

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

    this.statusText.setText('waiting for players   ·   ESC to quit');
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
      this.room = room;

      room.onMessage(MINIGAME_SERVER_MESSAGE.round, (payload: RoundPayload) => {
        this.showRound(payload);
      });
      room.onMessage(MINIGAME_SERVER_MESSAGE.result, (payload: RoundResultPayload) => {
        this.showResult(payload);
      });
      room.onMessage(MINIGAME_SERVER_MESSAGE.finished, (payload: FinishedPayload) => {
        this.showFinished(payload);
      });
      room.onLeave(() => {
        this.room = undefined;
      });

      // Declaring ready starts the round as soon as everyone present is ready;
      // the server also starts on a timer so a solo player is never stuck (06).
      room.send(MINIGAME_CLIENT_MESSAGE.ready, {});
      this.promptText.setText(
        `waiting for players…\n\nstarting in up to ${Math.round(TRIVIA_RULES.lobbyWaitMs / 1000)}s`,
      );
    } catch (error) {
      // Honest failure. This game is server-scored by design, so there is no
      // meaningful offline mode to fall back to.
      this.promptText.setText(
        'Trivia Blitz needs the game server.\n\nIt is scored server-side so nobody\ncan mark their own answers.',
      );
      this.statusText.setText('ESC to return');
      console.warn('[trivia] could not join room:', (error as Error).message);
    }
  }

  // -- rounds ---------------------------------------------------------------

  private showRound(payload: RoundPayload): void {
    this.answered = false;
    this.roundEndsAt = this.time.now + payload.durationMs;

    this.headerText.setText(
      `${this.minigame.displayName.toUpperCase()}   ${payload.index + 1}/${payload.total}`,
    );
    this.promptText.setText(payload.question.prompt);
    this.statusText.setText('pick an answer');

    this.clearOptions();
    payload.question.options.forEach((option, index) => {
      this.options.push(this.createOption(option, index));
    });
    this.positionOptions();
  }

  private createOption(text: string, index: number): OptionButton {
    const container = this.add.container(0, 0).setDepth(3);
    const background = this.add.graphics();
    const label = this.add
      .text(0, 0, `${String.fromCharCode(65 + index)}.  ${text}`, {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0, 0.5);

    container.add([background, label]);
    const button: OptionButton = { container, background, label, index };
    this.paintOption(button, 'idle');

    container.setInteractive(
      new Phaser.Geom.Rectangle(0, -26, 560, 52),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on('pointerdown', () => this.answer(index));
    container.on('pointerover', () => {
      if (!this.answered) this.paintOption(button, 'hover');
    });
    container.on('pointerout', () => {
      if (!this.answered) this.paintOption(button, 'idle');
    });

    this.playfield.add(container);
    return button;
  }

  private paintOption(button: OptionButton, state: 'idle' | 'hover' | 'chosen' | 'correct' | 'wrong'): void {
    const width = Math.min(560, Math.max(320, this.panel.width - 120));
    const g = button.background;
    g.clear();

    const fill = {
      idle: { color: COLORS.hudBg, alpha: 0.75 },
      hover: { color: COLORS.hudAccent, alpha: 0.28 },
      chosen: { color: COLORS.hudAccent, alpha: 0.5 },
      correct: { color: COLORS.statusStudying, alpha: 0.75 },
      wrong: { color: COLORS.interactBubbleMark, alpha: 0.55 },
    }[state];

    g.fillStyle(hex(fill.color), fill.alpha);
    g.fillRoundedRect(0, -26, width, 52, 10);
    g.lineStyle(2, hex(state === 'idle' ? COLORS.hudText : COLORS.hudAccent), state === 'idle' ? 0.25 : 0.9);
    g.strokeRoundedRect(0, -26, width, 52, 10);

    button.label.setX(20);
  }

  private answer(index: number): void {
    if (this.answered || !this.room) return;
    this.answered = true;

    const chosen = this.options[index];
    if (chosen) this.paintOption(chosen, 'chosen');
    this.statusText.setText('locked in — waiting for the others');

    // Only the index goes to the server. It decides whether that was right,
    // and how many points the timing was worth.
    this.room.send(MINIGAME_CLIENT_MESSAGE.answer, { index });
  }

  private showResult(payload: RoundResultPayload): void {
    this.answered = true;

    this.options.forEach((button) => {
      if (button.index === payload.correctIndex) this.paintOption(button, 'correct');
      else this.paintOption(button, 'wrong');
    });

    const mine = payload.scores.find((s) => s.playerId === this.room?.sessionId);
    this.statusText.setText(mine?.correct ? 'correct' : 'not that one');

    const board = [...payload.scores]
      .sort((a, b) => b.score - a.score)
      .map((s) => `${s.displayName}  ${s.score}`)
      .join('     ');
    this.scoreboard.setText(board);
  }

  private showFinished(payload: FinishedPayload): void {
    this.clearOptions();
    this.timerBar.clear();
    this.scoreboard.setText('');
    this.promptText.setText('');

    const mine = payload.standings.find((s) => s.playerId === this.room?.sessionId);
    this.finalScore = mine?.score ?? 0;
    this.reportScore(session.userId, this.finalScore);

    const position = payload.standings.findIndex((s) => s.playerId === this.room?.sessionId) + 1;
    const summary =
      payload.standings.length > 1
        ? `Finished ${ordinal(position)} of ${payload.standings.length}`
        : 'Round complete';

    void this.finishRun(summary);
  }

  private clearOptions(): void {
    for (const button of this.options) button.container.destroy(true);
    this.options = [];
  }

  // -- frame ----------------------------------------------------------------

  override update(): void {
    if (!this.room || this.answered || this.roundEndsAt === 0) return;

    const remaining = Math.max(0, this.roundEndsAt - this.time.now);
    const fraction = remaining / TRIVIA_RULES.roundMs;

    const width = Math.min(560, Math.max(320, this.panel.width - 120));
    const x = this.panel.x + (this.panel.width - width) / 2;
    const y = this.panel.y + 108;

    this.timerBar.clear();
    this.timerBar.fillStyle(0x000000, 0.4);
    this.timerBar.fillRoundedRect(x, y, width, 8, 4);
    // Turns red as it runs out — colour AND length, so the cue is not colour-only.
    const urgent = fraction < 0.3;
    this.timerBar.fillStyle(hex(urgent ? COLORS.interactBubbleMark : COLORS.hudAccent), 1);
    this.timerBar.fillRoundedRect(x, y, Math.max(0, width * fraction), 8, 4);
  }

  protected override onLayout(x: number, y: number, width: number, height: number): void {
    this.panel = { x, y, width, height };
    this.promptText?.setPosition(x + width / 2, y + 132);
    this.promptText?.setWordWrapWidth(Math.min(620, width - 100));
    this.scoreboard?.setPosition(x + width / 2, y + height - 62);
    this.positionOptions();
  }

  private positionOptions(): void {
    if (this.options.length === 0) return;
    const width = Math.min(560, Math.max(320, this.panel.width - 120));
    const startY = this.panel.y + this.panel.height / 2 - 40;

    this.options.forEach((button, index) => {
      button.container.setPosition(
        this.panel.x + (this.panel.width - width) / 2,
        startY + index * 62,
      );
      this.paintOption(button, this.answered ? 'idle' : 'idle');
    });
  }
}

function ordinal(n: number): string {
  if (n <= 0) return '—';
  const suffix = ['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][n % 100] ?? 'th';
  return `${n}${suffix}`;
}

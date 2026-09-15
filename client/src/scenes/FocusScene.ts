/**
 * Focus Mode — the study scene you drop into when you sit at a pod.
 *
 * Runs as an OVERLAY scene, launched in parallel with the zone you were
 * standing in. That is load-bearing rather than incidental: the zone scene
 * holds the Colyseus room, so stopping it would drop you out of the world and
 * everyone else would watch you vanish mid-session. Instead the world keeps
 * running underneath, your avatar stays seated in the room, and this scene
 * covers the screen.
 *
 * WHAT THIS SCENE DOES NOT OWN: the clock. FocusTimer opened a session when you
 * sat down and the server is writing it when you stand; this scene reads that
 * value to display it and never sets it. Pausing is relayed OUT to the owner
 * of the clock (and on to the server) and pauses the performance here; focus
 * time stops accruing, because progression is awarded for it and a paused
 * session is not one somebody is studying in.
 *
 * NOR DOES IT DIRECT. Who does what, where the camera looks and when it cuts
 * belong to FocusCinematicDirector. This scene builds the set — in three layers
 * of depth, dressed for the world you are in — animates the props when the
 * director says something happened on the desk, and keeps the frame (clock,
 * caption, level line, letterbox) pinned where no camera move can carry it.
 */

import Phaser from 'phaser';
import {
  COLORS,
  FOCUS,
  TYPOGRAPHY,
  WORLD_PALETTES,
  hex,
  mix,
  type WorldDefinition,
  type WorldPalette,
} from '@commons/shared';
import { FOCUS_ART, ensureFocusProps } from '../art/focusAvatarArt';
import { FOCUS_SET } from '../art/focusSet';
import { FocusAvatar } from '../entities/FocusAvatar';
import type { AvatarBehaviorMachine, BehaviorId, FocusCue, PropName } from '../systems/AvatarBehavior';
import type { FocusCameraController } from '../systems/FocusCamera';
import { FocusCinematicDirector } from '../systems/FocusCinematicDirector';
import { progression } from '../systems/Progression';
import { sfx } from '../systems/Sfx';
import { sessionClockText } from '../ui/FocusTimer';
import { displayedFocusSeconds, drawLevelBar, focusLevel } from '../ui/focusLevel';
import { ui } from '../ui/UIScene';
import { fadeWorldHud, restoreWorldHud } from '../ui/worldHud';

export interface FocusSceneData {
  bodyColor: string;
  hat?: { color: string; style: string };
  /** Where the zone the player is sitting in is called, for the caption. */
  zoneName: string;
  /** Called when the player leaves Focus Mode; the caller stands them up. */
  onExit: () => void;
  /**
   * Called when the player pauses or resumes. The caller owns the clock and the
   * connection, so it pauses both; this scene only pauses the performance.
   */
  onPauseChange: (paused: boolean) => void;
}

/**
 * Whether Focus Mode currently owns the screen.
 *
 * A module flag rather than a scene lookup so ZoneScene can ask cheaply every
 * frame without reaching into the scene manager, the same way it asks the UI
 * facade whether a panel is open.
 */
export const focusMode = { active: false };

/** Where the seated avatar sits in world space. Shots are framed against this. */
export const AVATAR_Y = FOCUS_SET.avatar.y;

type Image = Phaser.GameObjects.Image;
type Text = Phaser.GameObjects.Text;

/** A mote, and whether it drifts in the room or in front of the lens. */
interface Mote {
  image: Image;
  near: boolean;
}

export class FocusScene extends Phaser.Scene {
  static readonly KEY = 'FocusScene';

  private sceneData!: FocusSceneData;
  private world!: WorldDefinition;

  // -- the set, in three layers of depth ------------------------------------
  private scrim!: Phaser.GameObjects.Rectangle;
  private backdrop!: Phaser.GameObjects.Graphics;
  private farLayer!: Phaser.GameObjects.Container;
  private stage!: Phaser.GameObjects.Container;
  private nearLayer!: Phaser.GameObjects.Container;
  private glow!: Image;
  private props!: Record<PropName, Image>;
  private page!: Image;
  private highlights: Image[] = [];
  private nextHighlight = 0;
  private steam: Image[] = [];
  private motes: Mote[] = [];
  private mugHeld = false;
  /** How far the set sits below its resting place; the entrance raises it. */
  private readonly rise = { y: 0 };

  /**
   * Three cameras, drawn in this order:
   *   main - unzoomed: the sky and the scrim, behind everything;
   *   film - the one the director moves and zooms;
   *   hud  - unzoomed: the frame and the screen furniture, over everything.
   *
   * Pinned objects (scrollFactor 0) are still ZOOMED by the camera that draws
   * them, about its centre. Drawn by the film camera, a close-up scaled the
   * clock eight times and pushed it clean off the screen, and on a phone -
   * where the wide shot zooms OUT - the sky stopped short of the edges.
   */
  private filmCamera!: Phaser.Cameras.Scene2D.Camera;
  private hudCamera!: Phaser.Cameras.Scene2D.Camera;

  // -- the frame ------------------------------------------------------------
  private vignette!: Image;
  private veil!: Phaser.GameObjects.Rectangle;
  private pauseDim!: Phaser.GameObjects.Rectangle;
  private barTop!: Phaser.GameObjects.Rectangle;
  private barBottom!: Phaser.GameObjects.Rectangle;
  private clockLabel!: Text;
  private clock!: Text;
  private caption!: Text;
  private levelLabel!: Text;
  private levelBar!: Phaser.GameObjects.Graphics;
  private levelHours!: Text;
  private worldLabel!: Text;
  private hint!: Text;
  private pausedLabel!: Text;
  private titleName!: Text;
  private titleSub!: Text;
  /** Resting opacity of each piece of screen furniture, for fades to return to. */
  private readonly hudAlpha = new Map<Text | Phaser.GameObjects.Graphics, number>();
  private levelRow = { x: 0, y: 0, barWidth: 0 };

  private avatar!: FocusAvatar;
  private director!: FocusCinematicDirector;
  /** The director's parts, surfaced for the test suite and the console. */
  machine!: AvatarBehaviorMachine;
  camera!: FocusCameraController;

  private paused = false;
  private leaving = false;
  /** Set once the screen furniture has faded in; captions cross-fade after that. */
  private hudShown = false;
  private captionText = '';
  private levelElapsed = 0;
  /** Scene-owned tweens (set, props, transitions), cleaned up on shutdown. */
  private readonly sceneTweens = new Set<Phaser.Tweens.Tween>();

  constructor() {
    super({ key: FocusScene.KEY });
  }

  create(data: FocusSceneData): void {
    this.sceneData = data;
    focusMode.active = true;
    this.leaving = false;
    this.paused = false;
    this.hudShown = false;
    this.mugHeld = false;
    this.captionText = '';
    this.levelElapsed = 0;
    this.nextHighlight = 0;
    this.motes = [];
    this.highlights = [];
    this.steam = [];
    this.hudAlpha.clear();

    // Which world you are studying in decides the room and how it is filmed.
    // Read once, on entry: travelling mid-session is not possible, and a room
    // that could change underneath a running scene would need rebuilding live.
    this.world = progression.currentWorld;
    const palette = WORLD_PALETTES[this.world.palette];

    // Before ANY image is created: Phaser binds a texture at construction and
    // an object made against a missing key keeps the green placeholder even
    // after the real texture arrives.
    ensureFocusProps(this, this.world.palette);

    // Order matters and is easy to get backwards: the scrim hides the WORLD,
    // so it goes down first; the backdrop is this scene's own sky, above it.
    this.scrim = this.cover().setAlpha(0);
    this.backdrop = this.add.graphics().setScrollFactor(0).setAlpha(0);

    this.buildSet(data, palette);
    this.buildFrame(palette);
    this.assignCameras();

    this.director = new FocusCinematicDirector({
      avatar: this.avatar,
      camera: this.filmCamera,
      veil: this.veil,
      cinematic: this.world.cinematic,
      props: (visible) => this.showProps(visible),
      onCue: (cue) => this.onCue(cue),
    });
    this.machine = this.director.machine;
    this.camera = this.director.camera;

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.input.keyboard?.on('keydown', this.onKey, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    fadeWorldHud(this, 0, FOCUS.enter.scrimMs);
    sfx.focusEnter();
    this.playEntrance();

    // Motes start once the scrim has covered the world, not while it is black.
    this.time.delayedCall(FOCUS.enter.scrimMs, () => {
      if (!this.leaving) this.startAmbient();
    });
  }

  override update(_time: number, delta: number): void {
    // Still directed while leaving: the finale is performed, not frozen. The
    // director is driven from here rather than from a timer, so a backgrounded
    // tab does not silently run through a dozen behaviours.
    this.director.update(delta);

    // The clock is READ, never advanced. FocusTimer owns it.
    this.clock.setText(sessionClockText(ui.focus?.liveSeconds ?? 0));

    // The laptop faces the avatar. Seen from behind them, that means its
    // screen faces the camera; from anywhere else, the back of the lid does.
    const laptop = this.avatar.facing === 'back' ? FOCUS_ART.laptopScreen : FOCUS_ART.laptop;
    if (this.props.laptop.texture.key !== laptop) this.props.laptop.setTexture(laptop);

    if (!this.leaving) {
      const behavior = this.machine.currentId;
      if (behavior && behavior !== 'settle') this.setCaption(CAPTIONS[behavior] ?? '');
    }

    this.levelElapsed += delta;
    if (this.levelElapsed >= FOCUS.hud.levelRefreshMs) {
      this.levelElapsed = 0;
      this.refreshLevel();
    }
  }

  // -- transitions -----------------------------------------------------------

  /**
   * Entering, in the order the eye can follow: the world goes and the frame
   * closes in; the set rises; the world's name comes up like a film's first
   * card; then the clock, so the number is the final beat.
   */
  private playEntrance(): void {
    const { enter, hud } = FOCUS;

    this.track(this.tweens.add({
      targets: [this.scrim, this.backdrop],
      alpha: 1,
      duration: enter.scrimMs,
      ease: 'Sine.easeInOut',
    }));
    this.track(this.tweens.add({
      targets: this.vignette,
      alpha: hud.vignette,
      duration: enter.scrimMs,
      ease: 'Sine.easeInOut',
    }));

    for (const bar of [this.barTop, this.barBottom]) {
      bar.setScale(1, 0);
      this.track(this.tweens.add({ targets: bar, scaleY: 1, duration: hud.letterboxMs, ease: 'Cubic.easeInOut' }));
    }

    const layers = [this.farLayer, this.stage, this.nearLayer];
    const riseAt = enter.scrimMs * 0.6;
    this.rise.y = enter.deskRisePx;
    this.positionLayers();
    for (const layer of layers) layer.setAlpha(0);

    this.track(this.tweens.add({
      targets: layers,
      alpha: 1,
      delay: riseAt,
      duration: enter.deskRiseMs,
      ease: 'Cubic.easeOut',
    }));
    this.track(this.tweens.add({
      targets: this.rise,
      y: 0,
      delay: riseAt,
      duration: enter.deskRiseMs,
      ease: 'Cubic.easeOut',
      onUpdate: () => this.positionLayers(),
      onComplete: () => {
        if (!this.leaving) this.director.start();
      },
    }));

    const titleAt = enter.scrimMs + hud.titleDelayMs;
    const titleOutAt = titleAt + hud.titleInMs + hud.titleHoldMs;
    for (const [title, alpha] of [[this.titleName, 1], [this.titleSub, 0.6]] as const) {
      this.track(this.tweens.add({ targets: title, alpha, delay: titleAt, duration: hud.titleInMs, ease: 'Sine.easeOut' }));
      this.track(this.tweens.add({ targets: title, alpha: 0, delay: titleOutAt, duration: hud.titleOutMs, ease: 'Sine.easeIn' }));
    }

    const hudAt = titleAt + hud.titleInMs;
    for (const [object, alpha] of this.hudAlpha) {
      this.track(this.tweens.add({ targets: object, alpha, delay: hudAt, duration: enter.timerFadeMs, ease: 'Sine.easeOut' }));
    }
    this.time.delayedCall(hudAt + enter.timerFadeMs, () => {
      this.hudShown = true;
    });
  }

  /** Leaving: a reaction, a small celebration, the frame opening back up, then out. */
  private exit(): void {
    if (this.leaving) return;
    this.leaving = true;
    const { exit, hud } = FOCUS;

    // Leaving from pause: the picture wakes up for the finale, but the CLOCK
    // stays paused — this scene never resumes it, so the pause is never
    // counted, and the server subtracts the open pause when the session closes.
    if (this.paused) {
      this.paused = false;
      for (const tween of this.sceneTweens) tween.resume();
      this.pausedLabel.setAlpha(0);
      this.track(this.tweens.add({ targets: this.pauseDim, alpha: 0, duration: hud.pauseDimMs, ease: 'Sine.easeOut' }));
    }

    this.director.finish();
    this.setCaption('session complete');
    this.track(this.tweens.add({
      targets: this.clock,
      scale: 1.12,
      duration: exit.clockPopMs,
      yoyo: true,
      ease: 'Back.easeOut',
    }));

    this.time.delayedCall(exit.holdMs, () => {
      const fading = [
        this.farLayer, this.stage, this.nearLayer, this.backdrop, this.vignette,
        this.pausedLabel, this.pauseDim, this.titleName, this.titleSub, ...this.hudAlpha.keys(),
      ];
      this.track(this.tweens.add({ targets: fading, alpha: 0, duration: exit.scrimMs, ease: 'Sine.easeIn' }));
      for (const bar of [this.barTop, this.barBottom]) {
        this.track(this.tweens.add({ targets: bar, scaleY: 0, duration: exit.scrimMs, ease: 'Cubic.easeIn' }));
      }
      fadeWorldHud(this, 1, exit.scrimMs);
      this.track(this.tweens.add({
        targets: this.scrim,
        alpha: 0,
        delay: exit.scrimMs * 0.5,
        duration: exit.scrimMs,
        ease: 'Sine.easeIn',
        onComplete: () => {
          const { onExit } = this.sceneData;
          this.scene.stop();
          onExit();
        },
      }));
    });
  }

  // -- input -----------------------------------------------------------------

  private onKey(event: KeyboardEvent): void {
    if (this.leaving) return;

    const key = event.key.toLowerCase();
    if (key === 'escape' || key === ' ') {
      this.exit();
      return;
    }
    if (key === 'p') this.togglePause();
  }

  private togglePause(): void {
    this.paused = !this.paused;
    const { paused } = this;

    this.director.setPaused(paused);
    // Paused time is not focus time: the session clock stops with everything
    // else, and the server is told so it does not count the gap either.
    this.sceneData.onPauseChange(paused);
    for (const tween of this.sceneTweens) paused ? tween.pause() : tween.resume();
    sfx.focusToggle(paused);

    // Created AFTER the loop above, so the dim itself is not paused.
    this.track(this.tweens.add({
      targets: this.pauseDim,
      alpha: paused ? FOCUS.hud.pauseDim : 0,
      duration: FOCUS.hud.pauseDimMs,
      ease: 'Sine.easeInOut',
    }));
    this.pausedLabel.setAlpha(paused ? 1 : 0);
    const captionAlpha = this.hudAlpha.get(this.caption) ?? 1;
    this.caption.setAlpha(paused ? captionAlpha * 0.4 : captionAlpha);
  }

  // -- the set ----------------------------------------------------------------

  /**
   * The room, in world coordinates, built once around the desk (see FOCUS_SET).
   * Nothing here knows the viewport exists — the camera decides what part of
   * it you can see, which is the whole point of building it in world space.
   */
  private buildSet(data: FocusSceneData, palette: WorldPalette): void {
    const set = FOCUS_SET;
    const room = this.world.palette;
    const { far, near } = FOCUS.parallax;

    // FAR: the back wall and its window, drifting slower than the desk as the
    // camera moves. Horizontal only — the wall meets the floor, and a vertical
    // difference would open a seam along it.
    const wall = this.add.image(0, set.floorY, FOCUS_ART.wall(room)).setOrigin(0.5, 1);
    const window = this.add.image(set.window.x, set.window.y, FOCUS_ART.window(room));
    this.farLayer = this.add.container(0, 0, [wall, window]).setScrollFactor(far, 1);

    // MIDDLE: the floor, the avatar behind the desk, the lamp's light over both,
    // then the props on the desk. The light used to sit under the wall, where
    // it was never visible at all.
    const floor = this.add.image(0, set.floorY, FOCUS_ART.floor(room)).setOrigin(0.5, 0);
    this.avatar = new FocusAvatar(this, {
      x: set.avatar.x,
      y: set.avatar.y,
      bodyColor: data.bodyColor,
      hat: data.hat,
    });
    const desk = this.add.image(set.desk.x, set.desk.y, FOCUS_ART.desk).setOrigin(0.5, 0);
    this.glow = this.add
      .image(set.glow.x, set.glow.y, FOCUS_ART.glow)
      .setDisplaySize(set.glow.size, set.glow.size)
      .setTint(hex(palette.glow))
      .setBlendMode(Phaser.BlendModes.ADD);

    // The mug stays on the desk whatever you are doing; the rest come and go
    // with the task in hand.
    const prop = (name: PropName) =>
      this.add
        .image(set.props[name].x, set.props[name].y, FOCUS_ART[name])
        .setOrigin(0.5, 1)
        .setAlpha(name === 'mug' ? 1 : 0);
    this.props = {
      book: prop('book'),
      laptop: prop('laptop'),
      paper: prop('paper'),
      pen: prop('pen'),
      mug: prop('mug'),
    };

    this.page = this.add.image(set.bookSpine.x, set.bookSpine.y, FOCUS_ART.page).setOrigin(0, 0.5).setAlpha(0);
    this.highlights = set.highlightLines.map((y) =>
      this.add.image(set.highlightX, y, FOCUS_ART.highlight).setOrigin(0, 0.5).setAlpha(0).setScale(0, 1));
    this.steam = [0, 1, 2].map(() =>
      this.add.image(set.steam.x, set.steam.y, FOCUS_ART.puff).setAlpha(0).setTint(hex(COLORS.flowerWhite)));
    const lamp = this.add.image(set.lamp.x, set.lamp.y, FOCUS_ART.lamp).setOrigin(0.5, 1);

    // Order matters: the avatar sits BEHIND the desk, props rest ON it.
    this.stage = this.add.container(0, 0, [
      floor, this.avatar.container, desk, this.glow,
      ...Object.values(this.props), this.page, ...this.highlights, ...this.steam, lamp,
    ]);

    // NEAR: a few larger motes between the lens and the desk, sliding past
    // faster than the room when the camera moves. The rest drift in the room.
    this.nearLayer = this.add.container(0, 0).setScrollFactor(near, near);

    const nearCount = Math.round(FOCUS.ambient.moteCount * FOCUS.parallax.nearMoteShare);
    for (let i = 0; i < FOCUS.ambient.moteCount; i += 1) {
      const isNear = i < nearCount;
      // Soft and round rather than a sharp pixel: at a close-up's zoom a pixel
      // mote is a block the size of a fingertip. Near the lens they are larger
      // still — out of focus, which is most of what sells the depth.
      const image = this.add
        .image(0, 0, FOCUS_ART.puff)
        .setAlpha(0)
        .setTint(hex(palette.mote))
        .setBlendMode(Phaser.BlendModes.ADD);
      (isNear ? this.nearLayer : this.stage).add(image);
      this.motes.push({ image, near: isNear });
    }
  }

  /**
   * Keep the three layers in register.
   *
   * A layer that scrolls at a different rate is also scaled about the camera's
   * centre from a different point, which on its own would push it off by an
   * amount that depends on the size of the window. This offset cancels exactly
   * that, so the layers line up when the camera is on the desk and only
   * DIVERGE as it moves — which is the parallax, and all of the parallax.
   */
  private positionLayers(): void {
    const { width, height } = this.filmCamera;
    const { far, near } = FOCUS.parallax;
    this.farLayer.setPosition(((1 - far) * width) / 2, this.rise.y);
    this.stage.setPosition(0, this.rise.y);
    this.nearLayer.setPosition(((1 - near) * width) / 2, ((1 - near) * height) / 2 + this.rise.y);
  }

  /** Every object is drawn by exactly one of the three cameras. */
  private assignCameras(): void {
    const { width, height } = this.scale.gameSize;
    this.filmCamera = this.cameras.add(0, 0, width, height);
    this.hudCamera = this.cameras.add(0, 0, width, height);

    const back = [this.scrim, this.backdrop];
    const film = [this.farLayer, this.stage, this.nearLayer];
    const hud = [
      this.vignette, this.veil, this.pauseDim, this.barTop, this.barBottom,
      this.pausedLabel, this.titleName, this.titleSub, ...this.hudAlpha.keys(),
    ];
    this.cameras.main.ignore([...film, ...hud]);
    this.filmCamera.ignore([...back, ...hud]);
    this.hudCamera.ignore([...back, ...film]);
  }

  /** A pinned full-screen shape in the fade colour. */
  private cover(): Phaser.GameObjects.Rectangle {
    return this.add
      .rectangle(0, 0, 1, 1, hex(COLORS.transitionFade), 1)
      .setOrigin(0, 0)
      .setScrollFactor(0);
  }

  // -- the frame ---------------------------------------------------------------

  /**
   * The screen furniture. All of it is pinned with scrollFactor 0, so no camera
   * move can carry the session clock off the edge of the frame — a timer you
   * cannot see during a push-in would be a straightforwardly worse product
   * than the static screen this replaced.
   */
  private buildFrame(palette: WorldPalette): void {
    const text = (content: string, size: number, color: string = COLORS.hudText) =>
      this.add
        .text(0, 0, content, { fontFamily: TYPOGRAPHY.dialogueFont, fontSize: `${size}px`, color })
        .setScrollFactor(0)
        .setShadow(0, 2, COLORS.transitionFade, 6, false, true);

    this.vignette = this.add.image(0, 0, FOCUS_ART.vignette).setScrollFactor(0).setAlpha(0);
    this.veil = this.cover().setAlpha(0);
    this.pauseDim = this.cover().setAlpha(0);
    this.barTop = this.cover();
    this.barBottom = this.cover().setOrigin(0, 1);

    const small = TYPOGRAPHY.hudFontSize - 2;
    this.clockLabel = text('FOCUS', small, palette.accent).setOrigin(0, 0.5).setLetterSpacing(4);
    this.clock = text('00:00:00', 40).setOrigin(0, 0.5);
    this.caption = text('', TYPOGRAPHY.hudFontSize).setOrigin(0, 0.5);
    this.levelLabel = text('', small).setOrigin(0, 0.5).setLetterSpacing(1);
    this.levelBar = this.add.graphics().setScrollFactor(0);
    this.levelHours = text('', small).setOrigin(0, 0.5);
    this.worldLabel = text(this.world.name.toUpperCase(), small).setOrigin(0, 0.5).setLetterSpacing(3);
    this.hint = text('', small).setOrigin(1, 0.5);

    this.pausedLabel = text('PAUSED  —  focus time is not counting', TYPOGRAPHY.hudFontSize, COLORS.interactBubbleMark)
      .setOrigin(0, 0.5)
      .setAlpha(0);
    this.titleName = text(this.world.name.toUpperCase(), 32).setOrigin(0.5).setLetterSpacing(8).setAlpha(0);
    this.titleSub = text(this.world.description, TYPOGRAPHY.hudFontSize).setOrigin(0.5).setAlign('center').setAlpha(0);

    const resting: Array<[Text | Phaser.GameObjects.Graphics, number]> = [
      [this.clockLabel, 0.95], [this.clock, 1], [this.caption, 0.65],
      [this.levelLabel, 0.75], [this.levelBar, 0.9], [this.levelHours, 0.75],
      [this.worldLabel, 0.5], [this.hint, 0.45],
    ];
    for (const [object, alpha] of resting) {
      object.setAlpha(0);
      this.hudAlpha.set(object, alpha);
    }
  }

  /**
   * Everything on screen is positioned from the live canvas size, never from
   * constants, so the frame holds from a phone to an ultrawide.
   */
  private layout(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;
    const { hud } = FOCUS;
    const compact = width < 760 || height < 520;

    this.filmCamera.setSize(width, height);
    this.hudCamera.setSize(width, height);
    for (const cover of [this.scrim, this.veil, this.pauseDim]) cover.setSize(width, height);
    this.drawBackdrop(width, height);
    this.vignette.setPosition(width / 2, height / 2).setDisplaySize(width, height);

    // The letterbox is the frame of a film. The HUD lives IN the bars where it
    // can, so the picture between them stays clean.
    const barHeight = Math.round(height * (compact ? hud.letterboxCompact : hud.letterbox));
    this.barTop.setSize(width, barHeight);
    this.barBottom.setPosition(0, height).setSize(width, barHeight);

    const margin = Math.round(Phaser.Math.Clamp(width * 0.045, 18, 56));
    const clockSize = Math.round(Phaser.Math.Clamp(width * 0.034, 24, 46));
    const small = TYPOGRAPHY.hudFontSize - (compact ? 3 : 2);

    // Top: where you are, and how to leave.
    const topY = barHeight >= 24 ? barHeight / 2 : barHeight + 14;
    this.worldLabel.setFontSize(small).setPosition(margin, topY);
    this.hint
      .setFontSize(small)
      .setText(compact ? 'P pause · ESC finish' : 'P  pause     ESC  finish session')
      .setPosition(width - margin, topY);

    // Lower third, built upward from the bottom bar: level, caption, clock.
    const levelY = height - barHeight - Math.round(margin * 0.6);
    for (const label of [this.levelLabel, this.levelHours, this.clockLabel]) label.setFontSize(small);
    this.levelRow = { x: margin, y: levelY, barWidth: compact ? 88 : 132 };

    const captionY = levelY - small * 2;
    this.caption.setFontSize(compact ? small + 1 : TYPOGRAPHY.hudFontSize).setPosition(margin, captionY);

    const clockY = captionY - clockSize * 0.95;
    this.clockLabel.setPosition(margin, clockY);
    this.clock.setFontSize(clockSize).setPosition(margin + this.clockLabel.width + 12, clockY);

    // With the clock it qualifies, not over the character it would hide.
    this.pausedLabel.setFontSize(small).setPosition(margin, clockY - clockSize * 0.85);

    // High, above the desk and the window: the card must not sit on the person.
    const titleSize = Math.round(Phaser.Math.Clamp(width * 0.028, 20, 38));
    const titleY = Math.max(barHeight + titleSize, height * 0.17);
    this.titleName.setFontSize(titleSize).setPosition(width / 2, titleY);
    this.titleSub
      .setFontSize(small)
      .setWordWrapWidth(Math.min(width * 0.8, 560))
      .setPosition(width / 2, titleY + titleSize * 1.3);

    this.positionLayers();
    this.refreshLevel();
  }

  /** The sky behind everything. Pinned: its edge must never slide into view. */
  private drawBackdrop(width: number, height: number): void {
    const theme = WORLD_PALETTES[this.world.palette];
    const top = mix(theme.skyTop, COLORS.transitionFade, 0.25);
    const bottom = mix(theme.skyBottom, COLORS.transitionFade, 0.35);
    const bands = 28;

    this.backdrop.clear();
    for (let i = 0; i < bands; i += 1) {
      this.backdrop.fillStyle(hex(mix(top, bottom, i / (bands - 1))), 1);
      this.backdrop.fillRect(0, (height / bands) * i, width, height / bands + 1);
    }
  }

  /**
   * "LV.03 ▰▰▰▱▱ 27.4h" — real hours, from the same total the world map reads,
   * with the running session on top so the bar visibly creeps while you work.
   */
  private refreshLevel(): void {
    const seconds = displayedFocusSeconds(ui.focus);
    const { x, y, barWidth } = this.levelRow;
    this.levelBar.clear();

    if (seconds === null) {
      // Offline: nothing is being recorded, so no number is shown as if it were.
      this.levelLabel.setText('offline · not recorded').setPosition(x, y);
      this.levelHours.setText('');
      return;
    }

    const level = focusLevel(seconds);
    this.levelLabel.setText(level.label).setPosition(x, y);
    const barX = x + this.levelLabel.width + 10;
    drawLevelBar(
      this.levelBar, barX, y - 3, barWidth, 6, level.fraction,
      hex(WORLD_PALETTES[this.world.palette].accent), hex(COLORS.hudText),
    );
    this.levelHours.setText(level.hoursText).setPosition(barX + barWidth + 10, y);
  }

  /** A caption change is a quick cross-fade, not a text swap mid-read. */
  private setCaption(text: string): void {
    if (text === this.captionText) return;
    this.captionText = text;

    if (!this.hudShown) {
      this.caption.setText(text);
      return;
    }

    const swapMs = FOCUS.hud.captionSwapMs;
    this.track(this.tweens.add({
      targets: this.caption,
      alpha: 0,
      duration: swapMs,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.caption.setText(this.captionText);
        const resting = this.hudAlpha.get(this.caption) ?? 1;
        this.track(this.tweens.add({
          targets: this.caption,
          alpha: this.paused ? resting * 0.4 : resting,
          duration: swapMs,
          ease: 'Sine.easeOut',
        }));
      },
    }));
  }

  // -- props ------------------------------------------------------------------

  private showProps(visible: PropName[]): void {
    for (const [name, prop] of Object.entries(this.props) as [PropName, Image][]) {
      // The mug stays on the desk until a hand picks it up.
      const shown = name === 'mug' ? !this.mugHeld : visible.includes(name);
      this.fadeTo(prop, shown ? 1 : 0, FOCUS.props.fadeMs);
    }
  }

  /** The director says something happened on the desk; make it happen. */
  private onCue(cue: FocusCue): void {
    const timing = FOCUS.props;
    const set = FOCUS_SET;

    switch (cue) {
      case 'pageTurn': {
        // Turning away a page takes its highlights with it.
        for (const mark of this.highlights) this.fadeTo(mark, 0, timing.fadeMs);
        this.page.setAlpha(1).setScale(1, 1).setY(set.bookSpine.y);
        // Hinged at the spine: flat on the right, edge-on, flat on the left,
        // lifting a little on the way over.
        this.track(this.tweens.add({
          targets: this.page,
          scaleX: -1,
          duration: timing.pageTurnMs,
          ease: 'Sine.easeInOut',
          onComplete: () => this.page.setAlpha(0),
        }));
        this.track(this.tweens.add({
          targets: this.page,
          y: set.bookSpine.y - timing.pageLift,
          duration: timing.pageTurnMs / 2,
          yoyo: true,
          ease: 'Sine.easeOut',
        }));
        break;
      }

      case 'highlight': {
        const mark = this.highlights[this.nextHighlight % this.highlights.length];
        this.nextHighlight += 1;
        if (!mark) break;
        mark.setAlpha(1).setScale(0, 1);
        this.track(this.tweens.add({ targets: mark, scaleX: 1, duration: timing.highlightMs, ease: 'Sine.easeInOut' }));
        this.track(this.tweens.add({
          targets: mark,
          alpha: 0,
          delay: timing.highlightMs + timing.highlightHoldMs,
          duration: timing.highlightFadeMs,
          ease: 'Sine.easeIn',
        }));
        break;
      }

      case 'paperShuffle':
        this.track(this.tweens.add({
          targets: this.props.paper,
          y: set.props.paper.y - 2,
          angle: timing.shuffleAngle,
          duration: timing.shuffleMs,
          yoyo: true,
          repeat: 1,
          ease: 'Sine.easeInOut',
        }));
        break;

      case 'mugLift':
        this.mugHeld = true;
        this.fadeTo(this.props.mug, 0, timing.fadeMs);
        for (const puff of this.steam) puff.setVisible(false);
        this.avatar.hold('mug', timing.holdMs);
        break;

      case 'mugDown':
        this.mugHeld = false;
        this.fadeTo(this.props.mug, 1, timing.fadeMs);
        for (const puff of this.steam) puff.setVisible(true);
        this.avatar.hold(null);
        break;

      case 'penTap':
        // Heard, not seen: the tap is in the hand already.
        break;
    }
  }

  private fadeTo(target: Image, alpha: number, duration: number): void {
    if (target.alpha === alpha) return;
    this.track(this.tweens.add({ targets: target, alpha, duration, ease: 'Sine.easeInOut' }));
  }

  // -- ambience ----------------------------------------------------------------

  /** Motes, the lamp's breath and the mug's steam, once the scene is up. */
  private startAmbient(): void {
    for (const mote of this.motes) this.driftMote(mote);

    // The lamp breathes via scale rather than alpha: alpha is what the entrance
    // and exit fades animate, and two tweens on one property fight.
    const { ambient } = FOCUS;
    this.track(this.tweens.add({
      targets: this.glow,
      scale: this.glow.scaleX * (1 + ambient.lampPulseScale),
      duration: ambient.lampPulseMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    }));

    const { steam } = FOCUS_SET;
    this.steam.forEach((puff, i) => {
      this.track(this.tweens.add({
        targets: puff,
        y: { from: steam.y, to: steam.y - ambient.steamRise },
        x: { from: steam.x + i - 1, to: steam.x + (i - 1) * 3 },
        alpha: { from: 0.35, to: 0 },
        scale: { from: 0.25, to: 0.7 },
        duration: ambient.steamMs,
        delay: (ambient.steamMs / this.steam.length) * i,
        repeat: -1,
        ease: 'Sine.easeOut',
      }));
    });
  }

  /**
   * One mote's drift, in the way this world's particles move — dust rises,
   * snow falls, fireflies wander and blink, stars barely move and twinkle.
   *
   * A fixed pool, reused forever: each mote retargets itself on completion
   * rather than being destroyed and replaced, because a two-hour session at one
   * spawn per second is seven thousand objects nobody asked for.
   */
  private driftMote(mote: Mote, immediate = false): void {
    if (this.leaving) return;

    const p = FOCUS.ambient.particles[this.world.cinematic.particles];
    const box = FOCUS_SET.motes;
    const { image, near } = mote;
    const { Between, FloatBetween } = Phaser.Math;

    const x = Between(box.minX, box.maxX);
    const y = Between(box.minY, box.maxY);
    const [minScale, maxScale] = near ? FOCUS.parallax.nearMoteScale : FOCUS.ambient.moteScale;
    image.setPosition(x, y).setScale(FloatBetween(minScale, maxScale)).setAlpha(0);

    const peak = FloatBetween(p.alpha[0], p.alpha[1]) * (near ? FOCUS.parallax.nearMoteAlpha : 1);
    const duration = Between(p.minMs, p.maxMs);
    const alpha = p.twinkleMs > 0
      ? {
        from: 0,
        to: peak,
        duration: p.twinkleMs,
        yoyo: true,
        repeat: Math.max(0, Math.floor(duration / (p.twinkleMs * 2)) - 1),
      }
      : { from: 0, to: peak, duration: duration / 2, yoyo: true };

    const tween = this.tweens.add({
      targets: image,
      x: x + Between(-p.sway, p.sway),
      y: y - Between(p.rise[0], p.rise[1]),
      alpha,
      duration,
      delay: immediate ? 0 : Between(0, FOCUS.ambient.moteStaggerMs),
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.sceneTweens.delete(tween);
        this.driftMote(mote, true);
      },
    });
    this.track(tween);
  }

  private track(tween: Phaser.Tweens.Tween): Phaser.Tweens.Tween {
    this.sceneTweens.add(tween);
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.sceneTweens.delete(tween));
    return tween;
  }

  /**
   * Everything created here is released here.
   *
   * A focus session can run for hours and is entered and left repeatedly in one
   * sitting, so a leak here is not theoretical — it compounds every time
   * somebody sits down.
   */
  private teardown(): void {
    focusMode.active = false;

    // Unconditionally: a scene stopped mid-fade would otherwise leave the HUD
    // at whatever alpha it had reached, with no way back.
    restoreWorldHud(this);

    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.input.keyboard?.off('keydown', this.onKey, this);

    this.director?.destroy();
    // Whether or not the camera manager resets itself on shutdown, these two
    // must not survive into the next session and stack up.
    if (this.filmCamera) this.cameras.remove(this.filmCamera);
    if (this.hudCamera) this.cameras.remove(this.hudCamera);
    for (const tween of this.sceneTweens) tween.stop();
    this.sceneTweens.clear();

    this.avatar?.destroy();
    this.motes = [];
    this.highlights = [];
    this.steam = [];
  }
}

/** What the caption says for each behaviour. Small, and quietly funny. */
const CAPTIONS: Partial<Record<BehaviorId, string>> = {
  reading: 'reading',
  writing: 'writing it down',
  typing: 'typing',
  thinking: 'thinking',
  studying: 'studying',
  takingNotes: 'taking notes',
  lookingAtScreen: 'staring at the screen',
  highlighting: 'highlighting the good bit',
  turningPage: 'next page',
  scrolling: 'scrolling back through it',
  organizingNotes: 'squaring up the notes',
  penTapping: 'tapping the pen',
  confused: 'confused',
  struggling: 'struggling with this bit',
  thinkingHard: 'thinking hard',
  realising: 'oh — right',
  zonedOut: 'zoned out',
  distracted: 'briefly distracted',
  tired: 'a bit tired',
  rubbingEyes: 'resting the eyes',
  wristStretch: 'loosening the wrists',
  lookingAround: 'looking around',
  stretching: 'stretching',
  smallBreak: 'taking a breath',
  sipping: 'coffee',
  happyWithProgress: 'happy with that',
  celebration: 'small victory',
};

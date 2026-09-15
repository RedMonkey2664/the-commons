/**
 * The journey — a map of the worlds your focus time opens, and the rocket that
 * takes you between them.
 *
 * An overlay scene, like Focus Mode, for the same reason: the zone underneath
 * holds the room connection, so the world keeps running while you look at the
 * map, and nobody sees you vanish.
 *
 * Reads progression, never writes the total. The only thing this screen can
 * change is WHICH unlocked world you are in — travel — and only once the
 * rocket's destination is genuinely unlocked (or in DEV, with a bypass the
 * developer panel asks for explicitly).
 *
 * Choreography follows the rest of Focus Mode: GSAP for the launch sequence,
 * which is one long authored timeline that has to pause and die as a unit;
 * Phaser tweens for small independent loops (the rocket's idle bob, the
 * planets breathing); Phaser particles for exhaust and sparks.
 */

import Phaser from 'phaser';
import { gsap } from 'gsap';
import {
  COLORS,
  TYPOGRAPHY,
  WORLD_PALETTES,
  WORLD_PROGRESS_CONFIG,
  hex,
  isWorldUnlocked,
  mix,
  type WorldDefinition,
} from '@commons/shared';
import { ROCKET_ART, ensureRocketArt } from '../art/rocketArt';
import { DEV_MODE, PROGRESSION_EVENTS, progression } from '../systems/Progression';
import { sfx } from '../systems/Sfx';
import { durationText } from '../ui/FocusTimer';
import { ui } from '../ui/UIScene';
import { fadeWorldHud, restoreWorldHud } from '../ui/worldHud';

/** Whether the map owns the screen. ZoneScene checks this like focusMode. */
export const worldMap = { active: false };

interface PlanetView {
  world: WorldDefinition;
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  hours: Phaser.GameObjects.Text;
  lock?: Phaser.GameObjects.Image;
  halo: Phaser.GameObjects.Arc;
  x: number;
  y: number;
}

export class WorldMapScene extends Phaser.Scene {
  static readonly KEY = 'WorldMapScene';

  private stars: Phaser.GameObjects.Image[] = [];
  private backdrop!: Phaser.GameObjects.Graphics;
  private path!: Phaser.GameObjects.Graphics;
  private planets: PlanetView[] = [];

  private title!: Phaser.GameObjects.Text;
  private totalLabel!: Phaser.GameObjects.Text;
  private totalValue!: Phaser.GameObjects.Text;
  private stats!: Phaser.GameObjects.Text;
  private devBadge!: Phaser.GameObjects.Text;

  private card!: Phaser.GameObjects.Container;
  private cardFrame!: Phaser.GameObjects.Graphics;
  private cardName!: Phaser.GameObjects.Text;
  private cardStatus!: Phaser.GameObjects.Text;
  private cardBody!: Phaser.GameObjects.Text;

  private barFrame!: Phaser.GameObjects.Graphics;
  private barLabel!: Phaser.GameObjects.Text;
  private barValue!: Phaser.GameObjects.Text;
  private barRemaining!: Phaser.GameObjects.Text;
  private readonly bar = { fill: 0 };

  private rocket!: Phaser.GameObjects.Image;
  private flame!: Phaser.GameObjects.Image;
  private rocketHint!: Phaser.GameObjects.Text;
  private exhaust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hint!: Phaser.GameObjects.Text;

  private selected = 0;
  private launching = false;
  private closing = false;
  private shownTotal = { seconds: 0 };

  /** Every long-lived Phaser tween, so shutdown can stop them all. */
  private readonly loops = new Set<Phaser.Tweens.Tween>();
  /** The one GSAP timeline this scene may hold: the launch. */
  private launchTl?: gsap.core.Timeline;

  private readonly onProgress = () => this.refreshAll(true);

  constructor() {
    super({ key: WorldMapScene.KEY });
  }

  create(): void {
    worldMap.active = true;
    this.launching = false;
    this.closing = false;
    this.planets = [];
    this.stars = [];

    ensureRocketArt(this);
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');

    // The camera pans during a launch, and anything that scrolls with it will
    // eventually show its edge — so the sky is pinned to the screen, the stars
    // drift at a fraction for parallax, and only the map itself moves.
    this.backdrop = this.add.graphics().setScrollFactor(0);
    this.createStars();
    this.path = this.add.graphics();

    for (const world of WORLD_PROGRESS_CONFIG) this.createPlanet(world);
    this.createHeader();
    this.createCard();
    this.createBar();
    this.createRocket();

    this.hint = this.text(TYPOGRAPHY.hudFontSize, COLORS.hudText).setAlpha(0.45).setOrigin(0.5);
    this.devBadge = this.text(TYPOGRAPHY.hudFontSize - 2, COLORS.interactBubbleMark).setOrigin(0, 0);

    // Pinned: a camera move must never carry the total or the progress bar off
    // the edge of the frame.
    for (const fixed of [
      this.title, this.totalLabel, this.totalValue, this.stats, this.hint, this.devBadge,
      this.card, this.barFrame, this.barLabel, this.barValue, this.barRemaining,
    ]) fixed.setScrollFactor(0);

    // Start on the world you are in, so the card opens on something you own.
    this.selected = Math.max(0, WORLD_PROGRESS_CONFIG.findIndex((w) => w.id === progression.currentWorld.id));
    this.shownTotal.seconds = 0;

    this.layout();
    this.refreshAll(false);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.input.keyboard?.on('keydown', this.onKey, this);
    progression.on(PROGRESSION_EVENTS.progressChanged, this.onProgress);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    fadeWorldHud(this, 0, 320);
    this.playEntrance();

    // Pull the latest figure; the screen is already drawn from the cached one.
    void progression.refresh();
  }

  // -- entrance / exit ----------------------------------------------------------

  private playEntrance(): void {
    this.cameras.main.setAlpha(0);
    this.cameras.main.setZoom(0.94);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, zoom: 1, duration: 480, ease: 'Cubic.easeOut' });

    // The total counts up from zero on open. You see the whole journey, then
    // where you are on it — the number is the reward, so it gets the motion.
    this.tweens.add({
      targets: this.shownTotal,
      seconds: progression.focusSeconds,
      delay: 220,
      duration: 1200,
      ease: 'Cubic.easeOut',
      onUpdate: () => this.totalValue.setText(durationText(this.shownTotal.seconds)),
    });

    this.planets.forEach((planet, i) => {
      planet.image.setScale(0);
      this.tweens.add({ targets: planet.image, scale: 1, delay: 180 + i * 90, duration: 520, ease: 'Back.easeOut' });
    });
  }

  private close(): void {
    if (this.closing || this.launching) return;
    this.closing = true;
    sfx.uiClose();
    fadeWorldHud(this, 1, 320);
    this.tweens.add({
      targets: this.cameras.main,
      alpha: 0,
      zoom: 0.96,
      duration: 320,
      ease: 'Sine.easeIn',
      onComplete: () => this.scene.stop(),
    });
  }

  // -- input ----------------------------------------------------------------------

  private onKey(event: KeyboardEvent): void {
    if (this.launching || this.closing) return;
    const key = event.key.toLowerCase();

    if (key === 'escape' || key === 'j') this.close();
    else if (key === 'arrowright' || key === 'd') this.select(this.selected + 1);
    else if (key === 'arrowleft' || key === 'a') this.select(this.selected - 1);
    else if (key === ' ' || key === 'enter') this.tryLaunch();
  }

  private select(index: number): void {
    const next = Phaser.Math.Clamp(index, 0, this.planets.length - 1);
    if (next === this.selected) return;
    this.selected = next;
    sfx.uiOpen();
    this.refreshCard();
    this.refreshHalos();
  }

  // -- launch -----------------------------------------------------------------------

  /** Launch to the rocket's destination. Public so the dev panel can test it. */
  tryLaunch(bypassTo?: WorldDefinition): void {
    const destination = bypassTo ?? progression.destination;
    if (!destination || this.launching) {
      if (!destination) this.nudgeRocket();
      return;
    }
    this.launch(destination, bypassTo !== undefined);
  }

  /**
   * The trip. One GSAP timeline, so it plays, pauses and dies as a single
   * thing — and so that the scene closing mid-flight kills it rather than
   * leaving a rocket flying over the next screen.
   *
   *   power up -> lift off -> follow -> travel -> descend -> land -> reveal
   */
  private launch(destination: WorldDefinition, bypass: boolean): void {
    const target = this.planets.find((p) => p.world.id === destination.id);
    if (!target) return;

    this.launching = true;
    progression.noteLaunch(destination);
    this.card.setAlpha(0.35);
    this.rocketHint.setAlpha(0);

    const cam = this.cameras.main;
    const startX = this.rocket.x;
    const startY = this.rocket.y;
    const peakX = (startX + target.x) / 2;
    const peakY = Math.min(startY, target.y) - 140;
    const landX = target.x;
    const landY = target.y - target.image.displayHeight * 0.5 - 18;

    const flight = { t: 0 };
    const shake = { x: 0 };

    this.launchTl?.kill();
    const tl = gsap.timeline({
      onComplete: () => this.arrive(destination, bypass),
    });

    // 1. POWER UP. The anticipation: engine lights, a tremor, sparks.
    tl.call(() => {
      sfx.uiOpen();
      this.exhaust.start();
      this.flame.setVisible(true);
    });
    tl.to(this.flame, { scaleY: 1.6, scaleX: 1.2, duration: 0.7, ease: 'power2.in' }, 0);
    tl.to(shake, {
      x: 1,
      duration: 0.8,
      ease: 'none',
      onUpdate: () => this.rocket.setX(startX + Math.sin(shake.x * 60) * 1.4 * shake.x),
    }, 0);
    tl.call(() => this.sparks.explode(14, startX, startY + 22), undefined, 0.55);

    // 2+3+4. LIFT OFF, FOLLOW, TRAVEL — along a quadratic arc, with the camera
    //        leaning in the direction of travel rather than chasing the rocket
    //        dead-centre. A camera that follows exactly reads as the world moving.
    tl.to(flight, {
      t: 1,
      duration: 2.4,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = flight.t;
        const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * peakX + t * t * landX;
        const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * peakY + t * t * landY;
        const dx = 2 * (1 - t) * (peakX - startX) + 2 * t * (landX - peakX);
        const dy = 2 * (1 - t) * (peakY - startY) + 2 * t * (landY - peakY);
        if (!this.scene.isActive()) return;
        this.rocket.setPosition(x, y).setRotation(Math.atan2(dy, dx) + Math.PI / 2);
        this.placeFlame();
        cam.setScroll((x - this.scale.width / 2) * 0.18, (y - this.scale.height / 2) * 0.12);
      },
    }, 0.85);
    tl.to(cam, { zoom: 1.08, duration: 1.2, ease: 'sine.inOut' }, 0.85);

    // 5. DESCEND. Upright again, engine easing off as it drops onto the world.
    tl.to(this.rocket, { rotation: 0, duration: 0.5, ease: 'power2.out' }, 2.75);
    tl.to(this.flame, { scaleY: 0.7, scaleX: 0.9, duration: 0.6, ease: 'power2.out' }, 2.9);

    // 6. LAND. Engine off, a puff, the camera settles home.
    tl.call(() => {
      this.exhaust.stop();
      this.sparks.explode(18, landX, landY + 22);
      this.flame.setVisible(false);
    }, undefined, 3.35);
    tl.to(cam, { scrollX: 0, scrollY: 0, zoom: 1, duration: 0.9, ease: 'power2.inOut' }, 3.35);

    this.launchTl = tl;
  }

  /** 7. REVEAL. The new world is yours; the map re-lays itself around it. */
  private arrive(destination: WorldDefinition, bypass: boolean): void {
    this.launchTl = undefined;
    progression.enterWorld(destination.id, bypass);
    progression.markCelebrated(destination.id);

    const planet = this.planets.find((p) => p.world.id === destination.id);
    if (planet) {
      const ring = this.add.circle(planet.x, planet.y, planet.image.displayWidth * 0.55);
      ring.setStrokeStyle(3, hex(WORLD_PALETTES[destination.palette].accent), 1).setFillStyle(0, 0);
      this.tweens.add({ targets: ring, scale: 1.9, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    }

    ui.popup?.show(`Welcome to ${destination.name}`, { iconColor: WORLD_PALETTES[destination.palette].accent });

    this.selected = WORLD_PROGRESS_CONFIG.findIndex((w) => w.id === destination.id);
    this.launching = false;
    this.card.setAlpha(1);
    this.refreshAll(true);
  }

  /** Nothing to launch to: a small, honest shrug rather than silence. */
  private nudgeRocket(): void {
    this.tweens.add({ targets: this.rocket, angle: { from: -6, to: 6 }, duration: 70, yoyo: true, repeat: 2, onComplete: () => this.rocket.setAngle(0) });
    const next = progression.progress.next;
    ui.popup?.show(
      next ? `${durationText(progression.progress.remainingSeconds)} of focus to reach ${next.name}` : 'Every world is yours',
      { iconColor: COLORS.statusAfk },
    );
  }

  // -- building -------------------------------------------------------------------

  private text(size: number, color: string = COLORS.hudText): Phaser.GameObjects.Text {
    return this.add.text(0, 0, '', { fontFamily: TYPOGRAPHY.dialogueFont, fontSize: `${size}px`, color });
  }

  private createStars(): void {
    // A fixed pool. Twinkle is a handful of long loops, not a timer per star.
    for (let i = 0; i < 90; i += 1) {
      const star = this.add
        .image(0, 0, ROCKET_ART.star)
        .setAlpha(Phaser.Math.FloatBetween(0.15, 0.6))
        .setScrollFactor(Phaser.Math.FloatBetween(0.05, 0.25));
      this.stars.push(star);
    }
    for (let i = 0; i < 12; i += 1) {
      const star = this.stars[i * 7];
      if (!star) continue;
      this.track(this.tweens.add({
        targets: star,
        alpha: 0.9,
        duration: Phaser.Math.Between(1400, 3200),
        delay: Phaser.Math.Between(0, 3000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }));
    }
  }

  private createPlanet(world: WorldDefinition): void {
    const accent = WORLD_PALETTES[world.palette].accent;
    const halo = this.add.circle(0, 0, 44, hex(accent), 0.14).setStrokeStyle(2, hex(accent), 0.7).setVisible(false);
    const image = this.add.image(0, 0, ROCKET_ART.planet(world.palette));
    const label = this.text(TYPOGRAPHY.hudFontSize, COLORS.hudText).setOrigin(0.5, 0);
    const hours = this.text(TYPOGRAPHY.hudFontSize - 2, COLORS.hudText).setOrigin(0.5, 0).setAlpha(0.55);
    const lock = world.requiredFocusHours > 0 ? this.add.image(0, 0, ROCKET_ART.lock).setScale(1.5) : undefined;

    image.setInteractive({ useHandCursor: true });
    image.on('pointerdown', () => this.select(this.planets.findIndex((p) => p.world.id === world.id)));

    // Each world breathes at its own pace, so the row never pulses in unison.
    this.track(this.tweens.add({
      targets: image,
      y: '-=3',
      duration: 2600 + this.planets.length * 370,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    }));

    this.planets.push({ world, image, label, hours, lock, halo, x: 0, y: 0 });
  }

  private createHeader(): void {
    this.title = this.text(TYPOGRAPHY.hudFontSize - 1).setOrigin(0.5).setAlpha(0.55);
    this.title.setText('YOUR JOURNEY');
    this.totalLabel = this.text(TYPOGRAPHY.hudFontSize - 1).setOrigin(0.5).setAlpha(0.6);
    this.totalLabel.setText('TOTAL FOCUS');
    this.totalValue = this.text(52).setOrigin(0.5);
    this.stats = this.text(TYPOGRAPHY.hudFontSize - 1).setOrigin(0.5).setAlpha(0.7);
  }

  private createCard(): void {
    this.cardFrame = this.add.graphics();
    this.cardName = this.text(24, COLORS.dialogueBoxText).setOrigin(0, 0);
    this.cardStatus = this.text(TYPOGRAPHY.hudFontSize - 1, COLORS.dialogueBoxText).setOrigin(1, 0);
    this.cardBody = this.text(TYPOGRAPHY.hudFontSize, COLORS.dialogueBoxText).setOrigin(0, 0).setAlpha(0.8);
    this.card = this.add.container(0, 0, [this.cardFrame, this.cardName, this.cardStatus, this.cardBody]);
  }

  private createBar(): void {
    this.barFrame = this.add.graphics();
    this.barLabel = this.text(TYPOGRAPHY.hudFontSize - 1).setOrigin(0, 1).setAlpha(0.6);
    this.barValue = this.text(TYPOGRAPHY.hudFontSize + 1).setOrigin(1, 1);
    this.barRemaining = this.text(TYPOGRAPHY.hudFontSize - 1).setOrigin(0.5, 0).setAlpha(0.6);
  }

  private createRocket(): void {
    this.flame = this.add.image(0, 0, ROCKET_ART.flame).setOrigin(0.5, 0).setVisible(false);
    this.rocket = this.add.image(0, 0, ROCKET_ART.rocket).setScale(1.6).setInteractive({ useHandCursor: true });
    this.rocket.on('pointerdown', () => this.tryLaunch());
    this.rocketHint = this.text(TYPOGRAPHY.hudFontSize - 1, COLORS.interactBubbleMark).setOrigin(0.5, 0);

    this.exhaust = this.add.particles(0, 0, ROCKET_ART.spark, {
      speed: { min: 20, max: 60 },
      angle: { min: 80, max: 100 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 520,
      frequency: 28,
      tint: [0xfff3ce, hex(COLORS.flowerYellow), hex(COLORS.interactBubbleMark)],
      emitting: false,
    });
    this.sparks = this.add.particles(0, 0, ROCKET_ART.spark, {
      speed: { min: 40, max: 140 },
      angle: { min: 200, max: 340 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 700,
      gravityY: 160,
      tint: [0xffffff, hex(COLORS.flowerYellow)],
      emitting: false,
    });
  }

  // -- refreshing -------------------------------------------------------------------

  private refreshAll(animate: boolean): void {
    const focus = progression.focusSeconds;
    this.stats.setText(
      `${progression.sessionCount} sessions    today ${durationText(progression.todaySeconds)}    ` +
        `longest ${durationText(progression.longestSeconds)}    now ${durationText(ui.focus?.liveSeconds ?? 0)}`,
    );

    if (!animate) this.totalValue.setText(durationText(this.shownTotal.seconds));
    else {
      this.shownTotal.seconds = focus;
      this.totalValue.setText(durationText(focus));
    }

    this.devBadge.setText(
      DEV_MODE && progression.isSimulated
        ? `DEV  ·  SIMULATED ${Math.round(focus / 360) / 10}h  ·  real ${durationText(progression.realFocusSeconds)}`
        : !progression.isReachable ? 'offline — focus time will not be saved' : '',
    );

    for (const planet of this.planets) {
      const open = isWorldUnlocked(planet.world, focus);
      const here = planet.world.id === progression.currentWorld.id;
      planet.image.setTint(open ? 0xffffff : 0x4a4f5c).setAlpha(open ? 1 : 0.7);
      planet.lock?.setVisible(!open);
      planet.label.setText(open ? planet.world.name : '???').setAlpha(open ? 1 : 0.6);
      planet.hours.setText(here ? 'YOU ARE HERE' : planet.world.requiredFocusHours === 0 ? 'home' : `${planet.world.requiredFocusHours}h`);
      planet.hours.setColor(here ? WORLD_PALETTES[planet.world.palette].accent : COLORS.hudText).setAlpha(here ? 1 : 0.55);
    }

    this.refreshHalos();
    this.refreshCard();
    this.refreshBar(animate);
    this.refreshRocket();
  }

  private refreshHalos(): void {
    this.planets.forEach((planet, i) => {
      planet.halo.setVisible(i === this.selected || progression.isFresh(planet.world));
      planet.halo.setAlpha(i === this.selected ? 1 : 0.5);
    });
  }

  private refreshCard(): void {
    const planet = this.planets[this.selected];
    if (!planet) return;
    const world = planet.world;
    const open = isWorldUnlocked(world, progression.focusSeconds);
    const here = world.id === progression.currentWorld.id;
    const accent = WORLD_PALETTES[world.palette].accent;

    this.cardName.setText(open ? world.name : `${world.name.replace(/[A-Za-z]/g, '·')}`);
    this.cardStatus.setText(here ? 'CURRENT WORLD' : open ? 'UNLOCKED' : `LOCKED  ·  ${world.requiredFocusHours} FOCUS HOURS`);
    this.cardStatus.setColor(open ? accent : COLORS.interactBubbleMark);
    this.cardBody.setText(open ? world.description : `${world.teaser}\n\nRequires ${world.requiredFocusHours} hours of focus. You have ${durationText(progression.focusSeconds)}.`);

    const w = this.card.getData('width') as number | undefined ?? 460;
    this.cardBody.setWordWrapWidth(w - 48);
    this.cardFrame.clear();
    this.cardFrame.fillStyle(0x000000, 0.3);
    this.cardFrame.fillRoundedRect(4, 6, w, 126, 14);
    this.cardFrame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.cardFrame.fillRoundedRect(0, 0, w, 126, 14);
    this.cardFrame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.cardFrame.fillRoundedRect(3, 3, w - 6, 120, 12);
    this.cardFrame.fillStyle(hex(accent), 1);
    this.cardFrame.fillRoundedRect(3, 3, 5, 120, 3);
    this.cardName.setPosition(24, 16);
    this.cardStatus.setPosition(w - 20, 22);
    this.cardBody.setPosition(24, 56);
  }

  private refreshBar(animate: boolean): void {
    const progress = progression.progress;
    const next = progress.next;
    this.barLabel.setText(next ? `NEXT DESTINATION  ·  ${next.name.toUpperCase()}` : 'EVERY WORLD UNLOCKED');
    this.barValue.setText(next ? `${durationText(progression.focusSeconds)} / ${next.requiredFocusHours}h` : durationText(progression.focusSeconds));
    this.barRemaining.setText(next ? `${durationText(progress.remainingSeconds)} to unlock` : 'the rocket can take you anywhere');

    const target = progress.fraction;
    if (animate) this.tweens.add({ targets: this.bar, fill: target, duration: 900, ease: 'Cubic.easeOut', onUpdate: () => this.drawBar() });
    else {
      this.bar.fill = 0;
      this.tweens.add({ targets: this.bar, fill: target, delay: 500, duration: 1300, ease: 'Cubic.easeOut', onUpdate: () => this.drawBar() });
    }
    this.drawBar();
  }

  private drawBar(): void {
    const w = (this.barFrame.getData('width') as number | undefined) ?? 460;
    const next = progression.progress.next ?? WORLD_PROGRESS_CONFIG[WORLD_PROGRESS_CONFIG.length - 1];
    const accent = next ? WORLD_PALETTES[next.palette].accent : COLORS.statusStudying;

    this.barFrame.clear();
    this.barFrame.fillStyle(0x000000, 0.4);
    this.barFrame.fillRoundedRect(0, 0, w, 14, 7);
    // Segmented fill: blocks read as "earned in pieces", which is how it was.
    const filled = Math.max(0, Math.min(1, this.bar.fill)) * (w - 4);
    this.barFrame.fillStyle(hex(accent), 1);
    if (filled > 0) this.barFrame.fillRoundedRect(2, 2, Math.max(8, filled), 10, 5);
    this.barFrame.fillStyle(0x000000, 0.25);
    for (let x = 22; x < w - 4; x += 22) this.barFrame.fillRect(x, 2, 2, 10);
    this.barFrame.fillStyle(0xffffff, 0.25);
    if (filled > 0) this.barFrame.fillRect(4, 3, Math.max(0, filled - 4), 2);
  }

  /**
   * The rocket's two idle states. Parked: barely moving. Ready: engine lit, a
   * livelier bob, and a label that says what to do. The difference is the
   * whole signal — a rocket that is always excited stops meaning anything.
   */
  private refreshRocket(): void {
    for (const tween of [...this.loops]) {
      if (tween.targets.includes(this.rocket) || tween.targets.includes(this.flame)) {
        tween.stop();
        this.loops.delete(tween);
      }
    }

    const home = this.planets.find((p) => p.world.id === progression.currentWorld.id);
    if (!home || this.launching) return;

    const x = home.x + home.image.displayWidth * 0.62;
    const y = home.y - 10;
    this.rocket.setPosition(x, y).setRotation(0);
    this.placeFlame();

    const ready = progression.rocketReady;
    const destination = progression.destination;

    this.rocket.setAlpha(ready ? 1 : 0.8);
    this.flame.setVisible(ready).setScale(0.7, 0.55);
    this.rocketHint.setText(ready && destination ? `ROCKET READY  ·  SPACE  →  ${destination.name}` : '');
    // Under the planet's whole label block — name, then hours, then this —
    // and centred on the PLANET rather than the rocket, so a long destination
    // name does not run off the left edge of the screen.
    this.rocketHint.setPosition(home.x, home.y + 86).setAlpha(ready ? 1 : 0);

    this.track(this.tweens.add({
      targets: this.rocket,
      y: y - (ready ? 5 : 1.5),
      duration: ready ? 1100 : 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.placeFlame(),
    }));

    if (ready) {
      this.track(this.tweens.add({
        targets: this.flame,
        scaleY: 0.85,
        duration: 90,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }));
      this.track(this.tweens.add({
        targets: this.rocketHint,
        alpha: 0.55,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }));
    }
  }

  private placeFlame(): void {
    const angle = this.rocket.rotation;
    const offset = this.rocket.displayHeight * 0.4;
    const fx = this.rocket.x - Math.sin(angle) * -offset;
    const fy = this.rocket.y + Math.cos(angle) * offset;
    this.flame.setPosition(fx, fy).setRotation(angle);
    this.exhaust?.setPosition(fx, fy + 8);
  }

  // -- layout ------------------------------------------------------------------------

  /**
   * Responsive by construction: planets sit along an arc across the width on
   * wide screens and fold into two rows on narrow ones. Nothing is placed at a
   * fixed pixel; everything derives from the canvas.
   */
  private layout(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;

    // Backdrop: the deepest palette in the game, so every world's colour pops.
    this.backdrop.clear();
    const top = mix(WORLD_PALETTES.orbit.skyTop, '#000000', 0.2);
    const bottom = mix(WORLD_PALETTES.deepField.skyBottom, '#000000', 0.3);
    const bands = 32;
    for (let i = 0; i < bands; i += 1) {
      this.backdrop.fillStyle(hex(mix(top, bottom, i / (bands - 1))), 1);
      this.backdrop.fillRect(0, (height / bands) * i, width, height / bands + 1);
    }
    const rng = new Phaser.Math.RandomDataGenerator(['stars']);
    for (const star of this.stars) star.setPosition(rng.between(0, width), rng.between(0, height));

    const compact = width < 760;
    // Compact keeps ONE row and shrinks instead of folding into two. Two rows
    // put the far worlds straight through the card, and a map you cannot read
    // is worse than a small one.
    const scale = compact
      ? Phaser.Math.Clamp(Math.min(width / 1500, height / 900), 0.42, 0.62)
      : Phaser.Math.Clamp(Math.min(width / 1100, height / 760), 0.7, 1.35);

    this.title.setPosition(width / 2, height * 0.06);
    this.totalLabel.setPosition(width / 2, height * 0.06 + 26);
    this.totalValue.setPosition(width / 2, height * 0.06 + 66).setFontSize(Math.round(Phaser.Math.Clamp(width * 0.05, 34, 60)));
    this.stats.setPosition(width / 2, height * 0.06 + 108).setFontSize(compact ? 12 : 14);

    // The path.
    const count = this.planets.length;
    const pathTop = height * (compact ? 0.36 : 0.4);
    this.planets.forEach((planet, i) => {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = width * (compact ? 0.1 + t * 0.8 : 0.12 + t * 0.76);
      // The arc is what makes it a journey rather than a list; flattened on
      // small screens, where the vertical room is not there to spend.
      const y = pathTop + Math.sin(t * Math.PI) * (compact ? -18 : -46) * scale + 30;
      planet.x = x;
      planet.y = y;
      planet.image.setPosition(x, y).setScale(scale);
      planet.halo.setPosition(x, y).setRadius(40 * scale);
      planet.label.setPosition(x, y + 40 * scale);
      planet.hours.setPosition(x, y + 40 * scale + 20);
      planet.lock?.setPosition(x, y);
    });

    this.path.clear();
    for (let i = 0; i < count - 1; i += 1) {
      const a = this.planets[i];
      const b = this.planets[i + 1];
      if (!a || !b) continue;
      const reached = isWorldUnlocked(b.world, progression.focusSeconds);
      const steps = 14;
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        this.path.fillStyle(reached ? 0xffffff : 0x8a90a0, reached ? 0.55 : 0.25);
        this.path.fillCircle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, reached ? 2 : 1.5);
      }
    }

    const cardW = Math.min(520, width - 48);
    this.card.setData('width', cardW);
    this.card.setPosition((width - cardW) / 2, height * (compact ? 0.56 : 0.66));

    const barW = Math.min(520, width - 48);
    this.barFrame.setData('width', barW);
    const barY = height * (compact ? 0.89 : 0.88);
    this.barFrame.setPosition((width - barW) / 2, barY);
    this.barLabel.setPosition((width - barW) / 2, barY - 8);
    this.barValue.setPosition((width + barW) / 2, barY - 8);
    this.barRemaining.setPosition(width / 2, barY + 22);

    this.hint
      .setText(compact ? '← →  choose    SPACE  launch    ESC  close' : '← →  choose     SPACE  launch     J / ESC  close')
      .setPosition(width / 2, height - (compact ? 12 : 18))
      .setFontSize(compact ? 11 : TYPOGRAPHY.hudFontSize);
    this.devBadge.setPosition(16, 14);

    this.refreshCard();
    this.drawBar();
    this.refreshRocket();
  }

  private track(tween: Phaser.Tweens.Tween): void {
    this.loops.add(tween);
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.loops.delete(tween));
  }

  /** Everything this scene created is released here; nothing outlives it. */
  private teardown(): void {
    worldMap.active = false;
    restoreWorldHud(this);
    progression.off(PROGRESSION_EVENTS.progressChanged, this.onProgress);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.input.keyboard?.off('keydown', this.onKey, this);

    this.launchTl?.kill();
    this.launchTl = undefined;
    for (const tween of this.loops) tween.stop();
    this.loops.clear();
    this.exhaust?.stop();
    this.sparks?.stop();

    // Optional-chained on purpose: by SHUTDOWN the scene's camera manager may
    // already be torn down, and reaching through it threw — closing the map
    // after a launch crashed on the way out.
    this.cameras?.main?.setScroll(0, 0).setZoom(1).setAlpha(1);
    this.planets = [];
    this.stars = [];
  }
}

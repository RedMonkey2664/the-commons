/**
 * Cinematic camera direction for Focus Mode.
 *
 * The scene is built in WORLD coordinates around the desk, and this moves the
 * camera over it. Shots are named framings — a focus point, how much of the
 * world to fit across the frame, and how the camera behaves once it arrives.
 *
 * Four ideas do most of the work here:
 *
 *   1. STILLNESS IS A SHOT. The default state of a camera observing someone
 *      study is "not moving". Every shot holds for many seconds, some for the
 *      best part of a minute, and the only motion during a hold is a drift of
 *      a couple of world units. A camera that is always gliding somewhere reads
 *      as a screensaver and, in a room meant for concentrating, is actively
 *      annoying.
 *
 *   2. THE CAMERA REACTS, IT DOES NOT DECIDE. It is told what the avatar is
 *      doing and picks a framing that suits it — close on a struggle, wide on
 *      a celebration, side-on for a long quiet stretch of work. It never touches
 *      the clock.
 *
 *   3. A FLAT SCENE CANNOT ORBIT. Moving the camera to the side of a 2D
 *      character just crops them. So shots that imply a new angle ask the
 *      avatar to TURN — profile, or away from us — and the turn happens INSIDE
 *      a cut, where an editor would hide it, never in front of the lens.
 *
 *   4. EDITING HAS A GRAMMAR. A glide, a match cut, a hard cut on the action, a
 *      dip through dark — each chosen for what it joins, and none allowed to
 *      become a habit. Every so often the camera looks away from the character
 *      entirely, at the window or the lamp or the mug going cold, which is what
 *      turns a character on a loop into a place you are spending time in.
 *
 * Choreography is GSAP; rendering is Phaser. Each shot change is one GSAP
 * timeline tweening a plain proxy object that Phaser applies to its camera
 * every frame. Phaser's own pan and zoom effects fight when they overlap and
 * cannot be sequenced; a timeline pauses, resumes and dies as one thing. The
 * avatar's motion stays on Phaser tweens — one library per job.
 */

import Phaser from 'phaser';
import { gsap } from 'gsap';
import { FOCUS, type WorldCinematic } from '@commons/shared';
import type { FocusOrientation } from '../art/focusAvatarArt';
import { FOCUS_SET } from '../art/focusSet';
import type { BehaviorId } from './AvatarBehavior';

export type CutawayId = 'window' | 'lamp' | 'mug';

export type ShotId =
  | 'establishing'
  | 'medium'
  | 'threeQuarter'
  | 'sideProfile'
  | 'overShoulder'
  | 'closeUp'
  | 'detail'
  | 'detailBook'
  | 'celebration'
  | CutawayId;

export type TransitionKind = 'glide' | 'match' | 'cut' | 'dip';

export interface ShotDef {
  id: ShotId;
  /** Where the camera looks, in world units relative to the desk's centre-top. */
  focus: { x: number; y: number };
  /** How much world to fit across the frame. Smaller is closer. */
  frameWidth: number;
  /** Which way the avatar must face for this angle. Cutaways leave it alone. */
  orientation?: FocusOrientation;
  /** Base likelihood. Rare shots stay rare so they keep their impact. */
  weight: number;
  /**
   * A slow creep during the hold, as a fraction of frameWidth. Negative pushes
   * in, positive pulls out. Tiny values only — this should be felt, not seen.
   */
  creep?: number;
  /** Behaviours this shot is especially right for. */
  suits?: BehaviorId[];
  /** Set on environment shots: what the cutaway is of. */
  cutaway?: CutawayId;
}

/** Behaviours worth cutting in close for. Cutaways never interrupt these. */
const BIG_MOMENTS: readonly BehaviorId[] = ['celebration', 'realising', 'struggling'];

const SHOTS: Record<ShotId, ShotDef> = {
  establishing: {
    id: 'establishing',
    focus: { x: 0, y: -24 },
    frameWidth: 560,
    orientation: 'front',
    weight: 4,
    creep: -0.04,
  },

  medium: {
    id: 'medium',
    focus: { x: 0, y: -22 },
    frameWidth: 310,
    orientation: 'front',
    weight: 14,
    creep: -0.02,
    suits: ['reading', 'writing', 'typing', 'studying', 'takingNotes', 'scrolling', 'organizingNotes', 'wristStretch', 'turningPage'],
  },

  threeQuarter: {
    id: 'threeQuarter',
    // Off-centre on purpose: the desk fills the other side of the frame.
    focus: { x: -26, y: -24 },
    frameWidth: 250,
    orientation: 'front',
    weight: 12,
    creep: -0.03,
    suits: ['writing', 'takingNotes', 'thinking', 'sipping', 'highlighting', 'penTapping', 'organizingNotes'],
  },

  sideProfile: {
    id: 'sideProfile',
    focus: { x: 34, y: -20 },
    frameWidth: 230,
    orientation: 'profile',
    weight: 8,
    suits: ['reading', 'zonedOut', 'tired', 'thinking', 'studying', 'turningPage', 'scrolling', 'rubbingEyes'],
  },

  overShoulder: {
    id: 'overShoulder',
    focus: { x: 16, y: -38 },
    frameWidth: 170,
    orientation: 'back',
    weight: 6,
    creep: -0.02,
    suits: ['typing', 'lookingAtScreen', 'writing', 'reading', 'scrolling', 'highlighting', 'turningPage'],
  },

  closeUp: {
    id: 'closeUp',
    focus: { x: 0, y: -50 },
    frameWidth: 118,
    orientation: 'front',
    weight: 5,
    creep: -0.03,
    suits: ['struggling', 'thinkingHard', 'confused', 'realising', 'tired', 'happyWithProgress', 'rubbingEyes', 'penTapping'],
  },

  detail: {
    id: 'detail',
    // The working surface: hands, paper, the pen.
    focus: { x: 30, y: -4 },
    frameWidth: 130,
    orientation: 'front',
    weight: 4,
    suits: ['writing', 'takingNotes', 'penTapping', 'organizingNotes'],
  },

  detailBook: {
    id: 'detailBook',
    // The other half of the desk: the open book, a hand on the page.
    focus: { x: -26, y: -6 },
    frameWidth: 130,
    orientation: 'front',
    weight: 4,
    creep: -0.02,
    suits: ['reading', 'highlighting', 'turningPage', 'studying'],
  },

  celebration: {
    id: 'celebration',
    focus: { x: 0, y: -30 },
    frameWidth: 430,
    orientation: 'front',
    weight: 0, // never chosen at random; the completion sequence asks for it
  },

  // -- environment cutaways. Weight 0: chosen by their own rule, not the pool.

  window: {
    id: 'window',
    // The window hangs on the far layer, which scrolls slower than the camera;
    // dividing by that rate is where it APPEARS when the camera is looking at it.
    focus: { x: FOCUS_SET.window.x / FOCUS.parallax.far, y: FOCUS_SET.window.y },
    frameWidth: 150,
    weight: 0,
    creep: -0.05,
    cutaway: 'window',
  },

  lamp: {
    id: 'lamp',
    focus: { x: FOCUS_SET.lamp.x + 6, y: FOCUS_SET.lamp.y - 30 },
    frameWidth: 140,
    weight: 0,
    creep: 0.03,
    cutaway: 'lamp',
  },

  mug: {
    id: 'mug',
    focus: { x: FOCUS_SET.props.mug.x - 4, y: FOCUS_SET.props.mug.y - 12 },
    frameWidth: 96,
    weight: 0,
    creep: -0.03,
    cutaway: 'mug',
  },
};

const PICKABLE = (Object.keys(SHOTS) as ShotId[]).filter((id) => SHOTS[id].weight > 0);
const CUTAWAYS: readonly CutawayId[] = ['window', 'lamp', 'mug'];

/** Exposed for tests, the same way the behaviour table is. */
export const SHOT_TABLE = SHOTS;

/** What the controller needs from the outside world. */
export interface FocusCameraOptions {
  camera: Phaser.Cameras.Scene2D.Camera;
  /**
   * Turn the avatar to match the angle. `instant` when the turn is hidden in a
   * cut. The camera never animates the avatar itself.
   */
  setOrientation: (orientation: FocusOrientation, instant: boolean) => void;
  /** A pinned full-screen shape the camera fades through on a dip. */
  veil: { alpha: number };
  /** How this world is filmed: pace, and which cutaways it favours. */
  cinematic: WorldCinematic;
  /** For a reproducible session in tests; a real one differs every time. */
  seed?: string;
}

export class FocusCameraController {
  /** The tweened proxy. One object, so a move eases as a single gesture. */
  private readonly view = { x: 0, y: 0, frameWidth: 0 };

  private currentShot: ShotDef = SHOTS.establishing;
  private holdRemainingMs = 0;
  private readonly history: ShotId[] = [];
  private readonly transitionHistory: TransitionKind[] = [];
  /** Character shots since the last cutaway. Starts high enough to allow one. */
  private shotsSinceCutaway = 0;
  /**
   * A hard cut waiting for the avatar to move. Cutting on the action is the
   * oldest rule in editing: the eye follows the motion across the cut and
   * never sees the join.
   */
  private pendingCut?: { shot: ShotDef; waitedMs: number };
  /**
   * The only live GSAP object this controller ever holds. Killed before the
   * next shot starts and on destroy, so however long a session runs there is
   * at most one camera timeline in existence.
   */
  private timeline?: gsap.core.Timeline;
  private started = false;
  private paused = false;
  private stopped = false;

  /** The avatar's current behaviour, pushed in by the director. */
  private behavior: BehaviorId | undefined;
  /** Which way the camera last asked the avatar to face. */
  private orientation: FocusOrientation = 'front';
  /** True until the first move after the establishing shot. */
  private opening = false;

  /** A slow sway, so a held shot is still a camera being held rather than a still. */
  private swayPhase: number;
  private readonly rng: Phaser.Math.RandomDataGenerator;

  /** Fires as each new shot begins, so the director can bias the performance toward it. */
  onShotChange?: (shot: ShotDef) => void;

  constructor(private readonly options: FocusCameraOptions) {
    this.rng = new Phaser.Math.RandomDataGenerator([options.seed ?? String(Date.now())]);
    this.swayPhase = this.rng.frac() * Math.PI * 2;

    // Framed on the opening position from the very first frame, so the
    // entrance shows the room rather than whatever the default camera sees.
    const { opening } = FOCUS.camera;
    this.view.x = SHOTS.establishing.focus.x;
    this.view.y = SHOTS.establishing.focus.y - opening.liftY;
    this.view.frameWidth = SHOTS.establishing.frameWidth * opening.startScale;
  }

  get shotId(): ShotId {
    return this.currentShot.id;
  }

  get recentShots(): readonly ShotId[] {
    return this.history;
  }

  get recentTransitions(): readonly TransitionKind[] {
    return this.transitionHistory;
  }

  /**
   * The opening: wide, held long enough to read the room, then in toward the
   * avatar as they start working. Only the SHAPE is fixed; which closer shot,
   * and after how long, are rolled like any other.
   */
  start(): void {
    this.started = true;
    this.stopped = false;
    this.opening = true;
    this.applyShot(SHOTS.establishing, 'glide', FOCUS.camera.opening.moveMs);
  }

  /**
   * Told, not asked: the director forwards the avatar's behaviour changes.
   *
   * A behaviour change does not by itself move the camera — that would be a
   * cut every few seconds. It releases a cut that was waiting for movement,
   * and it shortens a long hold when something worth being close for starts.
   */
  onBehavior(id: BehaviorId): void {
    this.behavior = id;
    if (!this.started || this.stopped || this.paused) return;

    if (this.pendingCut) {
      const { shot } = this.pendingCut;
      this.pendingCut = undefined;
      this.applyShot(shot, 'cut');
      return;
    }

    const suitsCurrent = this.currentShot.suits?.includes(id) ?? false;
    const { bigMoment } = FOCUS.camera;
    if (!suitsCurrent && BIG_MOMENTS.includes(id) && this.holdRemainingMs > bigMoment.minRemainingMs) {
      // Cut the hold short, but never to zero: the move still has to be calm.
      this.holdRemainingMs = this.rng.between(bigMoment.cutMinMs, bigMoment.cutMaxMs);
    }
  }

  update(delta: number): void {
    if (this.paused || this.stopped) return;

    // The sway is applied on top of the tweened view, never into it, so a move
    // in progress is not fighting a second source of position.
    this.swayPhase += delta / FOCUS.camera.sway.periodMs;
    this.apply();
    if (!this.started) return;

    if (this.pendingCut) {
      // The avatar has not moved for a while. Cut anyway rather than hold a
      // shot past its welcome waiting for a cue that is not coming.
      this.pendingCut.waitedMs += delta;
      if (this.pendingCut.waitedMs >= FOCUS.transitions.cutOnActionMaxWaitMs) {
        const { shot } = this.pendingCut;
        this.pendingCut = undefined;
        this.applyShot(shot, 'cut');
      }
      return;
    }

    this.holdRemainingMs -= delta;
    if (this.holdRemainingMs > 0) return;

    const next = this.pickNext();
    const kind = this.pickTransition(next);
    if (kind === 'cut') this.pendingCut = { shot: next, waitedMs: 0 };
    else this.applyShot(next, kind);
  }

  /** The completion sequence asks for this one by name. */
  playCelebration(): void {
    this.pendingCut = undefined;
    this.started = true;
    this.applyShot(SHOTS.celebration, 'glide');
  }

  /**
   * Go straight to a named shot, by a named transition.
   *
   * Public because the test suite drives every framing and transition, and
   * reaching into a private method from a test is how a test ends up asserting
   * on an implementation detail that was never meant to be one.
   */
  forceShot(id: ShotId, kind: TransitionKind = 'glide', moveMs?: number): void {
    this.pendingCut = undefined;
    this.applyShot(SHOTS[id], kind, moveMs);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.timeline?.pause();
    else this.timeline?.resume();
  }

  destroy(): void {
    this.stopped = true;
    this.pendingCut = undefined;
    this.timeline?.kill();
    this.timeline = undefined;
    this.options.veil.alpha = 0;
  }

  // -- internals -------------------------------------------------------------

  private applyShot(shot: ShotDef, kind: TransitionKind, moveMsOverride?: number): void {
    const timing = FOCUS.camera.shots[shot.id];
    const { transitions, camera } = FOCUS;
    const from = { ...this.view };

    this.currentShot = shot;
    remember(this.history, shot.id, camera.historySize);
    remember(this.transitionHistory, kind, transitions.historySize);
    this.shotsSinceCutaway = shot.cutaway ? 0 : this.shotsSinceCutaway + 1;

    // The world sets the pace; the finale does not wait for it.
    const pace = shot.id === 'celebration' ? 1 : this.options.cinematic.pace;
    this.holdRemainingMs = this.rng.between(timing.minHoldMs, timing.maxHoldMs) * pace;

    const target = { x: shot.focus.x, y: shot.focus.y, frameWidth: shot.frameWidth };
    const turnTo = shot.orientation && shot.orientation !== this.orientation ? shot.orientation : undefined;
    const turn = (instant: boolean) => {
      if (!turnTo) return;
      this.orientation = turnTo;
      this.options.setOrientation(turnTo, instant);
    };
    // Everything that jumps, jumps together, on one frame.
    const jump = () => {
      Object.assign(this.view, target);
      turn(true);
    };

    this.timeline?.kill();
    const tl = gsap.timeline({ paused: this.paused });
    const { veil } = this.options;

    // A dip interrupted by this shot would otherwise leave the screen half dark.
    if (veil.alpha > 0 && kind !== 'dip') {
      tl.to(veil, { alpha: 0, duration: transitions.veilClearMs / 1000, ease: 'sine.out' }, 0);
    }

    let moveMs = 0;
    switch (kind) {
      case 'glide': {
        // power2.inOut: a real dolly accelerates and decelerates, and the slow
        // start is the anticipation that makes it read as intended. No
        // overshoot anywhere — springy framing reads as a nervous operator.
        moveMs = moveMsOverride ?? timing.moveMs;
        tl.to(this.view, { ...target, duration: moveMs / 1000, ease: 'power2.inOut' }, 0);
        // A glide can still turn the avatar (a forced shot, the finale): mid-
        // move, when the frame is travelling fastest and the eye sees least.
        if (turnTo) tl.call(() => turn(false), undefined, (moveMs / 1000) * camera.turnAt);
        break;
      }

      case 'cut':
        tl.call(jump, undefined, 0);
        break;

      case 'dip': {
        const { outMs, holdMs, inMs } = transitions.dip;
        tl.to(veil, { alpha: 1, duration: outMs / 1000, ease: 'sine.in' }, 0);
        tl.call(jump);
        tl.to(veil, { alpha: 0, duration: inMs / 1000, ease: 'sine.out' }, `+=${holdMs / 1000}`);
        moveMs = outMs + holdMs + inMs;
        break;
      }

      case 'match': {
        // Drift out of this shot, cut mid-drift, arrive already drifting the
        // same way. Distances scale with each shot's width, so the SCREEN speed
        // either side of the cut is close enough for the eye to carry it over.
        const { outMs, inMs, distance } = transitions.match;
        const dir = Math.sign(target.x - from.x) || (this.rng.frac() < 0.5 ? -1 : 1);
        const outDrift = dir * distance * from.frameWidth;
        const inDrift = dir * distance * target.frameWidth;
        tl.to(this.view, { x: from.x + outDrift, duration: outMs / 1000, ease: 'sine.in' }, 0);
        tl.call(() => {
          jump();
          this.view.x = target.x - inDrift;
        });
        tl.to(this.view, { x: target.x, duration: inMs / 1000, ease: 'power2.out' });
        moveMs = outMs + inMs;
        break;
      }
    }

    // THE SETTLE. A beat of true stillness before anything else happens; the
    // pause in move -> pause -> drift, without which every shot blurs into the next.
    tl.to({}, { duration: this.rng.between(camera.settleMinMs, camera.settleMaxMs) / 1000 });

    // THE CREEP. Only some shots, and only a few percent: felt, not seen.
    if (shot.creep) {
      tl.to(this.view, {
        frameWidth: shot.frameWidth * (1 + shot.creep),
        duration: Math.max(camera.creepMinMs, this.holdRemainingMs - moveMs) / 1000,
        ease: 'sine.inOut',
      });
    }

    this.timeline = tl;
    this.onShotChange?.(shot);
  }

  /**
   * How to get from this shot to the next.
   *
   * A turn is never glided — the avatar swapping angle in plain view is the
   * one thing a flat scene cannot sell. A big change of scale is rarely glided
   * either: a long zoom across the whole room is a screensaver move. Cutaways
   * prefer cuts and dips, because dollying from a face to a window says the
   * two are connected when they are not. And no transition becomes a habit:
   * never two hard cuts running, never two dips close together.
   */
  private pickTransition(shot: ShotDef): TransitionKind {
    const t = FOCUS.transitions;
    const from = this.currentShot;
    const weights: Record<TransitionKind, number> = { ...t.weights };

    const turns = shot.orientation !== undefined && shot.orientation !== this.orientation;
    const ratio = Math.max(shot.frameWidth, from.frameWidth) / Math.min(shot.frameWidth, from.frameWidth);

    if (turns) weights.glide = 0;
    if (ratio >= t.bigScaleRatio) weights.glide *= t.bigScaleGlide;
    if (shot.cutaway || from.cutaway) {
      weights.glide *= t.cutawayGlide;
      weights.dip *= t.cutawayDip;
    }

    const last = this.transitionHistory[this.transitionHistory.length - 1];
    if (last === 'cut') weights.cut = 0;
    if (this.transitionHistory.includes('dip')) weights.dip = 0;

    return weightedPick(this.rng, weights) ?? 'match';
  }

  /**
   * Weighted pick, biased hard toward shots that suit what the avatar is doing,
   * with the recent ones refused so no two-shot ping-pong can establish itself.
   * Now and then — never twice running, never during a big moment — the
   * camera looks at the room instead.
   */
  private pickNext(): ShotDef {
    // Out of the establishing shot, the camera always moves TOWARD the
    // character: that is the move that says "this is who we are watching".
    if (this.opening) {
      this.opening = false;
      return this.rng.pick([SHOTS.medium, SHOTS.medium, SHOTS.threeQuarter]);
    }

    const { cutaway } = FOCUS;
    const calm = this.behavior === undefined || !BIG_MOMENTS.includes(this.behavior);
    if (
      calm
      && !this.currentShot.cutaway
      && this.shotsSinceCutaway >= cutaway.minShotsBetween
      && this.rng.frac() < cutaway.chance
    ) {
      const weights: Partial<Record<CutawayId, number>> = {};
      for (const id of CUTAWAYS) {
        if (!this.history.includes(id)) weights[id] = this.options.cinematic.cutaways[id];
      }
      const id = weightedPick(this.rng, weights);
      if (id) return SHOTS[id];
    }

    const pool = PICKABLE.filter((id) => !this.history.includes(id));
    const candidates = pool.length > 0 ? pool : PICKABLE.filter((id) => id !== this.currentShot.id);

    const weights: Partial<Record<ShotId, number>> = {};
    for (const id of candidates) {
      const shot = SHOTS[id];
      const suits = this.behavior !== undefined && (shot.suits?.includes(this.behavior) ?? false);
      weights[id] = shot.weight * (suits ? FOCUS.camera.suitsBoost : 1);
    }
    const id = weightedPick(this.rng, weights) ?? candidates[0] ?? 'medium';
    return SHOTS[id];
  }

  /**
   * Push the proxy onto the real camera.
   *
   * Zoom is derived from how much world the shot wants to see, so the framing
   * is the same on a phone and an ultrawide — the camera shows the same slice
   * of the scene rather than the same number of pixels.
   */
  private apply(): void {
    const { camera } = this.options;
    const { width, height } = camera;
    if (width === 0 || height === 0) return;

    const { heightFit, sway } = FOCUS.camera;
    const zoomByWidth = width / this.view.frameWidth;
    const zoomByHeight = height / (this.view.frameWidth * heightFit);
    const zoom = Math.min(zoomByWidth, zoomByHeight);

    camera.setZoom(zoom);
    camera.centerOn(
      this.view.x + Math.sin(this.swayPhase) * sway.x,
      this.view.y + Math.cos(this.swayPhase * 0.7) * sway.y,
    );
  }
}

/** Push onto a bounded history, newest last. */
function remember<T>(history: T[], item: T, size: number): void {
  history.push(item);
  while (history.length > size) history.shift();
}

/** A weighted pick over a table of weights; undefined when nothing has weight. */
function weightedPick<K extends string>(
  rng: Phaser.Math.RandomDataGenerator,
  weights: Partial<Record<K, number>>,
): K | undefined {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return undefined;

  let roll = rng.frac() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1]?.[0];
}

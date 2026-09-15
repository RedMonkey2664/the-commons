/**
 * The seated avatar in Focus Mode — a rig, not a sprite.
 *
 * This owns the PARTS and the primitives that move them (lean, tilt the head,
 * swing an arm, change expression, hold something). It owns no opinion about
 * when any of that should happen; AvatarBehavior decides that. Keeping the two
 * apart is what lets the behaviour table stay readable and lets the rig be
 * tested by poking primitives directly from the console.
 *
 * Tween discipline, because a focus session can run for hours:
 *   - every tween goes through `tween()`, which tracks it and untracks it on
 *     completion, so nothing is orphaned;
 *   - `clearActions()` stops the previous behaviour's tweens before the next
 *     one starts, so two behaviours can never fight over the same arm;
 *   - the two always-running loops (breathing, blinking) are held separately and
 *     survive behaviour changes, because life should not stop between states.
 */

import Phaser from 'phaser';
import { FOCUS } from '@commons/shared';
import {
  FOCUS_ART,
  ensureFocusArt,
  type FocusFace,
  type FocusOrientation,
} from '../art/focusAvatarArt';

/** Where a hand can be asked to go. Behaviours speak in these, not pixels. */
export type HandTarget =
  | 'rest' | 'page' | 'keyboard' | 'chin' | 'pen' | 'up' | 'behindHead' | 'mug'
  | 'eyes' | 'wrist' | 'highlight' | 'pageLift' | 'tap';

/** Things the avatar can hold. Drawn in the hand while the desk copy is hidden. */
export type HeldItem = 'mug';

/**
 * How the arms draw against the body.
 *
 *   body  - the default: the near arm crosses the torso, the far arm is behind it.
 *   front - both arms in front of the torso, for hands that meet at the chest.
 *   face  - both arms in front of the head as well, for hands at the eyes.
 *
 * Without this, a pose that brings the hands to the face renders them BEHIND
 * the head, and rubbing your eyes looks like having no hands.
 */
type ArmLayer = 'body' | 'front' | 'face';
const LAYER_RANK: Record<ArmLayer, number> = { body: 0, front: 1, face: 2 };

export interface FocusAvatarOptions {
  x: number;
  y: number;
  bodyColor: string;
  hat?: { color: string; style: string };
}

/**
 * Where each hand target puts the arms.
 *
 * `dx`/`dy` move the SHOULDER as well as rotating it, and that is what makes
 * poses read at this scale. The arm is one straight piece with no elbow, so
 * chin-on-hand by rotation alone swings the hand out to the side and looks like
 * pointing; sliding the shoulder up and inward instead lands the hand under the
 * chin, which is the pose everyone recognises.
 */
const ARM_ANGLES: Record<HandTarget, {
  left: number; right: number;
  dxLeft?: number; dxRight?: number;
  dyLeft?: number; dyRight?: number;
  layer?: ArmLayer;
}> = {
  rest: { left: 6, right: -6 },
  page: { left: 22, right: -22, dyLeft: -3, dyRight: -3 },
  keyboard: { left: 16, right: -16, dyLeft: -2, dyRight: -2 },
  chin: { left: 10, right: -16, dxRight: -5, dyRight: -15 },
  pen: { left: 18, right: -14, dxRight: -2, dyRight: -6 },
  up: { left: 168, right: -168, dyLeft: -8, dyRight: -8 },
  behindHead: { left: 150, right: -150, dxLeft: 3, dxRight: -3, dyLeft: -6, dyRight: -6 },
  mug: { left: 10, right: -18, dxRight: -4, dyRight: -12 },
  // Both hands up to the eyes: the shoulders slide in so the hands land on them.
  eyes: { left: 172, right: -172, dxLeft: 7, dxRight: -7, layer: 'face' },
  // Hands meeting in front of the chest, fingers laced, pushing out.
  wrist: { left: -64, right: 64, dyLeft: -4, dyRight: -4, layer: 'front' },
  // The right hand reaching across to the book; the left holds the page flat.
  highlight: { left: 22, right: 42, dyLeft: -3, dxRight: -12, dyRight: 2 },
  // The left hand lifting a page up and over the spine.
  pageLift: { left: 58, right: -22, dxLeft: -6, dyLeft: -2, dyRight: -3 },
  // A pen held just off the desk, for tapping.
  tap: { left: 18, right: -30, dxRight: -4, dyRight: -8 },
};

/** Where a held item sits: in the right hand of the 'mug' pose. */
const HELD_AT = { x: 15, y: 0 };

const SHOULDER_X = 13;
const SHOULDER_Y = -2;

export class FocusAvatar {
  readonly container: Phaser.GameObjects.Container;

  private readonly head: Phaser.GameObjects.Image;
  private readonly torso: Phaser.GameObjects.Image;
  private readonly leftArm: Phaser.GameObjects.Image;
  private readonly rightArm: Phaser.GameObjects.Image;
  private readonly chair: Phaser.GameObjects.Image;
  private readonly bubble: Phaser.GameObjects.Text;
  private readonly held: Phaser.GameObjects.Image;

  private readonly textureKey: string;
  private readonly baseHeadY: number;
  private readonly baseTorsoY: number;

  /** Behaviour-scoped tweens: cleared whenever a behaviour ends. */
  private readonly actions = new Set<Phaser.Tweens.Tween>();
  /**
   * Turning, kept apart from behaviour tweens. A behaviour change mid-turn used
   * to stop the head's opacity dip halfway and leave the face half transparent.
   */
  private readonly turns = new Set<Phaser.Tweens.Tween>();
  private heldTween?: Phaser.Tweens.Tween;
  private holding: HeldItem | null = null;
  private armLayer: ArmLayer = 'body';
  /** Where the arms are heading; a LOWER layer is applied once they arrive. */
  private targetLayer: ArmLayer = 'body';
  /** Life that runs underneath every behaviour. */
  private breathTween?: Phaser.Tweens.Tween;
  private blinkTimer?: Phaser.Time.TimerEvent;
  private blinkRestore?: Phaser.Time.TimerEvent;

  private currentFace: FocusFace = 'neutral';
  private orientation: FocusOrientation = 'front';
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, options: FocusAvatarOptions) {
    const { key } = ensureFocusArt(scene, options.bodyColor, options.hat);
    this.textureKey = key;

    // A backrest behind the shoulders — the one part of a chair you can see
    // over a desk, and the part that says "seated" rather than "standing".
    this.chair = scene.add.image(0, 10, FOCUS_ART.chair).setOrigin(0.5, 0.5);

    this.torso = scene.add.image(0, 6, FOCUS_ART.torso(key)).setOrigin(0.5, 0.5);
    this.baseTorsoY = this.torso.y;

    // Origin at the shoulder, so rotation pivots there rather than mid-arm.
    this.leftArm = scene.add.image(-SHOULDER_X, SHOULDER_Y, FOCUS_ART.arm(key)).setOrigin(0.5, 0.05);
    this.rightArm = scene.add.image(SHOULDER_X, SHOULDER_Y, FOCUS_ART.arm(key)).setOrigin(0.5, 0.05);

    this.head = scene.add.image(0, -22, FOCUS_ART.head(key, 'neutral')).setOrigin(0.5, 0.5);
    this.baseHeadY = this.head.y;

    this.bubble = scene.add
      .text(20, -46, '', { fontFamily: 'monospace', fontSize: '22px', color: '#FFFFFF' })
      .setOrigin(0.5)
      .setAlpha(0);

    this.held = scene.add.image(HELD_AT.x, HELD_AT.y, FOCUS_ART.mug).setAlpha(0);

    this.container = scene.add.container(options.x, options.y, [
      this.chair,
      this.leftArm,
      this.torso,
      this.rightArm,
      this.held,
      this.head,
      this.bubble,
    ]);

    this.setHands('rest', 0);
    this.startBreathing();
    this.scheduleBlink();
  }

  // -- primitives the behaviour table calls ---------------------------------

  /** Expression. Cheap, instant, and the single biggest readability lever. */
  setFace(face: FocusFace): void {
    if (this.destroyed || face === this.currentFace) return;
    this.currentFace = face;
    this.applyHeadTexture();
  }

  /**
   * Turn the character. Called by the camera when it moves to a side or behind
   * angle, because a flat scene cannot orbit — the character turns instead.
   *
   * The swap is hidden inside a short dip in opacity. A head changing texture
   * on one frame reads as a glitch; the same change under a 120ms dip reads as
   * the camera having moved.
   */
  setOrientation(orientation: FocusOrientation, duration: number = FOCUS.camera.turnMs): void {
    if (this.destroyed || orientation === this.orientation) return;
    this.orientation = orientation;

    // Arms and torso shift too: a body seen from the side is narrower, and
    // from behind the near arm is the far one.
    const narrow = orientation === 'front' ? 1 : 0.72;

    for (const tween of this.turns) tween.stop();
    this.turns.clear();

    // Instant, for a turn hidden inside a camera cut. The cut IS the
    // transition; an opacity dip on top of it would only read as a flicker.
    if (duration <= 0) {
      this.head.setAlpha(1);
      this.applyHeadTexture();
      for (const part of [this.torso, this.leftArm, this.rightArm]) part.scaleX = narrow;
      this.restack();
      return;
    }

    this.turn({
      targets: this.head,
      alpha: { from: 1, to: 0.25 },
      duration: duration / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onYoyo: () => this.applyHeadTexture(),
      onStop: () => {
        this.head.setAlpha(1);
        this.applyHeadTexture();
      },
    });
    this.turn({
      targets: [this.torso, this.leftArm, this.rightArm],
      scaleX: narrow,
      duration,
      ease: 'Sine.easeInOut',
    });
    this.restack();
  }

  /**
   * Draw order within the rig. From the front the near arm crosses the body;
   * from behind both arms reach forward and the torso hides them (drawn in the
   * front order from behind, the arms hang outside the body like a coat on a
   * hanger). A pose can lift the arms over the torso, or over the head.
   */
  private restack(): void {
    const { chair, leftArm, rightArm, held, torso, head, bubble } = this;
    let order: Phaser.GameObjects.GameObject[];
    if (this.orientation === 'back') order = [chair, leftArm, rightArm, held, torso, head, bubble];
    else if (this.armLayer === 'face') order = [chair, torso, head, leftArm, rightArm, held, bubble];
    else if (this.armLayer === 'front') order = [chair, torso, leftArm, rightArm, held, head, bubble];
    else order = [chair, leftArm, torso, rightArm, held, head, bubble];
    for (const child of order) this.container.bringToTop(child);
  }

  private setArmLayer(layer: ArmLayer): void {
    if (layer === this.armLayer) return;
    this.armLayer = layer;
    this.restack();
  }

  private applyHeadTexture(): void {
    const key = this.textureKey;
    if (this.orientation === 'back') {
      this.head.setTexture(FOCUS_ART.backHead(key));
      return;
    }
    if (this.orientation === 'profile') {
      const shut = this.currentFace === 'closed' || this.currentFace === 'tired';
      this.head.setTexture(FOCUS_ART.profileHead(key, shut));
      return;
    }
    this.head.setTexture(FOCUS_ART.head(key, this.currentFace));
  }

  get face(): FocusFace {
    return this.currentFace;
  }

  /** Which way the avatar is turned, so the set can turn with it. */
  get facing(): FocusOrientation {
    return this.orientation;
  }

  /** Move both hands to a named target. Arms are the pose; everything else is garnish. */
  setHands(target: HandTarget, duration = 380): void {
    if (this.destroyed) return;
    const pose = ARM_ANGLES[target];

    // A rising layer switches now, while the arms are still clear of the face;
    // a falling one waits until the hands are back down, or they would vanish
    // behind the head on the way.
    const layer = pose.layer ?? 'body';
    this.targetLayer = layer;
    const raiseNow = duration <= 0 || LAYER_RANK[layer] >= LAYER_RANK[this.armLayer];
    if (raiseNow) this.setArmLayer(layer);

    const left = {
      angle: pose.left,
      x: -SHOULDER_X + (pose.dxLeft ?? 0),
      y: SHOULDER_Y + (pose.dyLeft ?? 0),
    };
    const right = {
      angle: pose.right,
      x: SHOULDER_X + (pose.dxRight ?? 0),
      y: SHOULDER_Y + (pose.dyRight ?? 0),
    };

    if (duration <= 0) {
      this.leftArm.setAngle(left.angle).setPosition(left.x, left.y);
      this.rightArm.setAngle(right.angle).setPosition(right.x, right.y);
      return;
    }

    this.tween({ targets: this.leftArm, ...left, duration, ease: 'Sine.easeInOut' });
    this.tween({
      targets: this.rightArm,
      ...right,
      duration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (!raiseNow && this.targetLayer === layer) this.setArmLayer(layer);
      },
    });
  }

  /** A small repeated motion on one arm — writing, typing, tapping a pen. */
  fidgetArm(side: 'left' | 'right', degrees: number, periodMs: number, delayMs = 0): void {
    if (this.destroyed) return;
    const arm = side === 'left' ? this.leftArm : this.rightArm;
    // Relative, and resolved when the tween STARTS. With a delay that is after
    // the arm has arrived in its pose, so the motion happens around the pose
    // rather than around wherever the arm was when this was asked for.
    this.tween({
      targets: arm,
      angle: `+=${degrees}`,
      delay: delayMs,
      duration: periodMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Tilt the head. Negative leans left, positive right. */
  tiltHead(degrees: number, duration = 420): void {
    if (this.destroyed) return;
    this.tween({ targets: this.head, angle: degrees, duration, ease: 'Sine.easeInOut' });
  }

  /** Lean the whole upper body — toward the page, back in the chair, slumped. */
  lean(x: number, y: number, duration = 500): void {
    if (this.destroyed) return;
    this.tween({
      targets: this.head,
      x,
      y: this.baseHeadY + y,
      duration,
      ease: 'Sine.easeInOut',
    });
    // The torso follows at a fraction, which is what makes it read as a body
    // leaning rather than a head and a box moving in lockstep.
    this.tween({
      targets: this.torso,
      x: x * 0.7,
      y: this.baseTorsoY + y * 0.6,
      duration,
      ease: 'Sine.easeInOut',
    });
  }

  /** A one-off nod, shake, or bounce, expressed as a scale/rotation pop. */
  pop(kind: 'nod' | 'shake' | 'bounce' | 'sigh'): void {
    if (this.destroyed) return;

    switch (kind) {
      case 'nod':
        this.tween({
          targets: this.head,
          y: this.head.y + 3,
          duration: 170,
          yoyo: true,
          repeat: 1,
          ease: 'Sine.easeInOut',
        });
        break;
      case 'shake':
        this.tween({
          targets: this.head,
          x: this.head.x - 3,
          duration: 110,
          yoyo: true,
          repeat: 3,
          ease: 'Sine.easeInOut',
        });
        break;
      case 'bounce':
        this.tween({
          targets: this.container,
          y: this.container.y - 6,
          duration: 220,
          yoyo: true,
          repeat: 1,
          ease: 'Quad.easeOut',
        });
        break;
      case 'sigh':
        // Shoulders up, then a longer drop. The asymmetry is the whole gag.
        this.tween({
          targets: [this.leftArm, this.rightArm, this.torso],
          y: '-=3',
          duration: 260,
          ease: 'Sine.easeOut',
          yoyo: true,
          hold: 90,
        });
        break;
    }
  }

  /**
   * A thought bubble: one glyph, briefly.
   *
   * Text rather than art because the vocabulary is punctuation — ? ! … ♪ ✓ —
   * and drawing five more textures to say what a character already says is
   * exactly the kind of cost this scene does not need.
   */
  think(glyph: string, holdMs = 1400): void {
    if (this.destroyed) return;
    this.bubble.setText(glyph);
    this.bubble.setPosition(20, -46).setScale(0.6);

    this.tween({
      targets: this.bubble,
      alpha: 1,
      scale: 1,
      y: -54,
      duration: 260,
      ease: 'Back.easeOut',
    });
    this.tween({
      targets: this.bubble,
      alpha: 0,
      delay: holdMs,
      duration: 260,
      ease: 'Sine.easeIn',
    });
  }

  /**
   * Something in the hand - a mug on its way to a sip.
   *
   * The scene hides the copy on the desk as this one appears, so it reads as
   * the same object picked up. Kept off the behaviour tweens: a behaviour
   * ending must not leave a mug frozen half-faded in mid-air.
   */
  hold(item: HeldItem | null, delayMs = 0): void {
    if (this.destroyed || item === this.holding) return;
    this.holding = item;
    if (item) this.held.setTexture(FOCUS_ART[item]);

    this.heldTween?.stop();
    this.heldTween = this.scene.tweens.add({
      targets: this.held,
      alpha: item ? 1 : 0,
      delay: item ? delayMs : 0,
      duration: FOCUS.props.holdMs,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * A slow, small drift of the head — the motion a person makes without
   * meaning to while their attention is elsewhere.
   *
   * Separate from breathing so behaviours can ask for more or less of it: a
   * zoned-out character drifts a lot, one mid-sentence barely at all.
   */
  drift(amount: number, periodMs: number): void {
    if (this.destroyed) return;
    this.tween({
      targets: this.head,
      x: this.head.x + amount,
      duration: periodMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Follow-through on the torso, delayed behind whatever the arms are doing.
   *
   * The delay is the point: a body that starts and stops with its hands looks
   * rigid, and a fraction of a second of lag is most of what reads as weight.
   */
  settleTorso(y: number, delayMs = 120): void {
    if (this.destroyed) return;
    this.tween({
      targets: this.torso,
      y: this.baseTorsoY + y,
      delay: delayMs,
      duration: 620,
      ease: 'Sine.easeOut',
    });
  }

  /** Stop everything the last behaviour started. Breathing and blinking survive. */
  clearActions(): void {
    for (const tween of this.actions) tween.stop();
    this.actions.clear();
  }

  /** Pause is purely visual: the session clock is not ours to stop. */
  setPaused(paused: boolean): void {
    if (this.destroyed) return;
    for (const tween of [...this.actions, ...this.turns]) paused ? tween.pause() : tween.resume();
    if (paused) this.heldTween?.pause();
    else this.heldTween?.resume();
    if (paused) this.breathTween?.pause();
    else this.breathTween?.resume();
    if (this.blinkTimer) this.blinkTimer.paused = paused;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.clearActions();
    for (const tween of this.turns) tween.stop();
    this.turns.clear();
    this.heldTween?.stop();
    this.breathTween?.stop();
    this.breathTween = undefined;
    this.blinkTimer?.remove();
    this.blinkRestore?.remove();
    this.blinkTimer = undefined;
    this.blinkRestore = undefined;

    this.container.destroy(true);
  }

  // -- internals -------------------------------------------------------------

  /** The only way a behaviour tween is created, so every one is tracked. */
  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween {
    const tween = this.scene.tweens.add(config);
    this.actions.add(tween);
    // Untracked on completion rather than inside onComplete, so a caller's own
    // onComplete is left alone and the set cannot grow across a long session.
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.actions.delete(tween));
    return tween;
  }

  /** Turning tweens: tracked, but not stopped by a behaviour change. */
  private turn(config: Phaser.Types.Tweens.TweenBuilderConfig): void {
    const tween = this.scene.tweens.add(config);
    this.turns.add(tween);
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.turns.delete(tween));
  }

  /**
   * The breath. Small, slow, and never stopped — a character that holds
   * perfectly still between behaviours reads as a paused video, which is the
   * exact impression this whole scene exists to avoid.
   */
  private startBreathing(): void {
    this.breathTween = this.scene.tweens.add({
      targets: [this.torso, this.head],
      y: `-=${FOCUS.idle.breathPixels}`,
      duration: FOCUS.idle.breathMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private scheduleBlink(): void {
    if (this.destroyed) return;
    const { blinkMinMs, blinkMaxMs, blinkMs } = FOCUS.idle;
    const delay = Phaser.Math.Between(blinkMinMs, blinkMaxMs);

    this.blinkTimer = this.scene.time.delayedCall(delay, () => {
      if (this.destroyed) return;

      // Only blink from faces where a blink is legible; a closed-eye pose
      // blinking is a flicker, and a wide-eyed one loses the joke.
      const blinkable =
        this.orientation !== 'back' && this.currentFace !== 'closed' && this.currentFace !== 'tired';
      if (blinkable) {
        const previous = this.currentFace;
        this.setFace('closed');
        this.blinkRestore = this.scene.time.delayedCall(blinkMs, () => {
          if (!this.destroyed && this.currentFace === 'closed') this.setFace(previous);
        });
      }
      this.scheduleBlink();
    });
  }
}

/**
 * The director: the one place the performance and the camera meet.
 *
 * Before this existed the scene wired the behaviour machine straight into the
 * camera, one way. That was enough for a camera that REACTS, but a film is a
 * conversation between the two, and that conversation needs somewhere to
 * live that is not the scene building the set:
 *
 *   performance -> camera   what the avatar starts doing decides what is worth
 *                           filming, and releases a cut waiting for movement
 *                           so it lands on the action;
 *   camera -> performance   while a framing holds, behaviours it frames well
 *                           become likelier — on the hands, the hands work;
 *   both -> sound           the page you see turn is the page you hear turn.
 *
 * It owns no clock. It is driven by the scene's update loop, so a paused or
 * backgrounded session simply stops being directed, and the session timer —
 * which is not this system's — carries on or stops by its own rules.
 */

import Phaser from 'phaser';
import { FOCUS, type WorldCinematic } from '@commons/shared';
import type { FocusAvatar } from '../entities/FocusAvatar';
import { AvatarBehaviorMachine, type BehaviorId, type FocusCue, type PropName } from './AvatarBehavior';
import { FocusCameraController, type ShotDef } from './FocusCamera';
import { sfx } from './Sfx';

export interface DirectorOptions {
  avatar: FocusAvatar;
  camera: Phaser.Cameras.Scene2D.Camera;
  /** What a dip fades through. Pinned over the set, under the HUD. */
  veil: { alpha: number };
  cinematic: WorldCinematic;
  /** Show these desk props and hide the rest. */
  props: (visible: PropName[]) => void;
  /** Something physical happened on the desk; the scene animates it. */
  onCue: (cue: FocusCue) => void;
}

export class FocusCinematicDirector {
  readonly machine: AvatarBehaviorMachine;
  readonly camera: FocusCameraController;

  private paused = false;
  private stopped = false;
  /** Whether the mug is in the avatar's hand, so it always gets put back. */
  private holdingMug = false;

  /** Countdown to the next sound of working, and how many keys are left in a burst. */
  private soundInMs = 0;
  private burstLeft = 0;

  /** Delayed steps of a sequence, counted down by update() so pausing pauses them. */
  private readonly queue: Array<{ inMs: number; run: () => void }> = [];
  private readonly rng = new Phaser.Math.RandomDataGenerator([String(Date.now())]);

  constructor(private readonly options: DirectorOptions) {
    this.machine = new AvatarBehaviorMachine({
      avatar: options.avatar,
      props: options.props,
      cue: (cue) => this.cue(cue),
    });

    this.camera = new FocusCameraController({
      camera: options.camera,
      veil: options.veil,
      cinematic: options.cinematic,
      setOrientation: (orientation, instant) =>
        options.avatar.setOrientation(orientation, instant ? 0 : FOCUS.camera.turnMs),
    });

    this.machine.onBehaviorChange = (id) => this.onBehavior(id);
    this.camera.onShotChange = (shot) => this.onShot(shot);
  }

  /** Action. Called once the set has risen into frame. */
  start(): void {
    this.machine.start();
    this.camera.start();
  }

  update(delta: number): void {
    if (this.stopped || this.paused) return;
    this.machine.update(delta);
    this.camera.update(delta);
    this.runQueue(delta);
    this.playActivity(delta);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.machine.setPaused(paused);
    this.camera.setPaused(paused);
  }

  /**
   * The completion: a realisation, a small celebration, the camera easing out.
   *
   * Forced rather than rolled for — "you finished" is not a probability, and a
   * completion the scheduler could decline to play would be the one moment
   * this system owes the player something.
   */
  finish(): void {
    this.setPaused(false);
    this.queue.length = 0;
    this.camera.playCelebration();
    this.machine.force('realising', FOCUS.exit.realiseMs);
    this.after(FOCUS.exit.realiseMs, () => this.machine.force('celebration', FOCUS.exit.celebrateMs));
    sfx.focusComplete();
  }

  destroy(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.machine.stop();
    this.camera.destroy();
  }

  // -- the conversation -----------------------------------------------------

  private cue(cue: FocusCue): void {
    switch (cue) {
      case 'pageTurn':
        sfx.pageTurn();
        break;
      case 'highlight':
        sfx.highlightStroke();
        break;
      case 'paperShuffle':
        sfx.paperShuffle();
        break;
      case 'penTap':
        sfx.penTaps();
        break;
      case 'mugLift':
        this.holdingMug = true;
        break;
      case 'mugDown':
        if (!this.holdingMug) return;
        this.holdingMug = false;
        sfx.mugSet();
        break;
    }
    this.options.onCue(cue);
  }

  private onBehavior(id: BehaviorId): void {
    // Whatever ended the last behaviour — including a forced finale — a mug in
    // hand goes back on the desk rather than vanishing with the pose.
    if (this.holdingMug && id !== 'sipping') this.cue('mugDown');

    this.burstLeft = 0;
    this.soundInMs = 0;
    this.camera.onBehavior(id);
  }

  /** While a framing holds, favour the behaviours it frames well. Cutaways favour nothing. */
  private onShot(shot: ShotDef): void {
    const bias: Partial<Record<BehaviorId, number>> = {};
    if (!shot.cutaway) {
      for (const id of shot.suits ?? []) bias[id] = FOCUS.camera.behaviorBias;
    }
    this.machine.setBias(bias);
  }

  private after(ms: number, run: () => void): void {
    this.queue.push({ inMs: ms, run });
  }

  private runQueue(delta: number): void {
    const due: Array<() => void> = [];
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      const step = this.queue[i];
      if (!step) continue;
      step.inMs -= delta;
      if (step.inMs <= 0) {
        due.push(step.run);
        this.queue.splice(i, 1);
      }
    }
    for (const run of due.reverse()) run();
  }

  /**
   * The sound of working, while the avatar is working.
   *
   * Paced here rather than looped so it has the rhythm the real thing has:
   * typing comes in bursts with gaps between them, writing in scratches. A
   * looped sample is recognisable as a loop within a minute, and this plays
   * for hours.
   */
  private playActivity(delta: number): void {
    this.soundInMs -= delta;
    if (this.soundInMs > 0) return;

    const { typing, writing, idlePollMs } = FOCUS.audio;
    switch (this.machine.currentId) {
      case 'typing':
        if (this.burstLeft > 0) {
          sfx.keyTap();
          this.burstLeft -= 1;
          this.soundInMs = this.rng.between(typing.minGapMs, typing.maxGapMs);
        } else {
          this.burstLeft = this.rng.between(typing.burstMin, typing.burstMax);
          this.soundInMs = this.rng.between(typing.pauseMinMs, typing.pauseMaxMs);
        }
        break;
      case 'writing':
      case 'takingNotes':
        sfx.penScratch();
        this.soundInMs = this.rng.between(writing.minGapMs, writing.maxGapMs);
        break;
      default:
        this.soundInMs = idlePollMs;
    }
  }
}

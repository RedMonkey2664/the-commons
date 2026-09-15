/**
 * The behaviour system: what the avatar does, and — the harder half — when.
 *
 * The rig (FocusAvatar) can lean, tilt, swing an arm and change expression. It
 * has no idea what studying looks like. This file is the difference between a
 * puppet and a person: a table of behaviours, each with a weight, a duration
 * RANGE, and its own opinion about what tends to follow it.
 *
 * Three things stop it reading as a loop, and all three matter:
 *
 *   1. WEIGHT. Reading and writing are common; celebrating is not. A uniform
 *      pick makes rare behaviours ordinary, which is exactly what drains the
 *      charm out of an idle system — the little discoveries stop being little.
 *
 *   2. HISTORY. The last few behaviours are refused outright, so the classic
 *      write/think/write/think oscillation cannot happen even when those two
 *      carry the most weight.
 *
 *   3. FOLLOW-ON WEIGHTS. Behaviours bias what comes next, so sequences have a
 *      shape: struggling leads to head-scratching and sighs rather than
 *      straight back to serene reading; zoning out leads to catching yourself.
 *      This is what makes a run of behaviours read as one person's train of
 *      thought instead of a shuffled playlist.
 *
 * It owns no timers of its own beyond the one the scene drives via update(),
 * and it never touches the session clock. Pausing it pauses acting, not time.
 */

import Phaser from 'phaser';
import { FOCUS } from '@commons/shared';
import type { FocusAvatar } from '../entities/FocusAvatar';

export type BehaviorId =
  // core study loop
  | 'reading'
  | 'writing'
  | 'typing'
  | 'thinking'
  | 'studying'
  | 'takingNotes'
  | 'lookingAtScreen'
  | 'highlighting'
  | 'turningPage'
  | 'scrolling'
  | 'organizingNotes'
  | 'penTapping'
  // personality
  | 'confused'
  | 'struggling'
  | 'thinkingHard'
  | 'zonedOut'
  | 'realising'
  | 'tired'
  | 'distracted'
  | 'lookingAround'
  | 'stretching'
  | 'smallBreak'
  | 'sipping'
  | 'happyWithProgress'
  | 'celebration'
  // looking after yourself
  | 'rubbingEyes'
  | 'wristStretch'
  // connective tissue
  | 'settle';

/** What a behaviour is handed when it starts. */
export interface BehaviorContext {
  avatar: FocusAvatar;
  /** Desk props live in the scene (they render above the desk, the avatar behind it). */
  props: (visible: PropName[]) => void;
  /**
   * Something physical happens on the desk: a page turns, a mug is picked up.
   * The scene animates the prop and the director plays the sound; the
   * behaviour only says WHEN, which is the part only it knows.
   */
  cue: (cue: FocusCue) => void;
  /** Deterministic per-session randomness, so a session can be replayed in a test. */
  rng: Phaser.Math.RandomDataGenerator;
}

export type PropName = 'book' | 'laptop' | 'paper' | 'pen' | 'mug';

export type FocusCue = 'pageTurn' | 'highlight' | 'paperShuffle' | 'penTap' | 'mugLift' | 'mugDown';

interface BehaviorDef {
  id: BehaviorId;
  /** Base likelihood of being chosen. Relative, not a percentage. */
  weight: number;
  minMs: number;
  maxMs: number;
  /**
   * Behaviours this one tends to lead into, and how strongly. A multiplier on
   * the base weight, applied only when picking the NEXT behaviour.
   */
  leadsTo?: Partial<Record<BehaviorId, number>>;
  /** Allowed to run twice in a row. Almost nothing should be. */
  repeatable?: boolean;
  enter: (ctx: BehaviorContext) => void;
  /**
   * Beats within the behaviour, fired at an offset from its start.
   *
   * This is what makes a behaviour a small performance rather than a pose held
   * for eight seconds. Good animation reads ACTION -> PAUSE -> REACTION, and a
   * single enter() can only ever express the first of those; the pause has to
   * be scheduled, and the thing that happens after it has to be a separate
   * decision. Beats past the behaviour's duration simply never fire, which is
   * what lets a long behaviour have more of them than a short one.
   */
  beats?: Array<{ at: number; run: (ctx: BehaviorContext) => void }>;
}

/**
 * The table.
 *
 * Durations are the quiet half of the design: reading holds for ten seconds and
 * a realisation is over in one. Equal durations are as robotic as equal weights.
 */
const BEHAVIORS: Record<BehaviorId, BehaviorDef> = {
  // ---- core study loop, high frequency ------------------------------------
  reading: {
    id: 'reading',
    weight: 18,
    minMs: 5000,
    maxMs: 12000,
    leadsTo: { thinking: 2.2, takingNotes: 1.8, writing: 1.5, lookingAround: 1.2, turningPage: 2.0, highlighting: 1.6 },
    enter: ({ avatar, props }) => {
      props(['book', 'mug']);
      avatar.setFace('reading');
      avatar.setHands('page');
      avatar.lean(0, 4);
      avatar.tiltHead(3);
      // Eyes tracking down the page: a slow, small head drift, not a nod.
      avatar.fidgetArm('left', 4, 2600);
      avatar.drift(1.5, 4200);
    },
    beats: [
      // Reaching the bottom of a page and going back to the top of the next.
      { at: 4200, run: ({ avatar }) => { avatar.tiltHead(-2, 900); avatar.pop('nod'); } },
      { at: 6100, run: ({ avatar }) => avatar.tiltHead(4, 1100) },
      { at: 9000, run: ({ avatar }) => { avatar.setFace('thinking'); avatar.tiltHead(-5, 800); } },
    ],
  },

  writing: {
    id: 'writing',
    weight: 16,
    minMs: 4000,
    maxMs: 9500,
    leadsTo: { thinking: 2.4, reading: 1.6, happyWithProgress: 1.4, struggling: 1.2, penTapping: 1.4, organizingNotes: 1.2 },
    enter: ({ avatar, props }) => {
      props(['paper', 'pen', 'book']);
      avatar.setFace('reading');
      avatar.setHands('pen');
      avatar.lean(2, 5);
      avatar.tiltHead(6);
      // The scribble. Short throw, quick period — this is the one motion that
      // has to look like effort rather than waving.
      avatar.fidgetArm('right', 7, 260);
      avatar.settleTorso(3);
    },
    beats: [
      // Stop mid-sentence, check the book, carry on. The pause is the beat
      // that makes the writing look like it is about something.
      { at: 2600, run: ({ avatar }) => {
        avatar.clearActions();
        avatar.setHands('pen');
        avatar.setFace('thinking');
        avatar.tiltHead(-6, 600);
      } },
      { at: 4200, run: ({ avatar }) => {
        avatar.setFace('reading');
        avatar.tiltHead(7, 500);
        avatar.fidgetArm('right', 6, 240);
      } },
      { at: 7400, run: ({ avatar }) => { avatar.pop('nod'); avatar.fidgetArm('right', 8, 300); } },
    ],
  },

  typing: {
    id: 'typing',
    weight: 13,
    minMs: 4500,
    maxMs: 10000,
    leadsTo: { lookingAtScreen: 2.4, thinking: 1.8, sipping: 1.3, scrolling: 1.6, wristStretch: 1.2 },
    enter: ({ avatar, props }) => {
      props(['laptop', 'mug']);
      avatar.setFace('neutral');
      avatar.setHands('keyboard');
      avatar.lean(0, 3);
      avatar.tiltHead(0);
      // Two hands at slightly different periods, so they never land together.
      avatar.fidgetArm('left', 5, 180);
      avatar.fidgetArm('right', -5, 210);
    },
    beats: [
      { at: 3000, run: ({ avatar }) => { avatar.clearActions(); avatar.setHands('keyboard'); avatar.setFace('wide'); } },
      { at: 4600, run: ({ avatar }) => { avatar.fidgetArm('left', 5, 170); avatar.fidgetArm('right', -5, 195); avatar.setFace('neutral'); } },
      { at: 8000, run: ({ avatar }) => avatar.pop('nod') },
    ],
  },

  studying: {
    id: 'studying',
    weight: 11,
    minMs: 5000,
    maxMs: 11000,
    leadsTo: { takingNotes: 2.0, thinking: 1.8, reading: 1.5 },
    enter: ({ avatar, props }) => {
      props(['book', 'paper', 'pen']);
      avatar.setFace('reading');
      avatar.setHands('page');
      avatar.lean(-2, 5);
      avatar.tiltHead(-4);
    },
  },

  thinking: {
    id: 'thinking',
    weight: 14,
    minMs: 2800,
    maxMs: 7000,
    leadsTo: { writing: 2.6, typing: 1.8, thinkingHard: 1.4, reading: 1.4, penTapping: 1.8 },
    enter: ({ avatar, props }) => {
      props(['book', 'paper']);
      avatar.setFace('thinking');
      avatar.setHands('chin');
      avatar.lean(-3, -2);
      avatar.tiltHead(-8);
      avatar.drift(2, 3600);
    },
    beats: [
      { at: 1800, run: ({ avatar, rng }) => avatar.setFace(rng.pick(['awayLeft', 'awayRight'] as const)) },
      { at: 3400, run: ({ avatar }) => { avatar.setFace('thinking'); avatar.tiltHead(-12, 900); } },
      { at: 5200, run: ({ avatar }) => { avatar.pop('nod'); avatar.setFace('neutral'); } },
    ],
  },

  lookingAtScreen: {
    id: 'lookingAtScreen',
    weight: 8,
    minMs: 3000,
    maxMs: 7500,
    leadsTo: { typing: 3.0, thinking: 1.6, distracted: 1.3, scrolling: 2.2 },
    enter: ({ avatar, props }) => {
      props(['laptop']);
      avatar.setFace('wide');
      avatar.setHands('rest');
      avatar.lean(0, 1);
      avatar.tiltHead(0);
    },
  },

  takingNotes: {
    id: 'takingNotes',
    weight: 9,
    minMs: 3500,
    maxMs: 8000,
    leadsTo: { reading: 2.2, happyWithProgress: 1.6, writing: 1.4 },
    enter: ({ avatar, props }) => {
      props(['paper', 'pen', 'book']);
      avatar.setFace('reading');
      avatar.setHands('pen');
      avatar.lean(3, 6);
      avatar.tiltHead(9);
      avatar.fidgetArm('right', 5, 320);
    },
  },

  // ---- more of the work itself ----------------------------------------------
  highlighting: {
    id: 'highlighting',
    weight: 7,
    minMs: 3500,
    maxMs: 7500,
    leadsTo: { reading: 2.0, takingNotes: 1.8, turningPage: 1.6 },
    enter: ({ avatar, props, cue }) => {
      props(['book']);
      avatar.setFace('reading');
      avatar.setHands('highlight', 420);
      avatar.lean(-2, 5);
      avatar.tiltHead(-5);
      // One stroke along the line, back and forth, the length of a sentence.
      avatar.fidgetArm('right', 5, 420, 420);
      cue('highlight');
    },
    beats: [
      // Lift the pen, read on, find the next bit worth keeping.
      { at: 1900, run: ({ avatar }) => { avatar.clearActions(); avatar.setHands('page', 320); avatar.tiltHead(-2, 500); } },
      { at: 3000, run: ({ avatar, cue }) => {
        avatar.setHands('highlight', 320);
        avatar.fidgetArm('right', 5, 400, 320);
        cue('highlight');
      } },
      { at: 5400, run: ({ avatar }) => { avatar.clearActions(); avatar.setHands('page', 360); avatar.pop('nod'); } },
    ],
  },

  turningPage: {
    id: 'turningPage',
    weight: 6,
    minMs: 2600,
    maxMs: 4200,
    leadsTo: { reading: 3.0, highlighting: 1.4, studying: 1.4 },
    enter: ({ avatar, props }) => {
      props(['book']);
      avatar.setFace('reading');
      avatar.setHands('page');
      avatar.lean(-1, 4);
      avatar.tiltHead(-3);
    },
    beats: [
      // Finish the line, THEN turn. The pause before is the whole read.
      { at: 700, run: ({ avatar, cue }) => { avatar.setHands('pageLift', FOCUS.props.pageTurnMs); cue('pageTurn'); } },
      { at: 780 + FOCUS.props.pageTurnMs, run: ({ avatar }) => { avatar.setHands('page', 420); avatar.tiltHead(3, 700); } },
      { at: 2300, run: ({ avatar }) => avatar.pop('nod') },
    ],
  },

  scrolling: {
    id: 'scrolling',
    weight: 6,
    minMs: 3500,
    maxMs: 8000,
    leadsTo: { typing: 2.2, reading: 1.5, thinking: 1.5 },
    enter: ({ avatar, props }) => {
      props(['laptop']);
      avatar.setFace('reading');
      avatar.setHands('keyboard', 360);
      avatar.lean(0, 2);
      avatar.tiltHead(-2);
      // One finger on the trackpad: slow and small, the other hand still.
      avatar.fidgetArm('right', -3, 700, 360);
      avatar.drift(1, 5200);
    },
    beats: [
      // Found it.
      { at: 2600, run: ({ avatar }) => { avatar.setFace('wide'); avatar.tiltHead(0, 400); } },
      { at: 3600, run: ({ avatar }) => { avatar.setFace('reading'); avatar.tiltHead(-3, 800); } },
    ],
  },

  organizingNotes: {
    id: 'organizingNotes',
    weight: 4,
    minMs: 2800,
    maxMs: 5000,
    leadsTo: { writing: 2.0, reading: 1.8, happyWithProgress: 1.4 },
    enter: ({ avatar, props, cue }) => {
      props(['paper', 'pen', 'book']);
      avatar.setFace('reading');
      avatar.setHands('keyboard', 360);
      avatar.lean(3, 5);
      avatar.tiltHead(6);
      cue('paperShuffle');
    },
    beats: [
      { at: 1200, run: ({ avatar, cue }) => { avatar.pop('nod'); cue('paperShuffle'); } },
      // Squared up. Small satisfaction, back to it.
      { at: 2400, run: ({ avatar }) => { avatar.setHands('pen', 400); avatar.tiltHead(9, 600); avatar.setFace('happy'); } },
    ],
  },

  penTapping: {
    id: 'penTapping',
    weight: 5,
    minMs: 2600,
    maxMs: 5200,
    leadsTo: { writing: 2.6, realising: 1.8, thinkingHard: 1.4 },
    enter: ({ avatar, props, cue }) => {
      props(['paper', 'pen', 'book']);
      avatar.setFace('thinking');
      avatar.setHands('tap', 380);
      avatar.lean(-2, 1);
      avatar.tiltHead(-6);
      avatar.fidgetArm('right', 6, 120, 380);
      cue('penTap');
    },
    beats: [
      // Tap, tap, stop - look away - tap again. The stop is the thought.
      { at: 1300, run: ({ avatar }) => { avatar.clearActions(); avatar.setHands('tap', 200); avatar.setFace('awayRight'); } },
      { at: 2300, run: ({ avatar, cue }) => { avatar.fidgetArm('right', 6, 110); avatar.setFace('thinking'); cue('penTap'); } },
      { at: 3800, run: ({ avatar }) => { avatar.clearActions(); avatar.setHands('tap', 200); avatar.tiltHead(-10, 700); } },
    ],
  },

  // ---- looking after yourself, low frequency ------------------------------
  rubbingEyes: {
    id: 'rubbingEyes',
    weight: 3,
    minMs: 2400,
    maxMs: 3800,
    leadsTo: { sipping: 2.2, stretching: 1.8, reading: 1.6, wristStretch: 1.2 },
    enter: ({ avatar }) => {
      avatar.setFace('closed');
      avatar.setHands('eyes', 520);
      avatar.lean(0, 3, 600);
      avatar.tiltHead(0, 400);
      // Small circles, the two hands out of step.
      avatar.fidgetArm('left', -4, 190, 520);
      avatar.fidgetArm('right', 4, 230, 520);
    },
    beats: [
      { at: 1500, run: ({ avatar }) => { avatar.clearActions(); avatar.setHands('rest', 600); avatar.pop('sigh'); } },
      { at: 2200, run: ({ avatar }) => { avatar.setFace('tired'); avatar.lean(0, 1, 700); } },
      { at: 3000, run: ({ avatar }) => { avatar.setFace('neutral'); avatar.pop('nod'); } },
    ],
  },

  wristStretch: {
    id: 'wristStretch',
    weight: 3,
    minMs: 2600,
    maxMs: 4000,
    leadsTo: { typing: 2.4, writing: 2.0, reading: 1.4 },
    enter: ({ avatar }) => {
      avatar.setFace('closed');
      avatar.setHands('wrist', 560);
      avatar.lean(0, -2, 560);
      avatar.tiltHead(0);
    },
    beats: [
      // Push out and hold...
      { at: 900, run: ({ avatar }) => { avatar.fidgetArm('left', -5, 520); avatar.fidgetArm('right', 5, 520); } },
      // ...then shake them loose over the keys.
      { at: 2000, run: ({ avatar }) => {
        avatar.clearActions();
        avatar.setHands('keyboard', 420);
        avatar.fidgetArm('left', 8, 90, 420);
        avatar.fidgetArm('right', -8, 100, 420);
        avatar.setFace('neutral');
      } },
      { at: 2800, run: ({ avatar }) => { avatar.clearActions(); avatar.setHands('rest', 400); avatar.settleTorso(1); } },
    ],
  },

  // ---- medium frequency, the texture between work -------------------------
  lookingAround: {
    id: 'lookingAround',
    weight: 6,
    minMs: 2200,
    maxMs: 5000,
    leadsTo: { reading: 2.0, thinking: 1.5, distracted: 1.6, stretching: 1.2 },
    enter: ({ avatar, props, rng }) => {
      props(['book']);
      avatar.setHands('rest');
      avatar.lean(0, -2);
      // Look one way, then the other. Which way first is a coin flip, and that
      // coin is most of why this never looks like the same beat twice.
      const first = rng.pick(['awayLeft', 'awayRight'] as const);
      avatar.setFace(first);
      avatar.tiltHead(first === 'awayLeft' ? -10 : 10, 500);
    },
  },

  stretching: {
    id: 'stretching',
    weight: 5,
    minMs: 2400,
    maxMs: 4000,
    leadsTo: { reading: 2.0, sipping: 1.8, smallBreak: 1.5, typing: 1.3 },
    enter: ({ avatar }) => {
      avatar.setFace('closed');
      avatar.setHands('up', 620);
      avatar.lean(0, -5, 620);
      avatar.tiltHead(0);
      avatar.pop('sigh');
    },
    beats: [
      // Arms down, shoulders settle after them — the follow-through is what
      // makes a stretch read as relief rather than a shape change.
      { at: 1500, run: ({ avatar }) => { avatar.setHands('rest', 700); avatar.settleTorso(2, 220); } },
      { at: 2400, run: ({ avatar }) => { avatar.setFace('neutral'); avatar.pop('nod'); } },
    ],
  },

  sipping: {
    id: 'sipping',
    weight: 4,
    minMs: 2600,
    maxMs: 4500,
    leadsTo: { reading: 2.2, typing: 1.8, thinking: 1.3, scrolling: 1.2 },
    enter: ({ avatar, props, cue }) => {
      props(['book']);
      avatar.setFace('neutral');
      avatar.setHands('mug', 480);
      avatar.lean(0, -1);
      avatar.tiltHead(-4);
      // Off the desk and into the hand, arriving with the arm.
      cue('mugLift');
    },
    beats: [
      { at: 700, run: ({ avatar }) => { avatar.setFace('closed'); avatar.tiltHead(-8, 600); } },
      { at: 1900, run: ({ avatar }) => { avatar.setFace('happy'); avatar.tiltHead(-2, 500); } },
      // Put down before the behaviour can end (minMs is longer than this), so
      // the hand holding the mug is the one that puts it back.
      { at: 2400, run: ({ avatar, cue }) => { avatar.setHands('rest', 420); cue('mugDown'); } },
    ],
  },

  smallBreak: {
    id: 'smallBreak',
    weight: 4,
    minMs: 3000,
    maxMs: 6000,
    leadsTo: { reading: 1.8, stretching: 1.6, tired: 1.3, typing: 1.4 },
    enter: ({ avatar, props }) => {
      props(['mug']);
      avatar.setFace('neutral');
      avatar.setHands('behindHead', 560);
      avatar.lean(0, -4, 560);
      avatar.tiltHead(-3);
    },
  },

  // ---- low frequency: the ones that should feel like a discovery ----------
  confused: {
    id: 'confused',
    weight: 3,
    minMs: 2400,
    maxMs: 4500,
    leadsTo: { thinkingHard: 3.0, reading: 2.0, struggling: 2.2 },
    enter: ({ avatar, props }) => {
      props(['book', 'paper']);
      avatar.setFace('strained');
      avatar.setHands('chin');
      avatar.tiltHead(-12);
      avatar.think('?');
    },
  },

  struggling: {
    id: 'struggling',
    weight: 3,
    minMs: 3000,
    maxMs: 6500,
    leadsTo: { thinkingHard: 2.6, tired: 1.8, smallBreak: 1.6, realising: 1.5, rubbingEyes: 1.4 },
    enter: ({ avatar, props }) => {
      props(['paper', 'pen']);
      avatar.setFace('strained');
      avatar.setHands('behindHead');
      avatar.lean(0, 2);
      avatar.pop('shake');
      avatar.pop('sigh');
    },
    beats: [
      // Give up on it, look away, come back at it differently.
      { at: 1600, run: ({ avatar }) => { avatar.setFace('tired'); avatar.setHands('rest'); avatar.lean(-4, 4, 900); } },
      { at: 3200, run: ({ avatar, rng }) => avatar.setFace(rng.pick(['awayLeft', 'awayRight'] as const)) },
      { at: 4600, run: ({ avatar }) => { avatar.setFace('thinking'); avatar.setHands('chin'); avatar.lean(0, 1, 700); avatar.think('…'); } },
    ],
  },

  thinkingHard: {
    id: 'thinkingHard',
    weight: 3,
    minMs: 2600,
    maxMs: 5500,
    leadsTo: { realising: 2.4, writing: 2.0, struggling: 1.4 },
    enter: ({ avatar, props }) => {
      props(['book', 'paper']);
      avatar.setFace('thinking');
      avatar.setHands('chin');
      avatar.lean(-4, 3);
      avatar.tiltHead(-14);
      avatar.think('…');
    },
  },

  realising: {
    id: 'realising',
    weight: 2,
    minMs: 1400,
    maxMs: 2600,
    leadsTo: { writing: 4.0, typing: 3.0, happyWithProgress: 1.6 },
    enter: ({ avatar }) => {
      // The moment it lands: head up, eyes wide, straight back to work after.
      avatar.setFace('wide');
      avatar.setHands('rest', 200);
      avatar.lean(0, -4, 240);
      avatar.tiltHead(0, 200);
      avatar.pop('nod');
      avatar.think('!');
    },
  },

  zonedOut: {
    id: 'zonedOut',
    weight: 2,
    minMs: 3500,
    maxMs: 7000,
    leadsTo: { realising: 3.5, tired: 1.6, lookingAround: 1.4, rubbingEyes: 1.5 },
    enter: ({ avatar, props }) => {
      props(['book']);
      avatar.setFace('tired');
      avatar.setHands('chin');
      avatar.lean(-2, 4, 900);
      avatar.tiltHead(-6, 900);
      // Barely moving, and slowly. Absence of motion is the performance here.
      avatar.drift(3, 6000);
    },
    beats: [
      { at: 2400, run: ({ avatar }) => avatar.setFace('awayLeft') },
      { at: 4800, run: ({ avatar }) => avatar.tiltHead(-10, 2200) },
    ],
  },

  distracted: {
    id: 'distracted',
    weight: 3,
    minMs: 2200,
    maxMs: 4500,
    leadsTo: { realising: 2.8, lookingAround: 1.8, reading: 1.5 },
    enter: ({ avatar, rng }) => {
      avatar.setFace(rng.pick(['awayLeft', 'awayRight'] as const));
      avatar.setHands('rest');
      avatar.lean(rng.pick([-5, 5]), -1);
      avatar.tiltHead(rng.pick([-12, 12]));
    },
  },

  tired: {
    id: 'tired',
    weight: 2,
    minMs: 3000,
    maxMs: 6000,
    leadsTo: { stretching: 2.6, sipping: 2.2, smallBreak: 1.8, rubbingEyes: 2.4 },
    enter: ({ avatar, props }) => {
      props(['book', 'mug']);
      avatar.setFace('tired');
      avatar.setHands('rest');
      avatar.lean(0, 6, 900);
      avatar.tiltHead(4, 900);
      avatar.pop('sigh');
    },
  },

  happyWithProgress: {
    id: 'happyWithProgress',
    weight: 3,
    minMs: 1800,
    maxMs: 3200,
    leadsTo: { reading: 2.2, writing: 2.0, celebration: 1.2, typing: 1.6 },
    enter: ({ avatar, props }) => {
      props(['paper', 'pen']);
      avatar.setFace('happy');
      avatar.setHands('rest', 260);
      avatar.lean(0, -3, 300);
      avatar.tiltHead(0);
      avatar.pop('nod');
      avatar.think('✓');
    },
  },

  celebration: {
    id: 'celebration',
    weight: 1,
    minMs: 1600,
    maxMs: 2600,
    leadsTo: { reading: 2.6, writing: 2.0, sipping: 1.4 },
    enter: ({ avatar }) => {
      avatar.setFace('happy');
      avatar.setHands('up', 240);
      avatar.pop('bounce');
      avatar.think('♪');
    },
  },

  // ---- connective tissue ---------------------------------------------------
  /**
   * A beat of nothing.
   *
   * Not chosen by weight — the scheduler inserts it between behaviours. Without
   * it every transition is one pose snapping into the next, and the eye reads
   * a machine cycling. Stillness is what makes the next movement feel chosen.
   */
  settle: {
    id: 'settle',
    weight: 0,
    minMs: FOCUS.behavior.settleMinMs,
    maxMs: FOCUS.behavior.settleMaxMs,
    repeatable: true,
    enter: ({ avatar }) => {
      avatar.setHands('rest', 520);
      avatar.lean(0, 0, 620);
      avatar.tiltHead(0, 520);
      if (avatar.face !== 'closed') avatar.setFace('neutral');
    },
  },
};

/** Everything the scheduler may pick. `settle` is inserted, never chosen. */
const PICKABLE = (Object.keys(BEHAVIORS) as BehaviorId[]).filter((id) => BEHAVIORS[id].weight > 0);

export class AvatarBehaviorMachine {
  private current?: BehaviorDef;
  /** Milliseconds left in the current behaviour. Counts down, so pausing is trivial. */
  private remainingMs = 0;
  /** Milliseconds since the current behaviour started, for firing its beats. */
  private elapsedMs = 0;
  private beatsFired = 0;

  /** Fires when the behaviour changes, so the camera can react to it. */
  onBehaviorChange?: (id: BehaviorId) => void;
  private readonly history: BehaviorId[] = [];
  private paused = false;
  private stopped = false;
  private pendingSettle = false;
  /** A temporary thumb on the scale from outside - the camera, via the director. */
  private bias: Partial<Record<BehaviorId, number>> = {};

  private readonly rng: Phaser.Math.RandomDataGenerator;

  constructor(
    private readonly ctx: Omit<BehaviorContext, 'rng'>,
    seed?: string,
  ) {
    // Seeded so a session is reproducible when a test asks for one, while a
    // real session (no seed) differs every time.
    this.rng = new Phaser.Math.RandomDataGenerator([seed ?? String(Date.now())]);
  }

  /**
   * Favour some behaviours for a while: the director's way of saying "the
   * camera is on the hands now". A multiplier on the table's own weights and
   * follow-ons, never a filter, so history still refuses repeats.
   */
  setBias(bias: Partial<Record<BehaviorId, number>>): void {
    this.bias = bias;
  }

  get currentId(): BehaviorId | undefined {
    return this.current?.id;
  }

  /** Roughly how long the current behaviour has left, for the camera to plan against. */
  get remainingForCamera(): number {
    return Math.max(0, this.remainingMs);
  }

  /** The last few behaviours, newest last. Exposed for tests and the console. */
  get recent(): readonly BehaviorId[] {
    return this.history;
  }

  start(): void {
    this.stopped = false;
    this.enter(BEHAVIORS.reading);
  }

  /**
   * Drive the scheduler. `delta` is real elapsed milliseconds.
   *
   * Deliberately fed from the scene's update loop rather than a timer: a timer
   * keeps firing when the tab is backgrounded and a hidden Focus Mode would
   * burn through fifty behaviours nobody saw. The clock is unaffected either
   * way — it is wall-time, and it is not ours.
   */
  update(delta: number): void {
    if (this.paused || this.stopped || !this.current) return;

    this.elapsedMs += delta;
    this.remainingMs -= delta;

    // Beats inside the behaviour: the pause, and the thing that happens after
    // it. Fired in order and only once each, so a long behaviour performs and a
    // short one simply never reaches its later beats.
    const beats = this.current.beats;
    while (beats && this.beatsFired < beats.length && this.elapsedMs >= (beats[this.beatsFired]?.at ?? Infinity)) {
      beats[this.beatsFired]?.run({ ...this.ctx, rng: this.rng });
      this.beatsFired += 1;
    }

    if (this.remainingMs > 0) return;

    // A settle beat is inserted after some behaviours, never two in a row.
    if (this.pendingSettle) {
      this.pendingSettle = false;
      this.enter(BEHAVIORS.settle);
      return;
    }

    this.enter(this.pickNext());
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.ctx.avatar.setPaused(paused);
  }

  /**
   * Force a specific behaviour — the completion sequence uses this.
   *
   * Kept off the weighted path on purpose: "the session just ended" is not a
   * probability, and the celebration must not be something the scheduler can
   * decide to skip.
   */
  force(id: BehaviorId, holdMs?: number): void {
    this.enter(BEHAVIORS[id], holdMs);
  }

  stop(): void {
    this.stopped = true;
    this.current = undefined;
  }

  // -- selection -------------------------------------------------------------

  private enter(def: BehaviorDef, holdMs?: number): void {
    this.current = def;
    this.ctx.avatar.clearActions();
    def.enter({ ...this.ctx, rng: this.rng });

    this.remainingMs = holdMs ?? this.rng.between(def.minMs, def.maxMs);
    this.elapsedMs = 0;
    this.beatsFired = 0;
    this.onBehaviorChange?.(def.id);

    if (def.id !== 'settle') {
      this.history.push(def.id);
      while (this.history.length > FOCUS.behavior.historySize) this.history.shift();
      this.pendingSettle = this.rng.frac() < FOCUS.behavior.settleChance;
    }
  }

  /**
   * Weighted pick, with the recent history refused outright.
   *
   * The refusal is a filter rather than a weight of zero because a weight can
   * still be selected when everything else is unlucky, and "still" is all it
   * takes for the player to notice the same three behaviours cycling.
   */
  private pickNext(): BehaviorDef {
    const previous = this.current;
    const bias = previous?.leadsTo ?? {};

    const candidates = PICKABLE.filter((id) => {
      if (this.history.includes(id)) return false;
      return !(id === previous?.id && !BEHAVIORS[id].repeatable);
    });

    // History can exclude everything on a short table; fall back to "anything
    // but the one just played" rather than repeating it.
    const pool = candidates.length > 0
      ? candidates
      : PICKABLE.filter((id) => id !== previous?.id);

    const weights = pool.map((id) => BEHAVIORS[id].weight * (bias[id] ?? 1) * (this.bias[id] ?? 1));
    const total = weights.reduce((sum, w) => sum + w, 0);

    let roll = this.rng.frac() * total;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) return BEHAVIORS[pool[i] as BehaviorId];
    }
    return BEHAVIORS[pool[pool.length - 1] as BehaviorId];
  }
}

/** Exposed for tests: the table itself, so a suite can assert on its shape. */
export const BEHAVIOR_TABLE = BEHAVIORS;

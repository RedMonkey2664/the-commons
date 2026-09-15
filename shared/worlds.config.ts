/**
 * World progression — where focus time takes you.
 *
 * The loop the whole system exists to make felt: you study, the hours add up,
 * and the hours open worlds. A world is where you STUDY — the room Focus Mode
 * drops you into, the sky outside its window, the dust in its lamplight — so
 * unlocking one changes the place you spend the next hour, not a badge in a
 * menu.
 *
 * Config over code, the same rule as zones.config.ts. Adding a sixth world is
 * one entry here and one palette in designTokens; the world map, the rocket,
 * the unlock logic and the progress bar all read this list and never name a
 * world themselves.
 *
 * Thresholds are in HOURS because that is how a person thinks about them, and
 * are converted to seconds exactly once, below. Everything that compares
 * against focus time compares seconds to seconds.
 */

import type { WorldPaletteId } from './designTokens.js';

export type WorldId = 'home' | 'forest' | 'orbit' | 'summit' | 'deepField';

/** What drifts through the lamplight. Timings for each live in animationConfig. */
export type FocusParticleMood = 'dust' | 'fireflies' | 'stars' | 'snow' | 'nebula';

/**
 * How Focus Mode is FILMED in this world.
 *
 * The palette decides what a world looks like; this decides how it feels to
 * sit in. Orbit is slow and keeps looking out of the window, because the
 * window is the point of being in orbit.
 */
export interface WorldCinematic {
  particles: FocusParticleMood;
  /** Multiplies every shot's hold. Above 1 is slower and dreamier. */
  pace: number;
  /** Relative weights of the environment cutaways here. */
  cutaways: { window: number; lamp: number; mug: number };
}

export interface WorldDefinition {
  id: WorldId;
  name: string;
  /** Cumulative focus hours needed to unlock. The first world must be 0. */
  requiredFocusHours: number;
  /** One line, shown once the world is yours. */
  description: string;
  /**
   * What a LOCKED world says about itself. Deliberately less than the
   * description: enough to make someone curious, not enough to spoil it.
   */
  teaser: string;
  /** Colours for the room, the sky and the dust. Lives in designTokens. */
  palette: WorldPaletteId;
  cinematic: WorldCinematic;
}

export const WORLD_PROGRESS_CONFIG: readonly WorldDefinition[] = [
  {
    id: 'home',
    name: 'The Commons',
    requiredFocusHours: 0,
    description: 'Where it starts. A desk above the square, and the town going quiet at dusk.',
    teaser: 'Home.',
    palette: 'dusk',
    cinematic: { particles: 'dust', pace: 1, cutaways: { window: 1, lamp: 1.4, mug: 1.2 } },
  },
  {
    id: 'forest',
    name: 'Greenwood',
    requiredFocusHours: 5,
    description: 'A cabin under the trees. Fireflies at the glass, and nothing to hear but rain.',
    teaser: 'Somewhere green. You can almost hear it.',
    palette: 'forest',
    cinematic: { particles: 'fireflies', pace: 1.1, cutaways: { window: 1.6, lamp: 1, mug: 1 } },
  },
  {
    id: 'orbit',
    name: 'Low Orbit',
    requiredFocusHours: 15,
    description: 'A desk on a station, the whole planet turning in the window while you work.',
    teaser: 'Up. Much further up.',
    palette: 'orbit',
    cinematic: { particles: 'stars', pace: 1.25, cutaways: { window: 2.4, lamp: 0.6, mug: 0.8 } },
  },
  {
    id: 'summit',
    name: 'The Summit',
    requiredFocusHours: 30,
    description: 'A lodge above the clouds. Cold air, clear head, snow drifting past the lamp.',
    teaser: 'High, cold, and very quiet.',
    palette: 'summit',
    cinematic: { particles: 'snow', pace: 1.1, cutaways: { window: 2, lamp: 1.2, mug: 0.8 } },
  },
  {
    id: 'deepField',
    name: 'The Deep Field',
    requiredFocusHours: 50,
    description: 'Past everything. A desk at the edge of the map, lit by galaxies.',
    teaser: '???',
    palette: 'deepField',
    cinematic: { particles: 'nebula', pace: 1.3, cutaways: { window: 2.2, lamp: 0.8, mug: 0.8 } },
  },
];

export const SECONDS_PER_HOUR = 3600;

export function requiredSeconds(world: WorldDefinition): number {
  return world.requiredFocusHours * SECONDS_PER_HOUR;
}

export function getWorld(id: string): WorldDefinition | undefined {
  return WORLD_PROGRESS_CONFIG.find((w) => w.id === id);
}

export function isWorldUnlocked(world: WorldDefinition, focusSeconds: number): boolean {
  return focusSeconds >= requiredSeconds(world);
}

/** Every world the given focus time has opened, in order. Never empty. */
export function unlockedWorlds(focusSeconds: number): WorldDefinition[] {
  const open = WORLD_PROGRESS_CONFIG.filter((w) => isWorldUnlocked(w, focusSeconds));
  return open.length > 0 ? open : [WORLD_PROGRESS_CONFIG[0] as WorldDefinition];
}

export interface WorldProgress {
  /** The furthest world unlocked so far. */
  latestUnlocked: WorldDefinition;
  /** The next world to earn, or undefined once all are open. */
  next?: WorldDefinition;
  /** 0..1 progress from the latest unlocked world's threshold to the next. */
  fraction: number;
  /** Focus seconds still needed for the next world. 0 when there is none. */
  remainingSeconds: number;
}

/**
 * Where a given amount of focus time stands on the path.
 *
 * The fraction is measured between THRESHOLDS, not from zero: at 12h toward a
 * 15h world that was unlocked-from at 5h, the bar is 70% full, not 80%. A bar
 * that starts most of the way full every time you unlock something feels like
 * no progress at all.
 */
export function worldProgress(focusSeconds: number): WorldProgress {
  const open = unlockedWorlds(focusSeconds);
  const latestUnlocked = open[open.length - 1] as WorldDefinition;
  const next = WORLD_PROGRESS_CONFIG.find((w) => !isWorldUnlocked(w, focusSeconds));

  if (!next) return { latestUnlocked, fraction: 1, remainingSeconds: 0 };

  const from = requiredSeconds(latestUnlocked);
  const to = requiredSeconds(next);
  const fraction = Math.min(1, Math.max(0, (focusSeconds - from) / (to - from)));

  return { latestUnlocked, next, fraction, remainingSeconds: Math.max(0, to - focusSeconds) };
}

/**
 * Worlds newly opened by moving from one total to another.
 *
 * What the unlock celebration is built on: it asks "did this session cross a
 * threshold", which is a question about two numbers, not about a stored flag
 * that could disagree with the total it was derived from.
 */
export function worldsCrossed(beforeSeconds: number, afterSeconds: number): WorldDefinition[] {
  return WORLD_PROGRESS_CONFIG.filter(
    (w) => !isWorldUnlocked(w, beforeSeconds) && isWorldUnlocked(w, afterSeconds),
  );
}

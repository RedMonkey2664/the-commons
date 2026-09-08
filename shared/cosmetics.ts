/**
 * Cosmetic unlocks — 06, Phase 5.
 *
 * "High scores or milestones could unlock cosmetic character customization
 * (hat, outfit colour) — gives the arcade a reason to be revisited without
 * turning the whole game into a grind economy."
 *
 * Two constraints from that sentence shape everything here:
 *
 *   1. COSMETIC ONLY. Nothing unlocked here changes what a player can do. 11's
 *      first pillar is presence over performance; an unlock that affected
 *      movement, study tracking or minigame odds would turn a hangout into a
 *      progression game.
 *   2. NOT A GRIND. Thresholds are low and reachable in a session or two, and
 *      there is no currency, no streak and no daily anything. 11 is explicit
 *      that competition stays contained to the Arcade.
 *
 * Unlocks are derived, never stored as a separate "owned" list: given a
 * player's scores and study time, the set of unlocked cosmetics is a pure
 * function. That means no migration when a threshold is tuned, and no way for
 * the two to disagree.
 */

export type CosmeticSlot = 'outfit' | 'hat';

/** Hat shapes the character renderer knows how to draw. */
export type HatStyle = 'cap' | 'beanie' | 'headphones';

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  displayName: string;
  /** Body colour for outfits; accent colour for hats. */
  color: string;
  /**
   * Which shape the renderer draws, for hats.
   *
   * Named here rather than switched on `id` in the art code so a new hat is a
   * new entry in this list plus one shape, never an edit to a character
   * drawing routine that knows about specific cosmetics.
   */
  style?: HatStyle;
  /** How it is earned. Shown in the UI so the requirement is never a mystery. */
  requirement: CosmeticRequirement;
}

export type CosmeticRequirement =
  | { kind: 'default' }
  /** Reach a score in one minigame. */
  | { kind: 'score'; minigameId: string; score: number }
  /** Play any minigame this many times. */
  | { kind: 'plays'; count: number }
  /** Accrue this much study time, in minutes. */
  | { kind: 'study'; minutes: number };

export const COSMETICS: Cosmetic[] = [
  // Defaults — always available, so nobody starts with nothing.
  { id: 'outfit_blue', slot: 'outfit', displayName: 'Blue', color: '#3E6FB5', requirement: { kind: 'default' } },
  { id: 'outfit_rust', slot: 'outfit', displayName: 'Rust', color: '#C4644A', requirement: { kind: 'default' } },
  { id: 'outfit_violet', slot: 'outfit', displayName: 'Violet', color: '#7A5FA8', requirement: { kind: 'default' } },

  // Arcade unlocks. Deliberately modest numbers: a reason to come back, not a
  // target to farm.
  {
    id: 'outfit_green',
    slot: 'outfit',
    displayName: 'Moss',
    color: '#3E8E6F',
    requirement: { kind: 'score', minigameId: 'memory_match', score: 400 },
  },
  {
    id: 'outfit_amber',
    slot: 'outfit',
    displayName: 'Amber',
    color: '#C08A3E',
    requirement: { kind: 'score', minigameId: 'retro_runner', score: 300 },
  },
  {
    id: 'outfit_plum',
    slot: 'outfit',
    displayName: 'Plum',
    color: '#8E4A72',
    requirement: { kind: 'score', minigameId: 'trivia_blitz', score: 400 },
  },
  {
    id: 'hat_cap',
    slot: 'hat',
    displayName: 'Cap',
    color: '#E8613C',
    style: 'cap',
    requirement: { kind: 'plays', count: 5 },
  },
  {
    id: 'hat_beanie',
    slot: 'hat',
    displayName: 'Beanie',
    color: '#4A9DD9',
    style: 'beanie',
    requirement: { kind: 'plays', count: 12 },
  },

  // One from the study side, so the Arcade is not the only thing that gives
  // anything back — and it is time spent, not performance.
  {
    id: 'hat_headphones',
    slot: 'hat',
    displayName: 'Headphones',
    color: '#3E8E6F',
    style: 'headphones',
    requirement: { kind: 'study', minutes: 60 },
  },
];

export interface CosmeticProgress {
  /** Best score per minigame id. */
  bestScores: Record<string, number>;
  /** Total minigame runs recorded. */
  totalPlays: number;
  studyMinutes: number;
}

export function isUnlocked(cosmetic: Cosmetic, progress: CosmeticProgress): boolean {
  const req = cosmetic.requirement;
  switch (req.kind) {
    case 'default':
      return true;
    case 'score':
      return (progress.bestScores[req.minigameId] ?? 0) >= req.score;
    case 'plays':
      return progress.totalPlays >= req.count;
    case 'study':
      return progress.studyMinutes >= req.minutes;
  }
}

export function unlockedCosmetics(progress: CosmeticProgress): Cosmetic[] {
  return COSMETICS.filter((c) => isUnlocked(c, progress));
}

export function describeRequirement(cosmetic: Cosmetic): string {
  const req = cosmetic.requirement;
  switch (req.kind) {
    case 'default':
      return 'available from the start';
    case 'score':
      return `score ${req.score} in ${req.minigameId.replace(/_/g, ' ')}`;
    case 'plays':
      return `play ${req.count} arcade rounds`;
    case 'study':
      return `study for ${req.minutes} minutes`;
  }
}

export function getCosmetic(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id);
}

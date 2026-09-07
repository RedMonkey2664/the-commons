/**
 * Every animation timing in the game, in one file.
 *
 * These numbers come from 10_ANIMATION_SPEC.md and are implemented as
 * specified. Tune by feel here — never by inlining a magic number in a scene.
 *
 * Three constants are additions rather than transcriptions, marked [ADDED]:
 * the spec described the behaviour but not the number.
 */

export const MOVEMENT = {
  /** Tile-to-tile tween, "walk". 10_ANIMATION_SPEC.md. */
  walkTileMs: 130,
  /** Reserved for a future Shift-to-run toggle. Not wired up in v1. */
  runTileMs: 80,
  /** Walk cycle playback rate. Deliberately choppy — that's the GBA look. */
  walkFrameRate: 8,
  /**
   * [ADDED] Tap a direction you aren't facing and you turn in place instead of
   * moving; hold it and you turn then walk. This is core FireRed feel but the
   * spec only covered turning while blocked. Set to 0 to move immediately.
   */
  turnInPlaceMs: 60,
  /** Snappy and deliberate, never floaty. No bounce/elastic here. */
  easing: 'Linear',
} as const;

export const BUMP = {
  /**
   * Nudge toward the blocked tile, then spring back. Read as a 60ms yoyo
   * (60 out + 60 back), not 30/30.
   */
  nudgeMs: 60,
  /** Quarter of a tile. */
  nudgeFraction: 0.25,
  easing: 'Quad.easeOut',
} as const;

export const SIT = {
  /** Cross-fade standing -> seated. Position snaps, it does not tween. */
  crossFadeMs: 150,
  /** Status icon waits for the sit to finish, so two things never move at once. */
  statusIconDelayMs: 200,
  statusIconFadeMs: 200,
} as const;

export const ZONE_TRANSITION = {
  fadeOutMs: 250,
  /** [ADDED] Spec says "brief hold" without a number. */
  holdMs: 80,
  fadeInMs: 250,
  /** Fade, not wipe. Picked once, used everywhere — consistency over choice. */
  style: 'fade',
} as const;

/** Ambient world loops. Texture, not gameplay — keep these cheap. */
export const AMBIENT = {
  grassSway: { frames: 3, cycleMs: 1500 },
  cafeSteam: { frames: 4, cycleMs: 1000 },
  pageTurn: { minDelayMs: 8000, maxDelayMs: 12000 },
  cabinetFlicker: { frames: 2, cycleMs: 2000 },
  bandstandPulse: { cycleMs: 3000 },
} as const;

export const UI = {
  dialogue: {
    slideMs: 180,
    slideEase: 'Cubic.easeOut',
    /** Character-by-character reveal. Space skips to full text. */
    revealMsPerChar: 30,
  },
  popup: {
    /** The one place a bouncier easing belongs — it's a reward beat. */
    scaleMs: 250,
    overshoot: 1.05,
    holdMs: 2000,
    fadeMs: 200,
  },
  /** Functional cue, not a polish moment. Latency here actively hurts. */
  interactBubble: {
    appearMs: 0,
    /** [ADDED] Gentle idle bob so it reads as active, applied after it appears. */
    bobMs: 700,
    bobPixels: 2,
  },
  panel: {
    slideMs: 200,
    slideEase: 'Cubic.easeOut',
  },
} as const;

export const CAMERA = {
  /**
   * [ADDED] 04 asks for "smooth-follow (slight lag/lerp) rather than rigid
   * lock" without a value. Low enough to read as a follow, high enough that the
   * player never approaches the screen edge while walking.
   */
  followLerp: 0.12,
} as const;

export const NETWORK = {
  /**
   * Remote players tween with the SAME walk timing as the local player, so a
   * friend's avatar moves at your visual cadence even though the wire message
   * was a single snap-to-value.
   */
  remoteTweenMs: MOVEMENT.walkTileMs,
  /** Beyond this gap, snap instead of fast-tweening. A pop beats a zoom. */
  snapThresholdTiles: 1,
} as const;

export const ANIMATION = { MOVEMENT, BUMP, SIT, ZONE_TRANSITION, AMBIENT, UI, CAMERA, NETWORK } as const;

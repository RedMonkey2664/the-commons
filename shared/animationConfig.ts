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

/**
 * [ADDED] Focus Mode — the study scene you drop into when you sit at a pod.
 *
 * Every number the behaviour system uses lives here rather than inside the
 * state table, because the difference between "alive" and "twitchy" is entirely
 * in these durations and they need to be tuned as a set.
 */
export const FOCUS = {
  /** Entering: world pushes in, then the desk scene takes over. */
  enter: {
    cameraZoom: 2.4,
    cameraZoomMs: 900,
    scrimMs: 520,
    /** The desk rises into frame after the scrim has covered the world. */
    deskRiseMs: 620,
    /** How far below its resting place the set starts, in world units. */
    deskRisePx: 60,
    avatarSettleMs: 480,
    timerFadeMs: 420,
  },
  exit: {
    scrimMs: 420,
    cameraRestoreMs: 700,
    /** The completion beat: a realisation, then a small celebration, then out. */
    realiseMs: 900,
    celebrateMs: 1400,
    /** From pressing ESC to the fade starting. */
    holdMs: 2300,
    clockPopMs: 260,
  },

  /**
   * How long a behaviour holds before the scheduler picks another.
   *
   * Wide, and deliberately so: a fixed dwell time is the single thing that
   * makes an idle system read as a loop. Each behaviour narrows this to its own
   * range — a stretch is over in a moment, reading goes on for a while.
   */
  behavior: {
    minMs: 2200,
    maxMs: 11000,
    /** Behaviours remembered, and refused, when picking the next one. */
    historySize: 4,
    /** Chance a completed behaviour is followed by a beat of stillness. */
    settleChance: 0.28,
    settleMinMs: 600,
    settleMaxMs: 1800,
  },

  /** Continuous life that runs underneath whatever behaviour is active. */
  idle: {
    breathMs: 3400,
    breathPixels: 1.5,
    blinkMinMs: 2600,
    blinkMaxMs: 7200,
    blinkMs: 130,
  },

  /** Ambient scene motion. Kept slow: the avatar is the focal point. */
  ambient: {
    moteCount: 14,
    /** Of the soft 16px puff texture: a few world units across. */
    moteScale: [0.2, 0.45],
    moteMinMs: 9000,
    moteMaxMs: 17000,
    lampPulseMs: 4200,
    /** The lamp's breath, as a fraction of its size. */
    lampPulseScale: 0.06,
    skyDriftMs: 60000,
    /** Delay before a mote first appears, so the pool does not arrive at once. */
    moteStaggerMs: 4000,
    /**
     * How each world's particles move, chosen by the world's cinematic mood.
     * `rise` is world units upward over one drift (negative falls); `twinkleMs`
     * of 0 is a single slow fade in and out, anything else flickers at that rate.
     */
    particles: {
      dust: { rise: [40, 110], sway: 30, minMs: 9000, maxMs: 17000, alpha: [0.15, 0.4], twinkleMs: 0 },
      fireflies: { rise: [10, 40], sway: 60, minMs: 5000, maxMs: 9000, alpha: [0.35, 0.85], twinkleMs: 900 },
      stars: { rise: [0, 8], sway: 6, minMs: 12000, maxMs: 20000, alpha: [0.2, 0.6], twinkleMs: 1600 },
      snow: { rise: [-140, -70], sway: 40, minMs: 8000, maxMs: 14000, alpha: [0.3, 0.7], twinkleMs: 0 },
      nebula: { rise: [10, 50], sway: 50, minMs: 14000, maxMs: 22000, alpha: [0.15, 0.5], twinkleMs: 2400 },
    },
    /** Steam off the mug. */
    steamMs: 2600,
    steamRise: 16,
  },

  /**
   * The cinematic camera. Framing GEOMETRY lives with the set it frames
   * (FocusCamera); how long anything takes lives here.
   */
  camera: {
    shots: {
      establishing: { minHoldMs: 9000, maxHoldMs: 16000, moveMs: 3200 },
      medium: { minHoldMs: 14000, maxHoldMs: 30000, moveMs: 2600 },
      threeQuarter: { minHoldMs: 12000, maxHoldMs: 26000, moveMs: 2800 },
      sideProfile: { minHoldMs: 13000, maxHoldMs: 24000, moveMs: 3400 },
      overShoulder: { minHoldMs: 11000, maxHoldMs: 20000, moveMs: 3000 },
      closeUp: { minHoldMs: 7000, maxHoldMs: 13000, moveMs: 2400 },
      detail: { minHoldMs: 6000, maxHoldMs: 11000, moveMs: 2600 },
      detailBook: { minHoldMs: 6000, maxHoldMs: 11000, moveMs: 2600 },
      celebration: { minHoldMs: 4000, maxHoldMs: 6000, moveMs: 1400 },
      // Environment cutaways: short, because the character is the story.
      window: { minHoldMs: 5000, maxHoldMs: 8500, moveMs: 2800 },
      lamp: { minHoldMs: 4500, maxHoldMs: 7000, moveMs: 2400 },
      mug: { minHoldMs: 4500, maxHoldMs: 7000, moveMs: 2400 },
    },
    /** The first move: from slightly wider than the establishing shot, into it. */
    opening: { startScale: 1.12, liftY: 8, moveMs: 3600 },
    historySize: 3,
    /** How much likelier a framing is when it suits what the avatar is doing. */
    suitsBoost: 3,
    /** How much likelier a behaviour is when the current framing suits it. */
    behaviorBias: 1.8,
    /** Stillness after arriving, before any creep. */
    settleMinMs: 800,
    settleMaxMs: 2200,
    creepMinMs: 4000,
    /** A held camera, not a tripod. */
    sway: { periodMs: 9000, x: 2.2, y: 1.1 },
    /** A big moment cuts a long hold short — to this, never to zero. */
    bigMoment: { minRemainingMs: 5000, cutMinMs: 1200, cutMaxMs: 2600 },
    /** On a glide that turns the avatar: this far through the move, at its fastest. */
    turnAt: 0.45,
    /** The avatar's turn when it is NOT hidden by a cut. */
    turnMs: 220,
    /** Fit by width, but never so tight that the frame's height crops the desk. */
    heightFit: 0.72,
  },

  /**
   * How one shot becomes the next.
   *
   *   glide — a slow dolly; the default, and the calmest.
   *   match — a motion-hidden cut: the outgoing shot starts to drift, and the
   *           cut lands mid-drift into an incoming shot already moving the same
   *           way, so the eye carries the motion across and does not see a jump.
   *   cut   — a hard cut, held until the avatar next MOVES so it lands on the
   *           action, which is where an editor would put it.
   *   dip   — a brief dip through dark; the soft transition, used sparingly.
   */
  transitions: {
    weights: { glide: 6, match: 3, cut: 2, dip: 1.5 },
    /** Framings this much wider or tighter than the last are rarely glided. */
    bigScaleRatio: 1.9,
    bigScaleGlide: 0.25,
    /** Cutaways favour cuts and dips over dollying across the room. */
    cutawayGlide: 0.3,
    cutawayDip: 2.5,
    dip: { outMs: 360, holdMs: 120, inMs: 520 },
    match: { outMs: 900, inMs: 1400, distance: 0.08 },
    /** Longest a hard cut waits for the avatar to move before cutting anyway. */
    cutOnActionMaxWaitMs: 4500,
    historySize: 3,
    /** Clearing a veil left over from an interrupted dip. */
    veilClearMs: 300,
  },

  cutaway: {
    /** Character shots between environment cutaways, at minimum. */
    minShotsBetween: 3,
    /** Chance, once allowed, that the next shot is a cutaway. */
    chance: 0.3,
  },

  /**
   * Depth. Layers scroll at different rates as the camera moves. Subtle on
   * purpose: this is a sense of space, not a side-scroller.
   */
  parallax: {
    /** Wall and window. Horizontal only — vertical would open a seam at the floor. */
    far: 0.9,
    /** Foreground dust drifting past the lens. */
    near: 1.12,
    nearMoteShare: 0.3,
    /** Of the soft 16px puff texture, not the 4px mote. */
    nearMoteScale: [0.5, 1.0],
    nearMoteAlpha: 0.5,
  },

  /** Things on the desk that do something. */
  props: {
    fadeMs: 300,
    pageTurnMs: 560,
    pageLift: 3,
    highlightMs: 1500,
    highlightHoldMs: 3200,
    highlightFadeMs: 900,
    shuffleMs: 170,
    shuffleAngle: 3,
    holdMs: 240,
  },

  /** Study sounds, paced here so they breathe instead of looping. */
  audio: {
    typing: { minGapMs: 70, maxGapMs: 190, burstMin: 3, burstMax: 9, pauseMinMs: 500, pauseMaxMs: 1600 },
    writing: { minGapMs: 180, maxGapMs: 420 },
    /** How often to look again when nothing is making a sound. */
    idlePollMs: 250,
  },

  /** Focus Mode's screen furniture. */
  hud: {
    letterboxMs: 900,
    /** Bar height as a fraction of the screen. */
    letterbox: 0.06,
    letterboxCompact: 0.035,
    titleDelayMs: 500,
    titleInMs: 900,
    titleHoldMs: 2200,
    titleOutMs: 900,
    captionSwapMs: 160,
    pauseDimMs: 320,
    pauseDim: 0.35,
    vignette: 0.55,
    /** How often the level line re-reads the total. */
    levelRefreshMs: 1000,
  },
} as const;

export const ANIMATION = { MOVEMENT, BUMP, SIT, ZONE_TRANSITION, AMBIENT, UI, CAMERA, NETWORK, FOCUS } as const;

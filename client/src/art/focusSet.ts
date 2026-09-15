/**
 * Where everything in the Focus Mode set stands, in world units.
 *
 * The desk's top surface is y=0 and its centre is x=0. The scene builds the set
 * from this and the camera frames shots against it, so the two cannot drift
 * apart: move the lamp here and the lamp cutaway follows it.
 */

export const FOCUS_SET = {
  /**
   * Low enough that the desk hides the lower torso. At -40 the gap between the
   * body and the desk top was filled by the chair, and the character read as
   * standing on a box rather than sitting behind a desk.
   */
  avatar: { x: 0, y: -24 },
  desk: { x: 0, y: 0 },
  lamp: { x: -96, y: 2 },
  /** Floor meets the wall a little below the desk top, so the desk has somewhere to stand. */
  floorY: 40,
  window: { x: 118, y: -104 },
  props: {
    book: { x: -34, y: 6 },
    laptop: { x: 0, y: 8 },
    paper: { x: 30, y: 6 },
    pen: { x: 46, y: 4 },
    mug: { x: 88, y: 5 },
  },
  /** The spine of the open book, where a turning page hinges. */
  bookSpine: { x: -33, y: -3 },
  /** Ruled lines on the book's right-hand page, for the highlighter. */
  highlightLines: [-6, -4, -2, 0],
  highlightX: -31,
  /** Just above the rim of the mug. */
  steam: { x: 86, y: -10 },
  glow: { x: -96, y: -40, size: 520 },
  /** The box dust drifts in. Around the desk, not the screen: dust belongs to the room. */
  motes: { minX: -220, maxX: 220, minY: -150, maxY: 30 },
} as const;

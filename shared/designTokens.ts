/**
 * Design tokens — 11_GAME_DESIGN_DOCUMENT.md.
 *
 * Centralized so a re-theme is a change here rather than a hunt through every
 * scene. Values marked [ADDED] are ones the implementation needed that the
 * spec's token block didn't enumerate.
 *
 * ---------------------------------------------------------------------------
 * ART DIRECTION OVERRIDE (requested)
 *
 * 07_ART_STYLE_UI_UX.md specifies GBA-era art on a 16px grid at 2x. That has
 * been deliberately overridden in favour of a higher-resolution, modern city
 * look. The changes:
 *
 *   - tile 16 -> 32. Source art is authored at 32x32, so every tile has FOUR
 *     TIMES the pixels to carry detail. This is what makes the world clearer;
 *     scaling 16px art up only makes it bigger.
 *   - tileDisplayScale 2 -> 1. The art no longer needs upscaling to be legible,
 *     so camera zoom is now driven by window size (see VIEWPORT.zoomFor) rather
 *     than pinned to this token.
 *   - The palette moves from "warm, slightly desaturated" GBA greens to a
 *     cooler, cleaner contemporary city palette.
 *
 * The zone-palette token NAMES are unchanged, so nothing downstream cares.
 * ---------------------------------------------------------------------------
 */

/**
 * [ADDED] World brightness.
 *
 * The art palette below is authored at the lightness the tiles are DRAWN at,
 * and every tile then stacks grain, seams and cast shadows on top of it — so
 * the assembled world reads a good deal darker than the swatches do. This
 * multiplies the world palette on the way out, which lifts the whole scene
 * without re-authoring sixty colours or dimming the UI chrome that sits over
 * it.
 *
 * It scales RGB rather than mixing toward white, so hue and saturation are
 * preserved and colours brighten instead of washing out. 1 is the palette as
 * written; above about 1.25 the paving starts to clip toward flat white.
 */
export const WORLD_BRIGHTNESS = 1.14;

/** Scale one #rrggbb toward white by `factor`, clamped. Alpha suffixes pass through. */
function brighten(hex: string, factor: number): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!match) return hex;

  const value = parseInt(match[1]!, 16);
  const scale = (channel: number) => Math.min(255, Math.round(channel * factor));
  const r = scale((value >> 16) & 0xff);
  const g = scale((value >> 8) & 0xff);
  const b = scale(value & 0xff);

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}${match[2] ?? ''}`;
}

function brightenAll<T extends Record<string, string>>(
  palette: T,
  factor: number,
): { [K in keyof T]: string } {
  return Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [key, brighten(value, factor)]),
  ) as { [K in keyof T]: string };
}

/**
 * UI chrome, NOT brightened: these are read against the world rather than part
 * of it, and lifting them costs the contrast that makes them legible.
 */
const UI_COLORS = {
  dialogueBoxBg: '#FAFAF7',
  dialogueBoxText: '#23262B',
  statusStudying: '#3E8E6F',
  statusListening: '#4A6FA5',
  statusAfk: '#8C8C8C',
  dialogueBoxBorder: '#23262B',
  dialogueBoxShadow: '#00000033',
  dialogueBoxAccent: '#4A9DD9',
  hudBg: '#171A1FE0',
  hudText: '#F2F4F7',
  hudAccent: '#4A9DD9',
  interactBubbleBg: '#FAFAF7',
  interactBubbleMark: '#E8613C',
  transitionFade: '#0B0D10',
} as const;

/** Everything the world itself is drawn from. Brightened as a whole. */
const WORLD_COLORS = {
  // Zone base palettes.
  townSquareBg: '#7FA8C9',
  libraryBg: '#B8A88F',
  cafeBg: '#D9A87C',
  arcadeBg: '#5B4B85',
  terraceBg: '#3B4664',
  greenhouseBg: '#89AE84',
  parkBg: '#7FB98A',




  // ---- Modern city art palette [ADDED] ----
  // Ground
  grass: '#6FA86B',
  grassLight: '#7FBA78',
  grassDark: '#578A56',
  soil: '#6B5541',

  // Paving
  paving: '#C8C6BF',
  pavingLight: '#D6D4CD',
  pavingDark: '#A8A69F',
  pavingSeam: '#B3B1AA',
  plaza: '#D9D5CA',
  plazaAccent: '#B5AE9E',
  plazaInlay: '#C3BBA9',

  // Water
  water: '#4A93C4',
  waterLight: '#67AEDB',
  waterDeep: '#33719E',
  waterFoam: '#D6EDF7',

  // Architecture
  concrete: '#BFC2C7',
  concreteLight: '#D2D5D9',
  concreteDark: '#8E9298',
  glass: '#5E8CA8',
  glassLight: '#87BBD4',
  glassLit: '#E8D9A0',
  steel: '#6E747C',
  storefront: '#3A4048',
  roofEdge: '#767B82',

  // Interior floors (Phase 6)
  carpet: '#6E3630',
  rugBase: '#7A4A38',
  rugPattern: '#D8B98A',
  terrazzo: '#D9D2C6',
  terrazzoWarm: '#C7B49C',
  terrazzoFleck: '#8A7F70',

  // Rooftop terrace at dusk. The sky is a real gradient rather than a flat
  // fill because the terrace is mostly sky, and a flat band reads as a wall.
  duskSkyTop: '#2C3752',
  duskSkyLow: '#8A6478',
  skylineFar: '#414D6B',
  skylineNear: '#232A3B',
  windowWarm: '#F0C97A',
  decking: '#B08A62',
  railGlass: '#9FBECF',

  // Greenhouse
  glassPane: '#C4DCD6',
  glassFrame: '#7E8A80',
  soilBed: '#5A4432',
  fernLight: '#6FB05E',

  // Nature & props
  foliage: '#3F7A47',
  foliageLight: '#549B57',
  foliageDark: '#2C5A35',
  trunk: '#6B4F3A',
  hedge: '#4A8250',
  flowerPink: '#E88BA8',
  flowerYellow: '#F2CE5C',
  flowerWhite: '#F5F2E8',
  benchWood: '#9C6F45',
  lampPost: '#3D4249',
  lampGlow: '#FFE9A8',
  planter: '#9E9A92',

  // Characters
  playerBody: '#3E6FB5',
  remoteBody: '#C4644A',
  npcBody: '#7A5FA8',
  skin: '#E8BE96',
} as const;

export const COLORS = {
  ...UI_COLORS,
  ...brightenAll(WORLD_COLORS, WORLD_BRIGHTNESS),
};

/**
 * [ADDED] World palettes — one per progression world (worlds.config.ts).
 *
 * Kept here with every other colour rather than in the world config, so the
 * rule that tunable colours live in one file still holds. A world names its
 * palette; this says what the palette is.
 */
export interface WorldPalette {
  /** The sky behind the room, top and bottom of the gradient. */
  skyTop: string;
  skyBottom: string;
  wall: string;
  floor: string;
  /** What is seen through the window. */
  windowSky: string;
  windowHorizon: string;
  /** The one bright thing in the window: moon, planet, aurora. */
  windowAccent: string;
  /** Dust in the lamplight. Fireflies in the forest, snow on the summit. */
  mote: string;
  glow: string;
  /** Used on the world map for this world's card and progress bar. */
  accent: string;
}

export type WorldPaletteId = 'dusk' | 'forest' | 'orbit' | 'summit' | 'deepField';

export const WORLD_PALETTES: Record<WorldPaletteId, WorldPalette> = {
  dusk: {
    skyTop: '#1B2233', skyBottom: '#1D2438',
    wall: '#2C3450', floor: '#4A3A2A',
    windowSky: '#243049', windowHorizon: '#5A4458', windowAccent: '#FFF3CE',
    mote: '#FFE9A8', glow: '#FFE9A8', accent: '#E8B86A',
  },
  forest: {
    skyTop: '#0F1E17', skyBottom: '#142A1E',
    wall: '#233A2B', floor: '#3E3222',
    windowSky: '#123024', windowHorizon: '#1F4A30', windowAccent: '#D9F7A6',
    mote: '#C8F27A', glow: '#F2E6A0', accent: '#7FCB7A',
  },
  orbit: {
    skyTop: '#060A18', skyBottom: '#0B1330',
    wall: '#1C2438', floor: '#2A3142',
    windowSky: '#040814', windowHorizon: '#1E5AA8', windowAccent: '#8FD3FF',
    mote: '#CFE6FF', glow: '#BFE0FF', accent: '#5AB0F0',
  },
  summit: {
    skyTop: '#1A2536', skyBottom: '#2B3A52',
    wall: '#3A4658', floor: '#4B4038',
    windowSky: '#3E5474', windowHorizon: '#DCE6F2', windowAccent: '#FFFFFF',
    mote: '#F2F6FF', glow: '#FFE2B8', accent: '#A9C8EC',
  },
  deepField: {
    skyTop: '#0B0616', skyBottom: '#1A0B2E',
    wall: '#221434', floor: '#2A1E36',
    windowSky: '#08040F', windowHorizon: '#6A2C8A', windowAccent: '#FFB8F2',
    mote: '#E6B8FF', glow: '#D9B8FF', accent: '#C28AF0',
  },
};

export const SPACING = {
  /**
   * Base tile size in px — source art resolution.
   * Raised from the spec's 16 to 32; see the override note above.
   */
  tile: 32,
  /** Art is authored at final resolution, so no per-sprite upscale. */
  tileDisplayScale: 1,
  hudMargin: 20,
  dialogueBoxPadding: 28,
} as const;

export const TYPOGRAPHY = {
  dialogueFont: 'monospace', // placeholder; swap for a display font asset
  dialogueFontSize: 20,
  hudFontSize: 15,
  titleFontSize: 54,
} as const;

/**
 * [ADDED] Viewport.
 *
 * The canvas RESIZES to the browser window rather than rendering at a fixed
 * design resolution and letterboxing — black bars down the sides do not read as
 * a modern game. So there is no single "design resolution"; these values are a
 * reference size for UI layout maths, and the real dimensions come from the
 * live camera.
 */
export const VIEWPORT = {
  /** Reference size. Actual canvas follows the window. */
  width: 1280,
  height: 720,

  /**
   * Camera zoom is chosen so a roughly constant slice of WORLD is visible
   * regardless of window size — a bigger window shows a bigger view at the same
   * scale, rather than the same view blown up.
   *
   * Quantized to half steps: unconstrained fractional zoom on pixel art makes
   * tile edges shimmer as the camera moves.
   */
  targetTilesHigh: 15,
  minZoom: 1,
  maxZoom: 3,

  zoomFor(viewportHeight: number): number {
    const ideal = viewportHeight / (this.targetTilesHigh * SPACING.tile);
    const quantized = Math.round(ideal * 2) / 2;
    return Math.max(this.minZoom, Math.min(this.maxZoom, quantized));
  },
} as const;

/** Convert a hex token to the 0xRRGGBB number Phaser wants. */
export function hex(token: string): number {
  return Number.parseInt(token.replace('#', '').slice(0, 6), 16);
}

/** Blend two hex tokens; t=0 returns a, t=1 returns b. */
export function mix(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.replace('#', '').slice(0, 6), 16);
  const pb = Number.parseInt(b.replace('#', '').slice(0, 6), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 0xff;
    const vb = (pb >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export const TOKENS = { COLORS, SPACING, TYPOGRAPHY, VIEWPORT } as const;

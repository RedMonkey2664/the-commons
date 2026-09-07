/**
 * Design tokens — 11_GAME_DESIGN_DOCUMENT.md.
 *
 * Centralized so a re-theme (seasonal palette, real art pass) is a change here
 * rather than a hunt through every scene. Values marked [ADDED] are ones the
 * implementation needed that the spec's token block didn't enumerate; the
 * specced values are transcribed exactly.
 */

export const COLORS = {
  // Zone base palettes — warm and slightly desaturated, per 07.
  townSquareBg: '#8FD5A6',
  libraryBg: '#C9A876',
  cafeBg: '#E8B888',
  arcadeBg: '#6B5B95',
  parkBg: '#7BC47F',

  dialogueBoxBg: '#F5F1E6',
  dialogueBoxText: '#2B2B2B',

  statusStudying: '#4A7C59',
  statusListening: '#4A5F8C',
  statusAfk: '#8C8C8C',

  // [ADDED] UI chrome derived from the specced palette.
  dialogueBoxBorder: '#3A3226',
  dialogueBoxShadow: '#C9C0AC',
  hudBg: '#2B2B2BCC',
  hudText: '#F5F1E6',
  interactBubbleBg: '#F5F1E6',
  interactBubbleMark: '#C4453B',
  transitionFade: '#000000',

  // [ADDED] Placeholder-art tile colors for Phase 0-2. Swapped out at Phase 5
  // by replacing the tileset PNG; asset keys stay stable so no scene changes.
  placeholderGrass: '#8FD5A6',
  placeholderGrassAlt: '#84CB9B',
  placeholderPath: '#D9C9A3',
  placeholderTree: '#3E7A4F',
  placeholderWater: '#6BA8D9',
  placeholderFence: '#8A6B4A',
  placeholderSign: '#A87C4F',
  placeholderDoor: '#5B4636',
  placeholderFlower: '#E8A0B4',
  placeholderPlayer: '#3F5FA8',
  placeholderRemote: '#A8543F',
} as const;

export const SPACING = {
  /** Base tile size in px — source art resolution. */
  tile: 16,
  /** Rendered at 2x for browser legibility. Applied as camera zoom, see below. */
  tileDisplayScale: 2,
  hudMargin: 12,
  dialogueBoxPadding: 16,
} as const;

export const TYPOGRAPHY = {
  dialogueFont: 'monospace', // placeholder; swap for a pixel font asset
  dialogueFontSize: 14,
  hudFontSize: 12,
} as const;

/**
 * [ADDED] Viewport derivation.
 *
 * `tileDisplayScale: 2` applied as a per-sprite scale on a wide canvas would
 * show ~30x20 tiles, which does not read like FireRed. Instead it is applied as
 * CAMERA ZOOM on a GBA-proportioned canvas: 480x320 at zoom 2 shows exactly
 * 15x10 tiles — the GBA framing — and Phaser's FIT scale mode then upscales the
 * whole canvas to fill the browser window, which is where legibility comes from.
 */
export const VIEWPORT = {
  /** Design resolution. UI is laid out in this space. */
  width: 480,
  height: 320,
  /** Camera zoom on world scenes. */
  get zoom(): number {
    return SPACING.tileDisplayScale;
  },
  /** Visible world area in tiles, at the above zoom. */
  get tilesWide(): number {
    return this.width / SPACING.tileDisplayScale / SPACING.tile;
  },
  get tilesHigh(): number {
    return this.height / SPACING.tileDisplayScale / SPACING.tile;
  },
} as const;

/** Convert a hex token to the 0xRRGGBB number Phaser wants. */
export function hex(token: string): number {
  return Number.parseInt(token.replace('#', '').slice(0, 6), 16);
}

export const TOKENS = { COLORS, SPACING, TYPOGRAPHY, VIEWPORT } as const;

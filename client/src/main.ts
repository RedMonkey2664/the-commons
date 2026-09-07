import Phaser from 'phaser';
import { GAME_CONFIG } from './config';

export const game = new Phaser.Game(GAME_CONFIG);

/**
 * Debug bridge.
 *
 * Exposes the game instance so tools/phase0_smoke.mjs (and a browser console)
 * can inspect and drive real game state — walking a player around and asserting
 * the resulting tile is the only honest way to test movement feel and collision
 * without a human at the keyboard. This becomes considerably more valuable in
 * Phase 1, where two clients must be checked against each other for desync.
 */
declare global {
  interface Window {
    __COMMONS__: { game: Phaser.Game };
  }
}

window.__COMMONS__ = { game };

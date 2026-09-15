import Phaser from 'phaser';
import { GAME_CONFIG } from './config';
import { progression } from './systems/Progression';

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
    __COMMONS__: { game: Phaser.Game; progression: typeof progression };
  }
}

// Progression joins the bridge for the same reason the game did: the only
// honest way to test "the hours are real" is to read them out of the running
// application. Its simulation methods no-op outside a dev build, so this
// exposes a reader in production, not a cheat.
window.__COMMONS__ = { game, progression };

/**
 * Load the persisted focus total once, at boot.
 *
 * Without this nothing reads the server until the journey screen is opened, so
 * a freshly loaded page believes the player has zero hours — which is not just
 * a stale display: an unlock earned in a previous session would not be noticed
 * until they happened to press J, and the rocket would sit dark next to a world
 * they had already paid for.
 */
void progression.refresh();

/**
 * Developer progression controls.
 *
 * Behind import.meta.env.DEV and behind a DYNAMIC import: Vite replaces the
 * constant with `false` when building for production, the branch is dropped,
 * and the module never enters the bundle. A panel that could award focus hours
 * has no business being shipped to players in any form, disabled or otherwise.
 */
if (import.meta.env.DEV) {
  void import('./dev/DevPanel').then((module) => module.mountDevPanel(game));
}

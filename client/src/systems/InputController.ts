/**
 * Action-based input.
 *
 * Scenes ask for ACTIONS ('interact'), never for keys ('SPACE'). 07 flags
 * keybind remapping as a later feature that must not require surgery: because
 * nothing outside this file knows a physical key exists, adding remap UI later
 * means writing to BINDINGS and persisting it, and nothing else changes.
 */

import Phaser from 'phaser';
import type { Direction } from '@commons/shared';

export type GameAction = Direction | 'interact' | 'menu';

export const DEFAULT_BINDINGS: Record<GameAction, string[]> = {
  // WASD, with arrow keys mirrored for muscle memory either way (04).
  up: ['W', 'UP'],
  down: ['S', 'DOWN'],
  left: ['A', 'LEFT'],
  right: ['D', 'RIGHT'],
  interact: ['SPACE', 'ENTER'],
  menu: ['ESC'],
};

const DIRECTION_ACTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

export class InputController {
  private readonly keys = new Map<GameAction, Phaser.Input.Keyboard.Key[]>();

  /**
   * Directions in the order they were pressed. The most recent held direction
   * wins, which is what makes diagonal-ish key rolls feel intentional instead
   * of snapping back to whichever direction the enum happened to list first.
   */
  private readonly pressOrder: Direction[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    bindings: Record<GameAction, string[]> = DEFAULT_BINDINGS,
  ) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');

    for (const [action, keyNames] of Object.entries(bindings) as [GameAction, string[]][]) {
      this.keys.set(
        action,
        keyNames.map((name) => keyboard.addKey(name, true, true)),
      );
    }

    // Stop the browser scrolling the page on arrows/space while playing.
    keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  isDown(action: GameAction): boolean {
    return (this.keys.get(action) ?? []).some((key) => key.isDown);
  }

  /** True once per physical press. Consumes the press. */
  justPressed(action: GameAction): boolean {
    return (this.keys.get(action) ?? []).some((key) => Phaser.Input.Keyboard.JustDown(key));
  }

  /**
   * The direction the player currently wants to go, or null.
   * Call once per frame — it maintains press-order state.
   */
  heldDirection(): Direction | null {
    for (const direction of DIRECTION_ACTIONS) {
      const down = this.isDown(direction);
      const index = this.pressOrder.indexOf(direction);
      if (down && index === -1) this.pressOrder.push(direction);
      else if (!down && index !== -1) this.pressOrder.splice(index, 1);
    }
    return this.pressOrder.length > 0 ? this.pressOrder[this.pressOrder.length - 1]! : null;
  }

  /** Clears held state — used when input is handed to a modal UI. */
  reset(): void {
    this.pressOrder.length = 0;
    for (const keys of this.keys.values()) for (const key of keys) key.reset();
  }

  destroy(): void {
    const keyboard = this.scene.input.keyboard;
    for (const keys of this.keys.values()) {
      for (const key of keys) keyboard?.removeKey(key, true);
    }
    this.keys.clear();
    this.pressOrder.length = 0;
  }
}

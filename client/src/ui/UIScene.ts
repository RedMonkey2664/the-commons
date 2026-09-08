/**
 * UI overlay scene.
 *
 * Runs in parallel with whatever zone scene is active, at zoom 1. This matters:
 * world scenes render at camera zoom 2 (see VIEWPORT), and if the UI shared that
 * camera every dialogue box and HUD label would be double-scaled and the type
 * sizes in 11's tokens would be wrong. A separate scene keeps UI in honest
 * 480x320 design space.
 *
 * Zone scenes never construct UI directly — they go through the `ui` facade, so
 * a scene does not need a handle on this scene or care when it was created.
 */

import Phaser from 'phaser';
import { ChatPanel } from './ChatPanel';
import { DialogueBox } from './DialogueBox';
import { FriendsPanel } from './FriendsPanel';
import { JukeboxPanel } from './JukeboxPanel';
import { Hud } from './Hud';
import { ItemPopup } from './ItemPopup';

export class UIScene extends Phaser.Scene {
  static readonly KEY = 'UIScene';

  dialogue!: DialogueBox;
  popup!: ItemPopup;
  hud!: Hud;
  friends!: FriendsPanel;
  chat!: ChatPanel;
  jukebox!: JukeboxPanel;

  constructor() {
    super({ key: UIScene.KEY });
  }

  create(): void {
    this.dialogue = new DialogueBox(this);
    this.popup = new ItemPopup(this);
    this.hud = new Hud(this);
    this.friends = new FriendsPanel(this);
    this.chat = new ChatPanel(this);
    this.jukebox = new JukeboxPanel(this);

    // Transparent overlay — the world scene below stays visible.
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');

    ui.attach(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => ui.detach(this));
  }
}

/**
 * Facade over the live UIScene.
 *
 * Every call is safe before the scene exists — it no-ops rather than throwing,
 * because a zone scene may legitimately try to speak during boot. `isReady`
 * exists for the rare caller that needs to branch on it.
 */
class UiFacade {
  private scene?: UIScene;

  attach(scene: UIScene): void {
    this.scene = scene;
  }

  detach(scene: UIScene): void {
    if (this.scene === scene) this.scene = undefined;
  }

  get isReady(): boolean {
    return this.scene !== undefined;
  }

  get dialogue(): DialogueBox | undefined {
    return this.scene?.dialogue;
  }

  get popup(): ItemPopup | undefined {
    return this.scene?.popup;
  }

  get hud(): Hud | undefined {
    return this.scene?.hud;
  }

  get friends(): FriendsPanel | undefined {
    return this.scene?.friends;
  }

  get chat(): ChatPanel | undefined {
    return this.scene?.chat;
  }

  get jukebox(): JukeboxPanel | undefined {
    return this.scene?.jukebox;
  }
}

export const ui = new UiFacade();

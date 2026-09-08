/**
 * Interactable behaviour registry.
 *
 * The config-over-code rule (02, 11) applied to interactions: the interaction
 * system finds WHAT you are facing, this table decides WHAT HAPPENS. Adding a
 * focus pod, a jukebox, or an arcade cabinet is a new entry here plus map
 * objects tagged with that kind — InteractionSystem never changes.
 *
 * Phase 0 registers signpost, npc and door. The kinds declared in types.ts but
 * absent here (focus_pod, seat, jukebox, cabinet, reading_nook) arrive with the
 * zones and systems that give them meaning, in Phases 2-4. Until then the
 * unhandled path below tells the player plainly rather than failing silently.
 */

import type Phaser from 'phaser';
import type { InteractableKind, InteractableObject, PlayerStatus, ZoneConfig, ZoneId } from '@commons/shared';
import { COLORS, SIT, getMinigame, getZone } from '@commons/shared';
import { ui } from '../ui/UIScene';

export interface InteractionContext {
  scene: Phaser.Scene;
  zone: ZoneConfig;
  object: InteractableObject;
  /** Locks/unlocks player movement for the duration of the interaction. */
  setBlocked: (blocked: boolean) => void;
  /** Pause this zone and hand the screen to a minigame scene. */
  launchMinigame: (sceneKey: string) => void;
  /** Open the shared jukebox queue. False when this zone has no jukebox. */
  openJukebox: () => boolean;
  /** Open the cafe drink picker (03). */
  openDrinks: () => void;
  /** Walk out of this zone into another. Owned by ZoneScene (fade + room swap). */
  transitionTo: (zoneId: ZoneId) => void;
  isSitting: () => boolean;
  sit: (status: PlayerStatus) => void;
  stand: () => void;
}

export type InteractionHandler = (ctx: InteractionContext) => void;

/** 'npc_wanderer' -> 'WANDERER'; used for the dialogue speaker tab. */
function displayNameFor(object: InteractableObject): string {
  const base = object.id.replace(/^(npc|sign|door)_/, '').replace(/_/g, ' ');
  return base.toUpperCase();
}

function textOf(object: InteractableObject, fallback: string): string {
  const value = object.props['text'];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Show dialogue and hold the player in BLOCKED until the box closes, so nobody
 * walks out from under an open dialogue box (10's state machine).
 */
function speak(ctx: InteractionContext, text: string, speaker?: string): void {
  const dialogue = ui.dialogue;
  if (!dialogue) return;
  ctx.setBlocked(true);
  dialogue.show(text, {
    speaker,
    onClose: () => ctx.setBlocked(false),
  });
}

export const INTERACTABLE_HANDLERS: Partial<Record<InteractableKind, InteractionHandler>> = {
  signpost: (ctx) => {
    speak(ctx, textOf(ctx.object, 'The sign is too weathered to read.'));
  },

  npc: (ctx) => {
    speak(ctx, textOf(ctx.object, '...'), displayNameFor(ctx.object));
  },

  /**
   * Doors fire on ENTERING the tile, not on Space — 03 specifies FireRed-style
   * map-edge transitions: "walk onto the tile, screen transition, spawn in the
   * new zone's designated entry point".
   */
  door: (ctx) => {
    const targetZoneId = ctx.object.props['targetZone'];
    if (typeof targetZoneId !== 'string') return;

    const target = safeGetZone(targetZoneId);
    const label = target?.displayName ?? 'that way';

    const sceneExists = target ? ctx.scene.scene.manager.keys[target.sceneKey] !== undefined : false;
    if (!target || !sceneExists) {
      speak(ctx, `The ${label} isn't open yet.|Come back once it's built.`);
      return;
    }

    ctx.transitionTo(target.id);
  },

  /**
   * Focus pod / study desk. 11: status flows from location and action, never a
   * manual toggle — sitting here IS what marks you as studying, and standing up
   * is what stops it. There is no start button anywhere.
   */
  focus_pod: (ctx) => {
    if (ctx.isSitting()) {
      ctx.stand();
      ui.popup?.show('Session ended', { iconColor: COLORS.statusAfk });
      return;
    }

    ctx.sit('studying');
    // The icon waits for the sit to finish, so two things never animate at once.
    ctx.scene.time.delayedCall(SIT.statusIconDelayMs, () => {
      ui.popup?.show('Focus session started', { iconColor: COLORS.statusStudying });
    });
  },

  /** Cafe booths, park benches. Purely social — no timer, no status change. */
  seat: (ctx) => {
    if (ctx.isSitting()) {
      ctx.stand();
      return;
    }
    ctx.sit('idle');
  },

  /**
   * Library reading nook: sit near people without a formal timer (03).
   *
   * Uses a popup rather than a dialogue box on purpose. speak() drives
   * setBlocked(true) then setBlocked(false) on close, and BLOCKED -> IDLE
   * overwrites the SITTING state — which would leave the player stuck in the
   * seated pose with no way to stand back up.
   */
  reading_nook: (ctx) => {
    if (ctx.isSitting()) {
      ctx.stand();
      return;
    }
    ctx.sit('idle');
    ctx.scene.time.delayedCall(SIT.statusIconDelayMs, () => {
      ui.popup?.show('You settle in', { iconColor: COLORS.statusListening });
    });
  },

  /**
   * Jukebox and bandstand — one shared queue per room (03).
   *
   * Opens the queue panel rather than saying anything: the interesting state is
   * what the ROOM is playing, and a dialogue box cannot show a live queue.
   */
  jukebox: (ctx) => {
    if (!ctx.openJukebox()) {
      speak(ctx, `${textOf(ctx.object, 'A jukebox.')}|It is not connected to anything right now.`);
    }
  },

  /**
   * The cafe counter (03).
   *
   * Cosmetic only, by design: ordering changes an icon over your head and
   * nothing else. No cost, no stat, no unlock — a third place is made of small
   * optional gestures, and the value is that other people can see you made one.
   */
  drink_counter: (ctx) => {
    ctx.openDrinks();
  },

  /**
   * Arcade cabinet.
   *
   * Looks the minigame up by id and launches its scene by KEY. This handler
   * knows nothing about any particular game — which is the point of 06's
   * plugin pattern, and why adding a fifth cabinet needs no change here.
   */
  cabinet: (ctx) => {
    const minigameId = ctx.object.props['minigameId'];
    const minigame = typeof minigameId === 'string' ? getMinigame(minigameId) : undefined;

    if (!minigame) {
      speak(ctx, 'This cabinet is out of order.');
      return;
    }
    if (!ctx.scene.scene.manager.keys[minigame.sceneKey]) {
      speak(ctx, `${minigame.displayName} is listed but its scene is not registered.`);
      return;
    }

    ctx.launchMinigame(minigame.sceneKey);
  },
};

function safeGetZone(id: string): ZoneConfig | undefined {
  try {
    return getZone(id as ZoneId);
  } catch {
    return undefined;
  }
}

/** Interactions triggered by Space while facing the object. */
export function isPressInteractable(kind: InteractableKind): boolean {
  return kind !== 'door';
}

/** Interactions triggered by walking onto the object's tile. */
export function isStepInteractable(kind: InteractableKind): boolean {
  return kind === 'door';
}

export function handlerFor(kind: InteractableKind): InteractionHandler | undefined {
  return INTERACTABLE_HANDLERS[kind];
}

/** Fallback so an unimplemented kind is visible, not silently inert. */
export function unhandled(ctx: InteractionContext): void {
  speak(ctx, `You can't do anything with the ${ctx.object.kind.replace(/_/g, ' ')} yet.`);
}

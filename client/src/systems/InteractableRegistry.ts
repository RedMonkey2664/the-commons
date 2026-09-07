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
import type { InteractableKind, InteractableObject, ZoneConfig, ZoneId } from '@commons/shared';
import { getZone } from '@commons/shared';
import { ui } from '../ui/UIScene';

export interface InteractionContext {
  scene: Phaser.Scene;
  zone: ZoneConfig;
  object: InteractableObject;
  /** Locks/unlocks player movement for the duration of the interaction. */
  setBlocked: (blocked: boolean) => void;
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

    // PHASE 2: replace this branch with the zone-transition system
    // (fade 250ms out -> leave room / join room -> fade 250ms in, per 10).
    const sceneExists = target ? ctx.scene.scene.manager.keys[target.sceneKey] !== undefined : false;
    if (!sceneExists) {
      speak(ctx, `The ${label} isn't open yet.|Come back once it's built.`);
      return;
    }

    ctx.scene.scene.start(target!.sceneKey, { fromZone: ctx.zone.id });
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

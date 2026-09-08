/**
 * Voice chat — 05, Phase 4.
 *
 * 05 is explicit on two points, and both shape this file:
 *
 *   1. "don't hand-roll a mesh network" — use LiveKit or Daily. So the client
 *      never touches WebRTC directly; it asks the server for a token and hands
 *      it to a provider SDK.
 *   2. "Voice room maps to the same zone/room boundary as everything else" and
 *      "zone-level defaults from zones.config.ts (e.g. Library defaults to
 *      muted) should apply automatically on join, with a manual override always
 *      available to the player."
 *
 * That second point is the interesting one, and it is implemented HERE rather
 * than in a provider adapter, because it is a design rule from 11's "zoning by
 * walking, not by menus" — it has to hold whichever provider is plugged in, and
 * it has to keep holding when the provider is not configured at all.
 *
 * ---------------------------------------------------------------------------
 * STATUS: the transport is UNVERIFIED.
 *
 * LiveKit needs LIVEKIT_API_KEY and LIVEKIT_API_SECRET, which were not
 * available. Everything that does not need them — the mute policy, the manual
 * override, the per-zone room naming, the UI state machine and the token
 * endpoint's shape — is built and tested. The actual audio path has never
 * carried audio. `VoiceAvailability` exists so the game can say so plainly
 * instead of showing a mic button that silently does nothing.
 * ---------------------------------------------------------------------------
 */

import type { VoiceChatDefault, ZoneConfig } from './types.js';

/** Why voice is or is not usable right now. */
export type VoiceAvailability =
  | 'ready'
  /** Server has no provider credentials configured. */
  | 'not_configured'
  /** Provider configured but the token request failed. */
  | 'unavailable'
  /** Browser refused microphone access. */
  | 'no_permission';

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'failed';

export interface VoiceToken {
  /** Provider room name — one per zone, matching the Colyseus boundary. */
  room: string;
  /** Short-lived JWT for the provider SDK. */
  token: string;
  /** wss:// URL of the provider. */
  url: string;
  identity: string;
}

export interface VoiceParticipant {
  identity: string;
  displayName: string;
  speaking: boolean;
  muted: boolean;
}

/**
 * Voice room name for a zone.
 *
 * Instanced zones (Study Rooms) get one voice room per instance, so two
 * unrelated study groups do not end up in the same call. Everything else is one
 * room per zone, matching the Colyseus boundary exactly (05).
 */
export function voiceRoomFor(zone: ZoneConfig, instanceId?: string): string {
  return zone.instanced && instanceId ? `commons-${zone.id}-${instanceId}` : `commons-${zone.id}`;
}

/**
 * Whether a zone's voice room is shared across every Colyseus room for it.
 *
 * Non-instanced zones deliberately share one call, so everyone in the Cafe can
 * hear each other. That only holds while the zone fits in a single Colyseus
 * room — past that, callers should pass the room id so the call splits with it.
 */
export function voiceRoomIsShared(zone: ZoneConfig): boolean {
  return !zone.instanced;
}

/**
 * Whether the microphone should be live on arriving in a zone.
 *
 * 11's pillar: quiet vs social is expressed by which building you are in, never
 * by a settings toggle you have to remember. Walking into the Library mutes
 * you; walking into the Cafe unmutes you.
 *
 * The exception matters as much as the rule — "defaults shouldn't trap anyone".
 * Once a player has deliberately overridden their mic in a zone, that choice
 * wins over the zone default for as long as they stay there. Re-muting someone
 * who just chose to speak would be the toggle-fighting-the-player behaviour the
 * pillar exists to avoid.
 */
export function shouldStartMuted(
  zoneDefault: VoiceChatDefault,
  manualOverride: boolean | undefined,
): boolean {
  if (manualOverride !== undefined) return manualOverride;
  return zoneDefault === 'muted';
}

export const VOICE_LIMITS = {
  /** 02: "not designed for hundreds in one room". */
  maxParticipants: 12,
  /** How long a token stays valid. Short: it is only used to join once. */
  tokenTtlSeconds: 600,
} as const;

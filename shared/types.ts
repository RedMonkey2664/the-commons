/**
 * Types shared by client and server.
 *
 * Nothing in here may import Phaser or Colyseus — this module is consumed by
 * both runtimes, so it stays engine-agnostic on purpose.
 */

// ---------------------------------------------------------------------------
// World primitives
// ---------------------------------------------------------------------------

/** Facing / movement direction. Matches 04_CHARACTER_MOVEMENT_ANIMATION.md. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** A position in tile space (not pixels). All gameplay logic is tile-space. */
export interface TileCoord {
  x: number;
  y: number;
}

export const DIRECTION_VECTORS: Readonly<Record<Direction, Readonly<TileCoord>>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const ALL_DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

/** Tile directly in front of an actor, given where it stands and faces. */
export function tileInFront(from: TileCoord, facing: Direction): TileCoord {
  const v = DIRECTION_VECTORS[facing];
  return { x: from.x + v.x, y: from.y + v.y };
}

export function tilesEqual(a: TileCoord, b: TileCoord): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Chebyshev-free orthogonal step distance; -1 if not orthogonally aligned. */
export function orthogonalDistance(a: TileCoord, b: TileCoord): number {
  if (a.x === b.x) return Math.abs(a.y - b.y);
  if (a.y === b.y) return Math.abs(a.x - b.x);
  return -1;
}

// ---------------------------------------------------------------------------
// Character state machine (10_ANIMATION_SPEC.md)
// ---------------------------------------------------------------------------

/**
 * IDLE    — standing, accepts movement + interact
 * WALKING — mid tile-tween, accepts buffered input only
 * SITTING — seated at a pod/bench, accepts interact (to stand) only
 * BLOCKED — movement locked (dialogue, transition, minigame), ignores WASD
 */
export type CharacterState = 'IDLE' | 'WALKING' | 'SITTING' | 'BLOCKED';

/** Presence status shown to other players. Inferred from location + action. */
export type PlayerStatus = 'idle' | 'studying' | 'listening' | 'afk';

// ---------------------------------------------------------------------------
// Multiplayer (05_MULTIPLAYER_PRESENCE.md)
// ---------------------------------------------------------------------------

export interface PlayerState {
  /** Stable user id. */
  id: string;
  displayName: string;
  /** Chosen character skin; an asset key, stable across art swaps. */
  spriteKey: string;
  x: number;
  y: number;
  facing: Direction;
  status: PlayerStatus;
  /** Set while the player is inside an arcade cabinet. */
  currentMinigame?: string;
}

// ---------------------------------------------------------------------------
// Zones (02_TECH_STACK_ARCHITECTURE.md, 03_WORLD_MAP_ZONES.md)
// ---------------------------------------------------------------------------

export type ZoneId = 'town_square' | 'library' | 'cafe' | 'arcade' | 'park' | 'study_room';

/** Zone-level social default, applied on join and always manually overridable. */
export type VoiceChatDefault = 'muted' | 'unmuted';

export interface ZoneConfig {
  id: ZoneId;
  displayName: string;
  /** Phaser tilemap cache key. Stable across placeholder -> real art swaps. */
  tilemapKey: string;
  /** Tiled JSON export, relative to the served assets root. */
  mapFile: string;
  /** Phaser Scene key. One scene file per zone (09_PROJECT_STRUCTURE_SETUP.md). */
  sceneKey: string;
  /** Default arrival tile when no named entry point is given. */
  spawnPoint: TileCoord;
  /**
   * Named arrival tiles, keyed by the zone you came FROM, so walking back and
   * forth through a door puts you on the correct side of it.
   */
  entryPoints?: Partial<Record<ZoneId, TileCoord>>;
  ambientSound: string | null;
  /** Manifest of interactable ids this zone owns; placement comes from the map. */
  interactables: string[];
  voiceChatDefault: VoiceChatDefault;
  /** Key into COLORS (designTokens.ts) for this zone's base palette. */
  bgColorToken: string;
  /** Instanced zones get one Colyseus room per group, not one room globally. */
  instanced?: boolean;
}

// ---------------------------------------------------------------------------
// Tilemap contract
// ---------------------------------------------------------------------------

/**
 * Custom properties this project expects on Tiled tiles and objects. Kept here
 * so the map authoring contract is documented in code, not just in a wiki.
 */
export interface TileProperties {
  /** Non-walkable. Trees, walls, furniture, water. */
  collides?: boolean;
  /** Decorative ambient animation key (see ANIMATION.ambient). */
  ambient?: string;
}

/** Interactable kinds. Adding one = adding a registry entry, not engine code. */
export type InteractableKind =
  | 'signpost'
  | 'npc'
  | 'door'
  | 'focus_pod'
  | 'seat'
  | 'jukebox'
  | 'cabinet'
  | 'reading_nook';

/** An object placed on a Tiled object layer, normalized into tile space. */
export interface InteractableObject {
  id: string;
  kind: InteractableKind;
  tile: TileCoord;
  /** Does standing on this tile get blocked? Signposts yes, doors no. */
  blocks: boolean;
  /** Free-form per-kind props from the Tiled object (dialogue text, target zone). */
  props: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Minigames (06_ARCADE_MINIGAMES.md)
// ---------------------------------------------------------------------------

export interface MinigameConfig {
  id: string;
  displayName: string;
  /** Sprite key for the arcade cabinet that launches it. */
  cabinetSpriteKey: string;
  /** Phaser Scene key of the self-contained minigame scene. */
  sceneKey: string;
  minPlayers: number;
  maxPlayers: number;
  /** Shown on the cabinet's pre-game panel. */
  blurb?: string;
}

/** Handed to a minigame scene when it starts. */
export interface PlayerRef {
  id: string;
  displayName: string;
  spriteKey: string;
}

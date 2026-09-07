# 04 — Character Movement & Animation

## Controls

- `W` `A` `S` `D` — move up/left/down/right
- `Space` — context-sensitive interact/confirm (talk to NPC, sit at pod,
  start minigame, advance dialogue, pick up item)
- Arrow keys mirror WASD (accessibility / muscle memory for either scheme)
- `Esc` — open pause/settings menu (friends list, audio, leave zone)

## Movement model — grid-based, not free-pixel

This is a hard requirement, not a style suggestion: movement should feel
like FireRed/LeafGreen, meaning the player moves one tile at a time in the
pressed direction, with a short tween (120-150ms) animating the slide
between tiles, not continuous free-form pixel movement.

```
Player presses W:
  1. Check tile north of player for collision/walkability
  2. If walkable: tween player sprite from (x, y) to (x, y-1) over ~130ms
  3. Lock further input until tween completes (or queue next input for
     responsive chaining if holding the key)
  4. If not walkable: play "bump" — face that direction, tiny nudge, no move
```

Holding a direction key should chain moves smoothly (like FireRed running),
not restart the tween awkwardly each tile.

## Collision

- Tilemap collision layer authored in Tiled, marking non-walkable tiles
  (trees, walls, furniture, water) — same pattern as the reference
  screenshot's tree-block layout.
- Interactable objects (signposts, NPCs, cabinets, pods) also block
  movement but are additionally tagged interactable so Space triggers their
  behavior when the player is facing them at range 1.

## Sprite & animation requirements

- 4-directional character sprite sheets (down/up/left/right), each with a
  walk-cycle (2-4 frames) — standard GBA-era spec, matches reference art.
- Idle frame per direction (first frame of walk cycle is fine to reuse).
- Sitting animation/pose for focus pods and cafe seating.
- Simple status icon overlay above avatar for state flavor: studying (book
  icon), listening (music note), afk (zzz) — small, non-intrusive.
- Placeholder phase: colored rectangle + directional arrow is fine until
  real sprites exist — don't block gameplay logic on art.

## Camera

- Camera follows the local player, centered, with tilemap bounds clamping
  (don't show past the edge of the map) — standard Phaser camera-follow
  behavior.
- Smooth-follow (slight lag/lerp) rather than rigid lock, for a less
  mechanical feel.

## Facing & interaction targeting

- Player has a `facingDirection` state, updated on movement and also
  settable by pressing a direction while blocked (so you can turn to face
  something without moving into it — again, matches FireRed behavior).
- Space checks the tile directly in front of the player (based on
  `facingDirection`) for an interactable and triggers it if present.

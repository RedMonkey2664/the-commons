# 07 — Art Style & UI/UX

## Visual direction

GBA-era pixel art, same register as FireRed/LeafGreen: 16x16 base tile
grid, chunky readable character sprites (roughly 16x32 for a standing
character, matching GBA overworld proportions), warm and slightly desaturated
palette rather than neon/high-saturation — this is a place you relax in, not
a place you get hyped in.

Per-zone palette variation to reinforce the zoning-by-walking-in idea from
01_VISION_AND_CONCEPT.md:
- Town Square / Park: greens, natural light, matches reference screenshot 1.
- Library: warm wood tones, muted, soft interior lighting.
- Cafe: warm oranges/creams, cozy interior.
- Arcade: slightly more saturated, neon accents on cabinets only (contained
  contrast, not overwhelming the palette).

## Core UI components (match reference screenshot 2's language)

### Dialogue box
- Bottom-of-screen box, rounded corners, light background, dark text —
  same visual family as classic GBA Pokemon dialogue boxes.
- Text reveals character-by-character (or fast-scroll on repeated Space
  press) — small detail but it's core to the "feel."
- Used for: NPC flavor lines, tutorial hints, system messages.

### Item/status popup
- Same pattern as reference image 2 ("received HM04 from the WARDEN") —
  small portrait/icon + short text banner — reused for things like
  "unlocked new cosmetic," "new high score," "friend joined the world."

### Interact bubble
- "!" bubble above interactable NPCs/objects when in range (reference
  image 1) — the sole visual cue that something is interactable, kept
  consistent everywhere so players learn the language once.

### HUD (persistent, minimal)
- Small corner indicator: current zone name, mic/chat status icon.
- Friends panel (Esc to open): avatar list with zone/status, invite/join
  actions.
- Pomodoro timer overlay when seated at a focus pod or in a Study Room —
  simple countdown, start/pause/reset, unobtrusive corner placement so it
  doesn't cover the world.

## Animation & feel

- Screen transitions between zones: short fade or wipe (200-300ms), never
  an instant cut — reinforces "this is a real place you're walking into."
- Idle ambient motion in each zone (leaves swaying, steam from a coffee
  cup, a page turning) — cheap to fake with simple sprite-sheet loops,
  large impact on "alive" feeling.
- Avatar status icons (studying/listening/afk) should be small, corner-
  positioned above the sprite, never blocking the character itself.

## Accessibility notes worth designing in from the start

- Text size/contrast should be legible at typical browser zoom, not
  GBA-screen-tiny — this is a browser game, not an emulator.
- Colorblind-safe status icons (use shape + color, not color alone) for
  studying/listening/afk states.
- Keybind remap for interact/move eventually (not blocking for MVP, but
  don't hardcode key handling in a way that makes this hard to add later).

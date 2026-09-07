# 10 — Animation Specification

This is the animation spec Claude Code should build against — timings,
states, and transitions, not just "make it look nice." Treat these numbers
as defaults to implement, not vibes; tune later by feel once it's running.

## Animation state machine (per character)

```
                 ┌─────────┐
        ┌───────▶│  IDLE   │◀───────┐
        │        └────┬────┘        │
        │             │ move input   │ move stops
        │             ▼             │
        │        ┌─────────┐        │
        │        │ WALKING │────────┘
        │        └────┬────┘
        │             │ interact w/ seat
        │             ▼
        │        ┌─────────┐
        └────────│ SITTING │
     stand/leave  └────┬────┘
                       │ enter minigame / dialogue
                       ▼
                  ┌───────────┐
                  │  BLOCKED  │  (movement locked, e.g. mid-dialogue)
                  └───────────┘
```

States: `IDLE`, `WALKING` (4-directional), `SITTING`, `BLOCKED`. Each state
owns which inputs it accepts — e.g. `BLOCKED` ignores WASD entirely so a
player can't walk through a dialogue box.

## Walk cycle

- 2-4 frames per direction (down/up/left/right), frame rate ~8fps for a
  readable GBA-style cadence (not smooth 60fps human walking — the slight
  choppiness is the aesthetic).
- Tile-to-tile tween duration: **130ms** default ("walk"), **80ms** if a
  future "run" toggle is added (hold Shift — not in v1, but keep the timing
  constant named/configurable so it's a one-line add later).
- Easing: linear or very slight ease-out — grid movement should feel
  snappy and deliberate, not floaty. Avoid bounce/elastic easings here.
- Input buffering: if a direction key is held, queue the next tile-move to
  start the instant the current tween completes — this is what makes
  holding W feel like continuous walking instead of stuttering.

## Bump animation (blocked movement)

- On pressing a direction into a non-walkable tile: 60ms nudge (quarter-
  tile) toward the blocked direction, then spring back — no sound needed
  by default, optional subtle "thud" SFX.
- Character still turns to face that direction even though it doesn't move
  (matches FireRed behavior, and matters for the interact-facing system in
  04_CHARACTER_MOVEMENT_ANIMATION.md).

## Sitting transition

- 150ms cross-fade from standing sprite to seated sprite, no tween of
  position (it's a snap-to-seat, not a walk-to-seat — the walk to the
  seat's tile already happened via normal grid movement).
- Status icon (book/music/zzz) fades in 200ms after the sit animation
  completes, not simultaneously — avoids visual clutter of two things
  animating at once.

## Zone-transition animation

- Fade to black (or a simple horizontal wipe, pick one and use it
  everywhere — consistency matters more than which one): **250ms out, brief
  hold, 250ms in** at the new spawn point.
- Network room-join should be kicked off during the "out" fade so the
  round-trip is masked by the transition rather than causing a visible
  hitch after the fade completes.

## Ambient/idle world animation (cheap, high impact)

These loop independently of player action — implement as simple sprite-
sheet loops on a timer, not physics:

| Element | Zone | Loop |
|---|---|---|
| Leaves/grass sway | Town Square, Park | 2-3 frame loop, ~1.5s cycle |
| Steam from cup | Cafe | 3-4 frame loop, ~1s cycle, alpha fade top |
| Page turn (reading nook) | Library | one-shot every ~8-12s, randomized |
| Arcade cabinet screen flicker | Arcade | 2-frame subtle loop, ~2s cycle |
| Bandstand light pulse | Park | slow sine pulse on emissive tiles, ~3s |

Keep these lightweight — they're texture, not gameplay, and shouldn't cost
meaningful render budget with many players on screen.

## UI animation (ties to 07_ART_STYLE_UI_UX.md components)

- **Dialogue box**: slides up from bottom, 180ms ease-out, text then reveals
  character-by-character at ~30ms/character (skippable via Space).
- **Item/status popup**: pops in with a small overshoot scale (1.0 → 1.05 →
  1.0) over 250ms, holds 2s, fades out 200ms — this is the one place a
  slightly bouncier easing is appropriate, it's a "reward" beat.
- **Interact bubble ("!")**: appears instantly (no fade) when entering
  range — this is a functional cue, not a polish moment, latency here
  actively hurts usability.
- **Friends panel / Pomodoro overlay**: slide-in from the relevant screen
  edge, 200ms ease-out, standard UI panel motion, nothing fancy.

## Remote player interpolation (networked motion, not authored animation)

- Remote players' positions arrive as discrete tile-move events from the
  server (per 05_MULTIPLAYER_PRESENCE.md) — the client should tween them
  visually using the **same 130ms walk timing** as the local player, so a
  friend's avatar moves at the same visual cadence yours does, even though
  the network update itself was a single snap-to-value message.
- If a network update is delayed and a remote player "jumps" more than one
  tile, snap directly rather than playing an exaggerated fast-tween across
  the gap — a subtle pop reads better than a weird zoom.

## Implementation note for Claude Code

Use Phaser's built-in `AnimationManager` for sprite-sheet cycles and
`tweens` for position/scale/alpha — don't hand-roll a timing system, Phaser
already has the primitives this spec needs. Centralize the timing constants
above (130ms tile move, 250ms zone fade, etc.) in one `animationConfig.ts`
in `shared/` so tuning them later is a one-file change, not a hunt through
every scene.

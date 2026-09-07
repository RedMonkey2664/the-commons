# 01 — Vision & Concept

## What this is

"The Commons" is a small virtual town that friends log into together — not to
fight or grind, but to exist in the same space while they study, chill, and
talk, the way a Discord voice call with cameras off never quite manages.

Reference feel: Pokemon FireRed/LeafGreen's overworld — same top-down 2D
grid, same chunky readable sprites, same "!" interaction bubble and item-
received dialogue box (see reference screenshots) — but repurposed. Instead
of gyms and wild encounters, the town has a library, a cafe, an arcade, a
park, and quiet study rooms.

## Why this shape works

- Games are naturally good at making "being somewhere together" feel real,
  which text chat and static video calls are not.
- A grid-world with distinct buildings gives natural social zoning for free:
  loud vs quiet, focused vs casual, without needing explicit "mute" UI —
  you just walk into the library and it's quiet there.
- Pokemon's overworld is a proven, low-asset-cost way to make a 2D world
  feel alive: idle animations, simple NPCs, environmental storytelling.

## Core loop

1. Player logs in, spawns in Town Square.
2. Sees friends' avatars walking around live (multiplayer presence).
3. Walks WASD into a building — Library, Cafe, Arcade, Park, or a private
   Study Room.
4. Zone context changes what's available: Library = focus pods + Pomodoro,
   Cafe = shared jukebox + seating, Arcade = minigame cabinets, Park = open
   hangout + benches, Study Room = instanced solo/group focus space.
5. Interacts with objects/NPCs via Space (talk, sit, start minigame, start
   Pomodoro timer, join jukebox queue).
6. Session persists lightly — friend list, cosmetic unlocks from arcade
   play, study time tracked per user (in the spirit of your existing
   StudyScape project, but multiplayer and game-shaped instead of a website).

## Zones (detail in 03_WORLD_MAP_ZONES.md)

- **Town Square** — hub, spawn point, signposts to every other zone.
- **Library** — quiet zone, individual focus pods, shared reading nook.
- **Cafe** — social zone, jukebox, seating, "order a drink" cosmetic flavor.
- **Arcade** — minigame cabinets, pluggable and expandable.
- **Park / Plaza** — open outdoor hangout, benches, bandstand for music.
- **Study Rooms** — instanced rooms (solo or small group), Pomodoro-driven.

## Design principles to hold onto

- **Low-pressure, not a game with win/lose stakes.** The arcade minigames
  are the only competitive layer; everything else is ambient/social.
- **Interruption-friendly.** Someone can drop in, wave, sit at the cafe for
  10 minutes, and leave — no onboarding tax each session.
- **Config over code for content.** New buildings, NPCs, and minigames
  should be addable by a non-engine-touching contributor (future you, or a
  friend helping) — this is a hard requirement, not a nice-to-have, see
  02_TECH_STACK_ARCHITECTURE.md.
- **Study features are real, not decorative.** Pomodoro timers, focus pods,
  and study-time tracking should actually work, not just look like they do.

## Explicitly out of scope for v1

- Combat, quests, currency/economy beyond arcade high scores.
- Mobile app — browser-first (Phaser runs fine in-browser); a wrapped
  mobile build is a later-phase idea, not v1.
- Full voice mesh for large groups — start with small-room voice (see
  08_FEATURE_ROADMAP.md), it's the single hardest technical piece here and
  shouldn't gate everything else.

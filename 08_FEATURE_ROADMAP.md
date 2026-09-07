# 08 — Feature Roadmap

Build in this order. Each phase should be genuinely playable/demoable
before moving to the next — don't let phases blur together.

## Phase 0 — Single-player skeleton
- One zone (Town Square) with placeholder tileset.
- WASD grid movement + collision, Space interact stub.
- Camera follow.
- No server, no accounts — just prove the movement/rendering feel is right.
- **Done when**: you can walk around one room and it feels like FireRed.

## Phase 1 — Basic multiplayer in one zone
- Colyseus server, one room type (Town Square).
- Player state sync (position, facing, displayName).
- Remote player interpolation.
- Simple auth stub (even just a name-entry, no real accounts yet).
- **Done when**: two browser tabs show each other's avatars moving live.

## Phase 2 — Full world
- All zones built (Library, Cafe, Arcade shell, Park, Study Rooms).
- Zone-transition system (leave/join rooms, spawn points).
- NPCs with dialogue box interactions.
- Friends list UI (can be mocked/local before real backend accounts).
- **Done when**: you can walk the whole town and transition between every
  zone smoothly.

## Phase 3 — Real accounts, persistence, arcade minigames
- Supabase auth + Postgres (real accounts, real friend list).
- Study-time tracking (focus pods, Study Rooms feed a persisted stat).
- Arcade minigame plugin system + first 2 minigames (Memory Match, Trivia
  Blitz) per 06_ARCADE_MINIGAMES.md.
- Zone-wide text chat.
- **Done when**: you can log in as yourself, add a real friend, and play a
  minigame with them with scores saved.

## Phase 4 — Music & voice layer
- Jukebox system in Cafe + Park (shared queue, synced playback state).
- Voice chat via LiveKit/Daily, scoped per zone room, with Library defaulting
  muted per zone config.
- **Done when**: a group of friends can sit in the cafe, talk, and listen to
  the same track together.

## Phase 5 — Polish & expansion
- Real pixel art replacing placeholders (character sprites, tilesets, UI
  chrome) per 07_ART_STYLE_UI_UX.md.
- Remaining minigames (Reaction Tap, Retro Runner, Rhythm Tap).
- Cosmetic unlocks, ambient animation pass, sound design pass.
- Anything you think of after actually using it with friends — this is the
  phase where the config-driven architecture pays off, since new
  zones/minigames/cosmetics should be additive from here on, not rewrites.

## Explicitly deferred until requested
- Mobile-native build.
- Large-room (10+) voice/presence scaling.
- User-generated content (custom rooms, uploaded music links) — flag
  licensing concerns before ever building arbitrary external media embeds.
- Monetization of any kind.

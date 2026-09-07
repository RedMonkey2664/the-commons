# 03 — World Map & Zones

## Town layout (top-down)

```
                         ┌───────────────────────┐
                         │   PARK / PLAZA          │
                         │   benches, bandstand    │
                         │   (open hangout,        │
                         │    shared music)         │
                         └───────────┬─────────────┘
                                     │
        ┌────────────┐      ┌───────┴────────┐      ┌────────────┐
        │  LIBRARY    ├──────┤  TOWN SQUARE    ├──────┤   CAFE      │
        │  quiet zone │      │  hub / spawn    │      │  social zone│
        │  focus pods │      │  signposts to   │      │  jukebox    │
        └────────────┘      │  every zone      │      └────────────┘
                             └───────┬─────────┘
                                     │
                         ┌───────────┴─────────────┐
                         │       ARCADE              │
                         │   minigame cabinets        │
                         │   (pluggable, expandable)   │
                         └───────────┬─────────────┘
                                     │
                         ┌───────────┴─────────────┐
                         │   STUDY ROOMS (instanced)  │
                         │   solo / small-group        │
                         │   Pomodoro pods              │
                         └───────────────────────────┘
```

Town Square is the hub every zone connects back to — matches the reference
screenshot's open grassy area with signposts/paths, and keeps navigation
simple (never more than one hop from spawn to any zone).

## Zone-by-zone spec

### Town Square (hub)
- Spawn point for all sessions.
- Signposts (interact with Space) at each cardinal direction leading to
  Library / Cafe / Arcade / Park, doorway south to Study Rooms.
- Ambient NPCs for flavor (non-interactive or light flavor-text only).
- Friend avatars visible here first — this is where you "see who's online."

### Library
- Silent zone — no jukebox, ambient sound is minimal (page turns, quiet
  hum), matches your existing instinct from StudyScape re: ambience mattering.
- **Focus pods**: individual desks; interacting sits your avatar down and
  opens a Pomodoro timer UI. While seated, other players see you as
  "studying" (small icon over avatar) instead of idle.
- **Reading nook**: a shared low-key spot, no timer, just flavor — for
  friends who want to sit near each other quietly without a formal timer.
- Voice chat default: muted (matches vision principle — zoning by walking
  in, not by manual mute toggles).

### Cafe
- Social zone — shared jukebox is the centerpiece.
- **Jukebox**: any player interacts to queue a track (initially: a curated
  royalty-free lo-fi/ambient playlist, expandable later to user-submitted
  links — flag licensing carefully if you ever allow arbitrary YouTube/
  Spotify embeds).
- **Seating**: tables/booths, sitting near friends is purely social (no
  mechanic, just proximity + chat).
- **Order a drink**: cosmetic-only interaction — picks a drink icon that
  shows over your avatar for flavor, no gameplay effect. Cheap to build,
  good "third place" texture.
- Voice chat default: on (this is the casual-talk zone).

### Arcade
- Cabinets placed around the room, each mapped to one entry in
  `minigames.config.ts` (see 02 and 06).
- Interacting with a cabinet either starts a solo minigame instantly or
  opens a "waiting for players" state for multiplayer minigames.
- High scores per cabinet, shown on an in-cabinet leaderboard, persisted
  per user.

### Park / Plaza
- Outdoor, open layout — benches, a bandstand.
- **Bandstand**: same shared-jukebox mechanic as the cafe, but themed as
  "live" — could later host scheduled listening-party events.
- Primarily a low-friction "just exist together outside" space — least
  mechanically dense zone on purpose.

### Study Rooms (instanced)
- Unlike other zones, these are instanced per group — a player either
  starts a new room (becomes shareable via a room code, like the reference
  request's "hangout with friends" framing) or joins a friend's.
- Each room has: a shared Pomodoro timer (host controls start/pause), desks
  for each participant, minimal decoration — this is the "get work done
  together" space, kept deliberately quiet and undistracting.
- Study time here is what feeds the per-user study-time tracking stat.

## NPCs & interaction pattern (matches reference screenshots)

- Idle NPCs show a "!" bubble when the player is in interact range (see
  reference image 1's exclamation-mark bubbles) — signals "you can talk to
  this."
- Talking to an NPC or picking something up opens a Pokemon-style dialogue
  box at the bottom of the screen (see reference image 2) — same
  visual language, repurposed for things like: cafe barista flavor lines,
  librarian tips ("focus pods save your streak"), arcade attendant
  explaining a new minigame.
- Zone-transition tiles (doors, gates) work like FireRed's map-edge
  transitions — walk onto the tile, screen transition, spawn in the new
  zone's designated entry point.

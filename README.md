# The Commons

A 2D top-down multiplayer virtual hangout town, styled like Pokemon
FireRed/LeafGreen. Friends log in to the same small town to study, chill,
listen to music together, and play arcade minigames.

The point is **presence, not progression** — see
[01_VISION_AND_CONCEPT.md](01_VISION_AND_CONCEPT.md).

---

## Status: Phase 1 complete

| Phase | Scope | State |
|---|---|---|
| **0** | Single-player skeleton: Town Square, WASD grid movement, collision, camera | **Done** — 23/23 smoke checks |
| **1** | Colyseus server, multiplayer sync in Town Square | **Done** — 20/20 sync checks |
| 2 | All zones + zone transitions + NPC dialogue + friends list | Not started |
| 3 | Supabase auth, persistence, arcade minigames, text chat | Not started |
| 4 | Jukebox + voice chat | Not started |
| 5 | Real pixel art, remaining minigames, polish | Not started |

**Playable right now:** type a name, spawn in Town Square, and walk it with
grid-based WASD movement — tile collision, bump feedback, turn-in-place, smooth
camera follow, Space to read signposts and talk to an NPC through a
Pokemon-style dialogue box, "!" interact bubbles, swaying ambient grass. Open a
second browser and you see each other live, with nameplates, moving at the same
130ms-per-tile cadence. The four zone doors are placed and reachable; walking
into one says the zone isn't open yet.

If the server is down the town still works — you just play it alone.

---

## Setup

Requires Node 20+.

```bash
npm install                 # installs all workspaces
npm run dev:client          # http://localhost:5173
```

For multiplayer, run both:

```bash
# terminal 1
npm run dev:server     # ws://localhost:2567
# terminal 2
npm run dev:client     # http://localhost:5173
```

Open two browser windows to see two players. The client connects automatically
and falls back to single-player if the server is unreachable.

### Other commands

```bash
npm run build               # typecheck + production client bundle
npm run typecheck           # all workspaces
node tools/verify_maps.mjs  # validate every map: spawn, reachability, door targets
python tools/generate_placeholder_maps.py   # regenerate placeholder Tiled maps
node tools/phase0_smoke.mjs  # single-player smoke test (no server needed)
node tools/phase1_sync.mjs   # two-client multiplayer sync test (boots server + client)
node tools/capture_screens.mjs # screenshot the loading, title and world screens
```

Both need `npx playwright install chromium` once. Add `--headed` to watch.

---

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` (or arrows) | Move one tile |
| `Space` (or `Enter`) | Interact / advance dialogue |
| `Esc` | Menu (Phase 2) |

Tap a direction you aren't facing to **turn in place**; hold it to walk.
Holding a direction chains tiles continuously.

---

## Repo layout

```
client/          Phaser 3 + TypeScript game
  src/art/         placeholder art generation, animation registration
  src/entities/    Player, RemotePlayer
  src/systems/     GridMovement, ZoneMap, Interaction*, InputController,
                   AmbientAnimator, NetworkClient, MultiplayerSystem
  src/scenes/      BootScene, TitleScene, ZoneScene (base), TownSquareScene
  src/ui/          UIScene, DialogueBox, ItemPopup, Hud
server/          Colyseus game server
  src/rooms/       ZoneRoom — one generic, config-driven room type for every zone
  src/schemas/     Colyseus state schemas
  src/world/       map loading (shares the client's collision parser)
shared/          types, zones.config, minigames.config, animationConfig, designTokens
assets/          tilesets, sprites, audio, maps (Tiled JSON) — served as the web root
tools/           map generation and validation, smoke test
```

The numbered `NN_*.md` files at the repo root are the design specs. They are the
source of truth; this README describes what has been built from them.

---

## Architecture: config over code

This is a hard requirement from
[02_TECH_STACK_ARCHITECTURE.md](02_TECH_STACK_ARCHITECTURE.md), not a
preference. New content must not require engine changes.

### Adding a zone

1. Append a `ZoneConfig` to `shared/zones.config.ts`.
2. Put its Tiled JSON in `assets/maps/`.
3. Add a scene file — the whole file:

   ```ts
   export class LibraryScene extends ZoneScene {
     constructor() { super(getZone('library')); }
   }
   ```

4. Add one line to `client/src/scenes/zoneSceneRegistry.ts`.

`ZoneScene` derives map loading, collision, spawn resolution, camera, the
interaction system, ambient animation and the HUD from the config and the map.
A zone that needs something unique overrides a hook rather than reimplementing
the scene.

### Adding an interactable

Add a handler to `INTERACTABLE_HANDLERS` in
`client/src/systems/InteractableRegistry.ts`, keyed by kind, then tag map
objects with `kind`. The interaction system finds *what you are facing*; the
registry decides *what happens*.

### Adding a minigame (Phase 3)

Write one self-contained scene implementing `MinigameScene`, append one entry to
`shared/minigames.config.ts`. The Arcade zone places a cabinet per entry and
never learns a minigame's internals.

### Every zone boots in isolation

`ZoneScene` generates its own art and loads its own map, so any zone can be
started directly without going through `BootScene`. No monolithic scenes.

---

## Multiplayer model

**One shared definition of collision.** `shared/tilemap.ts` parses the Tiled
JSON and produces the walkability query. The client uses it for movement; the
server uses it — same function, same file — to validate every move. Phaser is
used only to *draw* the map. Two implementations of "walkable" would drift, and
the failure mode is a player walking through a wall on one screen but not the
other.

**One room type for every zone.** `ZoneRoom` is generic and reads `ZoneConfig`;
the server registers it once with `filterBy(['zoneId'])`, so clients asking for
the same zone share a room and a new zone needs no server code.

**Clients send intent, never position.** A client sends `{dir, seq}`. The server
computes the target from *its own* authoritative position, validates it, and
applies it. There is no message that carries a player-supplied coordinate, so
there is nothing to spoof — verified by a test that forces a client's local
position and watches the server overrule it.

**Prediction without rubber-banding.** The local player moves immediately, and
the server validates in parallel. The subtlety is telling "the server hasn't
processed my latest move yet" apart from "the server disagrees with me" — the
first is stale, the second is authoritative. Every intent carries a sequence
number that the server echoes as `lastSeq`, and the client only accepts a
correcting snap once the server has caught up with everything it sent.

**Remote players** tween at the same 130ms per tile as the local player so
everyone moves at one visual cadence, and snap instead of racing if an update is
missed by more than a tile (per 10).

Players do **not** block each other — see the open question below.

---

## Design tokens and timings

Two files, and only two, hold tunable numbers:

- `shared/animationConfig.ts` — every duration, easing and frame rate
  (130ms tile step, 250ms zone fade, 30ms/char text reveal, …)
- `shared/designTokens.ts` — palette, spacing, typography, viewport

Nothing else in the codebase should contain a magic timing or color. Values
added beyond the specs are commented `[ADDED]` with the reason.

### Viewport

The canvas **resizes to the window** (`Phaser.Scale.RESIZE`) rather than
rendering at a fixed design resolution and letterboxing. There is therefore no
single design resolution:

- World cameras pick zoom from window **height** via `VIEWPORT.zoomFor`, so a
  wider window shows more city instead of magnifying the same slice. Zoom is
  quantized to half steps — unconstrained fractional zoom makes pixel edges
  shimmer as the camera moves.
- The UI scene lays out against the live camera size and reflows on resize.

### Art resolution

Source art is authored at **32×32 per tile** and **32×64 per character**. That
is the change that makes the world look clearer: scaling 16px art up only makes
it bigger, while four times the pixel budget lets every tile carry gradients,
edge highlights, grain and cast shadows. All of it is still generated
procedurally at runtime from `shared/designTokens.ts`.

---

## Placeholder art

All art is generated at runtime into canvas textures
(`client/src/art/placeholderArt.ts`). Asset keys in `ASSET_KEYS` are the
contract. Swapping in real art means loading a PNG under the same key in
`BootScene` and deleting the matching generator call — no scene, system or
entity changes.

Maps are **real Tiled 1.10 JSON exports** generated by
`tools/generate_placeholder_maps.py`, so hand-authored Tiled files drop in
without code changes.

---

## Known deviations from the specs

Flagged rather than made silently:

| Spec | Deviation | Why |
|---|---|---|
| 09: `ts-node-dev` | Using `tsx` | Avoids ESM + tsconfig path-mapping friction resolving `@commons/shared` |
| 09: `client/public/` | Vite `publicDir` points at repo-root `assets/` | The server needs the same map JSON for authoritative collision in Phase 1; duplicating guarantees drift |
| **07 + 11: art direction** | **Higher-resolution modern city instead of GBA pixel art** | **Requested.** Tiles authored at 32×32 (4× the pixels), cooler contemporary palette, glass-and-concrete buildings, paved plaza with a fountain and street furniture |
| **11: `tileDisplayScale`** | **1, with camera zoom derived from window height** | Art is authored at final resolution; zoom now adapts to the window so a bigger screen shows more city rather than a magnified slice |
| **Scale mode** | **RESIZE, canvas fills the window** | FIT letterboxes on any window that isn't the design aspect ratio; black bars don't read as a modern game |
| 10: bump timing | 60ms yoyo (60 out + 60 back) | Reading of "60ms nudge, then spring back" |
| 04/10 | Added `turnInPlaceMs: 60` | Tap-to-turn is core FireRed feel; spec only covered turning while blocked |
| 10: zone fade hold | Added `holdMs: 80` | Spec says "brief hold" without a number |
| 04: facing cue | Eyes rather than an arrow | Spec permits "colored rectangle + directional arrow"; eyes read better at 16×32 |
| 05 | Players don't collide with each other | Not specified either way. Blocking is grief-able in a hangout game and can trap someone in a doorway; flagged as an open question |

## Tooling gaps

No testing/QA, design-system or docs-generation skill was available in this
environment that fits a Phaser canvas game — the installed design skills target
HTML/CSS/React surfaces. UI is implemented directly from
[07_ART_STYLE_UI_UX.md](07_ART_STYLE_UI_UX.md) and
[10_ANIMATION_SPEC.md](10_ANIMATION_SPEC.md), this README is hand-maintained,
so multiplayer sync is tested with a bespoke Playwright harness
(`tools/phase1_sync.mjs`) that drives two real browser contexts against a real
server and compares each client's view of the other against that other client's
own state.

# 11 — Game Design Document

This ties together vision (01), world (03), and art (07) into the design
decisions that hold the whole thing together — the "why does this system
work this way" reference, plus the concrete design tokens implementers need.

## Design pillars (every feature decision should trace back to one of these)

1. **Presence over performance.** The point is feeling like your friends are
   nearby, not achieving anything. When a feature idea comes up later, ask:
   does this make people feel more together, or does it add friction/goals
   that fight that feeling?
2. **Zoning by walking, not by menus.** Quiet vs social, focused vs casual —
   these should always be expressed by which building you're in, never by a
   settings toggle you have to remember to set. (Exception: manual override
   always available — defaults shouldn't trap anyone.)
3. **Config over code.** Already load-bearing in the architecture (02, 06)
   — restated here because it's a design principle too: the game should be
   able to grow (new zones, new minigames, new cosmetics) without becoming
   harder to reason about.
4. **Low commitment, drop-in friendly.** No onboarding tax each session, no
   penalty for leaving mid-activity (except mid-multiplayer-minigame round,
   where a graceful forfeit is fine).

## Player experience goals, by zone

| Zone | Feeling on entry | Session length (typical) |
|---|---|---|
| Town Square | "Who's here?" — orientation, low stakes | 10-30s pass-through |
| Library | "Let's actually get something done" | 25-50 min (Pomodoro-scale) |
| Cafe | "Let's just talk for a bit" | 10-40 min, open-ended |
| Arcade | "Quick fun break" | 2-10 min per session |
| Park | "Background hangout while doing something else" | open-ended, low attention |
| Study Room | "Focused work with this specific person/group" | 25-90 min |

This table should inform default session/UI decisions — e.g. Study Rooms
justify a more prominent Pomodoro UI than the Park, because the whole point
of that zone is the timer.

## Systems design — how the pieces interact

- **Status flows from location + action, not manual toggles.** Sitting at a
  focus pod → status becomes `studying` automatically. Walking away →
  reverts to `idle`. This keeps the "zoning by walking" pillar honest —
  friends see accurate status without anyone managing it.
- **Study-time tracking is a passive byproduct, not a feature you "use."**
  Time accrues while `status === 'studying'` in Library/Study Rooms; no
  separate start/stop UI beyond sitting down and standing up.
- **Arcade is the only zone with explicit competition/scoring** — this is
  deliberate, not an oversight; see pillar 1. Keep future feature requests
  for "leaderboards" or "achievements" scoped to the Arcade unless there's
  a strong reason to break that containment.
- **Jukebox is shared state, not per-player** — one queue per room (Cafe,
  Park bandstand), because the point is listening together, not each
  person hearing their own private track while standing near each other.

## New-player flow (first session)

1. Land in Town Square already spawned (no character-creator gate in v1 —
   a simple name + preset sprite pick is enough friction; save deep
   customization for Phase 5 cosmetics).
2. First interact prompt is a signpost with a one-line orientation
   ("Library's quiet, Cafe's for talking, Arcade's for messing around") —
   not a forced tutorial sequence.
3. Friends list starts empty; first real action most players take is
   adding the friend who invited them (deep-link/invite code from outside
   the game, e.g. a shared join link).

## Design tokens (for UI implementation — pairs with 07_ART_STYLE_UI_UX.md)

```typescript
// shared/designTokens.ts
export const COLORS = {
  townSquareBg: '#8FD5A6',
  libraryBg:    '#C9A876',
  cafeBg:       '#E8B888',
  arcadeBg:     '#6B5B95',
  parkBg:       '#7BC47F',
  dialogueBoxBg: '#F5F1E6',
  dialogueBoxText: '#2B2B2B',
  statusStudying: '#4A7C59',
  statusListening: '#4A5F8C',
  statusAfk: '#8C8C8C',
};

export const SPACING = {
  tile: 16,           // base tile size in px, source art resolution
  tileDisplayScale: 2, // rendered at 2x for browser legibility
  hudMargin: 12,
  dialogueBoxPadding: 16,
};

export const TYPOGRAPHY = {
  dialogueFont: 'monospace', // placeholder; swap for pixel font asset
  dialogueFontSize: 14,
  hudFontSize: 12,
};
```

Keep these centralized rather than inlined per-scene — this is what makes
a future re-theme (e.g. a seasonal palette swap) a config change instead of
a hunt through every file.

## Balance & pacing notes (arcade specifically)

- Minigame rounds should target **2-5 minutes** — long enough to feel like
  a real activity, short enough that it doesn't stall the group's momentum
  toward the next thing.
- Difficulty curve within a minigame session (not across the whole game):
  each successive round of something like Reaction Tap or Trivia Blitz can
  ramp slightly, but reset per session — no meta-progression grind gating
  content, per pillar 1.

## Open design questions to revisit after playtesting with real friends

- Does zone-wide text chat (05) feel right, or does it need to be
  proximity-based once rooms have more than ~4-5 people at once?
- Does the "sit down = studying status" auto-inference ever feel wrong
  (e.g. someone sits to chat, not to focus) — may need a lightweight
  manual override.
- Whether Park and Cafe end up feeling redundant once both have jukeboxes
  — may want to differentiate further (e.g. Park = ambient/background
  music, Cafe = active shared queue) rather than duplicate mechanics.

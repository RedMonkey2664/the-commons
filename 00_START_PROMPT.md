# START PROMPT — paste this into Claude Code

You are building "The Commons" — a 2D top-down multiplayer virtual hangout game,
styled like Pokemon FireRed/LeafGreen, where friends can meet online to study,
chill, listen to music together, and play arcade minigames.

Before writing any code, read every file in this spec folder, in this order:

1. 01_VISION_AND_CONCEPT.md      — what we're building and why
2. 02_TECH_STACK_ARCHITECTURE.md — engine, server, folder structure, data flow
3. 03_WORLD_MAP_ZONES.md         — the town layout and each zone's purpose
4. 04_CHARACTER_MOVEMENT_ANIMATION.md — controls, grid movement, sprite anim
5. 05_MULTIPLAYER_PRESENCE.md    — how players see/sync with each other
6. 06_ARCADE_MINIGAMES.md        — the pluggable minigame system
7. 07_ART_STYLE_UI_UX.md         — visual direction and UI components
8. 08_FEATURE_ROADMAP.md         — build order, MVP → later phases
9. 09_PROJECT_STRUCTURE_SETUP.md — exact repo scaffold and setup commands
10. 10_ANIMATION_SPEC.md         — animation states, timings, easing, transitions
11. 11_GAME_DESIGN_DOCUMENT.md   — design pillars, systems design, design tokens

Before you start building anything, check what Skills you have available
in this environment (project-level, user-level, or plugin-provided) and
use whichever ones genuinely apply as you go — don't just note this once
and forget it:
- Any frontend/UI/design-system skill → use it for scene UI components
  (dialogue box, HUD, panels) and for the tilemap/sprite integration work,
  since 07_ART_STYLE_UI_UX.md and 10_ANIMATION_SPEC.md define the visual
  and motion language but a design skill may have useful conventions for
  implementing it cleanly.
- Any testing/QA skill → use it when you get to Phase 1+ multiplayer sync,
  since that's the highest-risk-of-silent-bugs part of this build (state
  desync between clients is easy to miss without deliberate testing).
- Any docs/README-generation skill → use it once the repo scaffold from
  09_PROJECT_STRUCTURE_SETUP.md exists, so the project stays documented as
  it grows instead of documentation lagging behind.
- Any general code-review or refactoring skill → use it at each phase
  boundary (see step 5 below) before moving to the next phase, so the
  config-driven architecture (02, 06) doesn't quietly erode into hardcoded
  special cases as more zones/minigames get added.
If a relevant skill isn't available, say so plainly rather than silently
skipping the step — I'd rather know a gap exists than assume it's covered.

Then do the following, in order:

1. Confirm you've understood the vision back to me in 3-4 sentences before
   touching any code.
2. Scaffold the project exactly as described in 09_PROJECT_STRUCTURE_SETUP.md
   (client + server as a monorepo, TypeScript throughout).
3. Build Phase 0 of the roadmap (08_FEATURE_ROADMAP.md) first: a single
   player walking around one zone (Town Square) with WASD + Space, tile
   collision, and a placeholder tileset. Nothing multiplayer yet. Get this
   running and confirm it works before moving on.
4. Only after Phase 0 works, move to Phase 1 (basic multiplayer sync in
   Town Square), then Phase 2 (remaining zones), then Phase 3 (arcade
   minigames), then Phase 4 (voice/social layer), per the roadmap.
5. At every phase boundary, stop and summarize what's playable so far
   before continuing — don't silently build ahead.

Non-negotiables from the spec, don't drift from these without asking:
- Movement is WASD + Space, grid-based (not free-form pixel movement),
  same feel as FireRed/LeafGreen.
- New zones and new arcade minigames must be addable via config/registry,
  not by editing core engine code — see 02 and 06 for the pattern.
- Keep the art style and UI consistent with 07_ART_STYLE_UI_UX.md — dialogue
  boxes, item-received popups, and interaction prompts should look and feel
  like the reference screenshots (Pokemon-style dialogue box, "!" interact
  bubble, item pickup with portrait).
- Every zone and every minigame should be playable and testable in isolation
  — don't build monolithic scenes.
- Animation timings and design tokens in 10_ANIMATION_SPEC.md and
  11_GAME_DESIGN_DOCUMENT.md are defaults to implement, not suggestions to
  reinterpret — if you think a number should change, say so and propose
  the alternative rather than quietly picking your own.

If anything in these specs is ambiguous or you think a different technical
choice serves the vision better, flag it and propose the alternative before
proceeding — don't silently deviate.

Ask me for real tile/sprite assets when you get to visual polish; use
placeholder colored rectangles/labels until then so gameplay logic isn't
blocked on art.

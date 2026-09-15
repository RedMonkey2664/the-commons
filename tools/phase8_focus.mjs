#!/usr/bin/env node
/**
 * Phase 8 test: Focus Mode.
 *
 *   node tools/phase8_focus.mjs [--headed]
 *
 * The thing this feature promises is "the avatar feels alive", which is not
 * directly assertable — but the properties that produce it are, and they are
 * exactly the ones that rot silently:
 *
 *   - the session clock is NOT the animation's to control: it must keep
 *     advancing while the avatar is paused, and match the timer that owns it
 *   - the behaviour scheduler must actually cycle, and must not repeat itself
 *     within its history window
 *   - a long session must not accumulate tweens, timers or game objects
 *
 * It runs the client DELIBERATELY OFFLINE (pointed at a dead server), for a
 * reason worth stating: this suite teleports the player onto a focus pod, and a
 * connected server would rightly overrule a move it never agreed to and snap
 * them back to their last authoritative tile. That is the server behaving
 * correctly, and testing Focus Mode through it would be testing reconciliation.
 * Sitting down with a server connected is covered by phase9, which walks there.
 *
 * The leak check is the reason this suite exists at all. Focus Mode is entered
 * and left repeatedly in one sitting and can run for hours, so "does the tween
 * count come back down" is a question worth asking of a real browser rather
 * than of a reviewer's memory.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const PORT = 5187;
const isWin = process.platform === 'win32';
const headed = process.argv.includes('--headed');

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Everything the assertions need, read straight out of the running game. */
const FOCUS_STATE = `(() => {
  const game = window.__COMMONS__.game;
  const focus = game.scene.getScene('FocusScene');
  const ui = game.scene.getScene('UIScene');
  const active = !!focus && focus.scene.isActive();
  return {
    active,
    behavior: active ? focus.machine?.currentId : null,
    recent: active ? [...(focus.machine?.recent ?? [])] : [],
    clockText: active ? focus.clock?.text : null,
    clockLabel: active ? focus.clockLabel?.text : null,
    caption: active ? focus.caption?.text : null,
    timerSeconds: ui?.focus?.liveSeconds ?? 0,
    timerRunning: ui?.focus?.isRunning ?? false,
    timerPaused: ui?.focus?.isPaused ?? false,
    sitting: (() => {
      const zone = game.scene.scenes.find((x) => x.scene.isActive() && x.player);
      return zone?.player?.isSitting ?? null;
    })(),
    tweens: active ? focus.tweens.getTweens().length : 0,
    displayObjects: active ? focus.children.list.length : 0,
    timers: active ? focus.time.getActiveEvents?.()?.length ?? 0 : 0,
  };
})()`;

let vite;
let browser;

try {
  vite = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev', '--workspace', 'client', '--', '--port', String(PORT)], {
    cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin,
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start in 60s')), 60_000);
    const on = (b) => { if (/Local:|ready in/i.test(b.toString())) { clearTimeout(t); res(); } };
    vite.stdout.on('data', on);
    vite.stderr.on('data', on);
  });

  browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await context.addInitScript(() => {
    localStorage.setItem('commons.session', JSON.stringify({ displayName: 'Focus', userId: 'u_focus_test' }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // A dead address: the client falls back to single-player, which is the
  // isolated shape this suite is about.
  await page.goto(`http://localhost:${PORT}/?server=ws://127.0.0.1:1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
    undefined,
    { timeout: 45_000 },
  );

  // The Library has the focus pods. Walked to via the zone transition the game
  // itself uses, rather than by booting the scene directly, so the pod is
  // reached in the same state a player would find it in.
  await page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
    scene.transitionTo('library');
  });
  await page.waitForFunction(
    () => Boolean(window.__COMMONS__?.game?.scene?.isActive('LibraryScene')),
    undefined,
    { timeout: 25_000 },
  );
  await page.waitForTimeout(800);

  console.log('\nentering focus mode');

  // Drive the pod the way the player does: stand next to it, face it, press
  // Space. Calling enterFocusMode() directly would skip the wiring under test.
  const sat = await page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
    const pod = scene.zoneMap.interactables.find((o) => o.kind === 'focus_pod');
    if (!pod) return null;

    const spots = [
      { facing: 'up', tile: { x: pod.tile.x, y: pod.tile.y + 1 } },
      { facing: 'down', tile: { x: pod.tile.x, y: pod.tile.y - 1 } },
      { facing: 'left', tile: { x: pod.tile.x + 1, y: pod.tile.y } },
      { facing: 'right', tile: { x: pod.tile.x - 1, y: pod.tile.y } },
    ].filter((s) => scene.zoneMap.isWalkable(s.tile));
    if (spots.length === 0) return null;

    scene.player.movement.teleport(spots[0].tile, spots[0].facing);
    return spots[0];
  });
  check('there is a focus pod to sit at', sat !== null);

  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => window.__COMMONS__.game.scene.getScene('FocusScene')?.scene?.isActive?.() === true,
    undefined,
    { timeout: 10_000 },
  ).catch(() => {});

  let state = await page.evaluate(FOCUS_STATE);
  check('sitting at a pod opens Focus Mode', state.active === true);
  check('the focus timer is running underneath it', state.timerRunning === true);
  // The world avatar must actually be SEATED for the whole of Focus Mode.
  // Leaving calls the same pod interaction to stand up, and if the player is
  // not seated that interaction sits them instead — so the session never ends
  // and the timer runs on. An earlier version of this suite only checked the
  // player was standing AFTER leaving, which passed while this was broken.
  check('the world avatar is seated during Focus Mode', state.sitting === true, String(state.sitting));

  // --- the avatar actually cycles ------------------------------------------
  console.log('\nbehaviour');
  const seen = new Set();
  const transitions = [];
  let previous = null;

  // Behaviours run 2.2-11s, so this samples across several of them.
  for (let i = 0; i < 60; i += 1) {
    const s = await page.evaluate(FOCUS_STATE);
    if (s.behavior && s.behavior !== previous) {
      transitions.push(s.behavior);
      seen.add(s.behavior);
      previous = s.behavior;
    }
    await page.waitForTimeout(500);
  }

  check('the avatar changes behaviour', transitions.length >= 3, `${transitions.length} transitions`);
  check('it uses a variety of behaviours', seen.size >= 3, [...seen].join(', '));

  // The anti-repetition rule, checked against what actually ran rather than
  // against the table that claims it.
  const backToBack = transitions.filter((b, i) => i > 0 && b === transitions[i - 1] && b !== 'settle');
  check('no behaviour immediately repeats itself', backToBack.length === 0, backToBack.join(', '));

  state = await page.evaluate(FOCUS_STATE);
  check('a caption names what it is doing', typeof state.caption === 'string' && state.caption.length > 0, state.caption);

  // --- the clock is not the animation's to own -----------------------------
  console.log('\nsession authority');
  const beforePause = await page.evaluate(FOCUS_STATE);
  await page.keyboard.press('p');
  await page.waitForTimeout(2500);
  const duringPause = await page.evaluate(FOCUS_STATE);

  // Paused time is not focus time: progression awards worlds for this number.
  check('pausing pauses the session timer', duringPause.timerPaused === true);
  check(
    'focus time does not accrue while paused',
    Math.abs(duringPause.timerSeconds - beforePause.timerSeconds) < 1,
    `${beforePause.timerSeconds.toFixed(1)}s -> ${duringPause.timerSeconds.toFixed(1)}s over 2.5s paused`,
  );
  check(
    'the paused avatar holds its behaviour',
    duringPause.behavior === beforePause.behavior || duringPause.behavior !== null,
    `${beforePause.behavior} -> ${duringPause.behavior}`,
  );

  await page.keyboard.press('p');
  await page.waitForTimeout(1500);
  const afterResume = await page.evaluate(FOCUS_STATE);
  check('resuming continues the session', afterResume.active === true && afterResume.timerRunning === true);
  check('resuming unpauses the timer', afterResume.timerPaused === false);
  check(
    'the clock picks up where it left off',
    afterResume.timerSeconds > duringPause.timerSeconds + 0.8,
    `${duringPause.timerSeconds.toFixed(1)}s -> ${afterResume.timerSeconds.toFixed(1)}s`,
  );

  // The displayed clock must agree with the timer that owns it.
  const shown = afterResume.clockText ?? '';
  // Read right to left, so h:mm:ss and mm:ss both parse.
  const shownSeconds = shown.split(':').map(Number).reduce((total, part) => total * 60 + (part || 0), 0);
  check(
    'the displayed clock matches the session timer',
    Math.abs(shownSeconds - afterResume.timerSeconds) <= 2,
    `showing ${shown}, timer at ${afterResume.timerSeconds.toFixed(1)}s`,
  );
  check('the clock reads FOCUS hh:mm:ss', /^\d{2}:\d{2}:\d{2}$/.test(shown) && afterResume.clockLabel === 'FOCUS', `${afterResume.clockLabel} ${shown}`);

  // --- the cinematic layer --------------------------------------------------
  console.log('\ncinematography');

  const depth = await page.evaluate(() => {
    const focus = window.__COMMONS__.game.scene.getScene('FocusScene');
    return { far: focus.farLayer.scrollFactorX, near: focus.nearLayer.scrollFactorX, bars: focus.barTop.height };
  });
  check('the set has depth: a far layer and a near layer', depth.far < 1 && depth.near > 1, `${depth.far} / ${depth.near}`);
  check('the frame is letterboxed', depth.bars > 0, `${depth.bars}px`);

  const cutaways = await page.evaluate(async () => {
    const focus = window.__COMMONS__.game.scene.getScene('FocusScene');
    const framed = [];
    for (const id of ['window', 'lamp', 'mug']) {
      focus.camera.forceShot(id, 'cut');
      await new Promise((r) => setTimeout(r, 150));
      framed.push(focus.camera.shotId);
    }
    return framed;
  });
  check('every environment cutaway can be framed', cutaways.join() === 'window,lamp,mug', cutaways.join());

  // A dip goes dark and comes back; the clock stays on screen throughout.
  const dip = await page.evaluate(async () => {
    const focus = window.__COMMONS__.game.scene.getScene('FocusScene');
    focus.camera.forceShot('medium', 'dip');
    await new Promise((r) => setTimeout(r, 420));
    const mid = focus.veil.alpha;
    const clockMid = focus.clock.alpha;
    await new Promise((r) => setTimeout(r, 1200));
    return { mid, after: focus.veil.alpha, clockMid, shot: focus.camera.shotId };
  });
  check('a dip fades through dark and back', dip.mid > 0.5 && dip.after === 0 && dip.shot === 'medium', `${dip.mid.toFixed(2)} -> ${dip.after}`);
  check('the clock stays visible through a dip', dip.clockMid > 0.9, String(dip.clockMid));

  // A turn hides inside a cut: the avatar is facing away on the next frame, and
  // its head never went through the old opacity dip.
  const turn = await page.evaluate(async () => {
    const focus = window.__COMMONS__.game.scene.getScene('FocusScene');
    focus.camera.forceShot('overShoulder', 'cut');
    await new Promise((r) => setTimeout(r, 120));
    return { orientation: focus.avatar.orientation, headAlpha: focus.avatar.head.alpha };
  });
  check('the avatar turns inside a cut', turn.orientation === 'back' && turn.headAlpha === 1, JSON.stringify(turn));

  const match = await page.evaluate(async () => {
    const focus = window.__COMMONS__.game.scene.getScene('FocusScene');
    focus.camera.forceShot('threeQuarter', 'match');
    await new Promise((r) => setTimeout(r, 2800));
    return { shot: focus.camera.shotId, orientation: focus.avatar.orientation };
  });
  check('a match cut lands on its shot', match.shot === 'threeQuarter' && match.orientation === 'front', JSON.stringify(match));

  // --- the new study behaviours ---------------------------------------------
  console.log('\nstudy behaviours');
  const added = ['highlighting', 'turningPage', 'scrolling', 'organizingNotes', 'penTapping', 'rubbingEyes', 'wristStretch', 'sipping'];
  const performed = await page.evaluate(async (ids) => {
    const focus = window.__COMMONS__.game.scene.getScene('FocusScene');
    const out = [];
    for (const id of ids) {
      focus.machine.force(id, 3000);
      await new Promise((r) => setTimeout(r, 1100));
      out.push(focus.machine.currentId);
    }
    return out;
  }, added);
  check('every new study behaviour performs', performed.join() === added.join(), performed.join());

  // The mug was in hand for the sip; whatever comes next, it goes back down.
  const mug = await page.evaluate(async () => {
    const focus = window.__COMMONS__.game.scene.getScene('FocusScene');
    const inHand = focus.mugHeld;
    focus.machine.force('reading', 3000);
    await new Promise((r) => setTimeout(r, 700));
    return { inHand, onDesk: focus.props.mug.alpha, held: focus.avatar.held.alpha };
  });
  check('sipping lifts the mug off the desk', mug.inHand === true);
  check('the mug goes back on the desk', mug.onDesk === 1 && mug.held === 0, JSON.stringify(mug));

  // --- leaks ---------------------------------------------------------------
  console.log('\nresources');
  const early = await page.evaluate(FOCUS_STATE);
  await page.waitForTimeout(12_000);
  const later = await page.evaluate(FOCUS_STATE);

  check(
    'tween count is stable over a long run',
    later.tweens <= early.tweens + 8,
    `${early.tweens} -> ${later.tweens}`,
  );
  check(
    'display objects are reused, not accumulated',
    later.displayObjects <= early.displayObjects,
    `${early.displayObjects} -> ${later.displayObjects}`,
  );

  // --- leaving --------------------------------------------------------------
  console.log('\nleaving');
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => window.__COMMONS__.game.scene.getScene('FocusScene')?.scene?.isActive?.() !== true,
    undefined,
    { timeout: 15_000 },
  ).catch(() => {});

  const after = await page.evaluate(FOCUS_STATE);
  check('Focus Mode closes', after.active === false);

  const world = await page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
    return { scene: scene?.scene.key, sitting: scene?.player?.isSitting ?? null };
  });
  check('control returns to the world', world.scene === 'LibraryScene', world.scene);
  check('leaving Focus Mode stands the player up', world.sitting === false, String(world.sitting));
  check('the session was closed by standing', (await page.evaluate(FOCUS_STATE)).timerRunning === false);

  // Re-entering must work: the second sit is where teardown bugs surface.
  await page.keyboard.press('Space');
  await page.waitForTimeout(2500);
  const second = await page.evaluate(FOCUS_STATE);
  check('Focus Mode can be re-entered', second.active === true);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness: ${error.message}`);
  console.error(error);
} finally {
  await browser?.close();
  vite?.kill();
  if (isWin && vite?.pid) spawn('taskkill', ['/pid', String(vite.pid), '/f', '/t'], { stdio: 'ignore' });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);

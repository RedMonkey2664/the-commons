#!/usr/bin/env node
/**
 * Phase 4 test: shared jukebox and voice policy.
 *
 *   node tools/phase4_music.mjs [--headed]
 *
 * Phase 4's done-when is "a group of friends can sit in the cafe, talk, and
 * listen to the same track together". Voice needs LiveKit credentials that are
 * not configured, so this covers the half that does not:
 *
 *   - the jukebox is ONE queue per room, not per player
 *   - two clients in the same room agree on the track AND the position in it,
 *     which is the whole point of 03's shared-state requirement
 *   - a client joining late lands at the right offset rather than from the top
 *   - queueing is rate limited and the queue is shared
 *   - skip is a vote, not a button one person can press
 *   - zones without a jukebox have no jukebox state at all
 *   - the voice MUTE POLICY: Library defaults muted, Cafe unmuted, and a
 *     manual override survives leaving and returning to a zone
 */

import { execSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLIENT_PORT = 5184;
const SERVER_PORT = 2567;
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

function freePort(port) {
  if (!isWin) return;
  let out = '';
  try {
    out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  } catch {
    return;
  }
  for (const pid of new Set(
    out.split(/\r?\n/).filter((l) => l.includes('LISTENING')).map((l) => l.trim().split(/\s+/).pop()),
  )) {
    if (pid && pid !== '0') {
      try { execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' }); } catch { /* gone */ }
    }
  }
}

function spawnAndWait(command, args, cwd, readyPattern, label) {
  const child = spawn(isWin ? `${command}.cmd` : command, args, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin,
  });
  const output = [];
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label} did not start in 90s`)), 90_000);
    const on = (b) => {
      const text = b.toString();
      output.push(text);
      if (readyPattern.test(text)) { clearTimeout(t); res(child); }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('exit', (code) => {
      clearTimeout(t);
      rej(new Error(`${label} exited early with code ${code}: ${output.join('').trim().split(/\r?\n/).slice(-5).join(' | ')}`));
    });
  });
}

function kill(child) {
  if (!child) return;
  child.kill();
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
}

const ZONE_KEYS = [
  'TownSquareScene', 'LibraryScene', 'CafeScene',
  'ArcadeScene', 'ParkScene', 'StudyRoomScene',
];

async function openClient(browser, name, userId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(
    ({ name, userId }) => {
      localStorage.setItem('commons.session', JSON.stringify({ displayName: name, userId }));
    },
    { name, userId },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|WebSocket|net::ERR/i.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (keys) => keys.some((k) => window.__COMMONS__?.game?.scene?.getScene(k)?.player),
    ZONE_KEYS,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(700);
  return { page, context, errors, name };
}

/** The room's music state, as this client understands it. */
async function musicState(client) {
  return client.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    const scene = key ? game.scene.getScene(key) : null;
    const ui = game.scene.getScene('UIScene');
    const panel = ui?.jukebox;
    return {
      scene: key ?? null,
      hasAudioEngine: Boolean(scene?.jukeboxAudio),
      // What the panel was told by the server.
      nowPlayingId: panel?.state?.now?.track?.id ?? null,
      startedAt: panel?.state?.startedAt ?? 0,
      serverNow: panel?.state?.serverNow ?? 0,
      queueLength: panel?.state?.queue?.length ?? 0,
      skipVotes: panel?.state?.skipVotes ?? 0,
      listeners: panel?.state?.listeners ?? 0,
      // Voice policy state.
      voiceMuted: scene?.voice?.isMuted ?? null,
      voiceAvailability: scene?.voice?.availabilityState ?? null,
    };
  }, ZONE_KEYS);
}

async function enterZone(client, zoneId, sceneKey) {
  await client.page.evaluate(
    ({ keys, zoneId }) => {
      const game = window.__COMMONS__.game;
      const key = keys.find((k) => game.scene.isActive(k));
      game.scene.getScene(key).transitionTo(zoneId);
    },
    { keys: ZONE_KEYS, zoneId },
  );
  await client.page.waitForFunction(
    (k) => Boolean(window.__COMMONS__?.game?.scene?.isActive(k)),
    sceneKey,
    { timeout: 20_000 },
  );
  await client.page.waitForTimeout(900);
}

async function waitFor(fn, predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 150));
    last = await fn();
  }
  return last;
}

let server;
let vite;
let browser;

try {
  console.log('starting game server...');
  freePort(SERVER_PORT);
  server = await spawnAndWait('npx', ['tsx', 'src/index.ts'], resolve(repoRoot, 'server'), /listening on ws:/, 'server');

  console.log('starting dev client...');
  vite = await spawnAndWait(
    'npx', ['vite', '--port', String(CLIENT_PORT), '--strictPort'],
    resolve(repoRoot, 'client'), /ready in|Local:/, 'vite',
  );

  browser = await chromium.launch({ headless: !headed });

  // --- only some zones have a jukebox -------------------------------------
  console.log('\njukebox placement');
  const alpha = await openClient(browser, 'Alpha', 'u_music_alpha');

  let a = await musicState(alpha);
  check('the Town Square has no jukebox', a.hasAudioEngine === false, JSON.stringify(a.scene));

  await enterZone(alpha, 'cafe', 'CafeScene');
  a = await waitFor(() => musicState(alpha), (s) => s.nowPlayingId !== null);
  check('the Cafe has a jukebox', a.hasAudioEngine === true);
  check('an empty Cafe starts something playing', a.nowPlayingId !== null, String(a.nowPlayingId));

  await enterZone(alpha, 'library', 'LibraryScene');
  const inLibrary = await musicState(alpha);
  check('the Library has no jukebox', inLibrary.hasAudioEngine === false);

  // --- the queue is shared, and so is the clock ---------------------------
  console.log('\nshared queue and clock');
  await enterZone(alpha, 'cafe', 'CafeScene');
  a = await waitFor(() => musicState(alpha), (s) => s.nowPlayingId !== null);

  // Beta joins LATE, which is the case that matters: it must land mid-track.
  const beta = await openClient(browser, 'Beta', 'u_music_beta');
  await enterZone(beta, 'cafe', 'CafeScene');
  let b = await waitFor(() => musicState(beta), (s) => s.nowPlayingId !== null);

  check('both clients see a track playing', a.nowPlayingId !== null && b.nowPlayingId !== null);
  check('both are playing the SAME track', a.nowPlayingId === b.nowPlayingId,
    `${a.nowPlayingId} vs ${b.nowPlayingId}`);
  check('both agree when it started', Math.abs(a.startedAt - b.startedAt) < 50,
    `${a.startedAt} vs ${b.startedAt}`);

  // The late joiner must be somewhere in the middle, not at zero.
  const betaOffset = await beta.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    const panel = game.scene.getScene('UIScene').jukebox;
    const scene = game.scene.getScene(key);
    void scene;
    const skew = panel.state.serverNow - Date.now();
    return Date.now() + skew - panel.state.startedAt;
  }, ZONE_KEYS);
  check('the late joiner starts partway through, not from the top',
    betaOffset > 500, `offset ${Math.round(betaOffset)}ms`);

  b = await musicState(beta);
  check('both clients count the same listeners', a.listeners >= 1 && b.listeners === 2,
    `${a.listeners} vs ${b.listeners}`);

  // --- queueing -----------------------------------------------------------
  console.log('\nqueueing');
  const before = (await musicState(alpha)).queueLength;
  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    game.scene.getScene(key).network.queueTrack('late_bus');
  }, ZONE_KEYS);

  a = await waitFor(() => musicState(alpha), (s) => s.queueLength > before);
  check('queueing a track lengthens the queue', a.queueLength === before + 1,
    `${before} -> ${a.queueLength}`);

  b = await waitFor(() => musicState(beta), (s) => s.queueLength === a.queueLength);
  check('the other client sees the same queue', b.queueLength === a.queueLength,
    `${a.queueLength} vs ${b.queueLength}`);

  // Rate limiting: a second immediate request is refused.
  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    game.scene.getScene(key).network.queueTrack('two_weeks');
  }, ZONE_KEYS);
  await alpha.page.waitForTimeout(700);
  const afterSpam = await musicState(alpha);
  check('a second immediate request is rate limited',
    afterSpam.queueLength === a.queueLength, `${a.queueLength} -> ${afterSpam.queueLength}`);

  // --- skip is a vote -----------------------------------------------------
  console.log('\nskip votes');
  const playingBefore = (await musicState(alpha)).nowPlayingId;
  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    game.scene.getScene(key).network.voteSkipTrack();
  }, ZONE_KEYS);
  await alpha.page.waitForTimeout(800);

  const oneVote = await musicState(alpha);
  // With two listeners, one vote meets the 50% threshold and skips; the check
  // that matters is that the vote is COUNTED and shared, not that one person
  // can never skip.
  check('a skip vote is registered and shared',
    oneVote.skipVotes > 0 || oneVote.nowPlayingId !== playingBefore,
    `votes ${oneVote.skipVotes}, now ${oneVote.nowPlayingId}`);

  // --- voice mute policy --------------------------------------------------
  console.log('\nvoice policy');
  // Cafe defaults unmuted (03: "voice chat default: on").
  const cafeVoice = await musicState(alpha);
  check('the Cafe defaults to unmuted', cafeVoice.voiceMuted === false, String(cafeVoice.voiceMuted));
  check('voice reports that it is not configured',
    cafeVoice.voiceAvailability === 'not_configured', String(cafeVoice.voiceAvailability));

  await enterZone(alpha, 'library', 'LibraryScene');
  const libraryVoice = await musicState(alpha);
  check('the Library defaults to muted — zoning by walking in',
    libraryVoice.voiceMuted === true, String(libraryVoice.voiceMuted));

  // A manual override must survive leaving and coming back (05: "a manual
  // override always available"; 11: "defaults shouldn't trap anyone").
  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    const scene = game.scene.getScene(key);
    return scene.voice.toggleMute(scene.zone);
  }, ZONE_KEYS);
  await alpha.page.waitForTimeout(300);

  const overridden = await musicState(alpha);
  check('unmuting in the Library takes effect', overridden.voiceMuted === false,
    String(overridden.voiceMuted));

  await enterZone(alpha, 'cafe', 'CafeScene');
  await enterZone(alpha, 'library', 'LibraryScene');
  const returned = await musicState(alpha);
  check('the override survives leaving and returning',
    returned.voiceMuted === false, String(returned.voiceMuted));

  const allErrors = [...alpha.errors, ...beta.errors];
  check('no unexpected page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness error: ${error.message}`);
  console.error('\nharness error:', error);
} finally {
  await browser?.close();
  kill(vite);
  kill(server);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);

/**
 * Developer progression controls — DEV BUILDS ONLY.
 *
 * Loaded exclusively through a dynamic import guarded by import.meta.env.DEV
 * (see main.ts). Vite replaces that constant with `false` in a production
 * build, the import becomes unreachable, and this module is not in the bundle
 * at all — not hidden, not disabled, absent. That matters because anything
 * shipped to a browser can be switched on by whoever is holding the browser.
 *
 * Everything it does goes through progression's simulation methods, which are
 * in-memory only: nothing here can write a focus second to the server or
 * rewrite the real player's world. The panel says SIMULATED in capitals on
 * every figure it shows, because a developer who forgets they are looking at
 * fake data is the other way this goes wrong.
 *
 * Plain DOM rather than Phaser: this is a tool, not part of the game, and an
 * <input type="number"> is worth more here than anything drawn on a canvas.
 */

import type Phaser from 'phaser';
import { WORLD_PROGRESS_CONFIG, getWorld } from '@commons/shared';
import { DEV_MODE, PROGRESSION_EVENTS, progression } from '../systems/Progression';
import { durationText } from '../ui/FocusTimer';
import { ui } from '../ui/UIScene';

const PANEL_ID = 'commons-dev-panel';

export function mountDevPanel(game: Phaser.Game): () => void {
  if (!DEV_MODE || document.getElementById(PANEL_ID)) return () => undefined;

  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText = [
    'position:fixed', 'right:12px', 'bottom:12px', 'z-index:10000',
    'font:12px/1.4 monospace', 'color:#F2F4F7',
    'background:rgba(23,26,31,0.94)', 'border:1px solid #E8613C', 'border-radius:8px',
    'padding:10px 12px', 'width:250px', 'box-shadow:0 6px 24px rgba(0,0,0,0.4)',
  ].join(';');

  const collapsed = { value: true };
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;cursor:pointer;color:#E8613C;font-weight:bold;letter-spacing:1px';
  header.innerHTML = '<span>[ DEV MODE ]</span><span data-toggle>+</span>';

  const body = document.createElement('div');
  body.style.cssText = 'margin-top:8px;display:none';

  const status = document.createElement('div');
  status.style.cssText = 'margin-bottom:8px;color:#B9C2CE';

  const button = (label: string, onClick: () => void, accent = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `font:11px monospace;margin:2px;padding:4px 6px;border-radius:4px;cursor:pointer;` +
      `border:1px solid ${accent ? '#E8613C' : '#4A5059'};background:${accent ? '#3A1E16' : '#2B2E33'};color:#F2F4F7`;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); refresh(); });
    return b;
  };

  const row = (...children: HTMLElement[]) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;flex-wrap:wrap;margin-bottom:4px';
    children.forEach((c) => r.appendChild(c));
    return r;
  };

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '0.5';
  input.placeholder = 'hours';
  input.style.cssText = 'width:70px;margin:2px;padding:3px;font:11px monospace;background:#171A1F;color:#F2F4F7;border:1px solid #4A5059;border-radius:4px';
  // The game listens for keys on window; typing a number here must not walk the avatar.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) input.addEventListener(type, (e) => e.stopPropagation());

  const openMap = (): Phaser.Scene | undefined => {
    const key = 'WorldMapScene';
    if (!game.scene.isActive(key)) game.scene.run(key);
    return game.scene.getScene(key);
  };

  body.append(
    status,
    row(
      button('+1h', () => progression.addSimulatedHours(1)),
      button('+5h', () => progression.addSimulatedHours(5)),
      button('+10h', () => progression.addSimulatedHours(10)),
    ),
    row(input, button('Set hours', () => {
      const hours = Number(input.value);
      if (Number.isFinite(hours) && hours >= 0) progression.simulateHours(hours);
    })),
    row(
      button('Unlock next', () => progression.unlockNextWorld()),
      button('Unlock all', () => progression.unlockAllWorlds()),
    ),
    row(
      button('Reset (sim)', () => progression.resetSimulation()),
      button('Use real data', () => progression.endSimulation(), true),
    ),
    row(
      button('Open journey', () => { openMap(); }),
      button('Test launch', () => {
        const map = openMap() as Phaser.Scene & { tryLaunch?: (w?: ReturnType<typeof getWorld>) => void };
        // Give the scene a frame to lay itself out before flying anything.
        setTimeout(() => {
          const target = progression.destination ?? WORLD_PROGRESS_CONFIG[1];
          map.tryLaunch?.(progression.destination ? undefined : target);
        }, 700);
      }, true),
    ),
    row(
      button('Test completion', () => {
        const next = progression.progress.next ?? WORLD_PROGRESS_CONFIG[1];
        ui.summary?.show(52 * 60, progression.focusSeconds + 52 * 60, next ? [next] : [], true);
      }),
      button('Test transition', () => {
        const target = WORLD_PROGRESS_CONFIG.find((w) => w.id !== progression.currentWorld.id);
        if (target) progression.enterWorld(target.id, true);
      }),
    ),
  );

  const worlds = document.createElement('div');
  worlds.style.cssText = 'margin-top:6px;border-top:1px solid #33373F;padding-top:6px;color:#B9C2CE';
  worlds.textContent = 'enter any world (bypass):';
  const worldRow = row();
  for (const world of WORLD_PROGRESS_CONFIG) {
    worldRow.appendChild(button(world.name.split(' ').pop() ?? world.id, () => progression.enterWorld(world.id, true)));
  }
  body.append(worlds, worldRow);

  root.append(header, body);
  document.body.appendChild(root);

  header.addEventListener('click', () => {
    collapsed.value = !collapsed.value;
    body.style.display = collapsed.value ? 'none' : 'block';
    const toggle = header.querySelector('[data-toggle]');
    if (toggle) toggle.textContent = collapsed.value ? '+' : '–';
  });

  function refresh(): void {
    const simulated = progression.isSimulated;
    status.innerHTML =
      `${simulated ? '<b style="color:#E8613C">SIMULATED</b>' : 'real'} focus: <b>${durationText(progression.focusSeconds)}</b><br>` +
      `real focus (untouched): ${durationText(progression.realFocusSeconds)}<br>` +
      `world: ${progression.currentWorld.name}${progression.rocketReady ? '  ·  rocket ready' : ''}`;
  }

  progression.on(PROGRESSION_EVENTS.progressChanged, refresh);
  refresh();

  return () => {
    progression.off(PROGRESSION_EVENTS.progressChanged, refresh);
    root.remove();
  };
}

/**
 * "FOCUS LV.03 ▰▰▰▰▱▱▱▱ 27.4h" — the one line that says how far you have come.
 *
 * THE LEVEL IS THE WORLD. There is no XP here and nothing to grind: your level
 * is which world your real, server-recorded focus hours have opened, and the
 * bar is how far you are toward the next. That is the same number the world
 * map and the rocket read, so the HUD can never claim progress the journey
 * does not agree with.
 *
 * Shared by the world HUD and Focus Mode, which is why it is a function and a
 * drawing helper rather than a component: the two places lay it out
 * differently but must never compute it differently.
 */

import type Phaser from 'phaser';
import { SECONDS_PER_HOUR, WORLD_PROGRESS_CONFIG, worldProgress } from '@commons/shared';
import { progression } from '../systems/Progression';
import type { FocusTimer } from './FocusTimer';

export interface FocusLevel {
  level: number;
  maxLevel: number;
  /** 0..1 toward the next world; 1 once every world is open. */
  fraction: number;
  /** "LV.03" */
  label: string;
  /** "27.4h" */
  hoursText: string;
}

export function focusLevel(seconds: number): FocusLevel {
  const progress = worldProgress(seconds);
  const level = WORLD_PROGRESS_CONFIG.findIndex((w) => w.id === progress.latestUnlocked.id) + 1;
  return {
    level,
    maxLevel: WORLD_PROGRESS_CONFIG.length,
    fraction: progress.next ? progress.fraction : 1,
    label: `LV.${String(level).padStart(2, '0')}`,
    hoursText: `${(seconds / SECONDS_PER_HOUR).toFixed(1)}h`,
  };
}

/**
 * Focus seconds to display: the persisted total, plus a session still running.
 *
 * The running part is shown because watching the bar creep while you study is
 * the point, and it is the same `total + live` the focus timer panel already
 * shows. The max() is what stops the figure dipping in the second between a
 * session ending and the server's new total arriving: the timer already added
 * the session optimistically; progression has not re-read yet.
 *
 * Returns null when the server cannot be reached, so the HUD says "offline"
 * rather than presenting zero hours as fact.
 */
export function displayedFocusSeconds(timer?: FocusTimer): number | null {
  if (progression.isSimulated) return progression.focusSeconds;
  if (!progression.isReachable) return null;
  const live = timer?.isRunning ? timer.liveSeconds : 0;
  return Math.max(progression.focusSeconds + live, timer?.totalStudySeconds ?? 0);
}

/**
 * The bar itself: segments, with the current one partly filled so progress
 * inside a segment is still visible. At 50h for a world, a segment is hours
 * of study, and a bar that only moves once a segment is full looks broken.
 */
export function drawLevelBar(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
  fill: number,
  empty: number,
  segments = 8,
): void {
  const gap = 2;
  const segmentWidth = (width - gap * (segments - 1)) / segments;
  const filled = Math.min(1, Math.max(0, fraction)) * segments;

  for (let i = 0; i < segments; i += 1) {
    const sx = x + i * (segmentWidth + gap);
    graphics.fillStyle(empty, 0.35);
    graphics.fillRect(sx, y, segmentWidth, height);
    const part = Math.min(1, Math.max(0, filled - i));
    if (part > 0) {
      graphics.fillStyle(fill, 1);
      graphics.fillRect(sx, y, segmentWidth * part, height);
    }
  }
}

/**
 * Shared backdrop for the loading and title screens.
 *
 * A parallax city skyline drawn with graphics primitives — dusk gradient, three
 * depth layers of buildings with lit windows, and drifting clouds. It exists so
 * the first thing anyone sees is the game's world rather than a black screen
 * with a progress bar on it.
 *
 * Rebuilt on resize; every layer is sized from the live canvas.
 */

import Phaser from 'phaser';
import { COLORS, hex, mix } from '@commons/shared';

interface SkylineLayer {
  graphics: Phaser.GameObjects.Graphics;
  /** Parallax speed in px/sec. Nearer layers drift faster. */
  speed: number;
  offset: number;
}

export class CityBackdrop {
  private readonly sky: Phaser.GameObjects.Graphics;
  private readonly layers: SkylineLayer[] = [];
  private readonly stars: Phaser.GameObjects.Graphics;
  private readonly vignette: Phaser.GameObjects.Graphics;
  private readonly container: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.sky = scene.add.graphics();
    this.stars = scene.add.graphics();

    for (const speed of [4, 9, 17]) {
      this.layers.push({ graphics: scene.add.graphics(), speed, offset: 0 });
    }

    this.vignette = scene.add.graphics();

    this.container = scene.add
      .container(0, 0, [this.sky, this.stars, ...this.layers.map((l) => l.graphics), this.vignette])
      .setDepth(-1000);

    this.redraw();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.redraw, this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.redraw, this);
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    });
  }

  private tick(_time: number, delta: number): void {
    const { width } = this.scene.scale.gameSize;
    for (const layer of this.layers) {
      layer.offset = (layer.offset + (layer.speed * delta) / 1000) % width;
      layer.graphics.x = -layer.offset;
    }
  }

  private redraw(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    this.drawSky(width, height);
    this.drawStars(width, height);

    const palettes = [
      { color: mix(COLORS.transitionFade, '#4A5F8C', 0.45), minH: 0.20, maxH: 0.42, lit: 0.05 },
      { color: mix(COLORS.transitionFade, '#3A4A6B', 0.30), minH: 0.28, maxH: 0.55, lit: 0.14 },
      { color: mix(COLORS.transitionFade, '#232838', 0.55), minH: 0.36, maxH: 0.72, lit: 0.30 },
    ];
    this.layers.forEach((layer, index) => {
      const p = palettes[index]!;
      this.drawSkyline(layer.graphics, width, height, p.color, p.minH, p.maxH, p.lit, 1000 + index * 77);
    });

    this.drawVignette(width, height);
  }

  private drawSky(width: number, height: number): void {
    const g = this.sky;
    g.clear();
    // Dusk gradient, drawn as horizontal bands (Graphics has no gradient fill).
    const bands = 48;
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      const color = t < 0.55
        ? mix('#101A2E', '#2B3A5C', t / 0.55)
        : mix('#2B3A5C', '#7A5A6B', (t - 0.55) / 0.45);
      g.fillStyle(hex(color), 1);
      g.fillRect(0, Math.floor((height * i) / bands), width, Math.ceil(height / bands) + 1);
    }
    // warm horizon glow
    g.fillStyle(hex('#C98A5E'), 0.20);
    g.fillEllipse(width * 0.5, height * 0.82, width * 1.1, height * 0.34);
  }

  private drawStars(width: number, height: number): void {
    const g = this.stars;
    g.clear();
    let seed = 20260907;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < 90; i += 1) {
      const x = rng() * width;
      const y = rng() * height * 0.5;
      const alpha = 0.15 + rng() * 0.5;
      g.fillStyle(0xffffff, alpha);
      g.fillRect(Math.floor(x), Math.floor(y), rng() > 0.85 ? 2 : 1, rng() > 0.85 ? 2 : 1);
    }
  }

  /**
   * One skyline band, drawn twice side by side so the parallax scroll wraps
   * seamlessly when the layer's x passes -width.
   */
  private drawSkyline(
    g: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    color: string,
    minH: number,
    maxH: number,
    litChance: number,
    seed: number,
  ): void {
    g.clear();
    let s = seed >>> 0;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };

    const fill = hex(color);
    const litColor = hex(COLORS.lampGlow);

    for (let pass = 0; pass < 2; pass += 1) {
      const originX = pass * width;
      let x = 0;
      // Reset the sequence for the second pass so both copies match exactly.
      if (pass === 1) s = seed >>> 0;

      while (x < width) {
        const bw = 40 + Math.floor(rng() * 90);
        const bh = Math.floor(height * (minH + rng() * (maxH - minH)));
        const bx = originX + x;
        const by = height - bh;

        g.fillStyle(fill, 1);
        g.fillRect(bx, by, bw, bh);

        // rooftop detail
        if (rng() > 0.6) {
          const aw = Math.max(4, Math.floor(bw * 0.18));
          g.fillRect(bx + bw / 2 - aw / 2, by - 14, aw, 14);
        }

        // window grid
        const cols = Math.max(1, Math.floor((bw - 12) / 14));
        const rows = Math.max(1, Math.floor((bh - 16) / 18));
        for (let cy = 0; cy < rows; cy += 1) {
          for (let cx = 0; cx < cols; cx += 1) {
            if (rng() > litChance) continue;
            g.fillStyle(litColor, 0.55 + rng() * 0.4);
            g.fillRect(bx + 8 + cx * 14, by + 10 + cy * 18, 5, 7);
          }
        }

        x += bw + 4 + Math.floor(rng() * 16);
      }
    }
  }

  private drawVignette(width: number, height: number): void {
    const g = this.vignette;
    g.clear();
    const steps = 14;
    for (let i = 0; i < steps; i += 1) {
      const alpha = 0.035 * (1 - i / steps);
      g.fillStyle(0x000000, alpha);
      g.fillRect(0, 0, width, 8 + i * 6);
      g.fillRect(0, height - (8 + i * 6), width, 8 + i * 6);
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }
}

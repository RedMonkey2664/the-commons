/**
 * Base class for every zone.
 *
 * This is where "config over code" (02, 11) is actually enforced. A zone scene
 * subclass passes its ZoneConfig up and, in the normal case, contains NO other
 * code — map loading, collision, spawning, camera, interaction, ambient
 * animation and HUD all derive from the config and the Tiled map.
 *
 * Adding a zone is therefore: one config entry + one Tiled map + a 4-line
 * subclass. If a zone ever needs something none of the others do, it overrides
 * a hook here rather than reimplementing the scene, so the shared path can't
 * quietly rot into per-zone special cases.
 *
 * Each zone is independently bootable — art and maps are ensured here, not
 * assumed from BootScene — which is what makes "every zone playable and
 * testable in isolation" true rather than aspirational.
 */

import Phaser from 'phaser';
import type { Direction, TileCoord, ZoneConfig, ZoneId } from '@commons/shared';
import { CAMERA, COLORS, VIEWPORT, ZONES, ZONE_TRANSITION, resolveEntryPoint } from '@commons/shared';
import { ASSET_KEYS, generateAllPlaceholderArt } from '../art/placeholderArt';
import { registerCharacterAnimations } from '../art/characterAnimations';
import { Player } from '../entities/Player';
import { AmbientAnimator } from '../systems/AmbientAnimator';
import { InputController } from '../systems/InputController';
import { InteractionSystem } from '../systems/InteractionSystem';
import type { InteractableObject } from '@commons/shared';
import { tileToWorld } from '../systems/GridMovement';
import { ZoneMap } from '../systems/ZoneMap';
import { UIScene, ui } from '../ui/UIScene';
import { MultiplayerSystem } from '../systems/MultiplayerSystem';
import { NetworkClient } from '../systems/NetworkClient';
import { session } from '../session';

/** Scene data accepted when starting a zone. */
export interface ZoneSceneData {
  /** Which zone the player came from, so they arrive at the matching entry point. */
  fromZone?: ZoneId;
  /** Explicit override, mostly for isolation testing. */
  spawnTile?: TileCoord;
  facing?: Direction;
  /**
   * Set false to run the zone standalone with no server. Zone scenes must stay
   * playable in isolation (a hard requirement), so multiplayer is additive: if
   * the connection fails the zone keeps working single-player.
   */
  multiplayer?: boolean;
}

export abstract class ZoneScene extends Phaser.Scene {
  protected readonly zone: ZoneConfig;

  protected zoneMap!: ZoneMap;
  protected player!: Player;
  protected controls!: InputController;
  protected interactions!: InteractionSystem;
  protected ambient?: AmbientAnimator;
  protected network?: NetworkClient;
  protected multiplayer?: MultiplayerSystem;

  private sceneData: ZoneSceneData = {};
  /** Tracks hint visibility so it is only toggled on an actual change. */
  private hintHidden = false;
  /** Set for the duration of a zone change, so it can't be started twice. */
  private transitioning = false;

  protected constructor(zone: ZoneConfig) {
    super({ key: zone.sceneKey });
    this.zone = zone;
  }

  init(data: ZoneSceneData): void {
    this.sceneData = data ?? {};

    // Phaser REUSES scene instances, so every field that survives a restart has
    // to be reset here. Missing this left `transitioning` true after the first
    // departure, which silently disabled every later exit from that zone — a
    // bug that only shows up on the second transition, never the first.
    this.transitioning = false;
    this.hintHidden = false;
  }

  preload(): void {
    // 09: "Tiled map JSON exports go in assets/maps/, loaded by Phaser's
    // tilemap loader in each zone scene's preload()."
    if (!this.cache.tilemap.exists(this.zone.tilemapKey)) {
      this.load.tilemapTiledJSON(this.zone.tilemapKey, this.zone.mapFile);
    }
  }

  create(): void {
    // Booting a zone directly (isolation testing) must not depend on BootScene.
    if (!this.textures.exists(ASSET_KEYS.tileset)) generateAllPlaceholderArt(this);
    registerCharacterAnimations(this, ASSET_KEYS.npcSheet);

    this.cameras.main.setBackgroundColor(this.backgroundColor());

    this.zoneMap = new ZoneMap(this, this.zone);
    this.createWorldObjects();
    this.ambient = new AmbientAnimator(this, this.zoneMap);

    // Interactions before the player: the player's onArrive hook calls into
    // this system, and both callbacks resolve lazily, so this ordering keeps
    // every field assigned before anything can fire.
    this.controls = new InputController(this);
    this.interactions = new InteractionSystem(this, this.zone, this.zoneMap, {
      setBlocked: (blocked) => this.player.setBlocked(blocked),
      transitionTo: (zoneId) => this.transitionTo(zoneId),
      isSitting: () => this.player.isSitting,
      sit: (status) => {
        this.player.sit(status);
        this.multiplayer?.pushStatus(status);
      },
      stand: () => {
        this.player.stand();
        this.multiplayer?.pushStatus('idle');
      },
    });

    this.createPlayer();
    this.configureCamera();

    this.ensureUi();

    // The panel asks the scene for the roster rather than being pushed updates,
    // so it always reflects the room as of the moment it is opened.
    ui.friends?.setEntriesProvider(() =>
      (this.multiplayer?.roster ?? []).map((person) => ({
        displayName: person.displayName,
        online: true,
        zone: this.zone.displayName,
        status: person.status,
      })),
    );

    // Arriving half of the zone transition (10): fade in at the new spawn.
    this.cameras.main.fadeIn(ZONE_TRANSITION.fadeInMs, 0, 0, 0);

    if (this.sceneData.multiplayer !== false) void this.connect();

    this.onZoneReady();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
  }

  override update(time: number): void {
    const dialogue = ui.dialogue;
    const dialogueOpen = Boolean(dialogue?.isVisible);

    if (dialogueOpen !== this.hintHidden) {
      this.hintHidden = dialogueOpen;
      ui.hud?.setHintVisible(!dialogueOpen);
    }

    // A visible dialogue box owns Space. The player is already BLOCKED, so
    // movement is inert; this stops the same press also re-triggering the world.
    if (dialogueOpen) {
      if (this.controls.justPressed('interact')) dialogue?.advance();
      return;
    }

    if (this.controls.justPressed('menu')) ui.friends?.toggle();

    // The friends panel is a modal overlay; the world keeps rendering but stops
    // taking input, so nobody walks off while reading who is online.
    if (ui.friends?.isOpen) return;

    this.player.update(time, this.controls.heldDirection());

    if (this.controls.justPressed('interact')) {
      this.interactions.tryInteract(this.player.tile, this.player.facing);
    }

    this.interactions.refreshBubbles(this.player.tile);
  }

  // -- construction steps (overridable hooks) ------------------------------

  protected backgroundColor(): string {
    const token = this.zone.bgColorToken as keyof typeof COLORS;
    return COLORS[token] ?? COLORS.townSquareBg;
  }

  /** Where the player appears, in priority order. */
  protected resolveSpawn(): TileCoord {
    if (this.sceneData.spawnTile) return this.sceneData.spawnTile;
    if (this.sceneData.fromZone) return resolveEntryPoint(this.zone, this.sceneData.fromZone);
    // A `spawn` object in the map wins over the config default, so map authors
    // can move a spawn point without editing zones.config.ts.
    return this.zoneMap.mapSpawnPoint ?? this.zone.spawnPoint;
  }

  protected createPlayer(): void {
    this.player = new Player(this, {
      tile: this.resolveSpawn(),
      facing: this.sceneData.facing ?? 'down',
      textureKey: session.spriteKey,
      isWalkable: this.zoneMap.isWalkable,
      // Intent is sent as the step COMMITS locally, not on arrival: the client
      // predicts immediately and the server validates in parallel (02).
      onDepart: (_from, _to, facing) => this.network?.sendMove(facing),
      onArrive: (tile) => this.interactions.handleTileEntered(tile),
      onFacingChanged: (facing) => this.network?.sendFace(facing),
    });
  }

  protected configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.zoneMap.widthInPixels, this.zoneMap.heightInPixels);
    // Smooth-follow rather than rigid lock (04).
    camera.startFollow(this.player.sprite, true, CAMERA.followLerp, CAMERA.followLerp);
    camera.roundPixels = true;

    this.applyViewport();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyViewport, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyViewport, this);
    });
  }

  /**
   * Match the camera to the live window.
   *
   * Zoom comes from window HEIGHT so a wider window shows more of the city
   * rather than magnifying the same slice — which is what makes a resize feel
   * like a bigger window instead of a zoom control.
   */
  protected applyViewport(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;

    const camera = this.cameras.main;
    camera.setSize(width, height);
    camera.setZoom(VIEWPORT.zoomFor(height));
  }

  /**
   * Sprite for each interactable kind.
   *
   * An object can override this with a `sprite` property in Tiled, which is how
   * a study-room desk and a library focus pod share the `focus_pod` KIND (same
   * behaviour) while looking like different furniture. Behaviour comes from the
   * kind, appearance from the map — neither needs a special case in code.
   */
  private static readonly KIND_SPRITE: Partial<Record<InteractableObject['kind'], string>> = {
    focus_pod: ASSET_KEYS.focusPod,
    seat: ASSET_KEYS.seat,
    reading_nook: ASSET_KEYS.readingNook,
    jukebox: ASSET_KEYS.jukebox,
    cabinet: ASSET_KEYS.cabinetLit,
    signpost: ASSET_KEYS.signpost,
  };

  /**
   * Renders sprites for map objects. Purely presentational — collision and
   * interaction come from ZoneMap, not from these sprites.
   */
  protected createWorldObjects(): void {
    for (const object of this.zoneMap.interactables) {
      const world = tileToWorld(object.tile);

      switch (object.kind) {
        case 'npc': {
          this.add
            .sprite(world.x, world.y, ASSET_KEYS.npcSheet, 0)
            .setOrigin(0.5, 1)
            .setDepth(world.y);
          break;
        }
        case 'door': {
          this.add
            .image(world.x, world.y, ASSET_KEYS.door)
            .setOrigin(0.5, 1)
            .setDepth(world.y - 1);

          const label = object.props['label'];
          if (typeof label === 'string') {
            this.add
              .text(world.x, world.y - 52, label, {
                fontFamily: 'monospace',
                fontSize: '11px',
                color: COLORS.hudText,
                backgroundColor: COLORS.hudBg,
                padding: { x: 6, y: 3 },
              })
              .setOrigin(0.5, 1)
              .setDepth(world.y + 400);
          }
          break;
        }
        default: {
          const override = object.props['sprite'];
          const preferred =
            typeof override === 'string' && this.textures.exists(override)
              ? override
              : ZoneScene.KIND_SPRITE[object.kind];

          this.add
            .image(world.x, world.y, preferred ?? ASSET_KEYS.signpost)
            .setOrigin(0.5, 1)
            .setDepth(world.y);
          break;
        }
      }
    }
  }

  private ensureUi(): void {
    if (!this.scene.isActive(UIScene.KEY)) this.scene.launch(UIScene.KEY);
    this.scene.bringToTop(UIScene.KEY);

    // The UI scene may not have run create() yet on the very first frame.
    this.time.delayedCall(0, () => {
      ui.hud?.setZoneName(this.zone.displayName);
      ui.hud?.fadeOutHint();
    });
  }

  /** Hook for zone-specific setup (Pomodoro pods, jukebox, cabinets). */
  protected onZoneReady(): void {}

  /**
   * Register an interactable that is not in the Tiled map, and give it a
   * sprite. Used by the Arcade to build cabinets from minigames.config.
   */
  protected registerInteractable(object: InteractableObject): void {
    this.zoneMap.registerInteractable(object);
  }

  /**
   * Walk from this zone into another (10).
   *
   * 250ms fade out, brief hold, 250ms fade in at the new spawn. The room swap
   * is kicked off DURING the fade rather than after it, so the network
   * round-trip is masked by the transition instead of showing up as a hitch on
   * the other side.
   */
  protected transitionTo(zoneId: ZoneId): void {
    if (this.transitioning) return;

    const target = ZONES.find((z) => z.id === zoneId);
    if (!target) return;

    this.transitioning = true;
    this.player.setBlocked(true);
    ui.friends?.close();

    // Leave the current room now, under cover of the fade.
    void this.network?.leave();
    this.network = undefined;

    const camera = this.cameras.main;
    camera.fadeOut(ZONE_TRANSITION.fadeOutMs, 0, 0, 0);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.time.delayedCall(ZONE_TRANSITION.holdMs, () => {
        this.scene.start(target.sceneKey, {
          fromZone: this.zone.id,
          multiplayer: this.sceneData.multiplayer,
        } satisfies ZoneSceneData);
      });
    });
  }

  /**
   * Join this zone's room. Failure is non-fatal by design — an unreachable
   * server should leave you standing in a working single-player town, not at a
   * broken screen.
   */
  private async connect(): Promise<void> {
    const network = new NetworkClient();
    this.network = network;

    this.multiplayer = new MultiplayerSystem({
      scene: this,
      network,
      player: this.player,
      zoneName: this.zone.displayName,
      onRosterChange: (event, displayName) => {
        ui.popup?.show(
          event === 'join' ? `${displayName} joined the world` : `${displayName} left`,
          { iconColor: event === 'join' ? COLORS.statusStudying : COLORS.statusAfk },
        );
      },
    });

    try {
      await network.joinZone(
        this.zone.id,
        {
          displayName: session.displayName ?? 'Wanderer',
          spriteKey: session.spriteKey,
          fromZone: this.sceneData.fromZone,
        },
        {
          onPlayerAdd: (state, id) => this.multiplayer?.handlePlayerAdd(state, id),
          onPlayerChange: (state, id) => this.multiplayer?.handlePlayerChange(state, id),
          onPlayerRemove: (id) => this.multiplayer?.handlePlayerRemove(id),
          onCorrection: (message) => this.multiplayer?.handleCorrection(message),
          onError: (error) => console.warn('[net]', error.message),
          onLeave: () => {
            ui.hud?.setConnected(false);
            // Drop every remote avatar. Without this a server restart leaves
            // frozen ghosts standing in the square forever.
            this.multiplayer?.destroy();
          },
        },
      );
      ui.hud?.setConnected(true);
    } catch (error) {
      console.warn('[net] offline — running single-player:', (error as Error).message);
      ui.hud?.setConnected(false);
      this.network = undefined;
    }
  }

  private teardown(): void {
    void this.network?.leave();
    this.network = undefined;
    this.multiplayer?.destroy();
    this.interactions?.destroy();
    this.ambient?.destroy();
    this.player?.destroy();
    this.controls?.destroy();
    this.zoneMap?.destroy();
  }
}

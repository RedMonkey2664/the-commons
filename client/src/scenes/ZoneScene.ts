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
import {
  CAMERA,
  COLORS,
  VIEWPORT,
  ZONES,
  ZONE_TRANSITION,
  getCosmetic,
  FOCUS,
  resolveEntryPoint,
  tileInFront,
} from '@commons/shared';
import {
  ASSET_KEYS,
  drinkTextureKey,
  ensureOutfitSheet,
  generateAllPlaceholderArt,
} from '../art/placeholderArt';
import { registerCharacterAnimations } from '../art/characterAnimations';
import { Player } from '../entities/Player';
import { AmbientAnimator } from '../systems/AmbientAnimator';
import { InputController } from '../systems/InputController';
import { InteractionSystem } from '../systems/InteractionSystem';
import type { InteractableObject } from '@commons/shared';
import { tileToWorld } from '../systems/GridMovement';
import { ZoneMap } from '../systems/ZoneMap';
import { UIScene, ui } from '../ui/UIScene';
import { WorldFx } from '../systems/WorldFx';
import { FocusScene, focusMode, type FocusSceneData } from './FocusScene';
import { WorldMapScene, worldMap } from './WorldMapScene';
import { progression } from '../systems/Progression';
import { getCosmetic as getCosmeticById } from '@commons/shared';
import { MultiplayerSystem } from '../systems/MultiplayerSystem';
import { NetworkClient } from '../systems/NetworkClient';
import { JukeboxPlayer } from '../systems/JukeboxPlayer';
import { VoiceClient } from '../systems/VoiceClient';
import { session } from '../session';
import { sfx } from '../systems/Sfx';
import { fetchProgress } from '../systems/scoreClient';

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
  /** Reactive world effects: footfalls, arrivals, interaction confirmation. */
  protected fx!: WorldFx;
  protected ambient?: AmbientAnimator;
  protected network?: NetworkClient;
  protected multiplayer?: MultiplayerSystem;
  /** Only created in zones that have a jukebox. */
  protected jukeboxAudio?: JukeboxPlayer;

  /**
   * The drink this player is carrying (03), and its icon.
   *
   * Deliberately NOT persisted in session storage the way cosmetics are: a
   * drink is something you are holding in a room, not a saved preference, and
   * it should not follow you into tomorrow's session.
   */
  private drink = '';
  private drinkIcon?: Phaser.GameObjects.Image;
  protected voice?: VoiceClient;

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
    // Returning from a paused minigame resumes this scene rather than
    // recreating it, so control has to be handed back explicitly.
    //
    // Removed on shutdown: Phaser only clears scene emitters on destroy, and
    // create() runs again on every visit, so without this the handler stacks up
    // once per time the player walks into the zone.
    const onResume = () => {
      this.player?.setBlocked(false);
      this.controls?.reset();
    };
    this.events.on(Phaser.Scenes.Events.RESUME, onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, onResume);
    });

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
    this.fx = new WorldFx(this);
    this.setupChatInput();

    // Browsers block audio until a gesture, and every sound bails while the
    // context is suspended. Unlocking only on the interact key left footsteps,
    // bumps, chat and UI silent for anyone who just walked around — so ANY
    // input counts as the gesture.
    const unlockAudio = () => sfx.unlock();
    this.input.keyboard?.on('keydown', unlockAudio);
    this.input.on('pointerdown', unlockAudio);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', unlockAudio);
      this.input.off('pointerdown', unlockAudio);
    });
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
        // Safety net: every way of standing ends the focus session, not just
        // the pod handler that usually does it. stop() is idempotent, so the
        // ordinary path stopping it first costs nothing here.
        ui.focus?.stop();
      },
      launchMinigame: (sceneKey) => this.launchMinigame(sceneKey),
      openDrinks: () => {
        ui.drinks?.setState(this.drink, (drink) => {
          this.drink = drink ? drink.id : '';
          this.multiplayer?.pushDrink(this.drink);
          this.applyLocalDrink();
          if (drink) ui.popup?.show(drink.line, { iconColor: drink.color });
        });
        ui.drinks?.show();
        this.player.setBlocked(true);
      },
      enterFocusMode: () => this.enterFocusMode(),
      openJukebox: () => {
        if (!this.jukeboxAudio) return false;
        // Browsers block audio until a gesture; interacting with the jukebox
        // IS that gesture, so unlock here rather than on some later click.
        void this.jukeboxAudio.unlock();
        ui.jukebox?.show();
        this.player.setBlocked(true);
        return true;
      },
    });

    this.createPlayer();
    this.configureCamera();

    // A ring where you land, so walking through a door arrives somewhere
    // rather than simply cutting. Delayed past the camera fade-in, or it plays
    // out behind black and nobody sees it.
    this.time.delayedCall(ZONE_TRANSITION.fadeInMs, () => {
      this.fx.arrival(this.player.sprite.x, this.player.sprite.y);
    });

    // 03 puts a jukebox in the Cafe and a bandstand in the Park. Zones without
    // one build no audio engine at all rather than an idle one.
    if (this.zone.interactables.some((id) => id === 'jukebox' || id === 'bandstand')) {
      this.jukeboxAudio = new JukeboxPlayer();
    }

    this.voice = new VoiceClient();
    this.voice.setHandlers({
      onStateChanged: (state, availability) =>
        ui.hud?.setVoice(state, availability, this.voice?.isMuted ?? true),
      onMuteChanged: (muted) => {
        ui.hud?.setVoice(this.voice?.state ?? 'idle', this.voice?.availabilityState ?? 'ready', muted);
        // The jukebox ducks when your mic opens, so a room can talk over music
        // without anyone reaching for a volume control.
        this.jukeboxAudio?.setVolume(muted ? 0.5 : 0.22);
      },
    });

    this.ensureUi();

    // Deferred for the same reason the HUD calls below are: on the very first
    // boot UIScene has been launched but has not run create() yet, so the panel
    // does not exist to be configured.
    this.time.delayedCall(0, () => {
      ui.jukebox?.setHandlers({
        onQueue: (trackId) => this.network?.queueTrack(trackId),
        onSkip: () => this.network?.voteSkipTrack(),
      });

      ui.chat?.setSendHandler((text) => {
        if (this.network?.isConnected) this.network.sendChat(text);
        else ui.chat?.system('not connected — nobody can hear you');
      });

      // Unlock facts come from the server; the RULES are evaluated client-side
      // in shared/cosmetics.ts. Cosmetic-only, so that split costs nothing.
      void fetchProgress().then((progress) => {
        // A request that resolves after the player walked out would otherwise
        // install a callback bound to a destroyed scene and player.
        if (!progress || !this.scene.isActive()) return;
        ui.friends?.setCosmetics(progress, (cosmetic) => {
          // Re-derived from BOTH slots rather than from the cosmetic just
          // clicked: picking a hat must not silently discard the outfit.
          this.player?.setTexture(this.outfitTexture());
          ui.popup?.show(`Wearing ${cosmetic.displayName}`, { iconColor: cosmetic.color });
        });
      });

      ui.friends?.setEntriesProvider(() =>
        (this.multiplayer?.roster ?? []).map((person) => ({
          displayName: person.displayName,
          online: true,
          zone: this.zone.displayName,
          status: person.status,
        })),
      );
    });

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

    // The composer and the modal panels each own the keyboard while open.
    if (ui.chat?.isComposing || ui.jukebox?.isOpen || ui.drinks?.isOpen) {
      this.controls.reset();
      return;
    }

    // Focus Mode owns the keyboard outright while it is up, and this check has
    // to come BEFORE the menu key rather than alongside the panels below it.
    // Esc is how you leave Focus Mode; when the zone scene also saw that press
    // it opened the friends panel behind the overlay, and the panel then
    // swallowed the next keypress — so leaving Focus Mode left the world
    // silently unresponsive.
    if (focusMode.active || worldMap.active) {
      this.controls.reset();
      return;
    }

    if (this.controls.justPressed('menu')) {
      // Esc closes the stats panel when that is what is open, rather than
      // opening a second panel behind it.
      if (ui.stats?.isOpen) ui.stats.close();
      else ui.friends?.toggle();
      // Phaser latches just-pressed until it is read. Without draining here, a
      // Space pressed while the panel was open fires an interaction on the
      // frame the panel closes.
      this.controls.reset();
    }

    // The friends and stats panels are modal overlays; the world keeps
    // rendering but stops taking input, so nobody walks off while reading.
    if (ui.friends?.isOpen || ui.stats?.isOpen) {
      this.controls.reset();
      return;
    }

    this.player.update(time, this.controls.heldDirection());

    // The mug rides along with the player. Positioned here rather than parented
    // to the sprite so it keeps the depth sorting the rest of the world uses.
    if (this.drinkIcon) {
      this.drinkIcon
        .setPosition(this.player.sprite.x - 15, this.player.sprite.y - 30)
        .setDepth(this.player.sprite.y + 401);
    }

    if (this.controls.justPressed('interact')) {
      // Only confirm a press that actually hit something — a pulse on empty
      // ground would say "that worked" when nothing did.
      if (this.interactions.tryInteract(this.player.tile, this.player.facing)) {
        const target = tileInFront(this.player.tile, this.player.facing);
        this.fx.interactPulse(target.x, target.y);
      }
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
      // The chosen outfit, generated on demand. Falls back to the default
      // sheet when nothing has been picked.
      textureKey: this.outfitTexture(),
      isWalkable: this.zoneMap.isWalkable,
      // Intent is sent as the step COMMITS locally, not on arrival: the client
      // predicts immediately and the server validates in parallel (02).
      onDepart: (_from, _to, facing) => this.network?.sendMove(facing),
      onArrive: (tile) => {
        this.interactions.handleTileEntered(tile);
        // At the feet, not the centre: the sprite's origin is its base.
        this.fx.footstep(this.player.sprite.x, this.player.sprite.y);
      },
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

  /**
   * Chat input.
   *
   * Hooked at the keyboard rather than through InputController because the
   * composer needs raw characters, not mapped game actions — and because while
   * it is open the world must receive NOTHING. Typing "swwwd" to a friend
   * should not walk you into a pond.
   */
  private setupChatInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    const onKey = (event: KeyboardEvent) => {
      // Focus Mode is a full-screen scene with its own keys (P pauses, Esc
      // finishes). Every one of them also means something out here — P is the
      // stats panel, M the mic — so the world stops listening entirely rather
      // than acting on keys aimed at the scene covering it.
      if (focusMode.active || worldMap.active) return;

      const chat = ui.chat;
      if (!chat) return;

      if (chat.isComposing) {
        if (event.key === 'Enter') {
          chat.submit();
          this.controls.reset();
          return;
        }
        if (event.key === 'Escape') {
          chat.cancel();
          this.controls.reset();
          return;
        }
        chat.handleKey(event);
        return;
      }

      // Enter opens the composer, but not on top of a dialogue box or panel —
      // those already own the keyboard.
      if (ui.drinks?.isOpen) {
        ui.drinks.handleKey(event);
        if (!ui.drinks.isOpen) this.player?.setBlocked(false);
        this.controls.reset();
        return;
      }

      // The jukebox panel is modal while open.
      if (ui.jukebox?.isOpen) {
        const wasOpen = ui.jukebox.isOpen;
        ui.jukebox.handleKey(event);
        if (wasOpen && !ui.jukebox.isOpen) this.player?.setBlocked(false);
        this.controls.reset();
        return;
      }

      if (event.key === 'Enter' && !ui.dialogue?.isVisible && !ui.friends?.isOpen) {
        chat.open();
        this.controls.reset();
        return;
      }

      // 05: a manual override is always available, whatever the zone default.
      if (event.key.toLowerCase() === 'm' && !ui.dialogue?.isVisible && !ui.friends?.isOpen) {
        void this.voice?.toggleMute(this.zone);
      }

      // Stats. Its own key rather than a tab inside the friends panel: what you
      // have done and who is here are different questions, and burying one
      // behind the other means neither is found.
      if (event.key.toLowerCase() === 'p' && !ui.dialogue?.isVisible && !ui.friends?.isOpen) {
        ui.stats?.toggle();
        this.controls.reset();
      }

      // The journey: where your focus time has taken you, and where it can.
      if (event.key.toLowerCase() === 'j' && !ui.dialogue?.isVisible && !ui.friends?.isOpen) {
        this.scene.launch(WorldMapScene.KEY);
        this.controls.reset();
      }
    };

    keyboard.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', onKey));
  }

  /**
   * Start, move or stop the local audio to match the room.
   *
   * The offset is computed from the SERVER's clock, corrected for the gap
   * between the two machines, so someone who walks in halfway through a track
   * hears the same bar as everyone already standing there (03).
   */
  private applyJukeboxAudio(state: import('@commons/shared').JukeboxState): void {
    const audio = this.jukeboxAudio;
    if (!audio) return;

    if (!state.now) {
      audio.stop();
      return;
    }

    // Offset as of the moment the server SENT this, which is a few ms ago.
    //
    // Written directly rather than as `Date.now() + (serverNow - Date.now())`,
    // which reduces to exactly this and only looked like a skew correction.
    // Network transit is not compensated: it is tens of ms at worst, well under
    // the 900ms drift guard in JukeboxPlayer.play(), so correcting for it would
    // add a round-trip estimator for an error nobody can hear. The panel's
    // progress bar DOES hold a skew, because it re-derives server time every
    // frame from a reading taken once.
    const offsetMs = state.serverNow - state.startedAt;

    // Past the end already (a stale message, or a long round trip): let the
    // next broadcast place us rather than starting a track that has finished.
    if (offsetMs < 0 || offsetMs > state.now.track.durationMs) {
      audio.stop();
      return;
    }

    audio.play(state.now.track, offsetMs);
  }

  /**
   * Hand the screen to a minigame.
   *
   * The zone is PAUSED rather than stopped, so returning puts the player back
   * exactly where they were standing, still facing the cabinet, still in the
   * same Colyseus room — walking out of the arcade and back in again to resume
   * would be a much worse experience for a two-minute game.
   */
  protected launchMinigame(sceneKey: string): void {
    if (this.transitioning) return;
    this.player.setBlocked(true);
    ui.friends?.close();
    this.scene.pause();
    this.scene.launch(sceneKey, { returnScene: this.zone.sceneKey });
    this.scene.bringToTop(sceneKey);
  }

  /**
   * Texture for the player's chosen outfit (06).
   *
   * Cosmetic-only: this changes the colour of a sprite and nothing else.
   */
  /**
   * Push the world camera in on the player, then hand the screen to FocusScene.
   *
   * The zoom happens HERE, on the real world camera, rather than being faked
   * inside the overlay: the camera already follows the player, so zooming it is
   * genuinely moving toward your avatar, and the scrim fading in over the top
   * hides the swap. Leaving Focus Mode reverses it.
   */
  private enterFocusMode(): void {
    if (focusMode.active) return;

    const camera = this.cameras.main;
    const previousZoom = camera.zoom;

    camera.zoomTo(previousZoom * FOCUS.enter.cameraZoom, FOCUS.enter.cameraZoomMs, 'Cubic.easeInOut');

    const outfitId = session.cosmetic('outfit');
    const hatId = session.cosmetic('hat');
    const outfit = outfitId ? getCosmeticById(outfitId) : undefined;
    const hat = hatId ? getCosmeticById(hatId) : undefined;

    this.scene.launch(FocusScene.KEY, {
      bodyColor: outfit?.color ?? COLORS.playerBody,
      hat: hat?.style ? { color: hat.color, style: hat.style } : undefined,
      zoneName: this.zone.displayName,
      onExit: () => {
        camera.zoomTo(previousZoom, FOCUS.exit.cameraRestoreMs, 'Cubic.easeInOut');
        // Standing is what ENDS the session: it stops the focus timer and
        // tells the server, exactly as pressing Space at the pod would.
        this.interactions.tryInteract(this.player.tile, this.player.facing);

        // Then progression reads what the SERVER recorded — not what the
        // client's clock thought — and says what it was worth. Nothing about
        // the avatar or the camera is involved; this is a different system
        // reacting to the same event.
        void progression.sessionEnded().then((result) => {
          if (result.added <= 0) return;
          ui.summary?.show(result.added, result.total, result.unlocked);
          for (const world of result.unlocked) progression.markCelebrated(world.id);
        });
      },
      onPauseChange: (paused) => {
        if (paused) ui.focus?.pause();
        else ui.focus?.resume();
        this.network?.sendFocusPause(paused);
      },
    } satisfies FocusSceneData);
  }

  private outfitTexture(): string {
    const outfitId = session.cosmetic('outfit');
    const hatId = session.cosmetic('hat');
    const outfit = outfitId ? getCosmetic(outfitId) : undefined;
    const hat = hatId ? getCosmetic(hatId) : undefined;

    // Nothing chosen in either slot: the default sheet, untouched.
    if (!outfit && !hat) return session.spriteKey;

    return ensureOutfitSheet(
      this,
      outfit?.color ?? COLORS.playerBody,
      hat?.style ? { color: hat.color, style: hat.style } : undefined,
    );
  }

  /**
   * Draw (or clear) the mug over the local player.
   *
   * The local player has no nameplate, so this is the only feedback that the
   * order actually happened for the person who placed it.
   */
  private applyLocalDrink(): void {
    if (!this.drink) {
      this.drinkIcon?.destroy();
      this.drinkIcon = undefined;
      return;
    }

    const key = drinkTextureKey(this.drink);
    if (!this.textures.exists(key)) return;

    if (!this.drinkIcon) {
      this.drinkIcon = this.add.image(0, 0, key).setOrigin(0.5, 1);
    } else {
      this.drinkIcon.setTexture(key);
    }
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
    sfx.transition();
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
      onRemoteAppeared: (x, y) => this.fx.arrival(x, y, COLORS.statusStudying),
    });

    try {
      await network.joinZone(
        this.zone.id,
        {
          displayName: session.displayName ?? 'Wanderer',
          spriteKey: session.spriteKey,
          fromZone: this.sceneData.fromZone,
          userId: session.userId,
        },
        {
          onPlayerAdd: (state, id) => this.multiplayer?.handlePlayerAdd(state, id),
          onPlayerChange: (state, id) => this.multiplayer?.handlePlayerChange(state, id),
          onPlayerRemove: (id) => this.multiplayer?.handlePlayerRemove(id),
          onCorrection: (message) => this.multiplayer?.handleCorrection(message),
          onChat: (message) => {
            ui.chat?.append(message);
            // Your own words appear in the log; the bubble belongs over the
            // OTHER person's head, since you can already see what you typed.
            if (message.authorId !== network.sessionId) {
              this.multiplayer?.showChatBubble(message.authorId, message.text);
            }
          },
          onJukebox: (state) => {
            ui.jukebox?.applyState(state);
            this.applyJukeboxAudio(state);
          },
          onJukeboxRejected: ({ reason }) => {
            ui.chat?.system(
              reason === 'rate_limited'
                ? 'give the jukebox a moment'
                : reason === 'queue_full'
                  ? 'the queue is full'
                  : 'that track is not in the catalogue',
            );
          },
          onChatRejected: ({ reason }) => {
            ui.chat?.system(
              reason === 'rate_limited'
                ? 'slow down a moment'
                : reason === 'too_long'
                  ? 'that message was too long'
                  : 'nothing to send',
            );
          },
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

      // 05: the voice room maps to the same zone boundary, and the zone's
      // default mute applies automatically on arrival.
      //
      // The Colyseus session is handed over as proof of presence: the server
      // mints a voice token only for someone actually in that room, and takes
      // their identity from its own record rather than from the request.
      const roomId = network.roomId;
      const sessionId = network.sessionId;
      if (roomId && sessionId) void this.voice?.joinZone(this.zone, { roomId, sessionId });
      else void this.voice?.joinZone(this.zone);
    } catch (error) {
      console.warn('[net] offline — running single-player:', (error as Error).message);
      ui.hud?.setConnected(false);
      this.network = undefined;
    }
  }

  private teardown(): void {
    this.jukeboxAudio?.destroy();
    this.jukeboxAudio = undefined;
    void this.voice?.leave();
    this.voice = undefined;
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

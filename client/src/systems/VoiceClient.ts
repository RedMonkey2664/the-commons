/**
 * Voice chat client — 05, Phase 4.
 *
 * Asks the server for a token and hands it to a provider SDK. 05 says not to
 * hand-roll a mesh, so this file contains no WebRTC: it is a state machine and
 * a mute policy, with a provider adapter behind a dynamic import.
 *
 * ---------------------------------------------------------------------------
 * STATUS
 *
 * The mute policy, zone-default application, manual override, state machine and
 * failure reporting are complete and exercised by the Phase 4 test.
 *
 * The TRANSPORT is unverified — LiveKit credentials were not available, so
 * `connect()` has never actually carried audio. When the server reports
 * `not_configured`, this class settles into that state deliberately so the HUD
 * can say "voice isn't set up" rather than showing a dead mic button.
 * ---------------------------------------------------------------------------
 */

import type {
  VoiceAvailability,
  VoiceConnectionState,
  VoiceParticipant,
  ZoneConfig,
} from '@commons/shared';
import { shouldStartMuted, voiceRoomFor } from '@commons/shared';
import { session } from '../session';

interface TokenResponse {
  availability: VoiceAvailability;
  room?: string;
  token?: string;
  url?: string;
  identity?: string;
}

/** Minimal shape of the LiveKit Room we use, so the SDK stays optional. */
interface ProviderRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  };
}

export interface VoiceHandlers {
  onStateChanged?: (state: VoiceConnectionState, availability: VoiceAvailability) => void;
  onMuteChanged?: (muted: boolean) => void;
  onParticipants?: (participants: VoiceParticipant[]) => void;
}

export class VoiceClient {
  private room?: ProviderRoom;
  private handlers: VoiceHandlers = {};

  private connection: VoiceConnectionState = 'idle';
  private availability: VoiceAvailability = 'ready';
  private muted = true;

  // Per-zone manual overrides live on the session, not here: a VoiceClient is
  // rebuilt every time a zone scene is created, so anything stored on it is
  // lost the moment the player walks out and back in. See Session.voiceOverride.

  setHandlers(handlers: VoiceHandlers): void {
    this.handlers = handlers;
  }

  get state(): VoiceConnectionState {
    return this.connection;
  }

  get availabilityState(): VoiceAvailability {
    return this.availability;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isConnected(): boolean {
    return this.connection === 'connected';
  }

  /**
   * Join the voice room for a zone.
   *
   * The mute decision is made BEFORE any connection attempt, so the correct
   * state is shown even when voice is not configured — walking into the Library
   * should read as "muted" whether or not there is a provider behind it.
   */
  async joinZone(zone: ZoneConfig): Promise<void> {
    this.muted = shouldStartMuted(zone.voiceChatDefault, session.voiceOverride(zone.id));
    this.handlers.onMuteChanged?.(this.muted);

    await this.leave();
    this.setState('connecting');

    let response: TokenResponse;
    try {
      const base = session.serverUrl.replace(/^ws/, 'http').replace(/\/$/, '');
      const result = await fetch(`${base}/voice/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          zoneId: zone.id,
          identity: session.userId,
          displayName: session.displayName ?? 'Wanderer',
        }),
      });
      response = (await result.json()) as TokenResponse;
    } catch {
      this.availability = 'unavailable';
      this.setState('idle');
      return;
    }

    if (response.availability !== 'ready' || !response.token || !response.url) {
      // Not an error: the common case is simply that no provider is configured.
      this.availability = response.availability ?? 'not_configured';
      this.setState('idle');
      return;
    }

    this.availability = 'ready';

    try {
      const livekit = (await import('livekit-client')) as unknown as {
        Room: new () => ProviderRoom;
      };
      const room = new livekit.Room();
      await room.connect(response.url, response.token);
      this.room = room;

      // Apply the zone's mute decision to the actual microphone.
      await room.localParticipant.setMicrophoneEnabled(!this.muted);
      this.setState('connected');
    } catch (error) {
      // A refused microphone is a different problem from a missing provider,
      // and the HUD says so rather than showing one generic failure.
      const message = String((error as Error)?.message ?? '');
      this.availability = /permission|NotAllowed/i.test(message) ? 'no_permission' : 'unavailable';
      this.setState('failed');
      console.warn('[voice] could not connect:', message);
    }
  }

  /** Manual mute toggle. Remembered for this zone. */
  async toggleMute(zone: ZoneConfig): Promise<void> {
    this.muted = !this.muted;
    session.setVoiceOverride(zone.id, this.muted);
    this.handlers.onMuteChanged?.(this.muted);

    try {
      await this.room?.localParticipant.setMicrophoneEnabled(!this.muted);
    } catch (error) {
      console.warn('[voice] could not change microphone state:', (error as Error).message);
    }
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = undefined;
    if (room) {
      await room.disconnect().catch(() => undefined);
    }
    if (this.connection !== 'idle') this.setState('idle');
  }

  private setState(state: VoiceConnectionState): void {
    if (this.connection === state) return;
    this.connection = state;
    this.handlers.onStateChanged?.(state, this.availability);
  }
}

export { voiceRoomFor };

/**
 * Zone text chat — 05.
 *
 * "Lightweight proximity or zone-wide text chat (start with zone-wide, it's
 * simpler and fine for room sizes of 2-8 people) — a chat bubble over the
 * avatar plus a persistent chat log panel."
 *
 * Zone-wide it is. 11 lists proximity chat as an open question to revisit after
 * playtesting, so the message shape carries no positional data yet — adding it
 * later is additive rather than a rewrite.
 */

export const CHAT_CLIENT_MESSAGE = {
  say: 'chat:say',
} as const;

export const CHAT_SERVER_MESSAGE = {
  message: 'chat:message',
  /** Sent to the author when the server drops their message. */
  rejected: 'chat:rejected',
} as const;

export interface ChatSayIntent {
  text: string;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  displayName: string;
  text: string;
  /** Server clock, so ordering does not depend on client clocks. */
  sentAt: number;
  /** System lines (joins, leaves, notices) render differently. */
  system?: boolean;
}

export interface ChatRejected {
  reason: 'rate_limited' | 'empty' | 'too_long';
}

export const CHAT_LIMITS = {
  maxLength: 200,
  /** Kept client-side; the log is a conversation, not a transcript. */
  historySize: 60,
  /** How long a bubble stays over the speaker's head. */
  bubbleMs: 4200,
  /** Longest text shown in a bubble before it is elided into the panel. */
  bubbleMaxChars: 90,
} as const;

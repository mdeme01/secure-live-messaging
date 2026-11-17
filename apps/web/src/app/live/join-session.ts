import { ErrorCode, type JoinAck, type JoinRequest } from '@slm/protocol';
import type { LiveTransport } from './transport';

/**
 * A role can look taken by our own previous connection for a moment: after a refresh the
 * server may see the new join before the old socket's close, and after a network drop it
 * only notices within one heartbeat (HEARTBEAT in @slm/protocol). So ROLE_TAKEN is retried briefly before it
 * is believed. First join: one retry. Rejoin: back off across the heartbeat window.
 */
export const FIRST_JOIN_RETRY_DELAYS_MS: readonly number[] = [1_000];
export const REJOIN_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 10_000];

/** Joins, retrying ROLE_TAKEN after each delay. Null if `isCurrent` turned false meanwhile. */
export async function joinSession(
  transport: LiveTransport,
  request: JoinRequest,
  retryDelaysMs: readonly number[],
  isCurrent: () => boolean,
): Promise<JoinAck | null> {
  for (let attempt = 0; ; attempt++) {
    const ack = await transport.join(request);
    if (!isCurrent()) return null;
    if (ack.ok || ack.error !== ErrorCode.RoleTaken || attempt >= retryDelaysMs.length) return ack;
    await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    if (!isCurrent()) return null;
  }
}

/**
 * A join can go unanswered (ack timeout) while the connection stays up, so no reconnect
 * will trigger a new one: try again after this pause.
 */
export const UNANSWERED_JOIN_RETRY_MS = 1_000;

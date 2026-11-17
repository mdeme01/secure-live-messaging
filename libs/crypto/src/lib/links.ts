import { isSenderToken, isSessionId, isSessionKey } from '@slm/protocol';

/**
 * Links carry their secrets in the URL fragment, which browsers never send to the server.
 *   Receiver Link: /r/{sessionId}#k={sessionKey}
 *   Sender Link:   /s/{sessionId}#k={sessionKey}&t={senderToken}
 */

export const RECEIVER_ROUTE = 'r';
export const SENDER_ROUTE = 's';

export interface ReceiverLink {
  sessionId: string;
  sessionKey: string;
}

export interface SenderLink extends ReceiverLink {
  senderToken: string;
}

/** Path + fragment of a Receiver Link. Never includes the Sender Token. */
export function receiverLinkPath({ sessionId, sessionKey }: ReceiverLink): string {
  return `/${RECEIVER_ROUTE}/${sessionId}#k=${sessionKey}`;
}

export function senderLinkPath({ sessionId, sessionKey, senderToken }: SenderLink): string {
  return `/${SENDER_ROUTE}/${sessionId}#k=${sessionKey}&t=${senderToken}`;
}

function fragmentParams(fragment: string | null): URLSearchParams | null {
  if (!fragment) return null;
  return new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
}

/** Parses the route's Session ID and fragment; null if anything is missing or malformed. */
export function parseReceiverLink(
  sessionId: string | null,
  fragment: string | null,
): ReceiverLink | null {
  const params = fragmentParams(fragment);
  const sessionKey = params?.get('k');
  if (!isSessionId(sessionId) || !isSessionKey(sessionKey)) return null;
  return { sessionId, sessionKey };
}

export function parseSenderLink(
  sessionId: string | null,
  fragment: string | null,
): SenderLink | null {
  const receiver = parseReceiverLink(sessionId, fragment);
  const senderToken = fragmentParams(fragment)?.get('t');
  if (!receiver || !isSenderToken(senderToken)) return null;
  return { ...receiver, senderToken };
}

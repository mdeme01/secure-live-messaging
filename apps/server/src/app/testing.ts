import { randomBytes } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import {
  SESSIONS_PATH,
  SOCKET_PATH,
  type ClientToServerEvents,
  type SealedUpdate,
  type ServerToClientEvents,
} from '@slm/protocol';

/** Test-only helpers for driving the server through its public interface. */

export type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

export const newSessionId = () => randomBytes(16).toString('base64url');

export const fakeUpdate = (seq: number, fill = 'B'): SealedUpdate => ({
  seq,
  iv: 'A'.repeat(16),
  ciphertext: fill.repeat(363),
});

export async function createSession(
  baseUrl: string,
  sessionId = newSessionId(),
  update0 = fakeUpdate(0),
): Promise<{ sessionId: string; senderToken: string; update0: SealedUpdate }> {
  const res = await fetch(`${baseUrl}${SESSIONS_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, update: update0 }),
  });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  const { senderToken } = await res.json();
  return { sessionId, senderToken, update0 };
}

export async function connectClient(
  baseUrl: string,
  auth: Record<string, unknown> = {},
): Promise<TestClient> {
  const socket: TestClient = connect(baseUrl, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    auth,
    forceNew: true,
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

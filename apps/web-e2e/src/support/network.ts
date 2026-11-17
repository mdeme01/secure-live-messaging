import type { Page, WebSocketRoute } from '@playwright/test';

/** How long a client may take to notice a restored network and rejoin (socket.io backoff). */
export const RECONNECT_TIMEOUT_MS = 15_000;

/** socket.io acknowledgement frame: engine.io "message" (4) + socket.io "ack" (3). */
const ACK_FRAME_PREFIX = '43';

/**
 * Routes a page's live connection through the test so it can be cut, as if the network
 * dropped. While cut, the client's reconnect attempts are refused; `restore()` lets them through.
 */
export async function controllableNetwork(page: Page) {
  let online = true;
  const liveConnections = new Set<{ client: WebSocketRoute; server: WebSocketRoute }>();
  await page.routeWebSocket(/\/socket\.io\//, async (client) => {
    if (!online) {
      await client.close();
      return;
    }
    const server = client.connectToServer();
    const connection = { client, server };
    liveConnections.add(connection);
    const closeBoth = async () => {
      liveConnections.delete(connection);
      await Promise.all([client.close(), server.close()]);
    };
    client.onClose(closeBoth);
    server.onClose(closeBoth);
  });
  return {
    async drop(): Promise<void> {
      online = false;
      const closing = [...liveConnections].flatMap(({ client, server }) => [
        client.close(),
        server.close(),
      ]);
      liveConnections.clear();
      await Promise.all(closing);
    },
    restore(): void {
      online = true;
    },
  };
}

/** Counts the server's acknowledgements on a page's live connection (joins and publishes). */
export function countServerAcks(page: Page): () => number {
  let acks = 0;
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string' && payload.startsWith(ACK_FRAME_PREFIX)) acks++;
    }),
  );
  return () => acks;
}

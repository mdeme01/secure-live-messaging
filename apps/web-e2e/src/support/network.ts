import type { Page, WebSocketRoute } from '@playwright/test';

/**
 * Routes a page's live connection through the test so it can be cut, as if the network
 * dropped. While cut, the client's reconnect attempts are refused; `restore()` lets them through.
 */
export async function controllableNetwork(page: Page) {
  let up = true;
  const open = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (!up) return void ws.close();
    const server = ws.connectToServer();
    const pair = { page: ws, server };
    open.add(pair);
    ws.onClose(() => (open.delete(pair), server.close()));
    server.onClose(() => (open.delete(pair), ws.close()));
  });
  return {
    drop: () => {
      up = false;
      for (const { page, server } of open) {
        page.close();
        server.close();
      }
      open.clear();
    },
    restore: () => (up = true),
  };
}

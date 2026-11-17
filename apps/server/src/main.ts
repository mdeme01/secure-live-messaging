import { buildServer } from './app/server';

const host = process.env['HOST'] ?? 'localhost';
const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;

async function main(): Promise<void> {
  const server = buildServer({ logger: true });
  const address = await server.listen(port, host);
  console.log(`[ ready ] ${address}`);

  // Lets `nx serve` (and the e2e runner) know the server is ready.
  if (process.env['NX_READY_SIGNAL_SOCKET']) {
    // Indirect import keeps bundlers from resolving this dev-only helper.
    const load = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
    load('@nx/js/ready-signal')
      .then((m) => m.emitReadySignal(server.http.server))
      .catch(() => undefined);
  }

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

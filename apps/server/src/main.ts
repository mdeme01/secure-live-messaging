import { buildServer } from './app/server';

const host = process.env['HOST'] ?? 'localhost';
const port = process.env['PORT'] ? Number(process.env['PORT']) : 3000;

async function main(): Promise<void> {
  const server = buildServer({ logger: true });
  const address = await server.listen(port, host);
  console.log(`[ ready ] ${address}`);

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

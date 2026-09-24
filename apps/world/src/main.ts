import { loadConfig } from './config.js';
import { Engine } from './engine.js';
import { createHttpServer } from './http.js';
import { FileStore, PgStore, type Store } from './store.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  let store: Store;
  if (cfg.databaseUrl) {
    const pgStore = new PgStore(cfg.databaseUrl);
    await pgStore.migrate();
    store = pgStore;
  } else {
    store = new FileStore(cfg.snapshotDir);
  }
  const engine = new Engine(cfg, store);
  await engine.init();
  engine.start();
  const server = createHttpServer(engine);
  server.listen(cfg.port, cfg.host, () => {
    console.log(JSON.stringify({ msg: 'world up', host: cfg.host, port: cfg.port, seed: cfg.seasonSeed, timeScale: cfg.timeScale, store: cfg.databaseUrl ? 'postgres' : 'file', colonies: Object.keys(engine.world.colonies).length }));
  });
  const shutdown = async (): Promise<void> => {
    console.log(JSON.stringify({ msg: 'shutting down' }));
    server.close();
    await engine.stop();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => { console.error(err); process.exit(1); });
